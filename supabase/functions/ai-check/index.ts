// Claude check of ONE KPI the HOD has just filled in (app "Check with Claude" button).
// Claude reads the attached photos / PDFs, compares them with the figure, and asks questions in Malayalam.
// Only that department's HOD or an admin may call it; files are read with the caller's own permissions.
import { cors, getCaller, HttpError, json, str } from "../_shared/claude.ts";
import { checkKpi } from "../_shared/ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile, supabase } = await getCaller(req);
    const b = await req.json();
    const deptId = str(b.deptId, 80), week = str(b.week, 10);
    if (!(profile.role === "admin" || (profile.role === "hod" && profile.dept_id === deptId))) {
      throw new HttpError(403, "Only this department's HOD or an admin can run the Claude check.");
    }
    if (!b.kpi || typeof b.kpi !== "object") throw new HttpError(400, "Fill in the KPI first.");
    const files = (Array.isArray(b.files) ? b.files : []).slice(0, 8)
      .filter((f: { path?: string }) => typeof f?.path === "string" && f.path.startsWith(`${week}/${deptId}/`));
    const out = await checkKpi({
      deptName: str(b.deptName, 80), hod: str(b.hod, 120), week: str(b.weekLabel, 40), kpi: b.kpi,
      earlier: Array.isArray(b.earlier) ? b.earlier.slice(0, 10) : [], storage: supabase.storage, files,
    });
    return json(out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
