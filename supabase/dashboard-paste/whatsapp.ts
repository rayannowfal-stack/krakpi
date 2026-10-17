// whatsapp — single-file version to paste into Supabase → Edge Functions → Deploy a new function → Via Editor (function name: whatsapp). Generated from supabase/functions/whatsapp; edit the originals, not this file.

// supabase/functions/_shared/claude.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
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
async function askClaudeJson(prompt, opts) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new HttpError(500, "Claude is not set up: add the ANTHROPIC_API_KEY secret in Supabase.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: claudeHeaders(key),
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

// supabase/functions/_shared/wa.ts
var API = () => `https://graph.facebook.com/${Deno.env.get("WA_API_VERSION") ?? "v25.0"}`;
async function post(body) {
  const token = Deno.env.get("WA_TOKEN"), id = Deno.env.get("WA_PHONE_NUMBER_ID");
  if (!token || !id) throw new Error("WhatsApp is not set up: add the WA_TOKEN and WA_PHONE_NUMBER_ID secrets.");
  const res = await fetch(`${API()}/${id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("WhatsApp error " + res.status + ": " + JSON.stringify(j.error || j).slice(0, 300));
  return j;
}
async function sendText(db, to, text) {
  const parts = text.length > 4e3 ? text.match(/[\s\S]{1,4000}/g) : [text];
  for (const p of parts) await post({ to, type: "text", text: { body: p, preview_url: false } });
  if (db) await db.from("wa_log").insert({ phone: to, direction: "out", body: text.slice(0, 4e3) });
}
async function sendTemplate(db, to, name, lang, bodyParams, headerDoc) {
  const components = [];
  if (headerDoc) components.push({ type: "header", parameters: [{ type: "document", document: { link: headerDoc.link, filename: headerDoc.filename } }] });
  if (bodyParams.length) components.push({ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) });
  await post({ to, type: "template", template: { name, language: { code: lang }, components } });
  if (db) await db.from("wa_log").insert({ phone: to, direction: "out", body: `[template ${name}] ${bodyParams.join(" | ")}${headerDoc ? " + " + headerDoc.filename : ""}` });
}
async function downloadMedia(mediaId) {
  const token = Deno.env.get("WA_TOKEN");
  if (!token) throw new Error("WhatsApp is not set up: add the WA_TOKEN secret.");
  const meta = await fetch(`${API()}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await meta.json().catch(() => ({}));
  if (!meta.ok || !j.url) throw new Error("WhatsApp media lookup failed " + meta.status + ": " + JSON.stringify(j.error || j).slice(0, 200));
  const file = await fetch(j.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!file.ok) throw new Error("WhatsApp media download failed " + file.status);
  return { bytes: new Uint8Array(await file.arrayBuffer()), mime: String(j.mime_type || file.headers.get("content-type") || "application/octet-stream").split(";")[0] };
}
async function validSignature(raw, header) {
  const secret = Deno.env.get("WA_APP_SECRET");
  if (!secret) return true;
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === header.slice(7);
}

// supabase/functions/_shared/core.js
var FREQ = { D: "Daily", W: "Weekly", "15D": "15 days", M: "Monthly", Q: "Quarterly", H: "Half-yearly", Y: "Yearly", AN: "As needed" };
var FREQ_ML = { D: "\u0D26\u0D3F\u0D35\u0D38\u0D35\u0D41\u0D02", W: "\u0D06\u0D34\u0D4D\u0D1A\u0D24\u0D4B\u0D31\u0D41\u0D02", "15D": "15 \u0D26\u0D3F\u0D35\u0D38\u0D02", M: "\u0D2E\u0D3E\u0D38\u0D02\u0D24\u0D4B\u0D31\u0D41\u0D02", Q: "\u0D24\u0D4D\u0D30\u0D48\u0D2E\u0D3E\u0D38\u0D02", H: "\u0D05\u0D7C\u0D27\u0D35\u0D3E\u0D7C\u0D37\u0D3F\u0D15\u0D02", Y: "\u0D35\u0D3E\u0D7C\u0D37\u0D3F\u0D15\u0D02", AN: "\u0D06\u0D35\u0D36\u0D4D\u0D2F\u0D3E\u0D28\u0D41\u0D38\u0D30\u0D23\u0D02" };
var WEEKLY = /* @__PURE__ */ new Set(["D", "W", "15D"]);
var RAGN = { G: "Green", A: "Amber", R: "Red", NA: "No data" };
var RAG_ML = { G: "\u0D2A\u0D1A\u0D4D\u0D1A (Green)", A: "\u0D2E\u0D1E\u0D4D\u0D1E (Amber)", R: "\u0D1A\u0D41\u0D35\u0D2A\u0D4D\u0D2A\u0D4D (Red)", NA: "\u0D21\u0D3E\u0D31\u0D4D\u0D31 \u0D07\u0D32\u0D4D\u0D32" };
var RATINGS2 = { "Result-oriented": "G", "Partly result-oriented": "A", "Activity only": "R" };
var RATING_ML = { "Result-oriented": "\u0D2B\u0D32\u0D3E\u0D27\u0D3F\u0D37\u0D4D\u0D20\u0D3F\u0D24\u0D02", "Partly result-oriented": "\u0D2D\u0D3E\u0D17\u0D3F\u0D15\u0D2E\u0D3E\u0D2F\u0D3F \u0D2B\u0D32\u0D3E\u0D27\u0D3F\u0D37\u0D4D\u0D20\u0D3F\u0D24\u0D02", "Activity only": "\u0D1C\u0D4B\u0D32\u0D3F \u0D1A\u0D46\u0D2F\u0D4D\u0D24\u0D41 \u0D0E\u0D28\u0D4D\u0D28\u0D4D \u0D2E\u0D3E\u0D24\u0D4D\u0D30\u0D02" };
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
function meetingWeek(todayYmd) {
  const d = parseYmd(todayYmd);
  const add = (8 - d.getDay()) % 7;
  d.setDate(d.getDate() + add);
  return ymd(d);
}
var weekRange = (w) => `${fmtShort(addDays(w, -7))} \u2013 ${fmtShort(addDays(w, -2))}`;
function calcAch(item, actual) {
  const a = parseFloat(String(actual).replace(/,/g, ""));
  if (actual === "" || actual == null || isNaN(a)) return null;
  const t = item.tv;
  if (item.dir === "zero") return a === 0 ? 100 : 0;
  if (t == null || isNaN(t)) return null;
  let v;
  if (item.dir === "down") v = a <= t ? 100 : a === 0 ? 100 : t / a * 100;
  else v = t === 0 ? a > 0 ? 100 : 0 : a / t * 100;
  return Math.round(Math.min(v, 120));
}
var ragOf = (ach) => ach == null ? "" : ach >= 95 ? "G" : ach >= 80 ? "A" : "R";
var isManual = (item) => item.tv == null && item.dir !== "zero";
var statusOf = (r) => ragOf(r && typeof r.ach === "number" ? r.ach : null);
var filesOf = (r) => r && Array.isArray(r.files) ? r.files : [];
var KIND_ML = { voice: "\u0D36\u0D2C\u0D4D\u0D26 \u0D38\u0D28\u0D4D\u0D26\u0D47\u0D36\u0D02", photo: "\u0D2B\u0D4B\u0D1F\u0D4D\u0D1F\u0D4B", file: "\u0D2B\u0D2F\u0D7D" };
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
var hasValue = (r) => !!r && !!(r.actual || r.reason || r.data || r.next || r.ach != null || filesOf(r).length);
function rowsHash(rows) {
  return Object.keys(rows || {}).sort().map((k) => {
    const r = rows[k];
    return [k, r.actual ?? "", r.ach ?? "", r.reason || "", r.data || "", r.next || "", filesOf(r).map((f) => f.path).join(",")].join("|");
  }).join("~");
}
function sortItems(items) {
  return items.slice().sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) || a.kraNo - b.kraNo || String(a.no).localeCompare(String(b.no), void 0, { numeric: true }));
}
function itemsFor(dept, all) {
  return dept ? sortItems((dept.items || []).filter((i) => all || WEEKLY.has(i.freq))) : [];
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
function checkRows(dept, rows) {
  const out = [];
  for (const i of dept && dept.items || []) {
    const r = rows[i.id];
    if (!hasValue(r)) continue;
    out.push({ no: i.no, kpi: i.text, target: i.target, freq: FREQ[i.freq] || i.freq, headline: !!i.star, actual: r.actual || "", achievement: r.ach != null ? r.ach + "%" : "", status: RAGN[statusOf(r)] || "", reason: r.reason || "", data: r.data || "", nextStep: r.next || "", attached: filesSummary(r) });
  }
  return out;
}
function missingHeadline(dept, rows) {
  return (dept && dept.items || []).filter((i) => i.star && WEEKLY.has(i.freq) && !hasValue(rows[i.id])).map((i) => `${i.no} ${i.text}`);
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
      rows: r ? Object.values(r.rows || {}).map((x) => ({ no: x.no, kpi: x.text, target: x.target, actual: x.actual, ach: x.ach, status: RAGN[statusOf(x)] || "", reason: x.reason, data: x.data, nextStep: x.next || "", attached: filesSummary(x) })) : [],
      clarifications: r ? [...r.clar || [], ...r.ai && r.ai.flags || []].map((c) => ({ kpi: c.kpiNo, q: c.question, a: c.answer || "NOT ANSWERED" })) : [],
      priorities: r ? (r.priorities || []).filter(Boolean) : [],
      support: r ? r.support : "",
      openActions: actions.filter((a) => a.dept === d.id && a.status !== "Done").map((a) => ({ action: a.action, owner: a.owner, due: a.due, overdue: !!(a.due && a.due < today), status: a.status }))
    };
  });
}

// supabase/functions/_shared/ai.ts
async function checkSheet(b, maxFlags = 8) {
  const prompt = `You review a weekly KPI result sheet that a Head of Department (HOD) at Atlas Maharani Group (textile retail, Kerala, many showrooms) will present to the MD office on Monday. Your job: make sure the results are reported in a RESULT-ORIENTED way, not as routine duty, and ask clarification questions where a result is unclear or unsupported.

How to judge each row:
- Result-oriented: a measured outcome against the target (a number, %, or "X out of Y"), backed by verifiable supporting data (count, source report, list).
- Activity only: says work was "done", "checked", "followed up", "ongoing", or claims 100% / Green without saying what was measured or how.
- Every Amber or Red row needs a root cause ("reason") and a "nextStep" (what, who, by when). A vague next step ("will improve", "will follow up") is not enough \u2014 ask for the concrete action.
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
Questions for Monday must be direct and specific to a KPI or figure. Suggestions must be practical for a textile retail chain. Simple English. Never invent figures not in the data.

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
import PptxGenJS from "npm:pptxgenjs@4.0.1";

// supabase/functions/_shared/ppt-builder.js
var INK = "12343B";
var GOLD = "B8892B";
var MUT = "5A6B6F";
var LINE = "D3DBD8";
var TXT = "13262B";
var RED = "B23434";
var RC = { G: ["DDF0E4", "25734A"], A: ["F8E9CC", "9A6412"], R: ["F7DEDC", "B23434"], NA: ["E4E9E8", "6B7779"], none: ["E4E9E8", "6B7779"], "": ["FFFFFF", "5A6B6F"] };
var FONT = "Calibri";
function whyCell(x) {
  const parts = [];
  if (x.reason) parts.push(x.reason);
  if (x.next) parts.push("Next: " + x.next);
  if (x.data) parts.push(x.data);
  const f = filesSummary(x);
  if (f) parts.push("\u{1F4CE} " + f);
  return parts.join(" \xB7 ");
}
function buildDeck(PptxGenJS2, d) {
  const { week, depts, results, actions, review: review2, today } = d;
  const pptx = new PptxGenJS2();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = "HOD Review " + week;
  pptx.defineSlideMaster({
    title: "M",
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 7.18, w: 13.33, h: 0.04, fill: { color: GOLD } } },
      { rect: { x: 0, y: 7.26, w: 13.33, h: 0.04, fill: { color: GOLD } } },
      { text: { text: "Atlas Maharani Group \xB7 Weekly HOD Review \xB7 " + fmt(week), options: { x: 0.5, y: 6.8, w: 9, h: 0.3, fontSize: 9, color: MUT, fontFace: FONT } } }
    ],
    slideNumber: { x: 12.4, y: 6.8, w: 0.5, h: 0.3, fontSize: 9, color: MUT }
  });
  const head = (s, title, sub) => {
    s.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 26, bold: true, color: INK, fontFace: FONT });
    if (sub) s.addText(sub, { x: 0.5, y: 0.9, w: 12.3, h: 0.4, fontSize: 13, color: MUT, fontFace: FONT });
  };
  const H = (t2) => ({ text: t2, options: { bold: true, color: "FFFFFF", fill: { color: INK }, fontSize: 11 } });
  const ragCell = (rag) => ({ text: RAGN[rag] || "\u2014", options: { bold: true, fill: { color: RC[rag || ""][0] }, color: RC[rag || ""][1], align: "center" } });
  const ratingCell = (rating) => {
    const k = RATINGS2[rating] || "";
    return { text: rating || "\u2014", options: { bold: true, fill: { color: RC[k][0] }, color: RC[k][1] } };
  };
  const tblOpts = (colW) => ({ x: 0.5, y: 1.45, w: 12.33, colW, fontSize: 10, fontFace: FONT, color: TXT, border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", margin: 0.05 });
  const bullets = (s, lines) => {
    if (lines.length) s.addText(lines, { x: 0.5, y: 1.45, w: 12.3, h: 5.2, valign: "top", fontFace: FONT, color: TXT, fit: "shrink" });
  };
  const sec = (t2, color, first) => ({ text: t2, options: { bold: true, fontSize: 16, color: color || INK, breakLine: true, paraSpaceBefore: first ? 0 : 10 } });
  const bl = (t2, size) => ({ text: String(t2), options: { bullet: true, fontSize: size || 14, breakLine: true } });
  const t = pptx.addSlide();
  t.background = { color: INK };
  t.addShape(pptx.ShapeType.rect, { x: 0, y: 5.2, w: 13.33, h: 0.06, fill: { color: GOLD } });
  t.addShape(pptx.ShapeType.rect, { x: 0, y: 5.32, w: 13.33, h: 0.06, fill: { color: GOLD } });
  t.addText("ATLAS MAHARANI GROUP", { x: 0.8, y: 1.4, w: 11, h: 0.4, fontSize: 14, color: "D9AE55", bold: true, charSpacing: 4, fontFace: FONT });
  t.addText("Weekly HOD Review", { x: 0.8, y: 1.9, w: 11, h: 1, fontSize: 44, color: "FFFFFF", bold: true, fontFace: FONT });
  t.addText(`KRA & KPI results \xB7 week ${weekRange(week)}`, { x: 0.8, y: 3, w: 11, h: 0.5, fontSize: 20, color: "E4ECEA", fontFace: FONT });
  t.addText(`Meeting: Monday ${fmt(week)}`, { x: 0.8, y: 3.6, w: 11, h: 0.4, fontSize: 16, color: "93A5A8", fontFace: FONT });
  const ds = deptListOf(depts);
  const snap = pptx.addSlide({ masterName: "M" });
  const scores = [];
  const tot = { G: 0, A: 0, R: 0 };
  const srows = [[H("Department"), H("HOD"), H("Submitted"), H("Score"), H("Status"), H("Green"), H("Amber"), H("Red"), H("Open actions")]];
  ds.forEach((dp) => {
    const r = results[dp.id];
    const subm = r && r.status === "submitted";
    const sm = r ? summarize(r.rows) : { score: null, counts: { G: 0, A: 0, R: 0 }, rag: "none" };
    if (subm) {
      if (sm.score != null) scores.push(sm.score);
      for (const k in tot) tot[k] += sm.counts[k];
    }
    srows.push([
      { text: dp.name, options: { bold: true } },
      dp.hod || "",
      subm ? "Yes" : r ? "Draft" : "No",
      sm.score != null ? sm.score + "%" : "\u2014",
      ragCell(subm ? sm.rag : "none"),
      String(sm.counts.G),
      String(sm.counts.A),
      String(sm.counts.R),
      String(actions.filter((a) => a.dept === dp.id && a.status !== "Done").length)
    ]);
  });
  const grp = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  head(snap, "Group snapshot", `${scores.length} of ${ds.length} departments submitted \xB7 group score ${grp != null ? grp + "%" : "\u2014"} \xB7 ${tot.G} Green, ${tot.A} Amber, ${tot.R} Red KPIs`);
  snap.addTable(srows, tblOpts([2.3, 2.6, 1.1, 0.9, 1.2, 0.9, 0.9, 0.9, 1.53]));
  if (review2) {
    const s = pptx.addSlide({ masterName: "M" });
    head(s, "MD office review (by Claude)", review2.headline || "");
    const lines = [];
    if (review2.groupView) lines.push({ text: review2.groupView, options: { fontSize: 14, breakLine: true, paraSpaceAfter: 8 } });
    if ((review2.watchList || []).length) {
      lines.push(sec("Watch list this week", INK, true));
      review2.watchList.forEach((x) => lines.push(bl(x, 13)));
    }
    if ((review2.crossDept || []).length) {
      lines.push(sec("Across departments"));
      review2.crossDept.forEach((x) => lines.push(bl(x, 13)));
    }
    bullets(s, lines);
    const rr = [[H("Department"), H("Claude rating"), H("Verdict")]];
    (review2.departments || []).forEach((x) => rr.push([(depts[x.dept] || {}).name || x.dept, ratingCell(x.rating), x.verdict]));
    if (rr.length > 1) {
      const s2 = pptx.addSlide({ masterName: "M" });
      head(s2, "Result-oriented or just duty?", "Claude's rating of how each department reported this week");
      s2.addTable(rr, tblOpts([2.2, 2.1, 8.03]));
    }
  }
  const order = { R: 0, A: 1, G: 2, NA: 3, "": 4 };
  ds.forEach((dp) => {
    const r = results[dp.id];
    const sm = r ? summarize(r.rows) : null;
    if (!r) {
      const s = pptx.addSlide({ masterName: "M" });
      head(s, dp.name, `HOD ${dp.hod || ""}`);
      s.addText("Results not submitted for this week.", { x: 0.5, y: 2.5, w: 12.3, h: 1, fontSize: 24, color: RED, bold: true, align: "center", fontFace: FONT });
      return;
    }
    const rows = Object.entries(r.rows || {}).map(([id, x]) => ({ id, ...x, rag: statusOf(x) })).sort((a, b) => order[a.rag] - order[b.rag] || (b.star ? 1 : 0) - (a.star ? 1 : 0) || String(a.no).localeCompare(String(b.no), void 0, { numeric: true }));
    const per = 9;
    const pages = Math.max(1, Math.ceil(rows.length / per));
    for (let p = 0; p < pages; p++) {
      const s = pptx.addSlide({ masterName: "M" });
      head(
        s,
        `${dp.name} \u2014 ${sm.score != null ? sm.score + "%" : "\u2014"} ${sm.rag !== "none" ? "\xB7 " + RAGN[sm.rag] : ""}`,
        `HOD ${dp.hod || ""} \xB7 ${sm.counts.G} Green, ${sm.counts.A} Amber, ${sm.counts.R} Red${r.status !== "submitted" ? " \xB7 DRAFT, not submitted" : ""}${r.source === "whatsapp" ? " \xB7 via WhatsApp" : ""}${pages > 1 ? ` \xB7 page ${p + 1} of ${pages}` : ""}`
      );
      const tr = [[H(""), H("#"), H("KPI"), H("Target"), H("Actual"), H("Ach %"), H("Status"), H("Reason \xB7 next step \xB7 evidence")]];
      rows.slice(p * per, p * per + per).forEach((x) => tr.push([x.star ? { text: "\u2605", options: { color: GOLD, align: "center" } } : "", x.no, x.text, x.target, String(x.actual || ""), x.ach != null ? x.ach + "%" : "\u2014", ragCell(x.rag), whyCell(x)]));
      if (tr.length === 1) tr.push(["", "", "No KPI rows entered", "", "", "", "", ""]);
      s.addTable(tr, tblOpts([0.35, 0.6, 4.1, 1.35, 1, 0.8, 0.95, 3.18]));
    }
    const pri = (r.priorities || []).filter(Boolean);
    const newActs = actions.filter((a) => a.dept === dp.id && a.week === week);
    const drv = review2 && (review2.departments || []).find((x) => x.dept === dp.id);
    const ai = r.ai;
    if (pri.length || r.support || newActs.length || drv || ai) {
      const s = pptx.addSlide({ masterName: "M" });
      head(s, `${dp.name} \u2014 plan & Claude's questions`, ai ? `Claude check: ${ai.rating}${ai.score != null ? " \xB7 evidence " + ai.score + "/100" : ""}` : "Not checked by Claude");
      const lines = [];
      if (drv && (drv.questions || []).length) {
        lines.push(sec("Ask on Monday", RED, !lines.length));
        drv.questions.forEach((x) => lines.push(bl(x)));
      }
      const qa = ai && ai.flags || [];
      const unans = qa.filter((x) => !(x.answer || "").trim());
      const ans = [...r.clar || [], ...qa.filter((x) => (x.answer || "").trim())];
      if (unans.length) {
        lines.push(sec("Claude's questions not answered by HOD", RED, !lines.length));
        unans.forEach((x) => lines.push(bl((x.kpiNo ? "KPI " + x.kpiNo + ": " : "") + x.question, 13)));
      }
      if (ans.length) {
        lines.push(sec("HOD's answers to Claude", INK, !lines.length));
        ans.slice(0, 6).forEach((x) => lines.push(bl(`${x.kpiNo ? "KPI " + x.kpiNo + ": " : ""}${x.question} \u2192 ${x.answer}`, 12)));
      }
      if (drv && (drv.suggestions || []).length) {
        lines.push(sec("Suggestions", INK, !lines.length));
        drv.suggestions.forEach((x) => lines.push(bl(x)));
      }
      if (pri.length) {
        lines.push(sec("Top priorities", INK, !lines.length));
        pri.forEach((x) => lines.push(bl(x)));
      }
      if (newActs.length) {
        lines.push(sec("Actions for Red KPIs", INK, !lines.length));
        newActs.forEach((a) => lines.push(bl(`${a.kpiNo ? "KPI " + a.kpiNo + ": " : ""}${a.action} \u2014 ${a.owner || "owner?"}, by ${a.due ? fmtShort(a.due) : "date?"}`)));
      }
      if (r.support) {
        lines.push(sec("Support needed", INK, !lines.length));
        lines.push({ text: r.support, options: { fontSize: 14, breakLine: true } });
      }
      bullets(s, lines);
    }
  });
  const reds = [];
  ds.forEach((dp) => {
    const r = results[dp.id];
    if (!r) return;
    Object.values(r.rows || {}).forEach((x) => {
      if (statusOf(x) === "R") reds.push([dp.name, x.no, x.text, x.target, String(x.actual || ""), x.ach != null ? x.ach + "%" : "\u2014", whyCell(x)]);
    });
  });
  for (let p = 0; p < Math.max(1, Math.ceil(reds.length / 10)); p++) {
    const s = pptx.addSlide({ masterName: "M" });
    head(s, "Red KPIs across the group", reds.length ? `${reds.length} KPIs below 80% of target \u2014 each needs an owner, action and date` : "No Red KPIs reported this week");
    if (reds.length) s.addTable([[H("Department"), H("#"), H("KPI"), H("Target"), H("Actual"), H("Ach %"), H("Reason \xB7 next step")], ...reds.slice(p * 10, p * 10 + 10)], tblOpts([1.8, 0.6, 4, 1.4, 1, 0.8, 2.73]));
  }
  const acts = actions.filter((a) => a.status !== "Done").sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  for (let p = 0; p < Math.max(1, Math.ceil(acts.length / 11)); p++) {
    const s = pptx.addSlide({ masterName: "M" });
    const od = acts.filter((a) => a.due && a.due < today).length;
    head(s, "Pending points \u2014 action tracker", acts.length ? `${acts.length} open actions \xB7 ${od} overdue` : "No open actions");
    if (acts.length) s.addTable([[H("Department"), H("KPI"), H("Action"), H("Owner"), H("Due"), H("Status")], ...acts.slice(p * 11, p * 11 + 11).map((a) => {
      const late = a.due && a.due < today;
      return [(depts[a.dept] || {}).name || a.dept, a.kpiNo || "", a.action, a.owner || "", { text: a.due ? fmtShort(a.due) + (late ? " \xB7 overdue" : "") : "\u2014", options: late ? { color: RED, bold: true } : {} }, a.status];
    })], tblOpts([1.8, 0.7, 5.3, 1.8, 1.4, 1.33]));
  }
  return pptx;
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

// supabase/functions/_shared/jobs.ts
async function getSettings(db) {
  const { data } = await db.from("app_settings").select("*").eq("id", 1).maybeSingle();
  return data || { report_numbers: [], bot_scope: "weekly", tpl_start: "kpi_weekly_start", tpl_report: "kpi_weekly_report", tpl_lang: "ml" };
}
async function review(db, week, userId = null) {
  const d = await loadWeek(db, week);
  const data = await reviewWeek({ weekLabel: weekRange(week), meeting: fmt(week), repeatReds: repeatReds(d.depts, d.results, d.prev).map((x) => `${x.name} ${x.no} ${x.text}`), departments: reviewDepartments(d) });
  const { error } = await db.from("reviews").upsert({ week, data, created_by: userId, created_at: (/* @__PURE__ */ new Date()).toISOString() });
  if (error) throw new Error("Review could not be saved: " + error.message);
  await logJob(db, "review", week, true, data.headline);
  return data;
}
async function ppt(db, week, opts = {}) {
  let d = await loadWeek(db, week);
  if (!d.review && opts.makeReview !== false && Deno.env.get("ANTHROPIC_API_KEY")) {
    try {
      await review(db, week);
      d = await loadWeek(db, week);
    } catch (e) {
      console.error("review before ppt failed", e);
    }
  }
  const deck = buildDeck(PptxGenJS, d);
  const bytes = await deck.write({ outputType: "uint8array" });
  const filename = `HOD-Review-${week}.pptx`;
  const path = `${week}/${filename}`;
  const up = await db.storage.from("reports").upload(path, bytes, { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  if (up.error) throw new Error("Could not store the PPT: " + up.error.message);
  const signed = await db.storage.from("reports").createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signed.error) throw new Error("Could not create the PPT link: " + signed.error.message);
  const link = signed.data.signedUrl;
  const st = await getSettings(db);
  const to = (opts.to && opts.to.length ? opts.to : st.report_numbers) || [];
  const total = deptListOf(d.depts).length;
  const submitted = Object.values(d.results).filter((r) => r.status === "submitted").length;
  const sent = [], failed = [];
  for (const n of to) {
    try {
      await sendTemplate(db, n, st.tpl_report, st.tpl_lang, [weekRange(week), `${submitted}/${total}`], { link, filename });
      sent.push(n);
    } catch (e) {
      failed.push(`${n}: ${e.message}`);
    }
  }
  await logJob(
    db,
    "ppt",
    week,
    failed.length === 0 && (to.length === 0 || sent.length > 0),
    `${submitted}/${total} submitted \xB7 sent to ${sent.length} number(s)${to.length === 0 ? " (no numbers in Settings)" : ""}${failed.length ? ` \xB7 failed: ${failed.join("; ")}` : ""}`
  );
  return { link, filename, sent, failed, submitted, total };
}

// supabase/functions/_shared/bot.ts
var WORDS = {
  start: ["start", "kpi", "report", "hi", "hello", "hai", "\u0D24\u0D41\u0D1F\u0D19\u0D4D\u0D19\u0D41\u0D15", "\u0D24\u0D41\u0D1F\u0D19\u0D4D\u0D19\u0D3E\u0D02", "\u0D39\u0D3E\u0D2F\u0D4D", "\u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D"],
  restart: ["restart", "\u0D35\u0D40\u0D23\u0D4D\u0D1F\u0D41\u0D02", "\u0D35\u0D40\u0D23\u0D4D\u0D1F\u0D41\u0D02 \u0D24\u0D41\u0D1F\u0D19\u0D4D\u0D19\u0D41\u0D15"],
  skip: ["skip", "\u0D12\u0D34\u0D3F\u0D35\u0D3E\u0D15\u0D4D\u0D15\u0D41\u0D15", "-", "next"],
  back: ["back", "\u0D2E\u0D41\u0D2E\u0D4D\u0D2A\u0D24\u0D4D\u0D24\u0D46", "\u0D2A\u0D3F\u0D28\u0D4D\u0D28\u0D4B\u0D1F\u0D4D\u0D1F\u0D4D"],
  stop: ["stop", "pause", "\u0D28\u0D3F\u0D7C\u0D24\u0D4D\u0D24\u0D41\u0D15", "later"],
  status: ["status", "\u0D28\u0D3F\u0D32"],
  help: ["help", "\u0D38\u0D39\u0D3E\u0D2F\u0D02", "?"],
  none: ["no", "nil", "none", "\u0D07\u0D32\u0D4D\u0D32", "\u0D35\u0D47\u0D23\u0D4D\u0D1F", "na", "n/a"]
};
var is = (t, k) => WORDS[k].includes(t);
var RAG_WORDS = /* @__PURE__ */ new Set(["g", "green", "\u0D2A\u0D1A\u0D4D\u0D1A", "a", "amber", "\u0D2E\u0D1E\u0D4D\u0D1E", "r", "red", "\u0D1A\u0D41\u0D35\u0D2A\u0D4D\u0D2A\u0D4D"]);
var HELP = "*\u0D38\u0D39\u0D3E\u0D2F\u0D02*\nSTART \u2013 \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D24\u0D41\u0D1F\u0D19\u0D4D\u0D19\u0D3E\u0D7B / \u0D24\u0D41\u0D1F\u0D30\u0D3E\u0D7B\nSKIP \u2013 \u0D08 \u0D1A\u0D4B\u0D26\u0D4D\u0D2F\u0D02 \u0D12\u0D34\u0D3F\u0D35\u0D3E\u0D15\u0D4D\u0D15\u0D3E\u0D7B\nBACK \u2013 \u0D2E\u0D41\u0D2E\u0D4D\u0D2A\u0D24\u0D4D\u0D24\u0D46 \u0D1A\u0D4B\u0D26\u0D4D\u0D2F\u0D02\nSTATUS \u2013 \u0D0E\u0D24\u0D4D\u0D30 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F\nSTOP \u2013 \u0D2A\u0D3F\u0D28\u0D4D\u0D28\u0D40\u0D1F\u0D4D \u0D24\u0D41\u0D1F\u0D30\u0D3E\u0D7B\nRESTART \u2013 \u0D06\u0D26\u0D4D\u0D2F\u0D02 \u0D2E\u0D41\u0D24\u0D7D \u0D2E\u0D3E\u0D31\u0D4D\u0D31\u0D3E\u0D7B";
function parseAnswer(text, manual) {
  const t = text.trim();
  const first = t.split(/[\s,.:;\-]+/)[0].toLowerCase();
  if (RAG_WORDS.has(first)) return { kind: "colour" };
  const m = t.replace(/rs\.?\s*/ig, "").match(/-?\d[\d,]*(\.\d+)?/);
  if (!m) return { kind: "none" };
  const value = m[0].replace(/,/g, "");
  const note = t.replace(/rs\.?\s*/ig, "").replace(m[0], "").replace(/^[\s,.:;%\-]+/, "").trim();
  return { kind: "number", value, note };
}
function askKpi(item, i, n, row) {
  let s = `*${i + 1}/${n} \xB7 KPI ${item.no}${item.star ? " \u2605" : ""}*
${item.text}
\u0D32\u0D15\u0D4D\u0D37\u0D4D\u0D2F\u0D02: ${item.target} (${FREQ_ML[item.freq] || item.freq})`;
  if (hasValue(row)) s += `
\u0D07\u0D2A\u0D4D\u0D2A\u0D4B\u0D7E: ${row.actual || (row.ach != null ? row.ach + "%" : "")}${filesOf(row).length ? " \xB7 \u{1F4CE} " + filesOf(row).length : ""} \u2014 \u0D2E\u0D3E\u0D31\u0D4D\u0D31\u0D2E\u0D3F\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D SKIP`;
  s += isManual(item) ? "\n\n\u0D0E\u0D24\u0D4D\u0D30 \u0D36\u0D24\u0D2E\u0D3E\u0D28\u0D02 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F \u0D0E\u0D28\u0D4D\u0D28\u0D4D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15 (\u0D09\u0D26\u0D3E: 92). \u0D15\u0D42\u0D1F\u0D46 \u0D21\u0D3E\u0D31\u0D4D\u0D31 \u0D0E\u0D34\u0D41\u0D24\u0D3E\u0D02. \u0D28\u0D3F\u0D31\u0D02 (Green/Amber/Red) \u0D24\u0D28\u0D3F\u0D2F\u0D46 \u0D35\u0D30\u0D41\u0D02." : "\n\n\u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 \u0D2F\u0D25\u0D3E\u0D7C\u0D24\u0D4D\u0D25 \u0D15\u0D23\u0D15\u0D4D\u0D15\u0D4D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15. \u0D15\u0D42\u0D1F\u0D46 \u0D21\u0D3E\u0D31\u0D4D\u0D31 \u0D0E\u0D34\u0D41\u0D24\u0D3E\u0D02 (\u0D09\u0D26\u0D3E: 1420, billing report).";
  s += "\n\u0D24\u0D46\u0D33\u0D3F\u0D35\u0D3E\u0D2F\u0D3F \u0D2B\u0D4B\u0D1F\u0D4D\u0D1F\u0D4B / \u0D36\u0D2C\u0D4D\u0D26 \u0D38\u0D28\u0D4D\u0D26\u0D47\u0D36\u0D02 / \u0D21\u0D4B\u0D15\u0D4D\u0D2F\u0D41\u0D2E\u0D46\u0D28\u0D4D\u0D31\u0D4D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D3E\u0D02.";
  return s;
}
var askFlag = (f, i, n) => `*Claude-\u0D28\u0D4D\u0D31\u0D46 \u0D1A\u0D4B\u0D26\u0D4D\u0D2F\u0D02 ${i + 1}/${n}*${f.kpiNo ? " \xB7 KPI " + f.kpiNo : ""}${f.severity === "high" ? " (\u0D2E\u0D31\u0D41\u0D2A\u0D1F\u0D3F \u0D28\u0D3F\u0D7C\u0D2C\u0D28\u0D4D\u0D27\u0D02)" : ""}
${f.question}`;
var ASK_REASON = (no, rag) => `KPI ${no}: ${RAG_ML[rag] || ""}
*\u0D15\u0D3E\u0D30\u0D23\u0D02* \u0D0E\u0D28\u0D4D\u0D24\u0D3E\u0D23\u0D4D? \u0D1F\u0D48\u0D2A\u0D4D\u0D2A\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D2F\u0D41\u0D15, \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D36\u0D2C\u0D4D\u0D26 \u0D38\u0D28\u0D4D\u0D26\u0D47\u0D36\u0D02 / \u0D2B\u0D4B\u0D1F\u0D4D\u0D1F\u0D4B / \u0D21\u0D4B\u0D15\u0D4D\u0D2F\u0D41\u0D2E\u0D46\u0D28\u0D4D\u0D31\u0D4D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.`;
var ASK_NEXT = (no) => `KPI ${no}: *\u0D05\u0D1F\u0D41\u0D24\u0D4D\u0D24 \u0D28\u0D1F\u0D2A\u0D1F\u0D3F* \u0D0E\u0D28\u0D4D\u0D24\u0D3E\u0D23\u0D4D? (\u0D0E\u0D28\u0D4D\u0D24\u0D4D, \u0D06\u0D30\u0D4D, \u0D0E\u0D2A\u0D4D\u0D2A\u0D4B\u0D7E)
\u0D09\u0D26\u0D3E: Perumbavoor-\u0D7D 2 staff \u0D15\u0D42\u0D1F\u0D3F, Manager Rajesh, 25 Oct-\u0D28\u0D15\u0D02`;
var ASK_PRI = "*\u0D05\u0D1F\u0D41\u0D24\u0D4D\u0D24 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 3 \u0D2A\u0D4D\u0D30\u0D27\u0D3E\u0D28 \u0D2E\u0D41\u0D7B\u0D17\u0D23\u0D28\u0D15\u0D7E*\n\u0D13\u0D30\u0D4B\u0D28\u0D4D\u0D28\u0D41\u0D02 \u0D2A\u0D4D\u0D30\u0D24\u0D40\u0D15\u0D4D\u0D37\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D28\u0D4D\u0D28 \u0D28\u0D2E\u0D4D\u0D2A\u0D31\u0D4B\u0D1F\u0D46, \u0D13\u0D30\u0D4B \u0D35\u0D30\u0D3F\u0D2F\u0D3F\u0D7D \u0D12\u0D28\u0D4D\u0D28\u0D4D.\n\u0D09\u0D26\u0D3E: Perumbavoor conversion 75% \u0D06\u0D15\u0D4D\u0D15\u0D41\u0D15";
var ASK_SUP = "*\u0D38\u0D39\u0D3E\u0D2F\u0D02 \u0D35\u0D47\u0D23\u0D4B?*\nCEO-\u0D2F\u0D3F\u0D7D \u0D28\u0D3F\u0D28\u0D4D\u0D28\u0D4B \u0D2E\u0D31\u0D4D\u0D31\u0D4D \u0D35\u0D15\u0D41\u0D2A\u0D4D\u0D2A\u0D41\u0D15\u0D33\u0D3F\u0D7D \u0D28\u0D3F\u0D28\u0D4D\u0D28\u0D4B \u0D0E\u0D28\u0D4D\u0D24\u0D4D \u0D38\u0D39\u0D3E\u0D2F\u0D02 \u0D35\u0D47\u0D23\u0D02? \u0D07\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u2018\u0D07\u0D32\u0D4D\u0D32\u2019 \u0D0E\u0D28\u0D4D\u0D28\u0D4D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.";
async function handleMessage(db, profile, textIn, media = null) {
  const text = (textIn || "").trim();
  const cmd = text.toLowerCase();
  const reply = (s2) => sendText(db, profile.phone, s2);
  if (profile.role !== "hod" || !profile.dept_id) {
    if (profile.role === "admin" && cmd === "ppt") {
      await reply("\u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 PPT \u0D24\u0D2F\u0D4D\u0D2F\u0D3E\u0D31\u0D3E\u0D15\u0D4D\u0D15\u0D41\u0D28\u0D4D\u0D28\u0D41\u2026 \u0D12\u0D30\u0D41 \u0D2E\u0D3F\u0D28\u0D3F\u0D31\u0D4D\u0D31\u0D4D.");
      const r = await ppt(db, meetingWeek(istToday()), { to: [profile.phone], makeReview: false });
      if (!r.sent.length) await reply("PPT \u0D24\u0D2F\u0D4D\u0D2F\u0D3E\u0D31\u0D3E\u0D2F\u0D3F, \u0D2A\u0D15\u0D4D\u0D37\u0D47 WhatsApp-\u0D7D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D3E\u0D28\u0D3E\u0D2F\u0D3F\u0D32\u0D4D\u0D32. \u0D21\u0D57\u0D7A\u0D32\u0D4B\u0D21\u0D4D: " + r.link);
      return;
    }
    if (profile.role === "admin" && cmd === "status") {
      const week2 = meetingWeek(istToday());
      const { data: depts } = await db.from("departments").select("id, name, sort_order").order("sort_order");
      const { data: res2 } = await db.from("results").select("dept_id, status, score").eq("week", week2);
      const lines = (depts || []).map((d) => {
        const r = (res2 || []).find((x) => x.dept_id === d.id);
        return `${r && r.status === "submitted" ? "\u2713" : r ? "\u2026" : "\u2717"} ${d.name}${r && r.score != null ? " \xB7 " + r.score + "%" : ""}`;
      });
      await reply(`*${weekRange(week2)} \xB7 \u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D23 \u0D28\u0D3F\u0D32*
${lines.join("\n")}`);
      return;
    }
    await reply(profile.role === "admin" ? "Admin commands:\nPPT \u2013 \u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 PPT\nSTATUS \u2013 \u0D06\u0D30\u0D4A\u0D15\u0D4D\u0D15\u0D46 \u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D3F\u0D1A\u0D4D\u0D1A\u0D41" : "KPI \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D HOD-\u0D2E\u0D3E\u0D7C\u0D15\u0D4D\u0D15\u0D4D \u0D2E\u0D3E\u0D24\u0D4D\u0D30\u0D2E\u0D3E\u0D23\u0D4D.");
    return;
  }
  const week = meetingWeek(istToday());
  const [{ data: dRow }, { data: kRows }, { data: rRow }, { data: sess }] = await Promise.all([
    db.from("departments").select("*").eq("id", profile.dept_id).maybeSingle(),
    db.from("kpis").select("*").eq("dept_id", profile.dept_id),
    db.from("results").select("*").eq("week", week).eq("dept_id", profile.dept_id).maybeSingle(),
    db.from("wa_sessions").select("*").eq("phone", profile.phone).maybeSingle()
  ]);
  if (!dRow) {
    await reply("\u0D28\u0D3F\u0D19\u0D4D\u0D19\u0D33\u0D41\u0D1F\u0D46 \u0D35\u0D15\u0D41\u0D2A\u0D4D\u0D2A\u0D4D \u0D15\u0D23\u0D4D\u0D1F\u0D46\u0D24\u0D4D\u0D24\u0D3E\u0D28\u0D3E\u0D2F\u0D3F\u0D32\u0D4D\u0D32. Admin-\u0D28\u0D46 \u0D05\u0D31\u0D3F\u0D2F\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D15.");
    return;
  }
  const dept = buildDepts([dRow], kRows || [])[profile.dept_id];
  const res = rRow ? mapResult(rRow) : { week, dept: profile.dept_id, status: "draft", rows: {}, priorities: [], support: "", ai: null, clar: [], source: "whatsapp" };
  const byId = Object.fromEntries(dept.items.map((i) => [i.id, i]));
  let s = sess && sess.week === week ? { ...sess } : null;
  const save = async () => {
    const sm = summarize(res.rows);
    const { error } = await db.from("results").upsert({
      week,
      dept_id: profile.dept_id,
      status: res.status,
      rows: res.rows,
      priorities: res.priorities,
      support: res.support,
      score: sm.score,
      counts: sm.counts,
      ai: res.ai,
      clar: res.clar,
      source: "whatsapp",
      updated_by: profile.id,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }, { onConflict: "week,dept_id" });
    if (error) throw new Error(error.message);
  };
  const saveSession = async () => {
    s.updated_at = (/* @__PURE__ */ new Date()).toISOString();
    await db.from("wa_sessions").upsert({ phone: profile.phone, user_id: profile.id, dept_id: profile.dept_id, week, step: s.step, idx: s.idx, items: s.items, sub: s.sub ?? null, updated_at: s.updated_at });
  };
  const storeMedia = async (folder) => {
    const m = media;
    const { bytes, mime } = await downloadMedia(m.id);
    if (bytes.length > 16 * 1024 * 1024) throw new Error("file too big");
    const type = mime || m.mime || "application/octet-stream";
    const kind = m.voice ? "voice" : kindOf(type);
    const ext = (type.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
    const name = (m.filename || `${kind}-whatsapp.${ext}`).replace(/[^\w.\-]+/g, "_").slice(-60);
    const path = `${week}/${profile.dept_id}/${folder}/${Date.now()}-${name}`;
    const up = await db.storage.from("evidence").upload(path, bytes, { contentType: type, upsert: false });
    if (up.error) throw new Error(up.error.message);
    return { path, name, type, size: bytes.length, kind, at: (/* @__PURE__ */ new Date()).toISOString(), via: "whatsapp" };
  };
  const attach = async (kpiId) => {
    const meta = await storeMedia(kpiId);
    const it = byId[kpiId];
    const base = it ? { no: it.no, text: it.text, target: it.target, star: !!it.star, kraNo: it.kraNo, freq: it.freq } : {};
    const old = res.rows[kpiId] || { actual: "", ach: null };
    res.rows[kpiId] = { ...old, ...base, files: [...filesOf(old), meta] };
    await save();
    return meta.kind;
  };
  const attachOrSay = async (kpiId, flag) => {
    try {
      if (kpiId) return await attach(kpiId);
      const meta = await storeMedia("_general");
      if (flag) flag.files = [...flag.files || [], meta];
      return meta.kind;
    } catch (e) {
      console.error("attach failed", e);
      await reply("\u0D2B\u0D2F\u0D7D \u0D38\u0D47\u0D35\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D2F\u0D3E\u0D28\u0D3E\u0D2F\u0D3F\u0D32\u0D4D\u0D32. \u0D35\u0D40\u0D23\u0D4D\u0D1F\u0D41\u0D02 \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15, \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D1F\u0D48\u0D2A\u0D4D\u0D2A\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D2F\u0D41\u0D15.");
      return null;
    }
  };
  const start = async (fromBeginning) => {
    const st = await getSettings(db);
    let items = itemsFor(dept, false);
    if (st.bot_scope === "headline") items = items.filter((i) => i.star);
    s = { step: "kpi", idx: 0, items: items.map((i) => i.id), sub: null };
    if (!s.items.length) {
      s.step = "priorities";
    } else if (!fromBeginning) {
      const first = s.items.findIndex((id) => !hasValue(res.rows[id]));
      s.idx = first < 0 ? s.items.length : first;
    }
    if (res.status === "submitted" && fromBeginning) {
      res.status = "draft";
      await save();
    }
    await saveSession();
    await reply(`\u0D28\u0D2E\u0D38\u0D4D\u0D15\u0D3E\u0D30\u0D02 ${profile.full_name || ""}.
*${dept.name}* \u2013 \u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 KPI \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D (${weekRange(week)}, \u0D2E\u0D40\u0D31\u0D4D\u0D31\u0D3F\u0D02\u0D17\u0D4D ${fmt(week)}).
${s.items.length} KPI. \u0D13\u0D30\u0D4B\u0D28\u0D4D\u0D28\u0D3F\u0D28\u0D41\u0D02 \u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 \u0D15\u0D23\u0D15\u0D4D\u0D15\u0D4D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.
SKIP \xB7 BACK \xB7 STOP \xB7 HELP`);
    await askCurrent();
  };
  const askCurrent = async () => {
    if (s.step === "kpi") {
      if (s.idx >= s.items.length) {
        s.step = "priorities";
        s.idx = 0;
        await saveSession();
        return reply(ASK_PRI);
      }
      const it = byId[s.items[s.idx]];
      if (!it) {
        s.idx++;
        return askCurrent();
      }
      if (s.sub === "reason") return reply(ASK_REASON(it.no, statusOf(res.rows[it.id])));
      if (s.sub === "next") return reply(ASK_NEXT(it.no));
      return reply(askKpi(it, s.idx, s.items.length, res.rows[it.id]));
    }
    if (s.step === "priorities") return reply(ASK_PRI);
    if (s.step === "support") return reply(ASK_SUP);
    if (s.step === "clarify") {
      const fl = res.ai?.flags || [];
      return reply(askFlag(fl[s.idx], s.idx, fl.length));
    }
  };
  const runCheck = async () => {
    await reply("\u0D28\u0D28\u0D4D\u0D26\u0D3F. Claude \u0D28\u0D3F\u0D19\u0D4D\u0D19\u0D33\u0D41\u0D1F\u0D46 \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D2A\u0D30\u0D3F\u0D36\u0D4B\u0D27\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D28\u0D4D\u0D28\u0D41\u2026 \u0D12\u0D30\u0D41 \u0D2E\u0D3F\u0D28\u0D3F\u0D31\u0D4D\u0D31\u0D4D.");
    for (const f of res.ai?.flags || []) if ((f.answer || "").trim() && !res.clar.some((c) => c.question === f.question)) res.clar.push({ kpiNo: f.kpiNo, question: f.question, answer: f.answer, at: (/* @__PURE__ */ new Date()).toISOString() });
    try {
      const out = await checkSheet({
        deptName: dept.name,
        hod: dept.hod,
        week: weekRange(week),
        meeting: fmt(week),
        rows: checkRows(dept, res.rows),
        missing: missingHeadline(dept, res.rows),
        priorities: res.priorities,
        support: res.support,
        clarifications: res.clar.map((c) => ({ kpi: c.kpiNo, q: c.question, a: c.answer }))
      }, 5);
      res.ai = { ...out, at: (/* @__PURE__ */ new Date()).toISOString(), hash: rowsHash(res.rows), flags: out.flags.map((f) => ({ ...f, answer: "" })) };
      await save();
    } catch (e) {
      console.error("claude check failed", e);
      await reply("Claude \u0D2A\u0D30\u0D3F\u0D36\u0D4B\u0D27\u0D28 \u0D07\u0D2A\u0D4D\u0D2A\u0D4B\u0D7E \u0D28\u0D1F\u0D28\u0D4D\u0D28\u0D3F\u0D32\u0D4D\u0D32. \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D28\u0D4D\u0D28\u0D41; MD \u0D13\u0D2B\u0D40\u0D38\u0D4D \u0D2A\u0D3F\u0D28\u0D4D\u0D28\u0D40\u0D1F\u0D4D \u0D2A\u0D30\u0D3F\u0D36\u0D4B\u0D27\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D02.");
      return finish();
    }
    if (!res.ai.flags.length) return finish();
    s.step = "clarify";
    s.idx = 0;
    await saveSession();
    await reply(`Claude-\u0D28\u0D4D ${res.ai.flags.length} \u0D1A\u0D4B\u0D26\u0D4D\u0D2F\u0D19\u0D4D\u0D19\u0D33\u0D41\u0D23\u0D4D\u0D1F\u0D4D. \u0D13\u0D30\u0D4B\u0D28\u0D4D\u0D28\u0D3F\u0D28\u0D41\u0D02 \u0D2E\u0D31\u0D41\u0D2A\u0D1F\u0D3F \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.`);
    return askCurrent();
  };
  const finish = async () => {
    res.status = "submitted";
    await save();
    s.step = "done";
    s.idx = 0;
    await saveSession();
    const sm = summarize(res.rows);
    let msg = `*\u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D3F\u0D1A\u0D4D\u0D1A\u0D41. \u0D28\u0D28\u0D4D\u0D26\u0D3F.*
${dept.name} \xB7 ${weekRange(week)}
\u0D38\u0D4D\u0D15\u0D4B\u0D7C ${sm.score != null ? sm.score + "%" : "\u2014"} \xB7 Green ${sm.counts.G} \xB7 Amber ${sm.counts.A} \xB7 Red ${sm.counts.R}`;
    if (res.ai) msg += `
Claude \u0D35\u0D3F\u0D32\u0D2F\u0D3F\u0D30\u0D41\u0D24\u0D4D\u0D24\u0D7D: ${RATING_ML[res.ai.rating] || res.ai.rating}${res.ai.score != null ? ` (${res.ai.score}/100)` : ""}`;
    if (res.ai?.suggestions?.length) msg += `

*\u0D28\u0D3F\u0D7C\u0D26\u0D4D\u0D26\u0D47\u0D36\u0D19\u0D4D\u0D19\u0D7E*
${res.ai.suggestions.map((x) => "\u2022 " + x).join("\n")}`;
    msg += "\n\n\u0D2E\u0D3E\u0D31\u0D4D\u0D31\u0D02 \u0D35\u0D47\u0D23\u0D2E\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D RESTART \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15, \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D06\u0D2A\u0D4D\u0D2A\u0D4D \u0D24\u0D41\u0D31\u0D15\u0D4D\u0D15\u0D41\u0D15.";
    return reply(msg);
  };
  if (is(cmd, "help")) return reply(HELP);
  if (is(cmd, "restart")) return start(true);
  if (is(cmd, "status")) {
    const items = itemsFor(dept, false);
    const done = items.filter((i) => hasValue(res.rows[i.id])).length;
    return reply(`${dept.name} \xB7 ${weekRange(week)}
${done}/${items.length} KPI \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F \xB7 ${res.status === "submitted" ? "\u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D3F\u0D1A\u0D4D\u0D1A\u0D41" : "\u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D3F\u0D1A\u0D4D\u0D1A\u0D3F\u0D1F\u0D4D\u0D1F\u0D3F\u0D32\u0D4D\u0D32"}`);
  }
  if (!s || s.step === "invited" || s.step === "idle") return start(false);
  if (s.step === "paused") {
    s.step = s.sub || "kpi";
    s.sub = null;
    await saveSession();
    await reply("\u0D24\u0D41\u0D1F\u0D30\u0D3E\u0D02.");
    return askCurrent();
  }
  if (s.step === "done") {
    if (is(cmd, "start")) return reply(`\u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D24\u0D4D\u0D24\u0D46 \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D07\u0D24\u0D3F\u0D28\u0D15\u0D02 \u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D3F\u0D1A\u0D4D\u0D1A\u0D41 (${summarize(res.rows).score ?? "\u2014"}%). \u0D2E\u0D3E\u0D31\u0D4D\u0D31\u0D02 \u0D35\u0D47\u0D23\u0D2E\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D RESTART \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.`);
    return reply("\u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D24\u0D4D\u0D24\u0D46 \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D3F\u0D1A\u0D4D\u0D1A\u0D41. \u0D2E\u0D3E\u0D31\u0D4D\u0D31\u0D02 \u0D35\u0D47\u0D23\u0D2E\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D RESTART \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15. \u0D38\u0D39\u0D3E\u0D2F\u0D24\u0D4D\u0D24\u0D3F\u0D28\u0D4D HELP.");
  }
  if (is(cmd, "stop")) {
    s.sub = s.step;
    s.step = "paused";
    await saveSession();
    return reply("\u0D36\u0D30\u0D3F, \u0D28\u0D3F\u0D7C\u0D24\u0D4D\u0D24\u0D3F. \u0D24\u0D41\u0D1F\u0D30\u0D3E\u0D7B \u0D0E\u0D2A\u0D4D\u0D2A\u0D4B\u0D7E \u0D35\u0D47\u0D23\u0D2E\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D32\u0D41\u0D02 START \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15. \u0D36\u0D28\u0D3F\u0D2F\u0D3E\u0D34\u0D4D\u0D1A 4:30-\u0D28\u0D4D \u0D2E\u0D41\u0D2E\u0D4D\u0D2A\u0D4D \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D15\u0D4D\u0D15\u0D41\u0D15.");
  }
  if (is(cmd, "start")) return askCurrent();
  if (s.step === "kpi") {
    const id = s.items[s.idx];
    const it = byId[id];
    if (!it) {
      s.idx++;
      await saveSession();
      return askCurrent();
    }
    if (is(cmd, "back")) {
      s.sub = null;
      s.idx = Math.max(0, s.idx - 1);
      await saveSession();
      return askCurrent();
    }
    if (s.sub === "reason") {
      if (media) {
        const kind = await attachOrSay(id);
        if (!kind) return;
        if (text) res.rows[id] = { ...res.rows[id], reason: text };
        else if (!(res.rows[id].reason || "").trim()) res.rows[id] = { ...res.rows[id], reason: `(${KIND_ML[kind]} \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41)` };
        await save();
        s.sub = "next";
        await saveSession();
        return reply(`\u{1F4CE} ${KIND_ML[kind]} KPI ${it.no}-\u0D7D \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41.

${ASK_NEXT(it.no)}`);
      }
      if (is(cmd, "skip")) {
        s.sub = "next";
        await saveSession();
        return askCurrent();
      }
      res.rows[id] = { ...res.rows[id], reason: text };
      await save();
      s.sub = "next";
      await saveSession();
      return askCurrent();
    }
    if (s.sub === "next") {
      if (media) {
        const kind = await attachOrSay(id);
        if (!kind) return;
        res.rows[id] = { ...res.rows[id], next: text || `(${KIND_ML[kind]} \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41)` };
        await save();
      } else if (!is(cmd, "skip")) {
        res.rows[id] = { ...res.rows[id], next: text };
        await save();
      }
      s.sub = null;
      s.idx++;
      await saveSession();
      await reply(`\u2713 KPI ${it.no} \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F.`);
      return askCurrent();
    }
    if (media) {
      const kind = await attachOrSay(id);
      if (!kind) return;
      if (text) {
        const a0 = parseAnswer(text, isManual(it));
        if (a0.kind !== "number") {
          res.rows[id] = { ...res.rows[id], data: [res.rows[id].data, text].filter(Boolean).join(" \xB7 ") };
          await save();
          return reply(`\u{1F4CE} ${KIND_ML[kind]} KPI ${it.no}-\u0D7D \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41. \u0D07\u0D28\u0D3F ${isManual(it) ? "\u0D36\u0D24\u0D2E\u0D3E\u0D28\u0D02" : "\u0D15\u0D23\u0D15\u0D4D\u0D15\u0D4D"} \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.`);
        }
      } else return reply(`\u{1F4CE} ${KIND_ML[kind]} KPI ${it.no}-\u0D7D \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41. \u0D07\u0D28\u0D3F ${isManual(it) ? "\u0D36\u0D24\u0D2E\u0D3E\u0D28\u0D02 (\u0D09\u0D26\u0D3E: 92)" : "\u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 \u0D15\u0D23\u0D15\u0D4D\u0D15\u0D4D"} \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.`);
    }
    if (is(cmd, "skip")) {
      s.idx++;
      await saveSession();
      return askCurrent();
    }
    const a = parseAnswer(text, isManual(it));
    if (a.kind === "colour") return reply(isManual(it) ? "\u0D28\u0D3F\u0D31\u0D02 \u0D24\u0D28\u0D3F\u0D2F\u0D46 \u0D15\u0D23\u0D15\u0D4D\u0D15\u0D3E\u0D15\u0D4D\u0D15\u0D41\u0D02. \u0D0E\u0D24\u0D4D\u0D30 \u0D36\u0D24\u0D2E\u0D3E\u0D28\u0D02 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F \u0D0E\u0D28\u0D4D\u0D28\u0D4D \u0D2E\u0D3E\u0D24\u0D4D\u0D30\u0D02 \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15 (\u0D09\u0D26\u0D3E: 92)." : "\u0D28\u0D3F\u0D31\u0D02 \u0D24\u0D28\u0D3F\u0D2F\u0D46 \u0D15\u0D23\u0D15\u0D4D\u0D15\u0D3E\u0D15\u0D4D\u0D15\u0D41\u0D02. \u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 \u0D15\u0D23\u0D15\u0D4D\u0D15\u0D4D \u0D2E\u0D3E\u0D24\u0D4D\u0D30\u0D02 \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15 (\u0D09\u0D26\u0D3E: 1420).");
    if (a.kind !== "number") return reply(isManual(it) ? "\u0D2E\u0D28\u0D38\u0D4D\u0D38\u0D3F\u0D32\u0D3E\u0D2F\u0D3F\u0D32\u0D4D\u0D32. \u0D0E\u0D24\u0D4D\u0D30 \u0D36\u0D24\u0D2E\u0D3E\u0D28\u0D02 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F \u0D0E\u0D28\u0D4D\u0D28\u0D4D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15 (\u0D09\u0D26\u0D3E: 92). \u0D12\u0D34\u0D3F\u0D35\u0D3E\u0D15\u0D4D\u0D15\u0D3E\u0D7B SKIP." : "\u0D12\u0D30\u0D41 \u0D28\u0D2E\u0D4D\u0D2A\u0D7C \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15 (\u0D09\u0D26\u0D3E: 1420). \u0D12\u0D34\u0D3F\u0D35\u0D3E\u0D15\u0D4D\u0D15\u0D3E\u0D7B SKIP.");
    const base = { no: it.no, text: it.text, target: it.target, star: !!it.star, kraNo: it.kraNo, freq: it.freq };
    const old = res.rows[id] || {};
    const ach = isManual(it) ? Math.max(0, Math.min(Math.round(parseFloat(a.value)), 120)) : calcAch(it, a.value);
    const row = { ...old, ...base, actual: isManual(it) ? "" : a.value, ach };
    delete row.rag;
    const rag = statusOf(row);
    const bad = rag === "A" || rag === "R";
    if (a.note) {
      if (bad) row.reason = a.note;
      else row.data = a.note;
    }
    res.rows[id] = row;
    await save();
    const got = `\u2713 KPI ${it.no}: ${row.actual ? row.actual + " \u2192 " : ""}${row.ach != null ? row.ach + "% " : ""}${RAG_ML[rag] || ""} \u{1F512}`;
    if (bad && !(row.reason || "").trim() && !filesOf(row).length) {
      s.sub = "reason";
      await saveSession();
      return reply(`${got}

${ASK_REASON(it.no, rag)}`);
    }
    if (bad && !(row.next || "").trim()) {
      s.sub = "next";
      await saveSession();
      return reply(`${got}

${ASK_NEXT(it.no)}`);
    }
    s.idx++;
    await saveSession();
    await reply(got);
    return askCurrent();
  }
  if (media && s.step === "clarify") {
    const fl = res.ai?.flags || [];
    const f = fl[s.idx];
    if (!f) return finish();
    const target = dept.items.find((i) => String(i.no) === String(f.kpiNo));
    const kind = await attachOrSay(target ? target.id : null, f);
    if (!kind) return;
    f.answer = text || `(${KIND_ML[kind]} \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41${target ? " \xB7 KPI " + target.no : ""})`;
    await save();
    s.idx++;
    await saveSession();
    await reply(`\u{1F4CE} ${KIND_ML[kind]} \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41.`);
    if (s.idx >= fl.length) return finish();
    return askCurrent();
  }
  if (media) return reply("\u0D2B\u0D2F\u0D32\u0D41\u0D15\u0D7E KPI \u0D1A\u0D4B\u0D26\u0D4D\u0D2F\u0D19\u0D4D\u0D19\u0D7E\u0D15\u0D4D\u0D15\u0D41\u0D02 Claude-\u0D28\u0D4D\u0D31\u0D46 \u0D1A\u0D4B\u0D26\u0D4D\u0D2F\u0D19\u0D4D\u0D19\u0D7E\u0D15\u0D4D\u0D15\u0D41\u0D02 \u0D07\u0D1F\u0D2F\u0D3F\u0D7D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15. \u0D07\u0D35\u0D3F\u0D1F\u0D46 \u0D1F\u0D48\u0D2A\u0D4D\u0D2A\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D24\u0D4D \u0D2E\u0D31\u0D41\u0D2A\u0D1F\u0D3F \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.");
  if (s.step === "priorities") {
    res.priorities = is(cmd, "skip") || is(cmd, "none") ? ["", "", ""] : text.split(/\n|;/).map((x) => x.replace(/^\s*[\d.)\-•*]+\s*/, "").trim()).filter(Boolean).slice(0, 3);
    while (res.priorities.length < 3) res.priorities.push("");
    await save();
    s.step = "support";
    await saveSession();
    return askCurrent();
  }
  if (s.step === "support") {
    res.support = is(cmd, "skip") || is(cmd, "none") ? "" : text;
    await save();
    s.step = "checking";
    await saveSession();
    return runCheck();
  }
  if (s.step === "checking") return reply("Claude \u0D07\u0D2A\u0D4D\u0D2A\u0D4B\u0D34\u0D41\u0D02 \u0D2A\u0D30\u0D3F\u0D36\u0D4B\u0D27\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D28\u0D4D\u0D28\u0D41\u2026 \u0D15\u0D41\u0D31\u0D1A\u0D4D\u0D1A\u0D4D \u0D38\u0D2E\u0D2F\u0D02 \u0D15\u0D3E\u0D24\u0D4D\u0D24\u0D3F\u0D30\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D15.");
  if (s.step === "clarify") {
    const fl = res.ai?.flags || [];
    const f = fl[s.idx];
    if (!f) return finish();
    if (is(cmd, "skip")) {
      if (f.severity === "high") return reply("\u0D08 \u0D1A\u0D4B\u0D26\u0D4D\u0D2F\u0D24\u0D4D\u0D24\u0D3F\u0D28\u0D4D \u0D2E\u0D31\u0D41\u0D2A\u0D1F\u0D3F \u0D28\u0D3F\u0D7C\u0D2C\u0D28\u0D4D\u0D27\u0D2E\u0D3E\u0D23\u0D4D. \u0D1A\u0D41\u0D30\u0D41\u0D15\u0D4D\u0D15\u0D3F \u0D0E\u0D34\u0D41\u0D24\u0D3F\u0D2F\u0D3E\u0D7D \u0D2E\u0D24\u0D3F.");
    } else {
      f.answer = text;
      await save();
    }
    s.idx++;
    await saveSession();
    if (s.idx >= fl.length) return finish();
    return askCurrent();
  }
  return start(false);
}

// supabase/functions/whatsapp/index.ts
async function handleOne(db, m) {
  const from = String(m.from || "");
  const mm = m.audio || m.voice || m.image || m.document || m.video;
  const media = mm && mm.id ? { id: String(mm.id), mime: String(mm.mime_type || ""), filename: String(m.document?.filename || ""), voice: !!(m.audio?.voice || m.voice) } : null;
  const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.image?.caption ?? m.document?.caption ?? m.video?.caption ?? "";
  const ins = await db.from("wa_log").insert({ msg_id: m.id, phone: from, direction: "in", body: (media ? `[${m.type}] ` : "") + (text || (media ? "" : `[${m.type}]`)) });
  if (ins.error) {
    if (String(ins.error.message).includes("duplicate")) return;
    console.error(ins.error);
  }
  const { data: profile } = await db.from("profiles").select("id, full_name, phone, role, dept_id").eq("phone", from).maybeSingle();
  if (!profile) return sendText(db, from, "\u0D08 \u0D28\u0D2E\u0D4D\u0D2A\u0D7C Atlas KPI Review-\u0D7D \u0D30\u0D1C\u0D3F\u0D38\u0D4D\u0D31\u0D4D\u0D31\u0D7C \u0D1A\u0D46\u0D2F\u0D4D\u0D24\u0D3F\u0D1F\u0D4D\u0D1F\u0D3F\u0D32\u0D4D\u0D32. Admin-\u0D28\u0D46 \u0D2C\u0D28\u0D4D\u0D27\u0D2A\u0D4D\u0D2A\u0D46\u0D1F\u0D41\u0D15.");
  if (profile.role === "pending") return sendText(db, from, "\u0D28\u0D3F\u0D19\u0D4D\u0D19\u0D33\u0D41\u0D1F\u0D46 \u0D05\u0D15\u0D4D\u0D15\u0D57\u0D23\u0D4D\u0D1F\u0D3F\u0D28\u0D4D Admin \u0D07\u0D24\u0D41\u0D35\u0D30\u0D46 \u0D05\u0D28\u0D41\u0D2E\u0D24\u0D3F \u0D28\u0D7D\u0D15\u0D3F\u0D2F\u0D3F\u0D1F\u0D4D\u0D1F\u0D3F\u0D32\u0D4D\u0D32.");
  if (!text && !media) return sendText(db, from, "\u0D1F\u0D46\u0D15\u0D4D\u0D38\u0D4D\u0D31\u0D4D\u0D31\u0D4D, \u0D36\u0D2C\u0D4D\u0D26 \u0D38\u0D28\u0D4D\u0D26\u0D47\u0D36\u0D02, \u0D2B\u0D4B\u0D1F\u0D4D\u0D1F\u0D4B \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D21\u0D4B\u0D15\u0D4D\u0D2F\u0D41\u0D2E\u0D46\u0D28\u0D4D\u0D31\u0D4D \u0D2E\u0D3E\u0D24\u0D4D\u0D30\u0D2E\u0D47 \u0D38\u0D4D\u0D35\u0D40\u0D15\u0D30\u0D3F\u0D15\u0D4D\u0D15\u0D42.");
  try {
    await handleMessage(db, profile, text, media);
  } catch (e) {
    console.error("bot error", e);
    await sendText(db, from, "\u0D15\u0D4D\u0D37\u0D2E\u0D3F\u0D15\u0D4D\u0D15\u0D23\u0D02, \u0D12\u0D30\u0D41 \u0D2A\u0D4D\u0D30\u0D36\u0D4D\u0D28\u0D02 \u0D35\u0D28\u0D4D\u0D28\u0D41. \u0D15\u0D41\u0D31\u0D1A\u0D4D\u0D1A\u0D4D \u0D15\u0D34\u0D3F\u0D1E\u0D4D\u0D1E\u0D4D START \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.").catch(() => {
    });
  }
}
Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === Deno.env.get("WA_VERIFY_TOKEN")) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await req.text();
  if (!await validSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Bad signature", { status: 401 });
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("ok");
  }
  const msgs = [];
  for (const e of body.entry ?? []) for (const c of e.changes ?? []) for (const m of c.value?.messages ?? []) msgs.push(m);
  if (!msgs.length) return new Response("ok");
  const db = serviceClient();
  const work = (async () => {
    for (const m of msgs) await handleOne(db, m);
  })();
  const rt = globalThis.EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(work);
  else await work;
  return new Response("ok");
});
