// Claude's weekly review for the MD office (admin only), in Malayalam. Reads the week straight from the database.
// It runs in the background: the app gets an answer at once, and the review appears when it is saved (about 1 minute).
import { cors, getCaller, HttpError, json, serviceClient, str } from "../_shared/claude.ts";
import { review } from "../_shared/jobs.ts";
import { logJob } from "../_shared/data.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile } = await getCaller(req);
    if (profile.role !== "admin") throw new HttpError(403, "Only the MD office (admin) can generate the review.");
    const b = await req.json();
    const week = str(b.week, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new HttpError(400, "Missing week.");
    const db = serviceClient();
    console.log("ai-review: start", week);
    const work = review(db, week, profile.id)
      .then(() => console.log("ai-review: saved", week))
      .catch(async (e) => { console.error("ai-review: failed", e instanceof Error ? e.message : e); await logJob(db, "review", week, false, e instanceof Error ? e.message : String(e)); });
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === "function") { rt.waitUntil(work); return json({ ok: true, started: true }); }
    await work;
    return json({ ok: true, started: false });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
