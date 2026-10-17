// Admin-only user management. People log in with a USERNAME + password (no email at all).
// The mobile number is only for the WhatsApp bot.
// Actions: create, update, set_password, delete.
import { cors, getCaller, HttpError, json, serviceClient, str } from "../_shared/claude.ts";
import { normPhone, normUsername, userLogin } from "../_shared/core.js";

const ROLES = ["admin", "hod", "viewer", "pending"];
const BAD_USERNAME = "Username: 3–30 letters or numbers (dot, dash and underscore allowed), no spaces.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile: me } = await getCaller(req);
    if (me.role !== "admin") throw new HttpError(403, "Only an admin can manage users.");
    const db = serviceClient();
    const b = await req.json();
    const action = str(b.action, 20);

    const usernameTaken = async (username: string, notId?: string) => {
      let q = db.from("profiles").select("id").eq("username", username);
      if (notId) q = q.neq("id", notId);
      const { data } = await q.maybeSingle();
      return !!data;
    };
    const phoneTaken = async (phone: string, notId?: string) => {
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
        email: userLogin(username), password, email_confirm: true,
        user_metadata: { full_name: str(b.full_name, 120), username, phone },
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
      const patch: Record<string, unknown> = {};
      if (b.full_name !== undefined) patch.full_name = str(b.full_name, 120);
      if (b.role !== undefined) { if (!ROLES.includes(b.role)) throw new HttpError(400, "Unknown role."); if (userId === me.id && b.role !== "admin") throw new HttpError(400, "You can't remove your own admin role."); patch.role = b.role; }
      if (b.dept_id !== undefined) patch.dept_id = b.dept_id || null;
      if (b.phone !== undefined) {
        const phone = b.phone ? normPhone(b.phone) : null;
        if (b.phone && !phone) throw new HttpError(400, "Enter a valid 10-digit mobile number.");
        if (phone && await phoneTaken(phone, userId)) throw new HttpError(409, "Another account already uses this mobile number.");
        patch.phone = phone;
      }
      if (b.username !== undefined) {
        // the username IS the login: change the hidden login address with it
        const username = normUsername(b.username);
        if (!username) throw new HttpError(400, BAD_USERNAME);
        if (await usernameTaken(username, userId)) throw new HttpError(409, "This username is already taken.");
        const { error } = await db.auth.admin.updateUserById(userId, { email: userLogin(username), email_confirm: true });
        if (error) throw new HttpError(400, error.message);
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
