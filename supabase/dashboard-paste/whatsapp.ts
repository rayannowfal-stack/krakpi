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
var WEEKLY = /* @__PURE__ */ new Set(["D", "W", "15D"]);
var RAGN = { G: "Green", A: "Amber", R: "Red", NA: "No data" };
var RAG_ML = { G: "\u0D2A\u0D1A\u0D4D\u0D1A (Green)", A: "\u0D2E\u0D1E\u0D4D\u0D1E (Amber)", R: "\u0D1A\u0D41\u0D35\u0D2A\u0D4D\u0D2A\u0D4D (Red)", NA: "\u0D21\u0D3E\u0D31\u0D4D\u0D31 \u0D07\u0D32\u0D4D\u0D32" };
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
var isPct = (item) => /%/.test(String(item && item.target || "")) || isManual(item);
var answerKind = (item) => isPct(item) ? "pct" : "count";
function resultFrom(item, input) {
  const t = String(input ?? "").replace(/rs\.?\s*/ig, "").replace(/₹/g, "").trim();
  if (!t) return null;
  const of = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:\/|of|ൽ|-ൽ|out of)\s*(\d[\d,]*(?:\.\d+)?)/i);
  const num = (x) => parseFloat(String(x).replace(/,/g, ""));
  if (of && isPct(item)) {
    const a = num(of[1]), b = num(of[2]);
    if (!(b > 0)) return null;
    const pct = Math.round(a / b * 1e3) / 10;
    const ach = isManual(item) ? Math.min(Math.round(pct), 120) : calcAch(item, pct);
    return { actual: `${of[1].replace(/,/g, "")}/${of[2].replace(/,/g, "")}`, ach, pct };
  }
  const m = t.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const v = m[0].replace(/,/g, "");
  if (isManual(item)) return { actual: v + "%", ach: Math.max(0, Math.min(Math.round(num(v)), 120)) };
  return { actual: v, ach: calcAch(item, v) };
}
var kpiHash = (r) => [r && r.actual || "", r && r.ach != null ? r.ach : "", r && r.reason || "", r && r.next || "", filesOf(r).map((f) => f.path).join(",")].join("|");
function kpiState(r) {
  if (!r || r.ach == null && !r.actual) return "todo";
  const bad = ["A", "R"].includes(statusOf(r));
  if (bad && !((r.reason || "").trim() || filesOf(r).length)) return "need-reason";
  if (bad && !(r.next || "").trim()) return "need-next";
  if (!r.ai || r.ai.hash !== kpiHash(r)) return "need-check";
  if ((r.ai.questions || []).some((q) => q.severity === "high" && !(q.answer || "").trim())) return "need-answer";
  return r.done ? "done" : "ready";
}
function progressOf(dept, rows, scope = "weekly") {
  let items = itemsFor(dept, false);
  if (scope === "headline") items = items.filter((i) => i.star);
  const list = items.map((i) => ({ item: i, row: (rows || {})[i.id] || null, state: kpiState((rows || {})[i.id]) }));
  const done = list.filter((x) => x.state === "done").length;
  return { list, done, total: list.length, pending: list.filter((x) => x.state !== "done"), complete: list.length > 0 && done === list.length };
}
function kpiCheckInput(item, row) {
  return {
    no: item.no,
    kpi: item.text,
    target: item.target,
    frequency: FREQ[item.freq] || item.freq,
    headline: !!item.star,
    answer: row.actual || "",
    achievement: row.ach != null ? row.ach + "%" : "",
    status: RAGN[statusOf(row)] || "",
    reason: row.reason || "",
    nextStep: row.next || "",
    attached: filesSummary(row)
  };
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

// supabase/functions/_shared/ai.ts
var IMG = ["image/jpeg", "image/png", "image/gif", "image/webp"];
function b64(bytes) {
  let s = "";
  const CH = 32768;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
async function proofBlocks(storage, files) {
  const blocks = [];
  const notes = [];
  let total = 0;
  for (const f of (files || []).slice(0, 6)) {
    const type = String(f.type || "").split(";")[0].toLowerCase();
    const label = f.name || f.path.split("/").pop();
    if (f.kind === "voice" || type.startsWith("audio/")) {
      notes.push(`${label}: voice note (Claude cannot listen to audio)`);
      continue;
    }
    const readable = IMG.includes(type) || type === "application/pdf" || type.startsWith("text/") || type === "application/csv";
    if (!readable) {
      notes.push(`${label}: ${type || "file"} (cannot be opened by Claude)`);
      continue;
    }
    if (blocks.length >= 4) {
      notes.push(`${label}: not read (only 4 files are read per KPI)`);
      continue;
    }
    const { data, error } = await storage.from("evidence").download(f.path);
    if (error || !data) {
      notes.push(`${label}: could not be downloaded`);
      continue;
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const limit = IMG.includes(type) ? 37e5 : type === "application/pdf" ? 12e6 : 2e5;
    if (bytes.length > limit || total + bytes.length > 2e7) {
      notes.push(`${label}: too big for Claude to read`);
      continue;
    }
    total += bytes.length;
    if (IMG.includes(type)) blocks.push({ type: "image", source: { type: "base64", media_type: type, data: b64(bytes) } });
    else if (type === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) }, title: String(label).slice(0, 100) });
    else blocks.push({ type: "text", text: `Attached file ${label}:
` + new TextDecoder().decode(bytes).slice(0, 2e4) });
    notes.push(`${label}: attached above (file ${blocks.length})`);
  }
  return { blocks, notes };
}
async function checkKpi(b) {
  const tp = Date.now();
  const { blocks, notes } = await proofBlocks(b.storage, b.files);
  console.log(`ai-check: proof read in ${Date.now() - tp} ms \u2192 ${blocks.length} block(s) \xB7 ${notes.join(" | ")}`);
  const prompt = `You check ONE weekly KPI result that a Head of Department (HOD) at Atlas Maharani Group (textile retail, Kerala, 24 showrooms) has just entered. It will be presented to the MD office on Monday. The MD wants RESULT-ORIENTED reporting, not "work done".

KPI and the HOD's entry: ${JSON.stringify(b.kpi)}
Department: ${str(b.deptName, 80)} (HOD: ${str(b.hod, 120)}) \xB7 Week: ${str(b.week, 40)}
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
  const res = await askClaudeJson(prompt, { model: Deno.env.get("CLAUDE_MODEL_CHECK") ?? "claude-sonnet-5-5", maxTokens: 2e3 }, blocks);
  const sev = (s) => ["high", "medium", "low"].includes(String(s)) ? String(s) : "medium";
  const order = { high: 0, medium: 1, low: 2 };
  const pr = res.proof && typeof res.proof === "object" ? res.proof : null;
  const cnt = pr ? Number(pr.count) : NaN;
  return {
    verdict: ["ok", "doubt", "weak"].includes(res.verdict) ? res.verdict : "doubt",
    summary: str(res.summary, 600),
    proof: (b.files || []).length ? { read: !!(pr && pr.read), count: pr && pr.count != null && Number.isFinite(cnt) ? cnt : null, matches: pr && typeof pr.matches === "boolean" ? pr.matches : null, note: str(pr && pr.note, 400) } : null,
    questions: (Array.isArray(res.questions) ? res.questions : []).slice(0, 3).map((x) => ({ q: str(x.q ?? x.question, 500), severity: sev(x.severity), answer: "" })).filter((x) => x.q).sort((a, c) => order[a.severity] - order[c.severity])
  };
}
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
import PptxGenJS from "npm:pptxgenjs@4.0.1";

// supabase/functions/_shared/ppt-builder.js
var INK = "12343B";
var GOLD = "C9962E";
var MUT = "5A6B6F";
var LINE = "D9E1DE";
var TXT = "13262B";
var WHITE = "FFFFFF";
var ST = { G: { bg: "E3F5EA", fg: "1E7A48", solid: "2EAD5B" }, A: { bg: "FFF1D6", fg: "9A6412", solid: "F2A93B" }, R: { bg: "FBE3E1", fg: "B23434", solid: "E05A4F" }, "": { bg: "EEF2F1", fg: "5A6B6F", solid: "9AA7A9" } };
var ACCENTS = ["E4572E", "1B9AAA", "F2A93B", "6A4C93", "2E86AB", "D1495B", "3BB273", "EDAE49", "00798C", "8E5572"];
var FONT = "Calibri";
var FONT_ML = "Nirmala UI";
var VERD = { ok: ["\u2713 Clear", "G"], doubt: ["? Needs clarity", "A"], weak: ["\u2717 Weak / not proved", "R"], skipped: ["Not checked", ""] };
var clean = (s, n = 400) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
function buildDeck(PptxGenJS2, d) {
  const { week, depts, results, actions, review: review2, today } = d;
  const proofs = d.proofs || {}, links = d.links || {}, single = !!d.single, scope = d.scope || "weekly";
  const pptx = new PptxGenJS2();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = "HOD Review " + week;
  const ds = deptListOf(depts);
  const accent = (id) => ACCENTS[Math.max(0, ds.findIndex((x) => x.id === id)) % ACCENTS.length];
  pptx.defineSlideMaster({
    title: "M",
    background: { color: "FAFBFA" },
    objects: [
      { rect: { x: 0, y: 7.2, w: 13.33, h: 0.3, fill: { color: INK } } },
      { text: { text: "Atlas Maharani Group \xB7 Weekly HOD Review \xB7 " + fmt(week), options: { x: 0.5, y: 7.2, w: 9, h: 0.3, fontSize: 9, color: "C9D6D3", fontFace: FONT } } }
    ],
    slideNumber: { x: 12.4, y: 7.2, w: 0.6, h: 0.3, fontSize: 9, color: "C9D6D3" }
  });
  const slide = (title, sub, color = INK) => {
    const s = pptx.addSlide({ masterName: "M" });
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 1.15, fill: { color } });
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 1.15, w: 13.33, h: 0.07, fill: { color: GOLD } });
    s.addText(title, { x: 0.5, y: 0.12, w: 12.3, h: 0.6, fontSize: 26, bold: true, color: WHITE, fontFace: FONT });
    if (sub) s.addText(sub, { x: 0.5, y: 0.66, w: 12.3, h: 0.4, fontSize: 13, color: "EAF2F0", fontFace: FONT });
    return s;
  };
  const pill = (s, text, x, y, w, rag) => {
    const c = ST[rag || ""] || ST[""];
    s.addShape(pptx.ShapeType.roundRect, { x, y, w, h: 0.34, fill: { color: c.solid }, rectRadius: 0.17, line: { color: c.solid } });
    s.addText(text, { x, y, w, h: 0.34, fontSize: 11, bold: true, color: WHITE, align: "center", valign: "middle", fontFace: FONT });
  };
  const H = (t2, color = INK) => ({ text: t2, options: { bold: true, color: WHITE, fill: { color }, fontSize: 11 } });
  const tbl = (s, rows, colW, y = 1.45, fontSize = 10) => s.addTable(rows, { x: 0.5, y, w: 12.33, colW, fontSize, fontFace: FONT, color: TXT, border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", margin: 0.06, autoPage: false });
  const ragCell = (rag) => {
    const c = ST[rag || ""];
    return { text: rag ? "\u25CF " + RAGN[rag] : "\u2014", options: { bold: true, fill: { color: c.bg }, color: c.fg, align: "center" } };
  };
  const ml = (t2, o = {}) => ({ text: clean(t2, 700), options: { fontFace: FONT_ML, fontSize: 13, breakLine: true, ...o } });
  const sec = (t2, color = INK) => ({ text: t2, options: { bold: true, fontSize: 15, color, breakLine: true, paraSpaceBefore: 8, fontFace: FONT } });
  const bl = (t2, o = {}) => ({ text: clean(t2, 600), options: { bullet: { code: "25CF" }, fontSize: 13, breakLine: true, fontFace: FONT_ML, ...o } });
  const t = pptx.addSlide();
  t.background = { color: INK };
  ACCENTS.slice(0, 6).forEach((c, i) => t.addShape(pptx.ShapeType.rect, { x: 8.6 + i * 0.78, y: 0, w: 0.78, h: 7.5, fill: { color: c, transparency: 10 + i * 6 } }));
  t.addShape(pptx.ShapeType.rect, { x: 0.8, y: 4.35, w: 3.2, h: 0.08, fill: { color: GOLD } });
  t.addText("ATLAS MAHARANI GROUP", { x: 0.8, y: 1.3, w: 7.6, h: 0.4, fontSize: 14, color: "F2C66D", bold: true, charSpacing: 4, fontFace: FONT });
  t.addText(single && ds[0] ? ds[0].name : "Weekly HOD Review", { x: 0.8, y: 1.8, w: 7.6, h: 1.3, fontSize: 46, color: WHITE, bold: true, fontFace: FONT, fit: "shrink" });
  t.addText(`${single ? "KPI results" : "KRA & KPI results"} \xB7 week ${weekRange(week)}`, { x: 0.8, y: 3.15, w: 7.6, h: 0.5, fontSize: 20, color: "E4ECEA", fontFace: FONT });
  t.addText(`Monday meeting ${fmt(week)}${single && ds[0] && ds[0].hod ? " \xB7 HOD " + ds[0].hod : ""}`, { x: 0.8, y: 3.7, w: 7.6, h: 0.4, fontSize: 15, color: "A9BCBF", fontFace: FONT });
  const info = ds.map((dp) => {
    const r = results[dp.id];
    const sm = r ? summarize(r.rows) : { score: null, counts: { G: 0, A: 0, R: 0 }, rag: "none" };
    const pg = progressOf(dp, r ? r.rows : {}, scope);
    return { dp, r, sm, pg };
  });
  if (!single) {
    const tot = { G: 0, A: 0, R: 0 };
    const scores = [];
    info.forEach((x) => {
      for (const k in tot) tot[k] += x.sm.counts[k];
      if (x.sm.score != null) scores.push(x.sm.score);
    });
    const grp = scores.length ? Math.round(scores.reduce((a, b2) => a + b2, 0) / scores.length) : null;
    const doneN = info.filter((x) => x.pg.complete).length;
    const s = slide("Group snapshot", `${doneN} of ${ds.length} HODs finished \xB7 group score ${grp != null ? grp + "%" : "\u2014"} \xB7 ${tot.G} Green \xB7 ${tot.A} Amber \xB7 ${tot.R} Red`);
    const labels = info.map((x) => x.dp.name);
    const by = (k) => info.map((x) => x.sm.score != null && x.sm.rag === k ? x.sm.score : 0);
    s.addText("Department score (% of target)", { x: 0.5, y: 1.4, w: 7.4, h: 0.35, fontSize: 14, bold: true, color: INK, fontFace: FONT });
    s.addChart(
      pptx.ChartType.bar,
      [{ name: "Green", labels, values: by("G") }, { name: "Amber", labels, values: by("A") }, { name: "Red", labels, values: by("R") }],
      {
        x: 0.4,
        y: 1.75,
        w: 7.6,
        h: 5.25,
        barDir: "bar",
        barGrouping: "stacked",
        chartColors: [ST.G.solid, ST.A.solid, ST.R.solid],
        valAxisMaxVal: 120,
        valAxisMinVal: 0,
        showValue: true,
        dataLabelFormatCode: "0;;;",
        dataLabelColor: WHITE,
        dataLabelFontBold: true,
        showLegend: false,
        catAxisLabelFontSize: 11,
        valAxisLabelFontSize: 9,
        catAxisOrientation: "maxMin"
      }
    );
    s.addText("All KPIs this week", { x: 8.3, y: 1.4, w: 4.5, h: 0.35, fontSize: 14, bold: true, color: INK, fontFace: FONT });
    s.addChart(
      pptx.ChartType.doughnut,
      [{ name: "KPIs", labels: ["Green", "Amber", "Red"], values: [tot.G, tot.A, tot.R] }],
      { x: 8.3, y: 1.75, w: 4.5, h: 3.6, holeSize: 58, chartColors: [ST.G.solid, ST.A.solid, ST.R.solid], showPercent: true, showLegend: true, legendPos: "b", dataLabelColor: WHITE, dataLabelFontBold: true }
    );
    s.addShape(pptx.ShapeType.roundRect, { x: 8.3, y: 5.5, w: 2.15, h: 1.4, fill: { color: INK }, rectRadius: 0.12 });
    s.addText([{ text: grp != null ? grp + "%" : "\u2014", options: { fontSize: 30, bold: true, color: "F2C66D", breakLine: true } }, { text: "group score", options: { fontSize: 11, color: WHITE } }], { x: 8.3, y: 5.5, w: 2.15, h: 1.4, align: "center", valign: "middle", fontFace: FONT });
    s.addShape(pptx.ShapeType.roundRect, { x: 10.65, y: 5.5, w: 2.15, h: 1.4, fill: { color: doneN === ds.length ? ST.G.solid : ST.A.solid }, rectRadius: 0.12 });
    s.addText([{ text: `${doneN}/${ds.length}`, options: { fontSize: 30, bold: true, color: WHITE, breakLine: true } }, { text: "HODs done", options: { fontSize: 11, color: WHITE } }], { x: 10.65, y: 5.5, w: 2.15, h: 1.4, align: "center", valign: "middle", fontFace: FONT });
    const b = slide("Department scoreboard", "Score, KPIs finished, and Claude's view of the proof \u2014 tap through the next slides for each department");
    const cols = 4, tw = 2.95, th = 2.65;
    info.forEach((x, i) => {
      const cx = 0.5 + i % cols * (tw + 0.18), cy = 1.45 + Math.floor(i / cols) * (th + 0.18);
      if (cy > 6.5) return;
      const ac = accent(x.dp.id);
      b.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: tw, h: th, fill: { color: WHITE }, line: { color: LINE }, rectRadius: 0.1, shadow: { type: "outer", blur: 4, offset: 1.5, angle: 90, color: "000000", opacity: 0.12 } });
      b.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: tw, h: 0.55, fill: { color: ac } });
      b.addText(x.dp.name, { x: cx + 0.12, y: cy, w: tw - 0.24, h: 0.55, fontSize: 14, bold: true, color: WHITE, valign: "middle", fontFace: FONT, fit: "shrink" });
      b.addText(x.sm.score != null ? x.sm.score + "%" : "\u2014", { x: cx + 0.12, y: cy + 0.6, w: 1.6, h: 0.75, fontSize: 30, bold: true, color: (ST[x.sm.rag] || ST[""]).fg, fontFace: FONT });
      b.addText(`${x.pg.done}/${x.pg.total}
KPIs done`, { x: cx + 1.6, y: cy + 0.65, w: tw - 1.72, h: 0.7, fontSize: 11, color: MUT, align: "right", fontFace: FONT });
      const c = x.sm.counts;
      pill(b, `${c.G} G`, cx + 0.12, cy + 1.45, 0.85, "G");
      pill(b, `${c.A} A`, cx + 1.05, cy + 1.45, 0.85, "A");
      pill(b, `${c.R} R`, cx + 1.98, cy + 1.45, 0.85, "R");
      const t2 = tally(x.r);
      b.addText(`Claude: ${t2.ok} clear \xB7 ${t2.doubt} doubt \xB7 ${t2.weak} weak${t2.mismatch ? `
\u{1F4CE} ${t2.mismatch} proof \u2260 figure` : ""}`, { x: cx + 0.12, y: cy + 1.88, w: tw - 0.24, h: 0.65, fontSize: 10, color: t2.mismatch ? ST.R.fg : MUT, fontFace: FONT, valign: "top" });
    });
  }
  if (review2 && !single) {
    const s = slide("MD office review \xB7 Claude", "", "6A4C93");
    s.addText(clean(review2.headline, 300), { x: 0.5, y: 0.6, w: 12.3, h: 0.5, fontSize: 14, color: WHITE, fontFace: FONT_ML, fit: "shrink" });
    const lines = [];
    if (review2.groupView) lines.push(ml(review2.groupView, { fontSize: 14, paraSpaceAfter: 6 }));
    if ((review2.watchList || []).length) {
      lines.push(sec("\u0D08 \u0D06\u0D34\u0D4D\u0D1A \u0D36\u0D4D\u0D30\u0D26\u0D4D\u0D27\u0D3F\u0D15\u0D4D\u0D15\u0D47\u0D23\u0D4D\u0D1F\u0D35 \xB7 Watch list", "6A4C93"));
      review2.watchList.forEach((x) => lines.push(bl(x)));
    }
    if ((review2.crossDept || []).length) {
      lines.push(sec("\u0D35\u0D15\u0D41\u0D2A\u0D4D\u0D2A\u0D41\u0D15\u0D7E \u0D24\u0D2E\u0D4D\u0D2E\u0D3F\u0D7D \xB7 Across departments", "6A4C93"));
      review2.crossDept.forEach((x) => lines.push(bl(x)));
    }
    s.addText(lines, { x: 0.5, y: 1.4, w: 12.3, h: 5.6, valign: "top", color: TXT, fit: "shrink" });
    const rr = [[H("Department", "6A4C93"), H("Claude rating", "6A4C93"), H("\u0D35\u0D3F\u0D32\u0D2F\u0D3F\u0D30\u0D41\u0D24\u0D4D\u0D24\u0D7D \xB7 verdict", "6A4C93")]];
    (review2.departments || []).forEach((x) => {
      const k = { "Result-oriented": "G", "Partly result-oriented": "A", "Activity only": "R" }[x.rating] || "";
      rr.push([(depts[x.dept] || {}).name || x.dept, { text: x.rating || "\u2014", options: { bold: true, fill: { color: ST[k].bg }, color: ST[k].fg } }, { text: clean(x.verdict, 400), options: { fontFace: FONT_ML } }]);
    });
    if (rr.length > 1) {
      const s2 = slide("Result-oriented or just duty?", "Claude's rating of how each department reported this week", "6A4C93");
      tbl(s2, rr, [2.2, 2.2, 7.93], 1.45, 11);
    }
  }
  const order = { R: 0, A: 1, G: 2, "": 3 };
  const empty = info.filter((x) => !x.r || !Object.keys(x.r.rows || {}).length);
  if (empty.length) {
    const s = slide(single ? ds[0].name : "Not reported yet", single ? "No KPI results this week" : `${empty.length} department${empty.length > 1 ? "s have" : " has"} not entered any KPI this week`, "B23434");
    empty.forEach((x, i) => {
      const cx = 0.5 + i % 2 * 6.25, cy = 1.5 + Math.floor(i / 2) * 1.05;
      s.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: 6.05, h: 0.9, fill: { color: ST.R.bg }, line: { color: ST.R.bg }, rectRadius: 0.08 });
      s.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: 0.14, h: 0.9, fill: { color: accent(x.dp.id) } });
      s.addText([{ text: x.dp.name, options: { bold: true, fontSize: 16, color: TXT, breakLine: true } }, { text: `HOD ${x.dp.hod || "\u2014"} \xB7 0/${x.pg.total} KPIs`, options: { fontSize: 11, color: ST.R.fg } }], { x: cx + 0.3, y: cy, w: 5.6, h: 0.9, valign: "middle", fontFace: FONT });
    });
  }
  info.forEach(({ dp, r, sm, pg }) => {
    const ac = accent(dp.id);
    if (!r || !Object.keys(r.rows || {}).length) return;
    const rows = Object.entries(r.rows || {}).map(([id, x]) => ({ id, ...x, rag: statusOf(x) })).sort((a, b) => order[a.rag] - order[b.rag] || (b.star ? 1 : 0) - (a.star ? 1 : 0) || String(a.no).localeCompare(String(b.no), void 0, { numeric: true }));
    const sub = `HOD ${dp.hod || ""} \xB7 ${pg.done}/${pg.total} KPIs done${pg.complete ? " \u2713" : ""} \xB7 ${sm.counts.G} Green \xB7 ${sm.counts.A} Amber \xB7 ${sm.counts.R} Red${r.source === "whatsapp" ? " \xB7 via WhatsApp" : ""}`;
    const per = 12;
    for (let p = 0; p < Math.ceil(rows.length / per); p++) {
      const s = slide(`${dp.name} \u2014 ${sm.score != null ? sm.score + "%" : "\u2014"}`, sub + (rows.length > per ? ` \xB7 ${p + 1}/${Math.ceil(rows.length / per)}` : ""), ac);
      rows.slice(p * per, p * per + per).forEach((x, i) => {
        const cx = 0.5 + i % 3 * 4.15, cy = 1.45 + Math.floor(i / 3) * 1.38;
        const c = ST[x.rag || ""];
        s.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: 4, h: 1.26, fill: { color: c.bg }, line: { color: c.bg }, rectRadius: 0.08 });
        s.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: 0.12, h: 1.26, fill: { color: c.solid } });
        s.addText(`${x.star ? "\u2605 " : ""}${x.no}  ${clean(x.text, 80)}`, { x: cx + 0.2, y: cy + 0.04, w: 3.75, h: 0.55, fontSize: 10.5, bold: true, color: TXT, fontFace: FONT, valign: "top", fit: "shrink" });
        s.addText(
          [{ text: x.ach != null ? x.ach + "%" : "\u2014", options: { fontSize: 22, bold: true, color: c.fg } }, { text: `   ${clean(x.actual, 20)} vs ${clean(x.target, 24)}`, options: { fontSize: 10, color: MUT } }],
          { x: cx + 0.2, y: cy + 0.58, w: 3.75, h: 0.42, fontFace: FONT, valign: "middle" }
        );
        const v = x.ai ? VERD[x.ai.verdict] || VERD.doubt : null;
        const nf = filesOf(x).length;
        const au = x.audit ? `  \xB7  \u{1F4C2} file ${clean(x.audit.value, 16)}${x.audit.matches === true ? " \u2713" : x.audit.matches === false ? " \u2717" : ""}` : "";
        s.addText(`${v ? "Claude " + v[0] : "Not checked"}${x.ai && x.ai.proof && x.ai.proof.matches === false ? " \xB7 proof \u2260 figure" : ""}${nf ? `  \xB7  \u{1F4CE} ${nf}` : ""}${au}`, { x: cx + 0.2, y: cy + 0.96, w: 3.75, h: 0.28, fontSize: 9, color: v ? ST[v[1]].fg : MUT, bold: !!(x.ai && x.ai.proof && x.ai.proof.matches === false || x.audit && x.audit.matches === false), fontFace: FONT });
      });
    }
    const why = rows.filter((x) => x.rag === "A" || x.rag === "R" || x.ai && x.ai.verdict !== "ok" && x.ai.verdict !== "skipped" || x.reason || x.data || x.next);
    for (let p = 0; p < Math.ceil(why.length / 6); p++) {
      const s = slide(`${dp.name} \u2014 reasons & next steps`, "Why it is below target, what happens next, and what Claude read in the proof", ac);
      const tr = [[H("KPI", ac), H("Result", ac), H("Reason", ac), H("Next step", ac), H("Claude \xB7 proof", ac)]];
      why.slice(p * 6, p * 6 + 6).forEach((x) => {
        const pr = x.ai && x.ai.proof;
        tr.push([
          { text: `${x.no} ${clean(x.text, 70)}`, options: { bold: true } },
          ragCellText(x),
          { text: clean(x.reason || x.data, 220), options: { fontFace: FONT_ML } },
          { text: clean(x.next, 200), options: { fontFace: FONT_ML } },
          {
            text: x.ai ? clean(`${(VERD[x.ai.verdict] || VERD.doubt)[0]}. ${pr ? (pr.count != null ? `Proof shows ${pr.count}${pr.matches === true ? " \u2713" : pr.matches === false ? " \u2717 does not match" : ""}. ` : "") + (pr.note || "") : x.ai.summary || ""}`, 260) : "Not checked",
            options: { fontFace: FONT_ML, color: pr && pr.matches === false ? ST.R.fg : TXT }
          }
        ]);
      });
      tbl(s, tr, [2.9, 1.35, 2.85, 2.6, 2.63], 1.45, 10);
    }
    const files = rows.flatMap((x) => filesOf(x).map((f) => ({ ...f, kpi: x })));
    const pics = files.filter((f) => proofs[f.path]);
    for (let p = 0; p < Math.ceil(pics.length / 4); p++) {
      const s = slide(`${dp.name} \u2014 proof`, "Photos the HOD attached, with what Claude read in them", ac);
      pics.slice(p * 4, p * 4 + 4).forEach((f, i) => {
        const cx = 0.5 + i % 2 * 6.25, cy = 1.4 + Math.floor(i / 2) * 2.9;
        s.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: 6.05, h: 2.75, fill: { color: WHITE }, line: { color: LINE }, rectRadius: 0.06 });
        s.addImage({ data: String(proofs[f.path]).replace(/^data:/, ""), x: cx + 0.1, y: cy + 0.1, w: 3.2, h: 2.55, sizing: { type: "contain", w: 3.2, h: 2.55 }, hyperlink: links[f.path] ? { url: links[f.path] } : void 0 });
        const pr = f.kpi.ai && f.kpi.ai.proof;
        s.addText(
          [
            { text: `KPI ${f.kpi.no}`, options: { bold: true, fontSize: 13, color: ac, breakLine: true } },
            { text: clean(f.kpi.text, 90), options: { fontSize: 10, color: TXT, breakLine: true } },
            { text: `Result: ${clean(f.kpi.actual, 20)} \u2192 ${f.kpi.ach != null ? f.kpi.ach + "%" : "\u2014"}`, options: { fontSize: 11, bold: true, color: (ST[statusOf(f.kpi)] || ST[""]).fg, breakLine: true } },
            ...pr ? [
              { text: pr.count != null ? `Claude counted ${pr.count}${pr.matches === true ? " \u2713 matches" : pr.matches === false ? " \u2717 does not match" : ""}` : "Claude read it", options: { fontSize: 11, bold: true, color: pr.matches === false ? ST.R.fg : ST.G.fg, breakLine: true } },
              { text: clean(pr.note, 180), options: { fontSize: 10, color: MUT, fontFace: FONT_ML } }
            ] : []
          ],
          { x: cx + 3.4, y: cy + 0.1, w: 2.55, h: 2.55, valign: "top", fontFace: FONT, fit: "shrink" }
        );
      });
    }
    const others = files.filter((f) => !proofs[f.path]);
    if (others.length) {
      const s = slide(`${dp.name} \u2014 attached files`, "Click a file to open it (links work for 7\u201330 days)", ac);
      const lines = others.slice(0, 22).map((f) => {
        const k = f.kind || kindOf(f.type);
        const icon = k === "voice" ? "\u{1F3A4}" : k === "photo" ? "\u{1F4F7}" : "\u{1F4CE}";
        return { text: `${icon}  KPI ${f.kpi.no} \xB7 ${f.name || "file"}${f.via === "whatsapp" ? " (WhatsApp)" : ""}`, options: { fontSize: 13, breakLine: true, color: links[f.path] ? "1B6FB3" : TXT, hyperlink: links[f.path] ? { url: links[f.path] } : void 0 } };
      });
      s.addText(lines, { x: 0.6, y: 1.45, w: 12.1, h: 5.5, valign: "top", fontFace: FONT, fit: "shrink" });
    }
    const qa = rows.flatMap((x) => (x.ai && x.ai.questions || []).map((q) => ({ no: x.no, q: q.q, a: q.answer })));
    const drv = review2 && (review2.departments || []).find((x) => x.dept === dp.id);
    const pri = (r.priorities || []).filter(Boolean);
    {
      const lines = [];
      if (drv && (drv.questions || []).length) {
        lines.push(sec("\u0D24\u0D3F\u0D19\u0D4D\u0D15\u0D33\u0D3E\u0D34\u0D4D\u0D1A \u0D1A\u0D4B\u0D26\u0D3F\u0D15\u0D4D\u0D15\u0D47\u0D23\u0D4D\u0D1F\u0D24\u0D4D \xB7 Ask on Monday", ST.R.fg));
        drv.questions.forEach((x) => lines.push(bl(x)));
      }
      if (qa.length) {
        lines.push(sec("Claude-\u0D28\u0D4D\u0D31\u0D46 \u0D1A\u0D4B\u0D26\u0D4D\u0D2F\u0D19\u0D4D\u0D19\u0D7E, HOD-\u0D28\u0D4D\u0D31\u0D46 \u0D2E\u0D31\u0D41\u0D2A\u0D1F\u0D3F", ac));
        qa.slice(0, 8).forEach((x) => {
          lines.push(bl(`KPI ${x.no}: ${x.q}`, { bold: true, fontSize: 12 }));
          lines.push({ text: "\u2192 " + (clean(x.a, 300) || "\u0D2E\u0D31\u0D41\u0D2A\u0D1F\u0D3F \u0D07\u0D32\u0D4D\u0D32 (not answered)"), options: { fontSize: 12, breakLine: true, indentLevel: 1, fontFace: FONT_ML, color: x.a ? TXT : ST.R.fg } });
        });
      }
      if (pri.length) {
        lines.push(sec("Next week's priorities", INK));
        pri.forEach((x) => lines.push(bl(x)));
      }
      if (r.support) {
        lines.push(sec("Support needed", INK));
        lines.push(ml(r.support));
      }
      const s = lines.length ? slide(`${dp.name} \u2014 Claude's questions & next week`, "", ac) : null;
      if (s) s.addText(lines, { x: 0.5, y: 1.4, w: 12.3, h: 5.65, valign: "top", color: TXT, fit: "shrink" });
    }
  });
  if (!single) {
    const reds = [];
    ds.forEach((dp) => {
      const r = results[dp.id];
      if (!r) return;
      Object.values(r.rows || {}).forEach((x) => {
        if (statusOf(x) === "R") reds.push([{ text: dp.name, options: { bold: true, color: accent(dp.id) } }, x.no, clean(x.text, 90), clean(x.actual, 20) + " / " + clean(x.target, 20), { text: x.ach != null ? x.ach + "%" : "\u2014", options: { bold: true, color: ST.R.fg } }, { text: clean(x.reason || x.data, 160), options: { fontFace: FONT_ML } }, { text: clean(x.next, 160), options: { fontFace: FONT_ML } }]);
      });
    });
    for (let p = 0; p < Math.max(1, Math.ceil(reds.length / 8)); p++) {
      const s = slide("Red KPIs across the group", reds.length ? `${reds.length} KPIs below 80% of target \u2014 each needs an owner, action and date` : "No Red KPIs this week \u{1F389}", "B23434");
      if (reds.length) tbl(s, [[H("Department", "B23434"), H("#", "B23434"), H("KPI", "B23434"), H("Result / target", "B23434"), H("Ach", "B23434"), H("Reason", "B23434"), H("Next step", "B23434")], ...reds.slice(p * 8, p * 8 + 8)], [1.6, 0.55, 3.3, 1.5, 0.7, 2.4, 2.28]);
    }
  }
  const acts = actions.filter((a) => a.status !== "Done" && (!single || depts[a.dept])).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  for (let p = 0; p < Math.max(1, Math.ceil(acts.length / 10)); p++) {
    const od = acts.filter((a) => a.due && a.due < today).length;
    const s = slide("Pending points \u2014 action tracker", acts.length ? `${acts.length} open actions \xB7 ${od} overdue` : "No open actions", "00798C");
    if (acts.length) tbl(s, [[H("Department", "00798C"), H("KPI", "00798C"), H("Action", "00798C"), H("Owner", "00798C"), H("Due", "00798C"), H("Status", "00798C")], ...acts.slice(p * 10, p * 10 + 10).map((a) => {
      const late = a.due && a.due < today;
      return [{ text: (depts[a.dept] || {}).name || a.dept, options: { bold: true, color: accent(a.dept) } }, a.kpiNo || "", { text: clean(a.action, 200), options: { fontFace: FONT_ML } }, a.owner || "", { text: a.due ? fmtShort(a.due) + (late ? " \xB7 overdue" : "") : "\u2014", options: late ? { color: ST.R.fg, bold: true } : {} }, a.status];
    })], [1.8, 0.7, 5.3, 1.8, 1.4, 1.33]);
  }
  return pptx;
  function ragCellText(x) {
    const c = ST[x.rag || ""];
    return { text: `${clean(x.actual, 18)}
${x.ach != null ? x.ach + "%" : "\u2014"} ${x.rag ? RAGN[x.rag] : ""}`, options: { bold: true, fill: { color: c.bg }, color: c.fg, align: "center" } };
  }
}
function tally(r) {
  const t = { ok: 0, doubt: 0, weak: 0, mismatch: 0 };
  Object.values(r && r.rows || {}).forEach((x) => {
    if (!x.ai || !t.hasOwnProperty(x.ai.verdict)) return;
    t[x.ai.verdict]++;
    if (x.ai.proof && x.ai.proof.matches === false) t.mismatch++;
  });
  return t;
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
async function progressAll(db, week, scope) {
  const [{ data: dRows }, { data: kRows }, { data: res }] = await Promise.all([
    db.from("departments").select("*").order("sort_order"),
    db.from("kpis").select("*"),
    db.from("results").select("dept_id, rows").eq("week", week)
  ]);
  const depts = buildDepts(dRows || [], kRows || []);
  const out = {};
  for (const d of dRows || []) {
    const r = (res || []).find((x) => x.dept_id === d.id);
    const pg = progressOf(depts[d.id], r ? r.rows : {}, scope);
    out[d.id] = { name: d.name, done: pg.done, total: pg.total, pending: pg.total - pg.done };
  }
  return out;
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
  const { proofs, links } = await proofFor(db, d.results);
  const deck = buildDeck(PptxGenJS, { ...d, proofs, links, scope: (await getSettings(db)).bot_scope });
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
  const prog = await progressAll(db, week, st.bot_scope);
  const list = Object.values(prog).filter((x) => x.total);
  const doneNames = list.filter((x) => x.pending === 0).map((x) => x.name);
  const notDone = list.filter((x) => x.pending > 0).map((x) => `${x.name} (${x.pending} \u0D2C\u0D3E\u0D15\u0D4D\u0D15\u0D3F)`);
  const total = list.length, submitted = doneNames.length;
  const sent = [], failed = [];
  for (const n of to) {
    try {
      await sendTemplate(db, n, st.tpl_report, st.tpl_lang, [weekRange(week), doneNames.join(", ") || "\u0D06\u0D30\u0D41\u0D2E\u0D3F\u0D32\u0D4D\u0D32", notDone.join(", ") || "\u0D07\u0D32\u0D4D\u0D32 \u2014 \u0D0E\u0D32\u0D4D\u0D32\u0D3E\u0D35\u0D30\u0D41\u0D02 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D15\u0D4D\u0D15\u0D3F \u2713"], { link, filename });
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
    `${submitted}/${total} HODs done${notDone.length ? ` \xB7 not done: ${notDone.join(", ")}` : ""} \xB7 sent to ${sent.length} number(s)${to.length === 0 ? " (no numbers in Settings)" : ""}${failed.length ? ` \xB7 failed: ${failed.join("; ")}` : ""}`
  );
  return { link, filename, sent, failed, submitted, total, done: doneNames, notDone };
}
async function proofFor(db, results) {
  const proofs = {}, links = {};
  const files = [];
  Object.values(results || {}).forEach((r) => Object.values(r.rows || {}).forEach((x) => filesOf(x).forEach((f) => files.push(f))));
  for (const f of files) {
    try {
      const { data } = await db.storage.from("evidence").createSignedUrl(f.path, 60 * 60 * 24 * 30);
      if (data && data.signedUrl) links[f.path] = data.signedUrl;
    } catch (_) {
    }
  }
  let n = 0;
  for (const f of files) {
    if ((f.kind || kindOf(f.type)) !== "photo" || n >= 40) continue;
    const type = String(f.type || "image/jpeg").split(";")[0];
    if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) continue;
    try {
      const { data } = await db.storage.from("evidence").download(f.path);
      if (!data) continue;
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.length > 4e6) continue;
      proofs[f.path] = `data:${type};base64,${b64(bytes)}`;
      n++;
    } catch (_) {
    }
  }
  return { proofs, links };
}

// supabase/functions/_shared/bot.ts
var WORDS = {
  start: ["start", "kpi", "report", "hi", "hello", "hai", "\u0D24\u0D41\u0D1F\u0D19\u0D4D\u0D19\u0D41\u0D15", "\u0D24\u0D41\u0D1F\u0D19\u0D4D\u0D19\u0D3E\u0D02", "\u0D39\u0D3E\u0D2F\u0D4D", "\u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D"],
  menu: ["menu", "list", "pending", "\u0D32\u0D3F\u0D38\u0D4D\u0D31\u0D4D\u0D31\u0D4D", "\u0D2C\u0D3E\u0D15\u0D4D\u0D15\u0D3F"],
  all: ["all", "restart", "edit", "\u0D0E\u0D32\u0D4D\u0D32\u0D3E\u0D02", "\u0D35\u0D40\u0D23\u0D4D\u0D1F\u0D41\u0D02"],
  ok: ["ok", "okay", "yes", "go", "\u0D36\u0D30\u0D3F", "next"],
  skip: ["skip", "\u0D12\u0D34\u0D3F\u0D35\u0D3E\u0D15\u0D4D\u0D15\u0D41\u0D15", "-", "later"],
  back: ["back", "\u0D2E\u0D41\u0D2E\u0D4D\u0D2A\u0D24\u0D4D\u0D24\u0D46", "\u0D2A\u0D3F\u0D28\u0D4D\u0D28\u0D4B\u0D1F\u0D4D\u0D1F\u0D4D"],
  stop: ["stop", "pause", "\u0D28\u0D3F\u0D7C\u0D24\u0D4D\u0D24\u0D41\u0D15"],
  status: ["status", "\u0D28\u0D3F\u0D32"],
  help: ["help", "\u0D38\u0D39\u0D3E\u0D2F\u0D02", "?"],
  none: ["no", "nil", "none", "\u0D07\u0D32\u0D4D\u0D32", "\u0D35\u0D47\u0D23\u0D4D\u0D1F", "na", "n/a"]
};
var is = (t, k) => WORDS[k].includes(t);
var RAG_WORDS = /* @__PURE__ */ new Set(["g", "green", "\u0D2A\u0D1A\u0D4D\u0D1A", "a", "amber", "\u0D2E\u0D1E\u0D4D\u0D1E", "r", "red", "\u0D1A\u0D41\u0D35\u0D2A\u0D4D\u0D2A\u0D4D", "yes", "no", "done", "ok"]);
var HELP = "*\u0D38\u0D39\u0D3E\u0D2F\u0D02*\nMENU \u2013 \u0D2C\u0D3E\u0D15\u0D4D\u0D15\u0D3F\u0D2F\u0D41\u0D33\u0D4D\u0D33 KPI \u0D32\u0D3F\u0D38\u0D4D\u0D31\u0D4D\u0D31\u0D4D\n(\u0D28\u0D2E\u0D4D\u0D2A\u0D7C) \u2013 \u0D32\u0D3F\u0D38\u0D4D\u0D31\u0D4D\u0D31\u0D3F\u0D7D \u0D28\u0D3F\u0D28\u0D4D\u0D28\u0D4D \u0D12\u0D30\u0D41 KPI \u0D24\u0D3F\u0D30\u0D1E\u0D4D\u0D1E\u0D46\u0D1F\u0D41\u0D15\u0D4D\u0D15\u0D3E\u0D7B\nSKIP \u2013 \u0D08 KPI \u0D2A\u0D3F\u0D28\u0D4D\u0D28\u0D40\u0D1F\u0D4D\nBACK \u2013 \u0D2E\u0D41\u0D2E\u0D4D\u0D2A\u0D24\u0D4D\u0D24\u0D46 KPI\nSTATUS \u2013 \u0D0E\u0D24\u0D4D\u0D30 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F\nSTOP \u2013 \u0D28\u0D3F\u0D7C\u0D24\u0D4D\u0D24\u0D3E\u0D7B (\u0D2A\u0D3F\u0D28\u0D4D\u0D28\u0D40\u0D1F\u0D4D START)\nALL \u2013 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D35 \u0D2E\u0D3E\u0D31\u0D4D\u0D31\u0D3E\u0D7B\n\n\u0D24\u0D46\u0D33\u0D3F\u0D35\u0D3E\u0D2F\u0D3F \u0D2B\u0D4B\u0D1F\u0D4D\u0D1F\u0D4B / PDF / \u0D36\u0D2C\u0D4D\u0D26 \u0D38\u0D28\u0D4D\u0D26\u0D47\u0D36\u0D02 \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D3E\u0D02. Claude \u0D2B\u0D4B\u0D1F\u0D4D\u0D1F\u0D4B\u0D2F\u0D41\u0D02 PDF-\u0D09\u0D02 \u0D35\u0D3E\u0D2F\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D02.";
function parseAnswer(text, item) {
  const t = text.trim();
  const first = t.split(/[\s,.:;\-]+/)[0].toLowerCase();
  if (RAG_WORDS.has(first)) return { kind: "colour" };
  const r = resultFrom(item, t);
  if (!r) return { kind: "none" };
  const m = t.replace(/rs\.?\s*/ig, "").match(/(\d[\d,]*(?:\.\d+)?)\s*(?:\/|of|out of)\s*(\d[\d,]*(?:\.\d+)?)|-?\d[\d,]*(?:\.\d+)?/i);
  const note = m ? t.replace(/rs\.?\s*/ig, "").replace(m[0], "").replace(/^[\s,.:;%\-]+/, "").trim() : "";
  return { kind: "number", actual: r.actual, ach: r.ach, note };
}
var ASK_REASON = (no, rag) => `KPI ${no}: ${RAG_ML[rag] || ""}
*\u0D15\u0D3E\u0D30\u0D23\u0D02* \u0D0E\u0D28\u0D4D\u0D24\u0D3E\u0D23\u0D4D? \u0D1F\u0D48\u0D2A\u0D4D\u0D2A\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D2F\u0D41\u0D15, \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D2B\u0D4B\u0D1F\u0D4D\u0D1F\u0D4B / PDF / \u0D36\u0D2C\u0D4D\u0D26 \u0D38\u0D28\u0D4D\u0D26\u0D47\u0D36\u0D02 \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.`;
var ASK_NEXT = (no) => `KPI ${no}: *\u0D05\u0D1F\u0D41\u0D24\u0D4D\u0D24 \u0D28\u0D1F\u0D2A\u0D1F\u0D3F* \u0D0E\u0D28\u0D4D\u0D24\u0D3E\u0D23\u0D4D? (\u0D0E\u0D28\u0D4D\u0D24\u0D4D, \u0D06\u0D30\u0D4D, \u0D0E\u0D2A\u0D4D\u0D2A\u0D4B\u0D7E)
\u0D09\u0D26\u0D3E: Perumbavoor-\u0D7D 2 staff \u0D15\u0D42\u0D1F\u0D3F, Manager Rajesh, 25 Oct-\u0D28\u0D15\u0D02`;
var ASK_PRI = "*\u0D05\u0D1F\u0D41\u0D24\u0D4D\u0D24 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 3 \u0D2A\u0D4D\u0D30\u0D27\u0D3E\u0D28 \u0D2E\u0D41\u0D7B\u0D17\u0D23\u0D28\u0D15\u0D7E* (optional)\n\u0D13\u0D30\u0D4B\u0D28\u0D4D\u0D28\u0D41\u0D02 \u0D2A\u0D4D\u0D30\u0D24\u0D40\u0D15\u0D4D\u0D37\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D28\u0D4D\u0D28 \u0D28\u0D2E\u0D4D\u0D2A\u0D31\u0D4B\u0D1F\u0D46, \u0D13\u0D30\u0D4B \u0D35\u0D30\u0D3F\u0D2F\u0D3F\u0D7D \u0D12\u0D28\u0D4D\u0D28\u0D4D. \u0D35\u0D47\u0D23\u0D4D\u0D1F\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D SKIP.";
var ASK_SUP = "*\u0D38\u0D39\u0D3E\u0D2F\u0D02 \u0D35\u0D47\u0D23\u0D4B?*\nCEO-\u0D2F\u0D3F\u0D7D \u0D28\u0D3F\u0D28\u0D4D\u0D28\u0D4B \u0D2E\u0D31\u0D4D\u0D31\u0D4D \u0D35\u0D15\u0D41\u0D2A\u0D4D\u0D2A\u0D41\u0D15\u0D33\u0D3F\u0D7D \u0D28\u0D3F\u0D28\u0D4D\u0D28\u0D4B \u0D0E\u0D28\u0D4D\u0D24\u0D4D \u0D38\u0D39\u0D3E\u0D2F\u0D02 \u0D35\u0D47\u0D23\u0D02? \u0D07\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u2018\u0D07\u0D32\u0D4D\u0D32\u2019.";
function askKpi(item, n, total, row) {
  let s = `*KPI ${item.no}${item.star ? " \u2605" : ""}* (${n}/${total})
${item.text}
\u0D32\u0D15\u0D4D\u0D37\u0D4D\u0D2F\u0D02: *${item.target}*`;
  if (row && (row.actual || row.ach != null)) s += `
\u0D07\u0D2A\u0D4D\u0D2A\u0D4B\u0D7E: ${row.actual || ""}${row.ach != null ? " \u2192 " + row.ach + "%" : ""}${filesOf(row).length ? " \xB7 \u{1F4CE} " + filesOf(row).length : ""}`;
  s += answerKind(item) === "pct" ? `

${isManual(item) ? "\u0D0E\u0D24\u0D4D\u0D30 \u0D36\u0D24\u0D2E\u0D3E\u0D28\u0D02 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F?" : "\u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 \u0D36\u0D24\u0D2E\u0D3E\u0D28\u0D02?"} \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15 (\u0D09\u0D26\u0D3E: 92) \u2014 \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D0E\u0D23\u0D4D\u0D23\u0D02: 46/48` : "\n\n\u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 \u0D15\u0D23\u0D15\u0D4D\u0D15\u0D4D (\u0D0E\u0D23\u0D4D\u0D23\u0D02 / \u0D24\u0D41\u0D15) \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15 (\u0D09\u0D26\u0D3E: 1420).";
  s += "\n\u0D15\u0D42\u0D1F\u0D46 \u0D2B\u0D4B\u0D1F\u0D4D\u0D1F\u0D4B / PDF \u0D24\u0D46\u0D33\u0D3F\u0D35\u0D4D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D3E\u0D02. \u0D28\u0D3F\u0D31\u0D02 \u0D24\u0D28\u0D3F\u0D2F\u0D46 \u0D35\u0D30\u0D41\u0D02 \u{1F512}";
  return s;
}
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
      const st2 = await getSettings(db);
      const [{ data: dRows }, { data: kRows2 }, { data: res2 }] = await Promise.all([
        db.from("departments").select("*").order("sort_order"),
        db.from("kpis").select("*"),
        db.from("results").select("*").eq("week", week2)
      ]);
      const depts = buildDepts(dRows || [], kRows2 || []);
      const lines = (dRows || []).map((d) => {
        const r = (res2 || []).find((x) => x.dept_id === d.id);
        const pg = progressOf(depts[d.id], r ? r.rows : {}, st2.bot_scope);
        return `${pg.complete ? "\u2713" : pg.done ? "\u2026" : "\u2717"} ${d.name} \xB7 ${pg.done}/${pg.total}${r && r.score != null ? " \xB7 " + r.score + "%" : ""}`;
      });
      await reply(`*${weekRange(week2)} \xB7 HOD \u0D28\u0D3F\u0D32*
${lines.join("\n")}`);
      return;
    }
    await reply(profile.role === "admin" ? "Admin commands:\nPPT \u2013 \u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 PPT\nSTATUS \u2013 HOD-\u0D2E\u0D3E\u0D30\u0D41\u0D1F\u0D46 \u0D28\u0D3F\u0D32" : "KPI \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D HOD-\u0D2E\u0D3E\u0D7C\u0D15\u0D4D\u0D15\u0D4D \u0D2E\u0D3E\u0D24\u0D4D\u0D30\u0D2E\u0D3E\u0D23\u0D4D.");
    return;
  }
  const week = meetingWeek(istToday());
  const [{ data: dRow }, { data: kRows }, { data: rRow }, { data: sess }, st] = await Promise.all([
    db.from("departments").select("*").eq("id", profile.dept_id).maybeSingle(),
    db.from("kpis").select("*").eq("dept_id", profile.dept_id),
    db.from("results").select("*").eq("week", week).eq("dept_id", profile.dept_id).maybeSingle(),
    db.from("wa_sessions").select("*").eq("phone", profile.phone).maybeSingle(),
    getSettings(db)
  ]);
  if (!dRow) {
    await reply("\u0D28\u0D3F\u0D19\u0D4D\u0D19\u0D33\u0D41\u0D1F\u0D46 \u0D35\u0D15\u0D41\u0D2A\u0D4D\u0D2A\u0D4D \u0D15\u0D23\u0D4D\u0D1F\u0D46\u0D24\u0D4D\u0D24\u0D3E\u0D28\u0D3E\u0D2F\u0D3F\u0D32\u0D4D\u0D32. Admin-\u0D28\u0D46 \u0D05\u0D31\u0D3F\u0D2F\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D15.");
    return;
  }
  const dept = buildDepts([dRow], kRows || [])[profile.dept_id];
  const res = rRow ? mapResult(rRow) : { week, dept: profile.dept_id, status: "draft", rows: {}, priorities: [], support: "", source: "whatsapp" };
  const byId = Object.fromEntries(dept.items.map((i) => [i.id, i]));
  const scope = st.bot_scope;
  const prog = () => progressOf(dept, res.rows, scope);
  let s = sess && sess.week === week ? { ...sess } : null;
  const saveSession = async () => {
    await db.from("wa_sessions").upsert({ phone: profile.phone, user_id: profile.id, dept_id: profile.dept_id, week, step: s.step, idx: s.idx, items: s.items, sub: s.sub ?? null, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
  };
  const saveRow = async (id, row) => {
    const it = byId[id];
    const full = { ...row, no: it.no, text: it.text, target: it.target, star: !!it.star, kraNo: it.kraNo, freq: it.freq, files: filesOf(row), updated_at: (/* @__PURE__ */ new Date()).toISOString() };
    delete full.rag;
    res.rows[id] = full;
    const { error } = await db.rpc("save_kpi", { p_week: week, p_dept: profile.dept_id, p_kpi: id, p_row: full, p_source: "whatsapp", p_complete: prog().complete });
    if (error) throw new Error(error.message);
  };
  const cur = () => s && s.step === "kpi" ? s.items[s.idx] : null;
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
  const attach = async (id) => {
    try {
      const meta = await storeMedia(id);
      const old = res.rows[id] || { actual: "", ach: null };
      await saveRow(id, { ...old, files: [...filesOf(old), meta] });
      return meta.kind;
    } catch (e) {
      console.error("attach failed", e);
      await reply("\u0D2B\u0D2F\u0D7D \u0D38\u0D47\u0D35\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D2F\u0D3E\u0D28\u0D3E\u0D2F\u0D3F\u0D32\u0D4D\u0D32. \u0D35\u0D40\u0D23\u0D4D\u0D1F\u0D41\u0D02 \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15, \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D1F\u0D48\u0D2A\u0D4D\u0D2A\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D2F\u0D41\u0D15.");
      return null;
    }
  };
  const showMenu = async (all = false) => {
    const pg = prog();
    const list = all ? pg.list : pg.pending;
    s = { step: "menu", idx: 0, items: list.map((x) => x.item.id), sub: all ? "all" : null };
    await saveSession();
    if (!list.length) {
      if (pg.total) return reply(`*${dept.name}* \xB7 ${weekRange(week)}
\u0D0E\u0D32\u0D4D\u0D32\u0D3E ${pg.total} KPI-\u0D15\u0D33\u0D41\u0D02 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F \u2713 \u0D28\u0D28\u0D4D\u0D26\u0D3F!
\u0D2E\u0D3E\u0D31\u0D4D\u0D31\u0D02 \u0D35\u0D47\u0D23\u0D2E\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D ALL \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.`);
      return reply("\u0D08 \u0D06\u0D34\u0D4D\u0D1A \u0D28\u0D3F\u0D19\u0D4D\u0D19\u0D7E\u0D15\u0D4D\u0D15\u0D4D KPI \u0D07\u0D32\u0D4D\u0D32.");
    }
    const lines = list.map((x, i) => `${i + 1}. ${x.state === "done" ? "\u2713 " : ""}KPI ${x.item.no}${x.item.star ? "\u2605" : ""} \u2013 ${x.item.text.slice(0, 48)}${x.item.text.length > 48 ? "\u2026" : ""}`);
    return reply(`\u0D28\u0D2E\u0D38\u0D4D\u0D15\u0D3E\u0D30\u0D02 ${profile.full_name || ""}.
*${dept.name}* \xB7 ${weekRange(week)} \xB7 ${pg.done}/${pg.total} \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F
\u0D36\u0D28\u0D3F\u0D2F\u0D3E\u0D34\u0D4D\u0D1A 5 PM-\u0D28\u0D4D \u0D2E\u0D41\u0D2E\u0D4D\u0D2A\u0D4D \u0D24\u0D40\u0D7C\u0D15\u0D4D\u0D15\u0D41\u0D15.

*${all ? "\u0D0E\u0D32\u0D4D\u0D32\u0D3E KPI" : "\u0D2C\u0D3E\u0D15\u0D4D\u0D15\u0D3F\u0D2F\u0D41\u0D33\u0D4D\u0D33 KPI"}:*
${lines.join("\n")}

\u0D12\u0D30\u0D41 KPI \u0D24\u0D3F\u0D30\u0D1E\u0D4D\u0D1E\u0D46\u0D1F\u0D41\u0D15\u0D4D\u0D15\u0D3E\u0D7B \u0D05\u0D24\u0D3F\u0D28\u0D4D\u0D31\u0D46 *\u0D28\u0D2E\u0D4D\u0D2A\u0D7C* \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15, \u0D15\u0D4D\u0D30\u0D2E\u0D24\u0D4D\u0D24\u0D3F\u0D7D \u0D2A\u0D4B\u0D15\u0D3E\u0D7B *OK*.`);
  };
  const openKpi = async (id) => {
    const pg = prog();
    const pos = pg.list.findIndex((x) => x.item.id === id);
    s = { step: "kpi", idx: Math.max(0, s && s.items ? s.items.indexOf(id) : 0), items: s && s.items && s.items.includes(id) ? s.items : [id], sub: null };
    await saveSession();
    return reply(askKpi(byId[id], pos + 1, pg.total, res.rows[id]));
  };
  const nextPending = async () => {
    const pg = prog();
    if (pg.complete || !pg.pending.length) {
      if (!(res.priorities || []).some(Boolean)) {
        s = { step: "plan", idx: 0, items: [], sub: "pri" };
        await saveSession();
        return reply(`\u{1F389} \u0D0E\u0D32\u0D4D\u0D32\u0D3E KPI-\u0D15\u0D33\u0D41\u0D02 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F (${pg.done}/${pg.total}). \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D3F\u0D1A\u0D4D\u0D1A\u0D41 \u2713

${ASK_PRI}`);
      }
      s = { step: "done", idx: 0, items: [], sub: null };
      await saveSession();
      return reply(`\u{1F389} \u0D0E\u0D32\u0D4D\u0D32\u0D3E KPI-\u0D15\u0D33\u0D41\u0D02 \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F (${pg.done}/${pg.total}). \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D3F\u0D1A\u0D4D\u0D1A\u0D41 \u2713 \u0D28\u0D28\u0D4D\u0D26\u0D3F!`);
    }
    const order = s && s.items && s.items.length ? s.items : pg.pending.map((x) => x.item.id);
    const nextId = order.find((id) => kpiState(res.rows[id]) !== "done") || pg.pending[0].item.id;
    s = { step: "kpi", idx: order.includes(nextId) ? order.indexOf(nextId) : 0, items: order.includes(nextId) ? order : [nextId], sub: null };
    await saveSession();
    const pos = pg.list.findIndex((x) => x.item.id === nextId);
    return reply(askKpi(byId[nextId], pos + 1, pg.total, res.rows[nextId]));
  };
  const runCheck = async (id) => {
    const it = byId[id];
    const row = res.rows[id];
    await reply(`Claude KPI ${it.no} \u0D2A\u0D30\u0D3F\u0D36\u0D4B\u0D27\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D28\u0D4D\u0D28\u0D41${filesOf(row).length ? " (\u0D24\u0D46\u0D33\u0D3F\u0D35\u0D41\u0D02 \u0D35\u0D3E\u0D2F\u0D3F\u0D15\u0D4D\u0D15\u0D41\u0D28\u0D4D\u0D28\u0D41)" : ""}\u2026`);
    const earlier = [...row.qa || [], ...(row.ai && row.ai.questions || []).filter((q) => (q.answer || "").trim()).map((q) => ({ q: q.q, a: q.answer }))];
    try {
      const out = await checkKpi({ deptName: dept.name, hod: dept.hod, week: weekRange(week), kpi: kpiCheckInput(it, row), earlier, storage: db.storage, files: filesOf(row) });
      const next = { ...row, qa: earlier.slice(-10), ai: { ...out, at: (/* @__PURE__ */ new Date()).toISOString() } };
      next.ai.hash = kpiHash(next);
      await saveRow(id, next);
    } catch (e) {
      console.error("claude check failed", e);
      const skipped = { ...row, done: true, ai: { verdict: "skipped", summary: "", proof: null, questions: [], at: (/* @__PURE__ */ new Date()).toISOString() } };
      skipped.ai.hash = kpiHash(skipped);
      await saveRow(id, skipped);
      await reply(`Claude \u0D2A\u0D30\u0D3F\u0D36\u0D4B\u0D27\u0D28 \u0D07\u0D2A\u0D4D\u0D2A\u0D4B\u0D7E \u0D28\u0D1F\u0D28\u0D4D\u0D28\u0D3F\u0D32\u0D4D\u0D32. KPI ${it.no} \u0D38\u0D47\u0D35\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D24\u0D41 (MD \u0D13\u0D2B\u0D40\u0D38\u0D4D \u0D2A\u0D3F\u0D28\u0D4D\u0D28\u0D40\u0D1F\u0D4D \u0D28\u0D4B\u0D15\u0D4D\u0D15\u0D41\u0D02).`);
      return nextPending();
    }
    const ai = res.rows[id].ai;
    let msg = `*Claude \xB7 KPI ${it.no}*
${ai.summary || ""}`;
    if (ai.proof) msg += `
\u{1F4CE} ${ai.proof.read ? ai.proof.count != null ? `\u0D24\u0D46\u0D33\u0D3F\u0D35\u0D3F\u0D7D: *${ai.proof.count}*${ai.proof.matches === true ? " \u2713 \u0D36\u0D30\u0D3F" : ai.proof.matches === false ? " \u2717 \u0D15\u0D23\u0D15\u0D4D\u0D15\u0D41\u0D2E\u0D3E\u0D2F\u0D3F \u0D1A\u0D47\u0D30\u0D41\u0D28\u0D4D\u0D28\u0D3F\u0D32\u0D4D\u0D32" : ""}` : "\u0D24\u0D46\u0D33\u0D3F\u0D35\u0D4D \u0D35\u0D3E\u0D2F\u0D3F\u0D1A\u0D4D\u0D1A\u0D41" : "\u0D24\u0D46\u0D33\u0D3F\u0D35\u0D4D \u0D35\u0D3E\u0D2F\u0D3F\u0D15\u0D4D\u0D15\u0D3E\u0D28\u0D3E\u0D2F\u0D3F\u0D32\u0D4D\u0D32"}${ai.proof.note ? "\n" + ai.proof.note : ""}`;
    if (!(ai.questions || []).length) {
      await saveRow(id, { ...res.rows[id], done: true });
      await reply(msg + `

\u2713 KPI ${it.no} \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F (${prog().done}/${prog().total}).`);
      return nextPending();
    }
    s.sub = "q:0";
    await saveSession();
    await reply(msg);
    return askQ(id, 0);
  };
  const askQ = (id, qi) => {
    const q = res.rows[id].ai.questions[qi];
    const n = res.rows[id].ai.questions.length;
    return reply(`*\u0D1A\u0D4B\u0D26\u0D4D\u0D2F\u0D02 ${qi + 1}/${n}*${q.severity === "high" ? " (\u0D2E\u0D31\u0D41\u0D2A\u0D1F\u0D3F \u0D28\u0D3F\u0D7C\u0D2C\u0D28\u0D4D\u0D27\u0D02)" : " (\u0D35\u0D47\u0D23\u0D4D\u0D1F\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D SKIP)"}
${q.q}`);
  };
  const afterFigure = async (id) => {
    const row = res.rows[id];
    const st2 = kpiState(row);
    if (st2 === "need-reason") {
      s.sub = "reason";
      await saveSession();
      return reply(ASK_REASON(byId[id].no, statusOf(row)));
    }
    if (st2 === "need-next") {
      s.sub = "next";
      await saveSession();
      return reply(ASK_NEXT(byId[id].no));
    }
    return runCheck(id);
  };
  if (!media) {
    if (is(cmd, "help")) return reply(HELP);
    if (is(cmd, "status")) {
      const pg = prog();
      return reply(`${dept.name} \xB7 ${weekRange(week)}
${pg.done}/${pg.total} KPI \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F${pg.complete ? " \u2713 \u0D38\u0D2E\u0D7C\u0D2A\u0D4D\u0D2A\u0D3F\u0D1A\u0D4D\u0D1A\u0D41" : ` \xB7 ${pg.pending.length} \u0D2C\u0D3E\u0D15\u0D4D\u0D15\u0D3F`}
\u0D32\u0D3F\u0D38\u0D4D\u0D31\u0D4D\u0D31\u0D3F\u0D28\u0D4D MENU.`);
    }
    if (is(cmd, "menu") || is(cmd, "start") && (!s || ["menu", "done", "idle", "invited", "paused"].includes(s.step))) return showMenu(false);
    if (is(cmd, "all")) return showMenu(true);
    if (is(cmd, "stop")) {
      if (s) {
        s.sub = s.step + "|" + (s.sub || "");
        s.step = "paused";
        await saveSession();
      }
      return reply("\u0D36\u0D30\u0D3F, \u0D28\u0D3F\u0D7C\u0D24\u0D4D\u0D24\u0D3F. \u0D0E\u0D32\u0D4D\u0D32\u0D3E\u0D02 \u0D38\u0D47\u0D35\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D24\u0D3F\u0D1F\u0D4D\u0D1F\u0D41\u0D23\u0D4D\u0D1F\u0D4D. \u0D24\u0D41\u0D1F\u0D30\u0D3E\u0D7B START \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15. \u0D36\u0D28\u0D3F\u0D2F\u0D3E\u0D34\u0D4D\u0D1A 5 PM-\u0D28\u0D4D \u0D2E\u0D41\u0D2E\u0D4D\u0D2A\u0D4D \u0D24\u0D40\u0D7C\u0D15\u0D4D\u0D15\u0D41\u0D15.");
    }
  }
  if (!s || ["invited", "idle", "paused"].includes(s.step)) return showMenu(false);
  if (s.step === "menu") {
    if (media) return reply("\u0D06\u0D26\u0D4D\u0D2F\u0D02 \u0D12\u0D30\u0D41 KPI \u0D24\u0D3F\u0D30\u0D1E\u0D4D\u0D1E\u0D46\u0D1F\u0D41\u0D15\u0D4D\u0D15\u0D41\u0D15 (\u0D28\u0D2E\u0D4D\u0D2A\u0D7C \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15), \u0D0E\u0D28\u0D4D\u0D28\u0D3F\u0D1F\u0D4D\u0D1F\u0D4D \u0D24\u0D46\u0D33\u0D3F\u0D35\u0D4D \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.");
    const n = parseInt(cmd, 10);
    if (Number.isFinite(n) && n >= 1 && n <= s.items.length && /^\d+$/.test(cmd)) return openKpi(s.items[n - 1]);
    if (is(cmd, "ok") || is(cmd, "start")) return s.items.length ? openKpi(s.items[0]) : showMenu(false);
    return reply(`\u0D32\u0D3F\u0D38\u0D4D\u0D31\u0D4D\u0D31\u0D3F\u0D32\u0D46 \u0D12\u0D30\u0D41 \u0D28\u0D2E\u0D4D\u0D2A\u0D7C (1\u2013${s.items.length}) \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15, \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D OK.`);
  }
  if (s.step === "kpi") {
    const id = cur();
    const it = id ? byId[id] : null;
    if (!it) return showMenu(false);
    const sub = String(s.sub || "");
    if (!media && is(cmd, "back")) {
      s.sub = null;
      s.idx = Math.max(0, s.idx - 1);
      await saveSession();
      return openKpi(s.items[s.idx]);
    }
    if (!media && is(cmd, "skip") && !sub.startsWith("q:")) {
      s.sub = null;
      s.idx++;
      await saveSession();
      if (s.idx >= s.items.length) return showMenu(false);
      return openKpi(s.items[s.idx]);
    }
    if (sub.startsWith("q:")) {
      const qi = parseInt(sub.slice(2), 10) || 0;
      const row2 = res.rows[id];
      const q = row2.ai && row2.ai.questions[qi];
      if (!q) {
        await saveRow(id, { ...row2, done: true });
        return nextPending();
      }
      if (media) {
        const kind = await attach(id);
        if (!kind) return;
        res.rows[id].ai.questions[qi].answer = text || `(${KIND_ML[kind]} \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41)`;
        res.rows[id].ai.hash = kpiHash(res.rows[id]);
      } else if (is(cmd, "skip")) {
        if (q.severity === "high") return reply("\u0D08 \u0D1A\u0D4B\u0D26\u0D4D\u0D2F\u0D24\u0D4D\u0D24\u0D3F\u0D28\u0D4D \u0D2E\u0D31\u0D41\u0D2A\u0D1F\u0D3F \u0D28\u0D3F\u0D7C\u0D2C\u0D28\u0D4D\u0D27\u0D2E\u0D3E\u0D23\u0D4D. \u0D1A\u0D41\u0D30\u0D41\u0D15\u0D4D\u0D15\u0D3F \u0D0E\u0D34\u0D41\u0D24\u0D3F\u0D2F\u0D3E\u0D7D \u0D2E\u0D24\u0D3F, \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D2B\u0D4B\u0D1F\u0D4D\u0D1F\u0D4B / PDF \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.");
      } else res.rows[id].ai.questions[qi].answer = text;
      await saveRow(id, res.rows[id]);
      if (qi + 1 < row2.ai.questions.length) {
        s.sub = "q:" + (qi + 1);
        await saveSession();
        return askQ(id, qi + 1);
      }
      await saveRow(id, { ...res.rows[id], done: true });
      s.sub = null;
      await saveSession();
      await reply(`\u2713 KPI ${it.no} \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F (${prog().done}/${prog().total}). \u0D28\u0D28\u0D4D\u0D26\u0D3F.`);
      return nextPending();
    }
    if (sub === "reason") {
      const row2 = res.rows[id] || {};
      if (media) {
        const kind = await attach(id);
        if (!kind) return;
        if (text || !(row2.reason || "").trim()) await saveRow(id, { ...res.rows[id], reason: text || `(${KIND_ML[kind]} \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41)` });
      } else await saveRow(id, { ...row2, reason: text });
      return afterFigure(id);
    }
    if (sub === "next") {
      if (media) {
        const kind = await attach(id);
        if (!kind) return;
        await saveRow(id, { ...res.rows[id], next: text || `(${KIND_ML[kind]} \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41)` });
      } else await saveRow(id, { ...res.rows[id], next: text });
      return afterFigure(id);
    }
    if (media) {
      const kind = await attach(id);
      if (!kind) return;
      const a0 = text ? parseAnswer(text, it) : { kind: "none" };
      if (a0.kind !== "number") return reply(`\u{1F4CE} ${KIND_ML[kind]} KPI ${it.no}-\u0D7D \u0D1A\u0D47\u0D7C\u0D24\u0D4D\u0D24\u0D41. \u0D07\u0D28\u0D3F ${answerKind(it) === "pct" ? "\u0D36\u0D24\u0D2E\u0D3E\u0D28\u0D02 (\u0D09\u0D26\u0D3E: 92) \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D0E\u0D23\u0D4D\u0D23\u0D02 (46/48)" : "\u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D2F\u0D3F\u0D32\u0D46 \u0D15\u0D23\u0D15\u0D4D\u0D15\u0D4D"} \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.`);
    }
    const a = parseAnswer(text, it);
    if (a.kind === "colour") return reply(`\u0D28\u0D3F\u0D31\u0D02 / Yes-No \u0D35\u0D47\u0D23\u0D4D\u0D1F \u2014 ${answerKind(it) === "pct" ? "\u0D36\u0D24\u0D2E\u0D3E\u0D28\u0D02 (\u0D09\u0D26\u0D3E: 92) \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D0E\u0D23\u0D4D\u0D23\u0D02 (46/48)" : "\u0D0E\u0D23\u0D4D\u0D23\u0D02 / \u0D24\u0D41\u0D15 (\u0D09\u0D26\u0D3E: 1420)"} \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15. \u0D28\u0D3F\u0D31\u0D02 \u0D24\u0D28\u0D3F\u0D2F\u0D46 \u0D35\u0D30\u0D41\u0D02 \u{1F512}`);
    if (a.kind !== "number") return reply(answerKind(it) === "pct" ? "\u0D2E\u0D28\u0D38\u0D4D\u0D38\u0D3F\u0D32\u0D3E\u0D2F\u0D3F\u0D32\u0D4D\u0D32. \u0D36\u0D24\u0D2E\u0D3E\u0D28\u0D02 (\u0D09\u0D26\u0D3E: 92) \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D0E\u0D23\u0D4D\u0D23\u0D02 (46/48) \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15. \u0D2A\u0D3F\u0D28\u0D4D\u0D28\u0D40\u0D1F\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D2F\u0D3E\u0D7B SKIP." : "\u0D12\u0D30\u0D41 \u0D28\u0D2E\u0D4D\u0D2A\u0D7C \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15 (\u0D09\u0D26\u0D3E: 1420). \u0D2A\u0D3F\u0D28\u0D4D\u0D28\u0D40\u0D1F\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D2F\u0D3E\u0D7B SKIP.");
    const old = res.rows[id] || {};
    const row = { ...old, actual: a.actual, ach: a.ach, done: false };
    delete row.data;
    const rag = statusOf(row);
    if (a.note) {
      if ((rag === "A" || rag === "R") && !(old.reason || "").trim()) row.reason = a.note;
      else row.reason = [old.reason, a.note].filter(Boolean).join(" \xB7 ");
    }
    await saveRow(id, row);
    await reply(`\u2713 KPI ${it.no}: ${row.actual}${row.ach != null ? " \u2192 " + row.ach + "%" : ""} ${RAG_ML[rag] || ""} \u{1F512}`);
    return afterFigure(id);
  }
  if (s.step === "plan") {
    if (media) return reply("\u0D07\u0D35\u0D3F\u0D1F\u0D46 \u0D1F\u0D48\u0D2A\u0D4D\u0D2A\u0D4D \u0D1A\u0D46\u0D2F\u0D4D\u0D24\u0D4D \u0D2E\u0D31\u0D41\u0D2A\u0D1F\u0D3F \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.");
    if (s.sub === "pri") {
      res.priorities = is(cmd, "skip") || is(cmd, "none") ? ["", "", ""] : text.split(/\n|;/).map((x) => x.replace(/^\s*[\d.)\-•*]+\s*/, "").trim()).filter(Boolean).slice(0, 3);
      while (res.priorities.length < 3) res.priorities.push("");
      await db.from("results").update({ priorities: res.priorities }).eq("week", week).eq("dept_id", profile.dept_id);
      s.sub = "sup";
      await saveSession();
      return reply(ASK_SUP);
    }
    res.support = is(cmd, "skip") || is(cmd, "none") ? "" : text;
    await db.from("results").update({ support: res.support }).eq("week", week).eq("dept_id", profile.dept_id);
    s = { step: "done", idx: 0, items: [], sub: null };
    await saveSession();
    return reply("\u0D28\u0D28\u0D4D\u0D26\u0D3F! \u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D24\u0D4D\u0D24\u0D46 \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F \u2713\n\u0D2E\u0D3E\u0D31\u0D4D\u0D31\u0D02 \u0D35\u0D47\u0D23\u0D2E\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D ALL \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15, \u0D05\u0D32\u0D4D\u0D32\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D \u0D06\u0D2A\u0D4D\u0D2A\u0D4D \u0D24\u0D41\u0D31\u0D15\u0D4D\u0D15\u0D41\u0D15.");
  }
  if (s.step === "done") {
    if (media) return reply("\u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F. \u0D12\u0D30\u0D41 KPI-\u0D7D \u0D24\u0D46\u0D33\u0D3F\u0D35\u0D4D \u0D1A\u0D47\u0D7C\u0D15\u0D4D\u0D15\u0D3E\u0D7B ALL \u0D05\u0D2F\u0D1A\u0D4D\u0D1A\u0D4D \u0D06 KPI \u0D24\u0D3F\u0D30\u0D1E\u0D4D\u0D1E\u0D46\u0D1F\u0D41\u0D15\u0D4D\u0D15\u0D41\u0D15.");
    return reply(`\u0D08 \u0D06\u0D34\u0D4D\u0D1A\u0D24\u0D4D\u0D24\u0D46 \u0D31\u0D3F\u0D2A\u0D4D\u0D2A\u0D4B\u0D7C\u0D1F\u0D4D\u0D1F\u0D4D \u0D2A\u0D42\u0D7C\u0D24\u0D4D\u0D24\u0D3F\u0D2F\u0D3E\u0D2F\u0D3F \u2713 (${prog().done}/${prog().total}). \u0D2E\u0D3E\u0D31\u0D4D\u0D31\u0D02 \u0D35\u0D47\u0D23\u0D2E\u0D46\u0D19\u0D4D\u0D15\u0D3F\u0D7D ALL \u0D05\u0D2F\u0D15\u0D4D\u0D15\u0D41\u0D15.`);
  }
  return showMenu(false);
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
