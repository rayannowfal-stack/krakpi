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
  const t0 = Date.now();
  console.log(`claude: asking ${opts.model} (${attachments.length} file block(s), prompt ${prompt.length} chars)`);
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      signal: AbortSignal.timeout(Number(Deno.env.get("CLAUDE_TIMEOUT_MS") ?? (opts.maxTokens > 4e3 ? 3e5 : 11e4))),
      method: "POST",
      headers: claudeHeaders(key),
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: [{ role: "user", content: attachments.length ? [...attachments, { type: "text", text: prompt + "\n\nReply with the JSON object only \u2014 no other text." }] : prompt + "\n\nReply with the JSON object only \u2014 no other text." }]
      })
    });
  } catch (e) {
    console.error(`claude: no answer after ${Date.now() - t0} ms`, e);
    throw new HttpError(504, "Claude took too long to answer. Try again \u2014 or attach a smaller photo / shorter PDF.");
  }
  console.log(`claude: HTTP ${res.status} after ${Date.now() - t0} ms`);
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
  const model = Deno.env.get("CLAUDE_MODEL_REVIEW") ?? "claude-sonnet-5-5";
  const depts = (b.departments || []).slice(0, 30);
  const LANG = `LANGUAGE: write every sentence in simple, clear MALAYALAM (Malayalam script), the way the MD office talks to its managers. Keep numbers, KPI numbers, department names and business terms (ATV, UPT, GP, PO, GRN, KPI) in English inside the sentence.`;
  const RULES = `Judge: are results measured outcomes against targets with real data, or just "work done"? Are Amber/Red KPIs explained with a real root cause ("reason") and a concrete "nextStep" (what, who, by when)? Did the HOD answer Claude's questions properly? "claude" on a KPI = what Claude found when the HOD finished it; "proof.matches": false means the attached photo/PDF does NOT support the figure \u2014 a serious point. Also look at the trend vs last week, overdue actions, unfinished KPIs. Never invent figures.`;
  const one = async (d) => {
    if (d.sheet === "missing" || !(d.rows || []).length) return { dept: str(d.id, 80), rating: "Activity only", verdict: "\u0D08 \u0D06\u0D34\u0D4D\u0D1A \u0D08 \u0D35\u0D15\u0D41\u0D2A\u0D4D\u0D2A\u0D4D KPI \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D28\u0D7D\u0D15\u0D3F\u0D2F\u0D3F\u0D1F\u0D4D\u0D1F\u0D3F\u0D32\u0D4D\u0D32.", questions: ["\u0D0E\u0D28\u0D4D\u0D24\u0D41\u0D15\u0D4A\u0D23\u0D4D\u0D1F\u0D3E\u0D23\u0D4D \u0D08 \u0D06\u0D34\u0D4D\u0D1A KPI \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D28\u0D7D\u0D15\u0D3E\u0D24\u0D3F\u0D30\u0D41\u0D28\u0D4D\u0D28\u0D24\u0D4D?"], suggestions: [] };
    let data = JSON.stringify(d);
    if (data.length > 4e4) data = data.slice(0, 4e4);
    const prompt2 = `You are the analyst for the MD office of Atlas Maharani Group (textile retail, Kerala, 24 showrooms). Review ONE department's weekly KPI report for the Monday HOD meeting (week ${str(b.weekLabel, 40)}, meeting ${str(b.meeting, 40)}).
${RULES}
Department data: ${data}
${LANG}
Reply with only this JSON:
{"rating":"Result-oriented" | "Partly result-oriented" | "Activity only","verdict":"<2 short sentences in Malayalam>","questions":["<up to 3 direct questions to ask this HOD on Monday, Malayalam>"],"suggestions":["<up to 2 practical suggestions, Malayalam>"]}`;
    try {
      const r = await askClaudeJson(prompt2, { model, maxTokens: 1500 });
      return { dept: str(d.id, 80), rating: RATINGS.includes(String(r.rating)) ? String(r.rating) : "Partly result-oriented", verdict: str(r.verdict, 600), questions: strArr(r.questions, 3), suggestions: strArr(r.suggestions, 2) };
    } catch (e) {
      console.error("review: department failed", d.id, e instanceof Error ? e.message : e);
      return { dept: str(d.id, 80), rating: "Partly result-oriented", verdict: "Claude-\u0D28\u0D4D \u0D08 \u0D35\u0D15\u0D41\u0D2A\u0D4D\u0D2A\u0D4D \u0D07\u0D2A\u0D4D\u0D2A\u0D4B\u0D7E \u0D35\u0D3F\u0D32\u0D2F\u0D3F\u0D30\u0D41\u0D24\u0D4D\u0D24\u0D3E\u0D28\u0D3E\u0D2F\u0D3F\u0D32\u0D4D\u0D32.", questions: [], suggestions: [] };
    }
  };
  const t0 = Date.now();
  const out = new Array(depts.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, depts.length) }, async () => {
    while (next < depts.length) {
      const i = next++;
      out[i] = await one(depts[i]);
    }
  }));
  console.log(`review: ${depts.length} departments in ${Date.now() - t0} ms`);
  const brief = depts.map((d, i) => ({
    dept: d.name,
    sheet: d.sheet,
    score: d.score,
    lastWeekScore: d.lastWeekScore,
    rating: out[i]?.rating,
    verdict: out[i]?.verdict,
    // deno-lint-ignore no-explicit-any
    red: (d.rows || []).filter((x) => x.status === "Red").map((x) => `${x.no} ${x.kpi}`).slice(0, 8),
    // deno-lint-ignore no-explicit-any
    proofMismatch: (d.rows || []).filter((x) => x.claude && x.claude.proof && x.claude.proof.matches === false).map((x) => x.no),
    // deno-lint-ignore no-explicit-any
    overdueActions: (d.openActions || []).filter((a) => a.overdue).length
  }));
  const prompt = `You are the analyst for the MD office of Atlas Maharani Group (textile retail, Kerala). Write the group view of this week's HOD reports (week ${str(b.weekLabel, 40)}, meeting ${str(b.meeting, 40)}).
Departments (already reviewed one by one): ${JSON.stringify(brief).slice(0, 3e4)}
KPIs Red two weeks running: ${JSON.stringify(strArr(b.repeatReds, 40))}
${LANG}
Reply with only this JSON:
{"headline":"<one sentence: the most important thing for the MD this week>","groupView":"<3 short sentences on the group overall>","watchList":["<up to 5 people / KPIs / issues the MD office must follow this week>"],"crossDept":["<up to 3 issues between departments, e.g. Purchase stock vs Sales>"]}`;
  let g = {};
  try {
    g = await askClaudeJson(prompt, { model, maxTokens: 1500 });
  } catch (e) {
    console.error("review: group view failed", e instanceof Error ? e.message : e);
  }
  console.log(`review: finished in ${Date.now() - t0} ms`);
  return {
    headline: str(g.headline, 400),
    groupView: str(g.groupView, 1200),
    watchList: strArr(g.watchList, 5),
    crossDept: strArr(g.crossDept, 4),
    departments: out.filter(Boolean)
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
    const db = serviceClient();
    console.log("ai-review: start", week);
    const work = review(db, week, profile.id).then(() => console.log("ai-review: saved", week)).catch(async (e) => {
      console.error("ai-review: failed", e instanceof Error ? e.message : e);
      await logJob(db, "review", week, false, e instanceof Error ? e.message : String(e));
    });
    const rt = globalThis.EdgeRuntime;
    if (rt && typeof rt.waitUntil === "function") {
      rt.waitUntil(work);
      return json({ ok: true, started: true });
    }
    await work;
    return json({ ok: true, started: false });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
