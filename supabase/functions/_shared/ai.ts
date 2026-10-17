// Claude prompts, shared by the app (ai-check, ai-review) and the WhatsApp bot / Saturday jobs.
// HOD-facing text (summary, questions, suggestions) is written in Malayalam; ratings stay as fixed English labels.
import { askClaudeJson, RATINGS, str, strArr } from "./claude.ts";

export type CheckInput = {
  deptName: string; hod?: string; week: string; meeting: string;
  rows: Record<string, unknown>[]; missing: string[]; priorities: string[]; support: string;
  clarifications: { kpi?: string; q: string; a: string }[];
};
export type CheckResult = {
  rating: string; score: number | null; summary: string;
  flags: { kpiNo: string; severity: string; issue: string; question: string }[];
  suggestions: string[];
};

export async function checkSheet(b: CheckInput, maxFlags = 8): Promise<CheckResult> {
  const prompt = `You review a weekly KPI result sheet that a Head of Department (HOD) at Atlas Maharani Group (textile retail, Kerala, many showrooms) will present to the MD office on Monday. Your job: make sure the results are reported in a RESULT-ORIENTED way, not as routine duty, and ask clarification questions where a result is unclear or unsupported.

How to judge each row:
- Result-oriented: a measured outcome against the target (a number, %, or "X out of Y"), backed by verifiable supporting data (count, source report, list).
- Activity only: says work was "done", "checked", "followed up", "ongoing", or claims 100% / Green without saying what was measured or how.
- Every Amber or Red row needs a root cause and a corrective action (what, who, by when).
- Flag inconsistencies: status not matching actual vs target, 100% or Green with no data, figures that cannot be right for the target, headline KPIs left blank.
- Next week's priorities should each name an expected number.
- If the HOD already answered a question well (see earlier answers), do not ask it again.
Never invent figures.

LANGUAGE: Write "summary", every "issue", every "question" and every "suggestion" in simple, polite, everyday MALAYALAM (Malayalam script), the way a Kerala manager talks to a colleague. Keep KPI numbers, figures and common business terms (ATV, UPT, GP, PO, GRN, KPI, report names) in English inside the Malayalam sentence. Each question must be short enough to answer in one WhatsApp message. The "rating" value must stay exactly one of the three English labels.

Department: ${str(b.deptName, 80)} (HOD: ${str(b.hod, 120)})
Week: ${str(b.week, 40)} (meeting ${str(b.meeting, 40)})
Reported rows: ${JSON.stringify((b.rows || []).slice(0, 80))}
Headline weekly KPIs NOT reported: ${JSON.stringify(strArr(b.missing, 40))}
Next week's priorities: ${JSON.stringify(strArr(b.priorities, 5))}
Support needed: ${JSON.stringify(str(b.support, 1500))}
Earlier answers from the HOD: ${JSON.stringify((b.clarifications || []).slice(0, 40))}

Reply with only this JSON:
{"rating":"Result-oriented" | "Partly result-oriented" | "Activity only","score":<0-100, how result-oriented and evidence-backed the sheet is>,"summary":"<2 short sentences in Malayalam>","flags":[{"kpiNo":"<KPI number or empty>","severity":"high"|"medium"|"low","issue":"<in Malayalam, under 15 words>","question":"<one direct question in Malayalam>"}],"suggestions":["<one specific improvement in Malayalam>"]}
At most ${maxFlags} flags, high severity first. At most 4 suggestions.`;

  const res = await askClaudeJson(prompt, { model: Deno.env.get("CLAUDE_MODEL_CHECK") ?? "claude-sonnet-5-5", maxTokens: 4000 });
  const sev = (s: unknown) => (["high", "medium", "low"].includes(String(s)) ? String(s) : "medium");
  const score = Number(res.score);
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return {
    rating: Object.keys(RATINGS_MAP).includes(res.rating) ? res.rating : "Partly result-oriented",
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    summary: str(res.summary, 800),
    flags: (Array.isArray(res.flags) ? res.flags : []).slice(0, maxFlags)
      .map((x: Record<string, unknown>) => ({ kpiNo: str(x.kpiNo, 20), severity: sev(x.severity), issue: str(x.issue, 300), question: str(x.question, 600) }))
      .filter((x: { question: string }) => x.question)
      .sort((a: { severity: string }, b: { severity: string }) => order[a.severity] - order[b.severity]),
    suggestions: strArr(res.suggestions, 4),
  };
}
const RATINGS_MAP: Record<string, true> = Object.fromEntries(RATINGS.map((r) => [r, true]));

export type ReviewInput = { weekLabel: string; meeting: string; repeatReds: string[]; departments: unknown[] };

/** MD office review of all departments (English, for the MD office). */
export async function reviewWeek(b: ReviewInput) {
  let payload = JSON.stringify((b.departments || []).slice(0, 30));
  if (payload.length > 180000) payload = payload.slice(0, 180000);
  const prompt = `You are the analyst for the MD office of Atlas Maharani Group (textile retail, Kerala). Every Monday the heads of department (HODs) present last week's KPI results. The MD wants each department to work in a RESULT-ORIENTED way, not just do its duty. Review this week's sheets and write the MD office's view.

For each department judge:
- Are results measured outcomes against targets with real data, or activity reports ("done", "checked", "followed up")?
- Are Amber/Red KPIs explained with a root cause and a corrective action with owner and date?
- Did the HOD answer Claude's clarification questions properly, or dodge them? (Answers may be in Malayalam.)
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
  return {
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
}
