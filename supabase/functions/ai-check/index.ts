// Claude check of ONE KPI the HOD has just filled in (app "Check with Claude" button).
// Claude reads the attached photos / PDFs, compares them with the figure, and asks questions in Malayalam.
// Only that department's HOD or an admin may call it; files are read with the caller's own permissions.
import { cors, getCaller, HttpError, json, str } from "../_shared/claude.ts";
import { checkKpi, checkFiles } from "../_shared/ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile, supabase } = await getCaller(req);
    const b = await req.json();
    const deptId = str(b.deptId, 80), week = str(b.week, 10);
    if (!(profile.role === "admin" || (profile.role === "hod" && profile.dept_id === deptId))) {
      throw new HttpError(403, "Only this department's HOD or an admin can run the Claude check.");
    }
    if (b.mode === "files") {
      // File check by the MD office: admin only
      if (profile.role !== "admin") throw new HttpError(403, "Only the MD office (admin) can run a file check.");
      const files = (Array.isArray(b.files) ? b.files : []).slice(0, 6).filter((f: { path?: string }) => typeof f?.path === "string" && f.path.startsWith(`${week}/${deptId}/`));
      const texts = (Array.isArray(b.texts) ? b.texts : []).slice(0, 6).map((t: { name?: string; text?: string }) => ({ name: str(t?.name, 120), text: str(t?.text, 60000) }));
      if (!files.length && !texts.some((t: { text: string }) => t.text.trim()) && !str(b.answerText, 10).trim()) throw new HttpError(400, "Add a file (or the HOD's answer) first.");
      console.log(`ai-check files: ${deptId} · ${files.length} photo/PDF · ${texts.length} text file(s)${b.earlier ? " · answer round" : ""}`);
      const t0 = Date.now();
      const out = await checkFiles({ deptName: str(b.deptName, 80), hod: str(b.hod, 120), week: str(b.weekLabel, 40), kpis: Array.isArray(b.kpis) ? b.kpis.slice(0, 80) : [],
        texts, files, storage: supabase.storage, earlier: Array.isArray(b.earlier) ? b.earlier.slice(0, 12) : undefined, answerText: str(b.answerText, 6000) });
      console.log(`ai-check files: done in ${Date.now() - t0} ms · ${out.kpis.length} KPI(s) marked · ${out.questions.length} question(s)`);
      return json(out);
    }
    if (!b.kpi || typeof b.kpi !== "object") throw new HttpError(400, "Fill in the KPI first.");
    const files = (Array.isArray(b.files) ? b.files : []).slice(0, 8)
      .filter((f: { path?: string }) => typeof f?.path === "string" && f.path.startsWith(`${week}/${deptId}/`));
    console.log(`ai-check: ${profile.role} · ${deptId} · KPI ${str(b.kpi.no, 20)} · ${files.length} file(s)`);
    const t0 = Date.now();
    const out = await checkKpi({
      deptName: str(b.deptName, 80), hod: str(b.hod, 120), week: str(b.weekLabel, 40), kpi: b.kpi,
      earlier: Array.isArray(b.earlier) ? b.earlier.slice(0, 10) : [], storage: supabase.storage, files,
    });
    console.log(`ai-check: done in ${Date.now() - t0} ms · verdict ${out.verdict} · ${out.questions.length} question(s)`);
    return json(out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(`ai-check: failed (${status})`, e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
