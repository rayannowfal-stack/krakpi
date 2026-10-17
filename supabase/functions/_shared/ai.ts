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

/* ---------- one KPI at a time: Claude checks the figure, the reason, the next step and READS the attached proof ---------- */
export type ProofFile = { path: string; name?: string; type?: string; kind?: string };
export type KpiCheck = {
  verdict: "ok" | "doubt" | "weak"; summary: string;
  proof: { read: boolean; count: number | null; matches: boolean | null; note: string } | null;
  questions: { q: string; severity: string; answer: string }[];
};
const IMG = ["image/jpeg", "image/png", "image/gif", "image/webp"];
export function b64(bytes: Uint8Array) {
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
/** Downloads the KPI's photos / PDFs / small text files from storage and turns them into Claude content blocks. */
// deno-lint-ignore no-explicit-any
export async function proofBlocks(storage: any, files: ProofFile[]) {
  const blocks: Record<string, unknown>[] = []; const notes: string[] = []; let total = 0;
  for (const f of (files || []).slice(0, 6)) {
    const type = String(f.type || "").split(";")[0].toLowerCase();
    const label = f.name || f.path.split("/").pop();
    if (f.kind === "voice" || type.startsWith("audio/")) { notes.push(`${label}: voice note (Claude cannot listen to audio)`); continue; }
    const readable = IMG.includes(type) || type === "application/pdf" || type.startsWith("text/") || type === "application/csv";
    if (!readable) { notes.push(`${label}: ${type || "file"} (cannot be opened by Claude)`); continue; }
    if (blocks.length >= 4) { notes.push(`${label}: not read (only 4 files are read per KPI)`); continue; }
    const { data, error } = await storage.from("evidence").download(f.path);
    if (error || !data) { notes.push(`${label}: could not be downloaded`); continue; }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const limit = IMG.includes(type) ? 3.7e6 : type === "application/pdf" ? 12e6 : 2e5;
    if (bytes.length > limit || total + bytes.length > 20e6) { notes.push(`${label}: too big for Claude to read`); continue; }
    total += bytes.length;
    if (IMG.includes(type)) blocks.push({ type: "image", source: { type: "base64", media_type: type, data: b64(bytes) } });
    else if (type === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) }, title: String(label).slice(0, 100) });
    else blocks.push({ type: "text", text: `Attached file ${label}:\n` + new TextDecoder().decode(bytes).slice(0, 20000) });
    notes.push(`${label}: attached above (file ${blocks.length})`);
  }
  return { blocks, notes };
}

export async function checkKpi(b: {
  deptName: string; hod?: string; week: string; kpi: Record<string, unknown>; earlier?: { q: string; a: string }[];
  // deno-lint-ignore no-explicit-any
  storage: any; files: ProofFile[];
}): Promise<KpiCheck> {
  const { blocks, notes } = await proofBlocks(b.storage, b.files);
  const prompt = `You check ONE weekly KPI result that a Head of Department (HOD) at Atlas Maharani Group (textile retail, Kerala, 24 showrooms) has just entered. It will be presented to the MD office on Monday. The MD wants RESULT-ORIENTED reporting, not "work done".

KPI and the HOD's entry: ${JSON.stringify(b.kpi)}
Department: ${str(b.deptName, 80)} (HOD: ${str(b.hod, 120)}) · Week: ${str(b.week, 40)}
Attachments (proof): ${JSON.stringify(notes)}
Earlier questions on this KPI and the HOD's answers: ${JSON.stringify((b.earlier || []).slice(0, 10))}

What to do:
1. The status (Green/Amber/Red) is calculated from the achievement % and cannot be changed, so never question the colour; question the figure and the evidence.
2. READ every attached photo / PDF / file. Find the number in it that this KPI is about (a count, a total, a %, an amount). Put that number in proof.count, and set proof.matches = true if it supports the HOD's answer (allow small rounding), false if it does not, null if the proof does not show that number. Say in proof.note, in one Malayalam sentence, what the proof shows. If nothing could be read, proof.read = false.
3. Amber/Red needs a real root cause and a concrete next step (what, who, by when). "Will improve" / "will follow up" is not enough.
4. Ask at most 3 short questions, only where something is unclear, unsupported, or does not match. Mark a question "high" only when the result cannot be accepted without the answer (e.g. proof contradicts the figure, Red with no real cause, 100% with no proof). If everything is clear, ask nothing.
5. Do not repeat a question the HOD already answered well.
verdict: "ok" = clear and supported, "doubt" = something to clarify, "weak" = activity-only / unsupported / proof contradicts.

LANGUAGE: "summary", "proof.note" and every question in simple, polite MALAYALAM (Malayalam script). Keep numbers and business terms (ATV, UPT, GP, PO, GRN, KPI, report names) in English inside the sentence. Each question must be answerable in one WhatsApp message.

Reply with only this JSON:
{"verdict":"ok"|"doubt"|"weak","summary":"<1-2 short sentences in Malayalam>","proof":{"read":true|false,"count":<number or null>,"matches":true|false|null,"note":"<Malayalam>"},"questions":[{"q":"<Malayalam question>","severity":"high"|"medium"|"low"}]}`;
  const res = await askClaudeJson(prompt, { model: Deno.env.get("CLAUDE_MODEL_CHECK") ?? "claude-sonnet-5-5", maxTokens: 2000 }, blocks);
  const sev = (s: unknown) => (["high", "medium", "low"].includes(String(s)) ? String(s) : "medium");
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const pr = res.proof && typeof res.proof === "object" ? res.proof : null;
  const cnt = pr ? Number(pr.count) : NaN;
  return {
    verdict: ["ok", "doubt", "weak"].includes(res.verdict) ? res.verdict : "doubt",
    summary: str(res.summary, 600),
    proof: (b.files || []).length ? { read: !!(pr && pr.read), count: pr && pr.count != null && Number.isFinite(cnt) ? cnt : null, matches: pr && typeof pr.matches === "boolean" ? pr.matches : null, note: str(pr && pr.note, 400) } : null,
    questions: (Array.isArray(res.questions) ? res.questions : []).slice(0, 3)
      .map((x: Record<string, unknown>) => ({ q: str(x.q ?? x.question, 500), severity: sev(x.severity), answer: "" }))
      .filter((x: { q: string }) => x.q)
      .sort((a: { severity: string }, c: { severity: string }) => order[a.severity] - order[c.severity]),
  };
}

export async function checkSheet(b: CheckInput, maxFlags = 8): Promise<CheckResult> {
  const prompt = `You review a weekly KPI result sheet that a Head of Department (HOD) at Atlas Maharani Group (textile retail, Kerala, many showrooms) will present to the MD office on Monday. Your job: make sure the results are reported in a RESULT-ORIENTED way, not as routine duty, and ask clarification questions where a result is unclear or unsupported.

How to judge each row:
- Result-oriented: a measured outcome against the target (a number, %, or "X out of Y"), backed by verifiable supporting data (count, source report, list).
- Activity only: says work was "done", "checked", "followed up", "ongoing", or claims 100% / Green without saying what was measured or how.
- Every Amber or Red row needs a root cause ("reason") and a "nextStep" (what, who, by when). A vague next step ("will improve", "will follow up") is not enough — ask for the concrete action.
- Status is calculated automatically from the achievement %, so never question the colour itself; question the figure or the evidence behind it.
- "attached" lists voice notes / photos / files the HOD attached as evidence. You cannot open them: count them as supporting evidence that exists, do not ask for proof that is already attached, but still ask what they show if the written reason is empty.
- Flag inconsistencies: 100% or Green with no data or evidence, figures that cannot be right for the target, headline KPIs left blank.
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
- Are Amber/Red KPIs explained with a root cause ("reason") and a concrete "nextStep" with owner and date? ("attached" = voice notes/photos/files given as evidence; you cannot open them.)
- Did the HOD answer Claude's clarification questions properly, or dodge them? (Answers may be in Malayalam.)
- Trend vs last week's score, overdue actions, KPIs Red two weeks running.
- A department with a missing sheet should be called out.
- Each KPI row may carry "claude": what Claude found when the HOD finished that KPI (verdict ok/doubt/weak, and "proof" = what Claude read in the attached photo/PDF, with "matches" true/false against the HOD's figure). A proof that does not match the figure is a serious point for the MD.
Questions for Monday must be direct and specific to a KPI or figure. Suggestions must be practical for a textile retail chain. Never invent figures not in the data.

LANGUAGE: Write "headline", "groupView", every "watchList" item, every "verdict", every "question", every "suggestion" and every "crossDept" item in simple, clear MALAYALAM (Malayalam script), the way the MD office talks to its managers. Keep numbers, KPI numbers, department names and business terms (ATV, UPT, GP, PO, GRN, KPI) in English inside the Malayalam sentence. "rating" stays exactly one of the three English labels, and "dept" stays the id from the data.

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
