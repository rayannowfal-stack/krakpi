// Saturday schedule and admin buttons: kickoff, remind, review, ppt.
// Called by pg_cron (header x-cron-secret = CRON_SECRET) or by an admin from the app.
// Deploy with JWT verification OFF; this function checks the secret or the admin login itself.
import { cors, getCaller, HttpError, json, serviceClient } from "../_shared/claude.ts";
import { istToday, meetingWeek } from "../_shared/core.js";
import { kickoff, ppt, review } from "../_shared/jobs.ts";
import { logJob } from "../_shared/data.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = serviceClient();
  let action = "?", week = "";
  try {
    const secret = Deno.env.get("CRON_SECRET");
    const fromCron = !!secret && req.headers.get("x-cron-secret") === secret;
    let userId: string | null = null;
    if (!fromCron) {
      const { profile } = await getCaller(req);
      if (profile.role !== "admin") throw new HttpError(403, "Only an admin can run this.");
      userId = profile.id;
    }
    const b = await req.json().catch(() => ({}));
    action = String(b.action || "");
    week = /^\d{4}-\d{2}-\d{2}$/.test(String(b.week || "")) ? String(b.week) : meetingWeek(istToday());

    if (action === "kickoff") return json({ ok: true, ...(await kickoff(db, week, false)) });
    if (action === "remind") return json({ ok: true, ...(await kickoff(db, week, true)) });
    if (action === "review") return json({ ok: true, review: await review(db, week, userId) });
    if (action === "ppt") {
      const to = Array.isArray(b.to) ? b.to.map(String) : undefined;
      return json({ ok: true, ...(await ppt(db, week, { to, makeReview: b.makeReview !== false })) });
    }
    throw new HttpError(400, "Unknown action. Use kickoff, remind, review or ppt.");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(action, e);
    if (status === 500) await logJob(db, action, week || null, false, (e as Error).message).catch(() => {});
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
