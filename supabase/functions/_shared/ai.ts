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
  const tp = Date.now();
  const { blocks, notes } = await proofBlocks(b.storage, b.files);
  console.log(`ai-check: proof read in ${Date.now() - tp} ms → ${blocks.length} block(s) · ${notes.join(" | ")}`);
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

/* ---------- File check (admin): Claude reads a department's KPI file(s), marks figures on their KPIs, asks questions;
   later the HOD's answers are uploaded and Claude checks them. ---------- */
export type FileCheck = {
  summary: string;
  kpis: { no: string; value: string; note: string; matches: boolean | null }[];
  questions: { q: string; kpiNo: string }[];
  answers: { q: string; verdict: string; note: string }[];
};
export async function checkFiles(b: {
  deptName: string; hod?: string; week: string; kpis: Record<string, unknown>[];
  texts: { name: string; text: string }[]; files: ProofFile[];
  // deno-lint-ignore no-explicit-any
  storage: any; earlier?: { q: string; a: string }[]; answerText?: string;
}): Promise<FileCheck> {
  const { blocks, notes } = await proofBlocks(b.storage, b.files);
  const texts = (b.texts || []).slice(0, 6).map((t) => `--- File "${str(t.name, 120)}" ---\n${str(t.text, 60000)}`).join("\n\n");
  const answering = !!(b.earlier && b.earlier.length);
  const prompt = `You are the analyst for the MD office of Atlas Maharani Group (textile retail, Kerala, 24 showrooms). The MD office has uploaded ${answering ? "the HOD's ANSWERS to earlier questions, together with" : ""} KPI working file(s) from the ${str(b.deptName, 80)} department (HOD: ${str(b.hod, 120)}) for week ${str(b.week, 40)}.

The department's KPIs, and what the HOD entered in the app ("hodResult"; empty = not entered yet):
${JSON.stringify((b.kpis || []).slice(0, 80))}

Photos / PDFs (attached above): ${JSON.stringify(notes)}
Spreadsheets / documents as text:
${texts || "(none)"}
${answering ? `
Earlier questions to the HOD: ${JSON.stringify(b.earlier)}
HOD's answer (text, may be Malayalam): ${JSON.stringify(str(b.answerText, 6000))}
For each earlier question judge the answer: "ok" = clear and supported, "weak" = vague or not supported, "missing" = not answered.` : ""}

What to do:
1. Read every file carefully. For each KPI that the files give a figure for, report it in "kpis": the KPI number, the figure the file shows ("value", as a count, total, amount or %, e.g. "46/48" or "92%" or "1420"), whether it matches the HOD's entered result ("matches": true / false, or null when the HOD has not entered one), and a one-line Malayalam note on where it came from / what is wrong.
2. Ask up to 6 direct questions for the HOD where the file is unclear, a figure does not match, data is missing for an important KPI, or something looks wrong. Each question names its KPI number when it is about one KPI.
3. "summary": 2-3 short Malayalam sentences: what the files show overall and the main concern.
Never invent figures that are not in the files.

LANGUAGE: summary, every note and every question in simple, polite MALAYALAM (Malayalam script). Keep numbers, KPI numbers and business terms (ATV, UPT, GP, PO, GRN, KPI, report names) in English inside the sentence.

Reply with only this JSON:
{"summary":"<Malayalam>","kpis":[{"no":"<KPI no>","value":"<figure in file>","matches":true|false|null,"note":"<Malayalam>"}],"questions":[{"kpiNo":"<KPI no or empty>","q":"<Malayalam question>"}]${answering ? ',"answers":[{"q":"<the earlier question>","verdict":"ok"|"weak"|"missing","note":"<Malayalam>"}]' : ""}}`;
  const res = await askClaudeJson(prompt, { model: Deno.env.get("CLAUDE_MODEL_FILES") ?? Deno.env.get("CLAUDE_MODEL_CHECK") ?? "claude-sonnet-5-5", maxTokens: 4000 }, blocks);
  return {
    summary: str(res.summary, 1200),
    kpis: (Array.isArray(res.kpis) ? res.kpis : []).slice(0, 80).map((x: Record<string, unknown>) => ({ no: str(x.no, 20), value: str(x.value, 60), note: str(x.note, 400), matches: typeof x.matches === "boolean" ? x.matches : null })).filter((x: { no: string }) => x.no),
    questions: (Array.isArray(res.questions) ? res.questions : []).slice(0, 6).map((x: Record<string, unknown>) => ({ kpiNo: str(x.kpiNo, 20), q: str(x.q ?? x.question, 500) })).filter((x: { q: string }) => x.q),
    answers: (Array.isArray(res.answers) ? res.answers : []).slice(0, 12).map((x: Record<string, unknown>) => ({ q: str(x.q, 500), verdict: ["ok", "weak", "missing"].includes(String(x.verdict)) ? String(x.verdict) : "weak", note: str(x.note, 400) })),
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

/** MD office review (Malayalam). Fast: one short Claude call per department, all at the same time,
 * then one short call for the group view — instead of one huge call that runs past the time limit. */
export async function reviewWeek(b: ReviewInput) {
  const model = Deno.env.get("CLAUDE_MODEL_REVIEW") ?? "claude-sonnet-5-5";
  // deno-lint-ignore no-explicit-any
  const depts = ((b.departments || []) as any[]).slice(0, 30);
  const LANG = `LANGUAGE: write every sentence in simple, clear MALAYALAM (Malayalam script), the way the MD office talks to its managers. Keep numbers, KPI numbers, department names and business terms (ATV, UPT, GP, PO, GRN, KPI) in English inside the sentence.`;
  const RULES = `Judge: are results measured outcomes against targets with real data, or just "work done"? Are Amber/Red KPIs explained with a real root cause ("reason") and a concrete "nextStep" (what, who, by when)? Did the HOD answer Claude's questions properly? "claude" on a KPI = what Claude found when the HOD finished it; "proof.matches": false means the attached photo/PDF does NOT support the figure — a serious point. Also look at the trend vs last week, overdue actions, unfinished KPIs. Never invent figures.`;

  const one = async (d: Record<string, unknown>) => {
    if (d.sheet === "missing" || !(d.rows as unknown[] || []).length) return { dept: str(d.id, 80), rating: "Activity only", verdict: "ഈ ആഴ്ച ഈ വകുപ്പ് KPI റിപ്പോർട്ട് നൽകിയിട്ടില്ല.", questions: ["എന്തുകൊണ്ടാണ് ഈ ആഴ്ച KPI റിപ്പോർട്ട് നൽകാതിരുന്നത്?"], suggestions: [] };
    let data = JSON.stringify(d); if (data.length > 40000) data = data.slice(0, 40000);
    const prompt = `You are the analyst for the MD office of Atlas Maharani Group (textile retail, Kerala, 24 showrooms). Review ONE department's weekly KPI report for the Monday HOD meeting (week ${str(b.weekLabel, 40)}, meeting ${str(b.meeting, 40)}).
${RULES}
Department data: ${data}
${LANG}
Reply with only this JSON:
{"rating":"Result-oriented" | "Partly result-oriented" | "Activity only","verdict":"<2 short sentences in Malayalam>","questions":["<up to 3 direct questions to ask this HOD on Monday, Malayalam>"],"suggestions":["<up to 2 practical suggestions, Malayalam>"]}`;
    try {
      const r = await askClaudeJson(prompt, { model, maxTokens: 1500 });
      return { dept: str(d.id, 80), rating: RATINGS.includes(String(r.rating)) ? String(r.rating) : "Partly result-oriented", verdict: str(r.verdict, 600), questions: strArr(r.questions, 3), suggestions: strArr(r.suggestions, 2) };
    } catch (e) {
      console.error("review: department failed", d.id, e instanceof Error ? e.message : e);
      return { dept: str(d.id, 80), rating: "Partly result-oriented", verdict: "Claude-ന് ഈ വകുപ്പ് ഇപ്പോൾ വിലയിരുത്താനായില്ല.", questions: [], suggestions: [] };
    }
  };
  const t0 = Date.now();
  // all departments in parallel (4 at a time)
  const out: Awaited<ReturnType<typeof one>>[] = new Array(depts.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, depts.length) }, async () => { while (next < depts.length) { const i = next++; out[i] = await one(depts[i]); } }));
  console.log(`review: ${depts.length} departments in ${Date.now() - t0} ms`);

  const brief = depts.map((d, i) => ({ dept: d.name, sheet: d.sheet, score: d.score, lastWeekScore: d.lastWeekScore, rating: out[i]?.rating, verdict: out[i]?.verdict,
    // deno-lint-ignore no-explicit-any
    red: ((d.rows || []) as any[]).filter((x) => x.status === "Red").map((x) => `${x.no} ${x.kpi}`).slice(0, 8),
    // deno-lint-ignore no-explicit-any
    proofMismatch: ((d.rows || []) as any[]).filter((x) => x.claude && x.claude.proof && x.claude.proof.matches === false).map((x) => x.no),
    // deno-lint-ignore no-explicit-any
    overdueActions: ((d.openActions || []) as any[]).filter((a) => a.overdue).length }));
  const prompt = `You are the analyst for the MD office of Atlas Maharani Group (textile retail, Kerala). Write the group view of this week's HOD reports (week ${str(b.weekLabel, 40)}, meeting ${str(b.meeting, 40)}).
Departments (already reviewed one by one): ${JSON.stringify(brief).slice(0, 30000)}
KPIs Red two weeks running: ${JSON.stringify(strArr(b.repeatReds, 40))}
${LANG}
Reply with only this JSON:
{"headline":"<one sentence: the most important thing for the MD this week>","groupView":"<3 short sentences on the group overall>","watchList":["<up to 5 people / KPIs / issues the MD office must follow this week>"],"crossDept":["<up to 3 issues between departments, e.g. Purchase stock vs Sales>"]}`;
  let g: Record<string, unknown> = {};
  try { g = await askClaudeJson(prompt, { model, maxTokens: 1500 }); }
  catch (e) { console.error("review: group view failed", e instanceof Error ? e.message : e); }
  console.log(`review: finished in ${Date.now() - t0} ms`);
  return {
    headline: str(g.headline, 400), groupView: str(g.groupView, 1200), watchList: strArr(g.watchList, 5), crossDept: strArr(g.crossDept, 4),
    departments: out.filter(Boolean),
  };
}
