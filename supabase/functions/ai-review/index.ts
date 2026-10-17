// Claude's weekly review for the MD office: reads every department's sheet and writes the MD's view.
// Admin only. Saves the result in the `reviews` table (one row per meeting week).
import { askClaudeJson, cors, getCaller, HttpError, json, RATINGS, str, strArr } from "../_shared/claude.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { supabase, user, profile } = await getCaller(req);
    if (profile.role !== "admin") throw new HttpError(403, "Only the MD office (admin) can generate the review.");
    const b = await req.json();
    const week = str(b.week, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new HttpError(400, "Missing week.");
    const departments = Array.isArray(b.departments) ? b.departments.slice(0, 30) : [];
    let payload = JSON.stringify(departments);
    if (payload.length > 180000) payload = payload.slice(0, 180000);

    const prompt = `You are the analyst for the MD office of Atlas Maharani Group (textile retail, Kerala). Every Monday the heads of department (HODs) present last week's KPI results. The MD wants each department to work in a RESULT-ORIENTED way, not just do its duty. Review this week's sheets and write the MD office's view.

For each department judge:
- Are results measured outcomes against targets with real data, or activity reports ("done", "checked", "followed up")?
- Are Amber/Red KPIs explained with a root cause and a corrective action with owner and date?
- Did the HOD answer Claude's clarification questions properly, or dodge them?
- Trend vs last week's score, overdue actions, KPIs Red two weeks running.
- A department with a missing sheet should be called out.
Questions for Monday must be direct and specific to a KPI or figure. Suggestions must be practical for a textile retail chain. Simple English. Never invent figures not in the data.

Week: ${str(b.weekLabel, 40)} (meeting ${str(b.meeting, 40)})
Red two weeks running: ${JSON.stringify(strArr(b.repeatReds, 60))}
Departments (JSON): ${payload}

Reply with only this JSON:
{"headline":"<one sentence, the most important thing for the MD this week>","groupView":"<3 short sentences on the group overall>","watchList":["<a person, KPI or issue the MD office must follow this week>"],"departments":[{"dept":"<id from the data>","rating":"Result-oriented" | "Partly result-oriented" | "Activity only","verdict":"<2 sentences>","questions":["<question to ask the HOD on Monday>"],"suggestions":["<practical suggestion>"]}],"crossDept":["<issue between departments, e.g. Purchase stock vs Sales availability>"]}
One entry per department in the data, in the same order. Up to 3 questions and 3 suggestions per department, up to 5 watch-list items, up to 4 cross-department items.`;

    const res = await askClaudeJson(prompt, { model: Deno.env.get("CLAUDE_MODEL_REVIEW") ?? "claude-opus-5-5", maxTokens: 8000 });
    const data = {
      headline: str(res.headline, 400),
      groupView: str(res.groupView, 1200),
      watchList: strArr(res.watchList, 5),
      crossDept: strArr(res.crossDept, 4),
      departments: (Array.isArray(res.departments) ? res.departments : []).map((x: Record<string, unknown>) => ({
        dept: str(x.dept, 80),
        rating: RATINGS.includes(String(x.rating)) ? String(x.rating) : "Partly result-oriented",
        verdict: str(x.verdict, 600),
        questions: strArr(x.questions, 3),
        suggestions: strArr(x.suggestions, 3),
      })),
    };
    const { error } = await supabase.from("reviews").upsert({ week, data, created_by: user.id, created_at: new Date().toISOString() });
    if (error) throw new HttpError(500, "Review was written but could not be saved: " + error.message);
    return json({ ok: true, review: data });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
