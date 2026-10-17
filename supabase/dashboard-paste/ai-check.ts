// ai-check — single-file version to paste into Supabase → Edge Functions → Deploy a new function → Via Editor (function name: ai-check). Generated from supabase/functions/ai-check; edit the originals, not this file.

// supabase/functions/_shared/claude.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
async function getCaller(req) {
  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } }
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new HttpError(401, "Please sign in again.");
  const { data: profile } = await supabase.from("profiles").select("id, role, dept_id").eq("id", user.id).maybeSingle();
  if (!profile || profile.role === "pending") throw new HttpError(403, "Your account is waiting for the admin to give you access.");
  return { supabase, user, profile };
}
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
async function askClaudeJson(prompt, opts) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new HttpError(500, "Claude is not set up: add the ANTHROPIC_API_KEY secret in Supabase.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: prompt + "\n\nReply with the JSON object only \u2014 no other text." }]
    })
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("Claude API error", res.status, detail);
    if (res.status === 429 || res.status === 529) throw new HttpError(503, "Claude is busy right now. Try again in a minute.");
    if (res.status === 401) throw new HttpError(500, "The Claude API key is not valid. Check the ANTHROPIC_API_KEY secret.");
    throw new HttpError(502, "Claude could not answer. Try again.");
  }
  const data = await res.json();
  const text = (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return parseJson(text);
}
function parseJson(text) {
  const tries = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) tries.push(fence[1].trim());
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {
    }
  }
  throw new HttpError(502, "Claude's answer came back in the wrong shape. Try again.");
}
var RATINGS = ["Result-oriented", "Partly result-oriented", "Activity only"];
var str = (v, max = 600) => String(v ?? "").slice(0, max);
var strArr = (v, n) => Array.isArray(v) ? v.slice(0, n).map((x) => str(x, 400)) : [];

// supabase/functions/_shared/ai.ts
async function checkSheet(b, maxFlags = 8) {
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
  const res = await askClaudeJson(prompt, { model: Deno.env.get("CLAUDE_MODEL_CHECK") ?? "claude-sonnet-5-5", maxTokens: 4e3 });
  const sev = (s) => ["high", "medium", "low"].includes(String(s)) ? String(s) : "medium";
  const score = Number(res.score);
  const order = { high: 0, medium: 1, low: 2 };
  return {
    rating: Object.keys(RATINGS_MAP).includes(res.rating) ? res.rating : "Partly result-oriented",
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    summary: str(res.summary, 800),
    flags: (Array.isArray(res.flags) ? res.flags : []).slice(0, maxFlags).map((x) => ({ kpiNo: str(x.kpiNo, 20), severity: sev(x.severity), issue: str(x.issue, 300), question: str(x.question, 600) })).filter((x) => x.question).sort((a, b2) => order[a.severity] - order[b2.severity]),
    suggestions: strArr(res.suggestions, 4)
  };
}
var RATINGS_MAP = Object.fromEntries(RATINGS.map((r) => [r, true]));

// supabase/functions/ai-check/index.ts
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile } = await getCaller(req);
    const b = await req.json();
    const deptId = str(b.deptId, 80);
    if (!(profile.role === "admin" || profile.role === "hod" && profile.dept_id === deptId)) {
      throw new HttpError(403, "Only this department's HOD or an admin can run the Claude check.");
    }
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 80) : [];
    if (!rows.length) throw new HttpError(400, "Enter your results first.");
    const out = await checkSheet({
      deptName: str(b.deptName, 80),
      hod: str(b.hod, 120),
      week: str(b.week, 40),
      meeting: str(b.meeting, 40),
      rows,
      missing: strArr(b.missing, 40),
      priorities: strArr(b.priorities, 5),
      support: str(b.support, 1500),
      clarifications: Array.isArray(b.clarifications) ? b.clarifications.slice(0, 40) : []
    });
    return json(out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
