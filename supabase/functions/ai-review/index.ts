// Claude's weekly review for the MD office (admin only). Reads the week straight from the database.
import { cors, getCaller, HttpError, json, serviceClient, str } from "../_shared/claude.ts";
import { review } from "../_shared/jobs.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile } = await getCaller(req);
    if (profile.role !== "admin") throw new HttpError(403, "Only the MD office (admin) can generate the review.");
    const b = await req.json();
    const week = str(b.week, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new HttpError(400, "Missing week.");
    const data = await review(serviceClient(), week, profile.id);
    return json({ ok: true, review: data });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
