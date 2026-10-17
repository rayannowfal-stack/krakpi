// admin-users — single-file version to paste into Supabase → Edge Functions → Deploy a new function → Via Editor (function name: admin-users). Generated from supabase/functions/admin-users; edit the originals, not this file.

// supabase/functions/_shared/claude.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}
async function getCaller(req) {
  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } }
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new HttpError(401, "Please sign in again.");
  const { data: profile } = await supabase.from("profiles").select("id, role, dept_id").eq("id", user.id).maybeSingle();
  if (!profile || profile.role === "pending") throw new HttpError(403, "Your account is waiting for the admin to give you access.");
  return { supabase, user, profile };
}
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
var str = (v, max = 600) => String(v ?? "").slice(0, max);

// supabase/functions/_shared/core.js
function normPhone(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : "";
}
function normUsername(s) {
  const u = String(s || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u) ? u : "";
}
var LOGIN_DOMAIN = "u.atlas-kpi.app";
var userLogin = (username) => `${username}@${LOGIN_DOMAIN}`;

// supabase/functions/admin-users/index.ts
var ROLES = ["admin", "hod", "viewer", "pending"];
var BAD_USERNAME = "Username: 3\u201330 letters or numbers (dot, dash and underscore allowed), no spaces.";
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile: me } = await getCaller(req);
    if (me.role !== "admin") throw new HttpError(403, "Only an admin can manage users.");
    const db = serviceClient();
    const b = await req.json();
    const action = str(b.action, 20);
    const usernameTaken = async (username, notId) => {
      let q = db.from("profiles").select("id").eq("username", username);
      if (notId) q = q.neq("id", notId);
      const { data } = await q.maybeSingle();
      return !!data;
    };
    const phoneTaken = async (phone, notId) => {
      let q = db.from("profiles").select("id").eq("phone", phone);
      if (notId) q = q.neq("id", notId);
      const { data } = await q.maybeSingle();
      return !!data;
    };
    if (action === "create") {
      const username = normUsername(b.username);
      if (!username) throw new HttpError(400, BAD_USERNAME);
      const password = String(b.password || "");
      if (password.length < 6) throw new HttpError(400, "Password must be at least 6 characters.");
      const phone = b.phone ? normPhone(b.phone) : null;
      if (b.phone && !phone) throw new HttpError(400, "Enter a valid 10-digit mobile number (or leave it empty).");
      const role = ROLES.includes(b.role) ? b.role : "hod";
      if (await usernameTaken(username)) throw new HttpError(409, "This username is already taken.");
      if (phone && await phoneTaken(phone)) throw new HttpError(409, "Another account already uses this mobile number.");
      const { data, error } = await db.auth.admin.createUser({
        email: userLogin(username),
        password,
        email_confirm: true,
        user_metadata: { full_name: str(b.full_name, 120), username, phone }
      });
      if (error) throw new HttpError(400, /already/i.test(error.message) ? "This username is already taken." : error.message);
      const up = await db.from("profiles").update({ full_name: str(b.full_name, 120), username, email: null, phone, role, dept_id: b.dept_id || null }).eq("id", data.user.id);
      if (up.error) throw new HttpError(400, up.error.message);
      return json({ ok: true, id: data.user.id, username });
    }
    const userId = str(b.user_id, 64);
    if (!userId) throw new HttpError(400, "Missing user.");
    if (action === "set_password") {
      const password = String(b.password || "");
      if (password.length < 6) throw new HttpError(400, "Password must be at least 6 characters.");
      const { error } = await db.auth.admin.updateUserById(userId, { password });
      if (error) throw new HttpError(400, error.message);
      return json({ ok: true });
    }
    if (action === "update") {
      const patch = {};
      if (b.full_name !== void 0) patch.full_name = str(b.full_name, 120);
      if (b.role !== void 0) {
        if (!ROLES.includes(b.role)) throw new HttpError(400, "Unknown role.");
        if (userId === me.id && b.role !== "admin") throw new HttpError(400, "You can't remove your own admin role.");
        patch.role = b.role;
      }
      if (b.dept_id !== void 0) patch.dept_id = b.dept_id || null;
      if (b.phone !== void 0) {
        const phone = b.phone ? normPhone(b.phone) : null;
        if (b.phone && !phone) throw new HttpError(400, "Enter a valid 10-digit mobile number.");
        if (phone && await phoneTaken(phone, userId)) throw new HttpError(409, "Another account already uses this mobile number.");
        patch.phone = phone;
      }
      if (b.username !== void 0) {
        const username = normUsername(b.username);
        if (!username) throw new HttpError(400, BAD_USERNAME);
        if (await usernameTaken(username, userId)) throw new HttpError(409, "This username is already taken.");
        const { error: error2 } = await db.auth.admin.updateUserById(userId, { email: userLogin(username), email_confirm: true });
        if (error2) throw new HttpError(400, error2.message);
        patch.username = username;
        patch.email = null;
      }
      const { error } = await db.from("profiles").update(patch).eq("id", userId);
      if (error) throw new HttpError(400, error.message);
      return json({ ok: true });
    }
    if (action === "delete") {
      if (userId === me.id) throw new HttpError(400, "You can't delete your own account.");
      const { error } = await db.auth.admin.deleteUser(userId);
      if (error) throw new HttpError(400, error.message);
      return json({ ok: true });
    }
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
