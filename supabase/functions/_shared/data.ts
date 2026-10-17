// Loads a week's data on the server (service access), in the same shape the app uses.
import { addDays, buildDepts, istToday, mapAction, mapResult } from "./core.js";
// deno-lint-ignore no-explicit-any
type Db = any;

export async function loadWeek(db: Db, week: string) {
  const pw = addDays(week, -7);
  const [d, k, r, a, rv] = await Promise.all([
    db.from("departments").select("*"),
    db.from("kpis").select("*"),
    db.from("results").select("*").in("week", [week, pw]),
    db.from("actions").select("*"),
    db.from("reviews").select("*").eq("week", week).maybeSingle(),
  ]);
  for (const x of [d, k, r, a]) if (x.error) throw new Error(x.error.message);
  const results: Record<string, unknown> = {}, prev: Record<string, unknown> = {};
  // deno-lint-ignore no-explicit-any
  (r.data || []).forEach((row: any) => { const m = mapResult(row); (m.week === week ? results : prev)[m.dept] = m; });
  return {
    week,
    depts: buildDepts(d.data, k.data),
    results, prev,
    actions: (a.data || []).map(mapAction),
    review: rv.data ? { ...rv.data.data, at: rv.data.created_at } : null,
    today: istToday(),
  };
}

export async function logJob(db: Db, job: string, week: string | null, ok: boolean, detail: string) {
  await db.from("job_runs").insert({ job, week, ok, detail: detail.slice(0, 2000) });
}
