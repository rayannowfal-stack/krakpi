// Claude check of one department's weekly sheet (from the app's "Check with Claude" button).
// Questions come back in Malayalam. Only that department's HOD or an admin may call it.
import { cors, getCaller, HttpError, json, str, strArr } from "../_shared/claude.ts";
import { checkSheet } from "../_shared/ai.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile } = await getCaller(req);
    const b = await req.json();
    const deptId = str(b.deptId, 80);
    if (!(profile.role === "admin" || (profile.role === "hod" && profile.dept_id === deptId))) {
      throw new HttpError(403, "Only this department's HOD or an admin can run the Claude check.");
    }
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 80) : [];
    if (!rows.length) throw new HttpError(400, "Enter your results first.");
    const out = await checkSheet({
      deptName: str(b.deptName, 80), hod: str(b.hod, 120), week: str(b.week, 40), meeting: str(b.meeting, 40),
      rows, missing: strArr(b.missing, 40), priorities: strArr(b.priorities, 5), support: str(b.support, 1500),
      clarifications: Array.isArray(b.clarifications) ? b.clarifications.slice(0, 40) : [],
    });
    return json(out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
