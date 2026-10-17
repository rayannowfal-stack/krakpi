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

// supabase/functions/_shared/core.js
var WEEKLY = /* @__PURE__ */ new Set(["D", "W", "15D"]);
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
        s.addText(`${v ? "Claude " + v[0] : "Not checked"}${x.ai && x.ai.proof && x.ai.proof.matches === false ? " \xB7 proof \u2260 figure" : ""}${nf ? `  \xB7  \u{1F4CE} ${nf}` : ""}`, { x: cx + 0.2, y: cy + 0.96, w: 3.75, h: 0.28, fontSize: 9, color: v ? ST[v[1]].fg : MUT, bold: !!(x.ai && x.ai.proof && x.ai.proof.matches === false), fontFace: FONT });
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

// supabase/functions/_shared/ai.ts
function b64(bytes) {
  let s = "";
  const CH = 32768;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
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
async function kickoff(db, week, onlyPending = false) {
  const st = await getSettings(db);
  const prog = await progressAll(db, week, st.bot_scope);
  const sent = [], failed = [], skipped = [];
  for (const p of await hods(db)) {
    const pg = prog[p.dept_id];
    const dn = pg ? pg.name : p.dept_id;
    if (!pg || !pg.total || pg.pending === 0) {
      skipped.push(dn);
      continue;
    }
    try {
      await sendTemplate(db, p.phone, st.tpl_start, st.tpl_lang, [p.full_name || "HOD", dn, weekRange(week), `${pg.pending} / ${pg.total}`]);
      await db.from("wa_sessions").upsert({ phone: p.phone, user_id: p.id, dept_id: p.dept_id, week, step: "invited", idx: 0, items: [], sub: null, updated_at: (/* @__PURE__ */ new Date()).toISOString() });
      sent.push(`${dn} (${pg.pending})`);
    } catch (e) {
      failed.push(`${dn}: ${e.message}`);
    }
  }
  const detail = `${onlyPending ? "Reminder" : "Kickoff"} sent to ${sent.length}: ${sent.join(", ")}${skipped.length ? ` \xB7 already done: ${skipped.join(", ")}` : ""}${failed.length ? ` \xB7 failed ${failed.length}: ${failed.join("; ")}` : ""}`;
  await logJob(db, onlyPending ? "remind" : "kickoff", week, failed.length === 0, detail);
  return { sent, failed, skipped };
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
