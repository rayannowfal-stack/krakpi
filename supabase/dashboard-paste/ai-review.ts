// ai-review — single-file version to paste into Supabase → Edge Functions → Deploy a new function → Via Editor (function name: ai-review). Generated from supabase/functions/ai-review; edit the originals, not this file.

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
function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
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
function claudeHeaders(key) {
  const h = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  const ws = Deno.env.get("ANTHROPIC_WORKSPACE_ID");
  if (ws) h["anthropic-workspace-id"] = ws.trim();
  return h;
}
async function askClaudeJson(prompt, opts, attachments = []) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new HttpError(500, "Claude is not set up: add the ANTHROPIC_API_KEY secret in Supabase.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: claudeHeaders(key),
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: attachments.length ? [...attachments, { type: "text", text: prompt + "\n\nReply with the JSON object only \u2014 no other text." }] : prompt + "\n\nReply with the JSON object only \u2014 no other text." }]
    })
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("Claude API error", res.status, detail);
    if (res.status === 429 || res.status === 529) throw new HttpError(503, "Claude is busy right now. Try again in a minute.");
    if (res.status === 401) throw new HttpError(500, "The Claude API key is not valid. Check the ANTHROPIC_API_KEY secret.");
    let why = "";
    try {
      why = JSON.parse(detail)?.error?.message ?? "";
    } catch (_) {
    }
    if (/workspace/i.test(why)) throw new HttpError(500, "The Claude API key is not linked to a workspace. Make a new key inside a workspace (platform.claude.com \u2192 API Keys) and save it as ANTHROPIC_API_KEY.");
    if (/credit balance/i.test(why)) throw new HttpError(500, "Claude API credit is used up. Add credit at platform.claude.com \u2192 Billing.");
    throw new HttpError(502, "Claude could not answer" + (why ? ": " + why.slice(0, 200) : ". Try again."));
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

// supabase/functions/_shared/jobs.ts
import PptxGenJS from "npm:pptxgenjs@4.0.1";

// supabase/functions/_shared/core.js
var RAGN = { G: "Green", A: "Amber", R: "Red", NA: "No data" };
var pad = (n) => String(n).padStart(2, "0");
var ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
var parseYmd = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
var addDays = (s, n) => {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var fmt = (s) => {
  const d = parseYmd(s);
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
};
var fmtShort = (s) => {
  const d = parseYmd(s);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
};
function istToday(now = /* @__PURE__ */ new Date()) {
  const t = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 6e4);
  return ymd(t);
}
var weekRange = (w) => `${fmtShort(addDays(w, -7))} \u2013 ${fmtShort(addDays(w, -2))}`;
var ragOf = (ach) => ach == null ? "" : ach >= 95 ? "G" : ach >= 80 ? "A" : "R";
var statusOf = (r) => ragOf(r && typeof r.ach === "number" ? r.ach : null);
var filesOf = (r) => r && Array.isArray(r.files) ? r.files : [];
var kindOf = (mime) => /^audio\//.test(mime || "") ? "voice" : /^image\//.test(mime || "") ? "photo" : "file";
function filesSummary(r) {
  const c = { voice: 0, photo: 0, file: 0 };
  filesOf(r).forEach((f) => {
    c[f.kind || kindOf(f.type)]++;
  });
  const out = [];
  if (c.voice) out.push(`${c.voice} voice note${c.voice > 1 ? "s" : ""}`);
  if (c.photo) out.push(`${c.photo} photo${c.photo > 1 ? "s" : ""}`);
  if (c.file) out.push(`${c.file} file${c.file > 1 ? "s" : ""}`);
  return out.join(", ");
}
function summarize(rows) {
  const c = { G: 0, A: 0, R: 0 };
  let sum = 0, n = 0;
  for (const r of Object.values(rows || {})) {
    const rag = statusOf(r);
    if (c[rag] != null) c[rag]++;
    if (typeof r.ach === "number") {
      sum += Math.min(r.ach, 120);
      n++;
    }
  }
  const score = n ? Math.round(sum / n) : null;
  return { score, counts: c, rag: score == null ? "none" : ragOf(score) };
}
function mapKpi(k) {
  return {
    id: k.id,
    kraNo: k.kra_no,
    kra: k.kra,
    kraW: Number(k.kra_weight) || 0,
    no: k.no,
    text: k.text,
    target: k.target,
    tv: k.tv == null ? null : Number(k.tv),
    dir: k.dir,
    freq: k.freq,
    owner: k.owner,
    star: k.star
  };
}
function buildDepts(deptRows, kpiRows) {
  const m = {};
  (deptRows || []).forEach((d) => m[d.id] = { name: d.name, hod: d.hod, order: d.sort_order, items: [] });
  (kpiRows || []).forEach((k) => m[k.dept_id] && m[k.dept_id].items.push(mapKpi(k)));
  return m;
}
var deptListOf = (depts) => Object.entries(depts).map(([id, d]) => ({ id, ...d })).sort((a, b) => (a.order || 99) - (b.order || 99));
function mapResult(r) {
  return {
    week: r.week,
    dept: r.dept_id,
    status: r.status,
    rows: r.rows || {},
    priorities: r.priorities || [],
    support: r.support || "",
    ai: r.ai || null,
    clar: r.clar || [],
    by: r.updated_by,
    at: r.updated_at,
    source: r.source || "app"
  };
}
var mapAction = (a) => ({ _id: a.id, dept: a.dept_id, week: a.week, kpiNo: a.kpi_no, kpiText: a.kpi_text, action: a.action, owner: a.owner, due: a.due, status: a.status, result: a.result });
function repeatReds(depts, results, prev) {
  const out = [];
  deptListOf(depts).forEach((d) => {
    const r = results[d.id], p = prev[d.id];
    if (!r || !p) return;
    for (const [id, x] of Object.entries(r.rows || {})) {
      const y = (p.rows || {})[id];
      if (y && statusOf(x) === "R" && statusOf(y) === "R") out.push({ dept: d.id, name: d.name, no: x.no, text: x.text });
    }
  });
  return out;
}
function reviewDepartments({ depts, results, prev, actions, today }) {
  return deptListOf(depts).map((d) => {
    const r = results[d.id];
    const p = prev[d.id];
    return {
      id: d.id,
      name: d.name,
      hod: d.hod,
      sheet: r ? r.status : "missing",
      via: r ? r.source : "",
      score: r ? summarize(r.rows).score : null,
      lastWeekScore: p ? summarize(p.rows).score : null,
      claudeCheck: r && r.ai ? { rating: r.ai.rating, evidenceScore: r.ai.score, summary: r.ai.summary } : null,
      rows: r ? Object.values(r.rows || {}).map((x) => ({
        no: x.no,
        kpi: x.text,
        target: x.target,
        actual: x.actual,
        ach: x.ach,
        status: RAGN[statusOf(x)] || "",
        reason: x.reason || x.data || "",
        nextStep: x.next || "",
        attached: filesSummary(x),
        claude: x.ai ? { verdict: x.ai.verdict, proof: x.ai.proof || null, note: x.ai.summary } : null,
        finished: !!x.done
      })) : [],
      clarifications: r ? [
        ...Object.values(r.rows || {}).flatMap((x) => (x.ai && x.ai.questions || []).map((q) => ({ kpi: x.no, q: q.q, a: q.answer || "NOT ANSWERED" }))),
        ...r.clar || [],
        ...r.ai && r.ai.flags || []
      ].map((c) => ({ kpi: c.kpi || c.kpiNo, q: c.q || c.question, a: c.a || c.answer || "NOT ANSWERED" })) : [],
      priorities: r ? (r.priorities || []).filter(Boolean) : [],
      support: r ? r.support : "",
      openActions: actions.filter((a) => a.dept === d.id && a.status !== "Done").map((a) => ({ action: a.action, owner: a.owner, due: a.due, overdue: !!(a.due && a.due < today), status: a.status }))
    };
  });
}

// supabase/functions/_shared/data.ts
async function loadWeek(db, week) {
  const pw = addDays(week, -7);
  const [d, k, r, a, rv] = await Promise.all([
    db.from("departments").select("*"),
    db.from("kpis").select("*"),
    db.from("results").select("*").in("week", [week, pw]),
    db.from("actions").select("*"),
    db.from("reviews").select("*").eq("week", week).maybeSingle()
  ]);
  for (const x of [d, k, r, a]) if (x.error) throw new Error(x.error.message);
  const results = {}, prev = {};
  (r.data || []).forEach((row) => {
    const m = mapResult(row);
    (m.week === week ? results : prev)[m.dept] = m;
  });
  return {
    week,
    depts: buildDepts(d.data, k.data),
    results,
    prev,
    actions: (a.data || []).map(mapAction),
    review: rv.data ? { ...rv.data.data, at: rv.data.created_at } : null,
    today: istToday()
  };
}
async function logJob(db, job, week, ok, detail) {
  await db.from("job_runs").insert({ job, week, ok, detail: detail.slice(0, 2e3) });
}

// supabase/functions/_shared/ai.ts
var RATINGS_MAP = Object.fromEntries(RATINGS.map((r) => [r, true]));
async function reviewWeek(b) {
  let payload = JSON.stringify((b.departments || []).slice(0, 30));
  if (payload.length > 18e4) payload = payload.slice(0, 18e4);
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
  const res = await askClaudeJson(prompt, { model: Deno.env.get("CLAUDE_MODEL_REVIEW") ?? "claude-opus-5-5", maxTokens: 8e3 });
  return {
    headline: str(res.headline, 400),
    groupView: str(res.groupView, 1200),
    watchList: strArr(res.watchList, 5),
    crossDept: strArr(res.crossDept, 4),
    departments: (Array.isArray(res.departments) ? res.departments : []).map((x) => ({
      dept: str(x.dept, 80),
      rating: RATINGS.includes(String(x.rating)) ? String(x.rating) : "Partly result-oriented",
      verdict: str(x.verdict, 600),
      questions: strArr(x.questions, 3),
      suggestions: strArr(x.suggestions, 3)
    }))
  };
}

// supabase/functions/_shared/jobs.ts
async function review(db, week, userId = null) {
  const d = await loadWeek(db, week);
  const data = await reviewWeek({ weekLabel: weekRange(week), meeting: fmt(week), repeatReds: repeatReds(d.depts, d.results, d.prev).map((x) => `${x.name} ${x.no} ${x.text}`), departments: reviewDepartments(d) });
  const { error } = await db.from("reviews").upsert({ week, data, created_by: userId, created_at: (/* @__PURE__ */ new Date()).toISOString() });
  if (error) throw new Error("Review could not be saved: " + error.message);
  await logJob(db, "review", week, true, data.headline);
  return data;
}

// supabase/functions/ai-review/index.ts
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile } = await getCaller(req);
    if (profile.role !== "admin") throw new HttpError(403, "Only the MD office (admin) can generate the review.");
    const b = await req.json();
    const week = str(b.week, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new HttpError(400, "Missing week.");
    const data = await review(serviceClient(), week, profile.id);
    return json({ ok: true, review: data });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
