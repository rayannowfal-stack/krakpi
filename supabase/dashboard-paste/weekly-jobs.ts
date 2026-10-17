// weekly-jobs — single-file version to paste into Supabase → Edge Functions → Deploy a new function → Via Editor (function name: weekly-jobs). Generated from supabase/functions/weekly-jobs; edit the originals, not this file.

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

// supabase/functions/_shared/core.js
var RAGN = { G: "Green", A: "Amber", R: "Red", NA: "No data" };
var RATINGS2 = { "Result-oriented": "G", "Partly result-oriented": "A", "Activity only": "R" };
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
      rows: r ? Object.values(r.rows || {}).map((x) => ({ no: x.no, kpi: x.text, target: x.target, actual: x.actual, ach: x.ach, status: RAGN[statusOf(x)] || "", reason: x.reason, data: x.data, nextStep: x.next || "", attached: filesSummary(x) })) : [],
      clarifications: r ? [...r.clar || [], ...r.ai && r.ai.flags || []].map((c) => ({ kpi: c.kpiNo, q: c.question, a: c.answer || "NOT ANSWERED" })) : [],
      priorities: r ? (r.priorities || []).filter(Boolean) : [],
      support: r ? r.support : "",
      openActions: actions.filter((a) => a.dept === d.id && a.status !== "Done").map((a) => ({ action: a.action, owner: a.owner, due: a.due, overdue: !!(a.due && a.due < today), status: a.status }))
    };
  });
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
async function sendTemplate(db, to, name, lang, bodyParams, headerDoc) {
  const components = [];
  if (headerDoc) components.push({ type: "header", parameters: [{ type: "document", document: { link: headerDoc.link, filename: headerDoc.filename } }] });
  if (bodyParams.length) components.push({ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) });
  await post({ to, type: "template", template: { name, language: { code: lang }, components } });
  if (db) await db.from("wa_log").insert({ phone: to, direction: "out", body: `[template ${name}] ${bodyParams.join(" | ")}${headerDoc ? " + " + headerDoc.filename : ""}` });
}

// supabase/functions/_shared/jobs.ts
async function getSettings(db) {
  const { data } = await db.from("app_settings").select("*").eq("id", 1).maybeSingle();
  return data || { report_numbers: [], bot_scope: "weekly", tpl_start: "kpi_weekly_start", tpl_report: "kpi_weekly_report", tpl_lang: "ml" };
}
async function hods(db) {
  const { data } = await db.from("profiles").select("id, full_name, phone, role, dept_id").eq("role", "hod");
  return (data || []).filter((p) => p.phone && p.dept_id);
}
async function kickoff(db, week, onlyPending = false) {
  const st = await getSettings(db);
  const { data: depts } = await db.from("departments").select("id, name");
  const { data: res } = await db.from("results").select("dept_id, status").eq("week", week);
  const done = new Set((res || []).filter((r) => r.status === "submitted").map((r) => r.dept_id));
  const sent = [], failed = [];
  for (const p of await hods(db)) {
    if (onlyPending && done.has(p.dept_id)) continue;
    const dn = (depts || []).find((d) => d.id === p.dept_id)?.name || p.dept_id;
    try {
      await sendTemplate(db, p.phone, st.tpl_start, st.tpl_lang, [p.full_name || "HOD", dn, weekRange(week)]);
      if (!onlyPending) await db.from("wa_sessions").upsert({ phone: p.phone, user_id: p.id, dept_id: p.dept_id, week, step: "invited", idx: 0, items: [], sub: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
      sent.push(dn);
    } catch (e) {
      failed.push(`${dn}: ${e.message}`);
    }
  }
  const detail = `${onlyPending ? "Reminder" : "Kickoff"} sent to ${sent.length}: ${sent.join(", ")}${failed.length ? ` \xB7 failed ${failed.length}: ${failed.join("; ")}` : ""}`;
  await logJob(db, onlyPending ? "remind" : "kickoff", week, failed.length === 0, detail);
  return { sent, failed };
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

// supabase/functions/weekly-jobs/index.ts
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = serviceClient();
  let action = "?", week = "";
  try {
    const secret = Deno.env.get("CRON_SECRET");
    const fromCron = !!secret && req.headers.get("x-cron-secret") === secret;
    let userId = null;
    if (!fromCron) {
      const { profile } = await getCaller(req);
      if (profile.role !== "admin") throw new HttpError(403, "Only an admin can run this.");
      userId = profile.id;
    }
    const b = await req.json().catch(() => ({}));
    action = String(b.action || "");
    week = /^\d{4}-\d{2}-\d{2}$/.test(String(b.week || "")) ? String(b.week) : meetingWeek(istToday());
    if (action === "kickoff") return json({ ok: true, ...await kickoff(db, week, false) });
    if (action === "remind") return json({ ok: true, ...await kickoff(db, week, true) });
    if (action === "review") return json({ ok: true, review: await review(db, week, userId) });
    if (action === "ppt") {
      const to = Array.isArray(b.to) ? b.to.map(String) : void 0;
      return json({ ok: true, ...await ppt(db, week, { to, makeReview: b.makeReview !== false }) });
    }
    throw new HttpError(400, "Unknown action. Use kickoff, remind, review or ppt.");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(action, e);
    if (status === 500) await logJob(db, action, week || null, false, e.message).catch(() => {
    });
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
