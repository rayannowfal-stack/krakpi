// Claude check of one department's weekly sheet, before the HOD submits it.
// Called from the app's "Check with Claude" button. Only that department's HOD or an admin may call it.
import { askClaudeJson, cors, getCaller, HttpError, json, RATINGS, str, strArr } from "../_shared/claude.ts";

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

    const prompt = `You review a weekly KPI result sheet that a Head of Department (HOD) at Atlas Maharani Group (textile retail, Kerala, many showrooms) will present to the MD office on Monday. Your job: make sure the results are reported in a RESULT-ORIENTED way, not as routine duty, and ask clarification questions where a result is unclear or unsupported.

How to judge each row:
- Result-oriented: a measured outcome against the target (a number, %, or "X out of Y"), backed by verifiable supporting data (count, source report, list).
- Activity only: says work was "done", "checked", "followed up", "ongoing", or claims 100% / Green without saying what was measured or how.
- Every Amber or Red row needs a root cause and a corrective action (what, who, by when).
- Flag inconsistencies: status not matching actual vs target, 100% or Green with no data, figures that cannot be right for the target, headline KPIs left blank.
- Next week's priorities should each name an expected number.
- If the HOD already answered a question well (see earlier answers), do not ask it again.
Write in short, simple English the HOD understands. Be specific to the KPI. Never invent figures.

Department: ${str(b.deptName, 80)} (HOD: ${str(b.hod, 120)})
Week: ${str(b.week, 40)} (meeting ${str(b.meeting, 40)})
Reported rows: ${JSON.stringify(rows)}
Headline weekly KPIs NOT reported: ${JSON.stringify(strArr(b.missing, 40))}
Next week's priorities: ${JSON.stringify(strArr(b.priorities, 5))}
Support needed: ${JSON.stringify(str(b.support, 1500))}
Earlier answers from the HOD: ${JSON.stringify(Array.isArray(b.clarifications) ? b.clarifications.slice(0, 40) : [])}

Reply with only this JSON:
{"rating":"Result-oriented" | "Partly result-oriented" | "Activity only","score":<0-100, how result-oriented and evidence-backed the sheet is>,"summary":"<2 short sentences>","flags":[{"kpiNo":"<KPI number or empty>","severity":"high"|"medium"|"low","issue":"<what is wrong or unclear, under 15 words>","question":"<one direct question the HOD must answer>"}],"suggestions":["<one specific improvement>"]}
At most 8 flags, high severity first. At most 4 suggestions.`;

    const res = await askClaudeJson(prompt, { model: Deno.env.get("CLAUDE_MODEL_CHECK") ?? "claude-sonnet-5-5", maxTokens: 3000 });
    const sev = (s: unknown) => (["high", "medium", "low"].includes(String(s)) ? String(s) : "medium");
    const score = Number(res.score);
    return json({
      rating: RATINGS.includes(res.rating) ? res.rating : "Partly result-oriented",
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
      summary: str(res.summary, 600),
      flags: (Array.isArray(res.flags) ? res.flags : []).slice(0, 8)
        .map((x: Record<string, unknown>) => ({ kpiNo: str(x.kpiNo, 20), severity: sev(x.severity), issue: str(x.issue, 200), question: str(x.question, 400) }))
        .filter((x: { question: string }) => x.question),
      suggestions: strArr(res.suggestions, 4),
    });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
