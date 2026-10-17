// Shared logic used by BOTH the web app (browser) and the server functions (Deno):
// labels, dates, scoring, mapping database rows. Plain JavaScript, no imports.

export const FREQ = { D: "Daily", W: "Weekly", "15D": "15 days", M: "Monthly", Q: "Quarterly", H: "Half-yearly", Y: "Yearly", AN: "As needed" };
export const FREQ_ML = { D: "ദിവസവും", W: "ആഴ്ചതോറും", "15D": "15 ദിവസം", M: "മാസംതോറും", Q: "ത്രൈമാസം", H: "അർധവാർഷികം", Y: "വാർഷികം", AN: "ആവശ്യാനുസരണം" };
export const WEEKLY = new Set(["D", "W", "15D"]);
export const RAGN = { G: "Green", A: "Amber", R: "Red", NA: "No data" };
export const RAG_ML = { G: "പച്ച (Green)", A: "മഞ്ഞ (Amber)", R: "ചുവപ്പ് (Red)", NA: "ഡാറ്റ ഇല്ല" };
export const RATINGS = { "Result-oriented": "G", "Partly result-oriented": "A", "Activity only": "R" };
export const RATING_ML = { "Result-oriented": "ഫലാധിഷ്ഠിതം", "Partly result-oriented": "ഭാഗികമായി ഫലാധിഷ്ഠിതം", "Activity only": "ജോലി ചെയ്തു എന്ന് മാത്രം" };

/* ---------- dates (week key = Monday of the HOD meeting; reporting covers Mon–Sat before it) ---------- */
export const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmt = (s) => { const d = parseYmd(s); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtShort = (s) => { const d = parseYmd(s); return `${d.getDate()} ${MON[d.getMonth()]}`; };
/** Today's date in India (YYYY-MM-DD), whatever the server's clock zone. */
export function istToday(now = new Date()) {
  const t = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60000);
  return ymd(t);
}
/** The Monday meeting this date reports into: today if Monday, else the coming Monday. */
export function meetingWeek(todayYmd) { const d = parseYmd(todayYmd); const add = (8 - d.getDay()) % 7; d.setDate(d.getDate() + add); return ymd(d); }
export const weekRange = (w) => `${fmtShort(addDays(w, -7))} – ${fmtShort(addDays(w, -2))}`;

/* ---------- scoring ---------- */
export function calcAch(item, actual) {
  const a = parseFloat(String(actual).replace(/,/g, ""));
  if (actual === "" || actual == null || isNaN(a)) return null;
  const t = item.tv;
  if (item.dir === "zero") return a === 0 ? 100 : 0;
  if (t == null || isNaN(t)) return null;
  let v;
  if (item.dir === "down") v = a <= t ? 100 : a === 0 ? 100 : (t / a) * 100;
  else v = t === 0 ? (a > 0 ? 100 : 0) : (a / t) * 100;
  return Math.round(Math.min(v, 120));
}
export const ragOf = (ach) => (ach == null ? "" : ach >= 95 ? "G" : ach >= 80 ? "A" : "R");
export const isManual = (item) => item.tv == null && item.dir !== "zero";
/** A KPI's status is LOCKED to its achievement %: nobody picks Green/Amber/Red by hand. */
export const statusOf = (r) => ragOf(r && typeof r.ach === "number" ? r.ach : null);
/** Attachments (voice notes, photos, files) on one KPI row. */
export const filesOf = (r) => (r && Array.isArray(r.files) ? r.files : []);
export const KIND_ML = { voice: "ശബ്ദ സന്ദേശം", photo: "ഫോട്ടോ", file: "ഫയൽ" };
export const kindOf = (mime) => (/^audio\//.test(mime || "") ? "voice" : /^image\//.test(mime || "") ? "photo" : "file");
/** "1 voice note, 2 photos" — what's attached, for Claude and the PPT. */
export function filesSummary(r) {
  const c = { voice: 0, photo: 0, file: 0 };
  filesOf(r).forEach((f) => { c[f.kind || kindOf(f.type)]++; });
  const out = [];
  if (c.voice) out.push(`${c.voice} voice note${c.voice > 1 ? "s" : ""}`);
  if (c.photo) out.push(`${c.photo} photo${c.photo > 1 ? "s" : ""}`);
  if (c.file) out.push(`${c.file} file${c.file > 1 ? "s" : ""}`);
  return out.join(", ");
}
export function summarize(rows) {
  const c = { G: 0, A: 0, R: 0 }; let sum = 0, n = 0;
  for (const r of Object.values(rows || {})) {
    const rag = statusOf(r);
    if (c[rag] != null) c[rag]++;
    if (typeof r.ach === "number") { sum += Math.min(r.ach, 120); n++; }
  }
  const score = n ? Math.round(sum / n) : null;
  return { score, counts: c, rag: score == null ? "none" : ragOf(score) };
}
export const hasValue = (r) => !!r && !!(r.actual || r.reason || r.data || r.next || r.ach != null || filesOf(r).length);

/* ---------- one KPI at a time (v3) ---------- */
/** Does this KPI's target read as a percentage? (then "46/48" or "46 of 48" counts are turned into %) */
export const isPct = (item) => /%/.test(String(item && item.target || "")) || isManual(item);
/** What the HOD is asked for: "pct" = a % (or X of Y), "count" = a number/count/amount. */
export const answerKind = (item) => (isPct(item) ? "pct" : "count");
/**
 * Reads what the HOD typed for a KPI: "1420", "92", "92%", "46/48", "46 of 48", "Rs. 1,420".
 * Returns { actual, ach } or null when there is no number. The status is never typed — it follows ach.
 */
export function resultFrom(item, input) {
  const t = String(input ?? "").replace(/rs\.?\s*/ig, "").replace(/₹/g, "").trim();
  if (!t) return null;
  const of = t.match(/(\d[\d,]*(?:\.\d+)?)\s*(?:\/|of|ൽ|-ൽ|out of)\s*(\d[\d,]*(?:\.\d+)?)/i);
  const num = (x) => parseFloat(String(x).replace(/,/g, ""));
  if (of && isPct(item)) {
    const a = num(of[1]), b = num(of[2]);
    if (!(b > 0)) return null;
    const pct = Math.round((a / b) * 1000) / 10;
    const ach = isManual(item) ? Math.min(Math.round(pct), 120) : calcAch(item, pct);
    return { actual: `${of[1].replace(/,/g, "")}/${of[2].replace(/,/g, "")}`, ach, pct };
  }
  const m = t.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!m) return null;
  const v = m[0].replace(/,/g, "");
  if (isManual(item)) return { actual: v + "%", ach: Math.max(0, Math.min(Math.round(num(v)), 120)) };
  return { actual: v, ach: calcAch(item, v) };
}
/** A KPI is finished when it has a result, Claude has checked this exact entry, and every required question is answered. */
export const kpiHash = (r) => [r && r.actual || "", r && r.ach != null ? r.ach : "", r && r.reason || "", r && r.next || "", filesOf(r).map((f) => f.path).join(",")].join("|");
export function kpiState(r) {
  if (!r || (r.ach == null && !r.actual)) return "todo";
  const bad = ["A", "R"].includes(statusOf(r));
  if (bad && !((r.reason || "").trim() || filesOf(r).length)) return "need-reason";
  if (bad && !(r.next || "").trim()) return "need-next";
  if (!r.ai || r.ai.hash !== kpiHash(r)) return "need-check";
  if ((r.ai.questions || []).some((q) => q.severity === "high" && !(q.answer || "").trim())) return "need-answer";
  return r.done ? "done" : "ready";
}
/** The KPIs a HOD must finish this week, and where each one stands. scope "headline" = only ★ KPIs. */
export function progressOf(dept, rows, scope = "weekly") {
  let items = itemsFor(dept, false);
  if (scope === "headline") items = items.filter((i) => i.star);
  const list = items.map((i) => ({ item: i, row: (rows || {})[i.id] || null, state: kpiState((rows || {})[i.id]) }));
  const done = list.filter((x) => x.state === "done").length;
  return { list, done, total: list.length, pending: list.filter((x) => x.state !== "done"), complete: list.length > 0 && done === list.length };
}
/** What Claude reads about one KPI. */
export function kpiCheckInput(item, row) {
  return { no: item.no, kpi: item.text, target: item.target, frequency: FREQ[item.freq] || item.freq, headline: !!item.star,
    answer: row.actual || "", achievement: row.ach != null ? row.ach + "%" : "", status: RAGN[statusOf(row)] || "",
    reason: row.reason || "", nextStep: row.next || "", attached: filesSummary(row) };
}
/** Fingerprint of the figures, so a Claude check is redone when figures change. */
export function rowsHash(rows) {
  return Object.keys(rows || {}).sort().map((k) => { const r = rows[k]; return [k, r.actual ?? "", r.ach ?? "", r.reason || "", r.data || "", r.next || "", filesOf(r).map((f) => f.path).join(",")].join("|"); }).join("~");
}

/* ---------- KPI lists ---------- */
export function sortItems(items) {
  return items.slice().sort((a, b) => (b.star ? 1 : 0) - (a.star ? 1 : 0) || a.kraNo - b.kraNo || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
}
export function itemsFor(dept, all) { return dept ? sortItems((dept.items || []).filter((i) => all || WEEKLY.has(i.freq))) : []; }

/* ---------- database rows -> app objects ---------- */
export function mapKpi(k) {
  return { id: k.id, kraNo: k.kra_no, kra: k.kra, kraW: Number(k.kra_weight) || 0, no: k.no, text: k.text, target: k.target,
    tv: k.tv == null ? null : Number(k.tv), dir: k.dir, freq: k.freq, owner: k.owner, star: k.star };
}
export function buildDepts(deptRows, kpiRows) {
  const m = {};
  (deptRows || []).forEach((d) => (m[d.id] = { name: d.name, hod: d.hod, order: d.sort_order, items: [] }));
  (kpiRows || []).forEach((k) => m[k.dept_id] && m[k.dept_id].items.push(mapKpi(k)));
  return m;
}
export const deptListOf = (depts) => Object.entries(depts).map(([id, d]) => ({ id, ...d })).sort((a, b) => (a.order || 99) - (b.order || 99));
export function mapResult(r) {
  return { week: r.week, dept: r.dept_id, status: r.status, rows: r.rows || {}, priorities: r.priorities || [], support: r.support || "",
    ai: r.ai || null, clar: r.clar || [], by: r.updated_by, at: r.updated_at, source: r.source || "app" };
}
export const mapAction = (a) => ({ _id: a.id, dept: a.dept_id, week: a.week, kpiNo: a.kpi_no, kpiText: a.kpi_text, action: a.action, owner: a.owner, due: a.due, status: a.status, result: a.result });
export const mapProposal = (p) => ({ _id: p.id, dept: p.dept_id, kraNo: p.kra_no, kraName: p.kra_name, text: p.text, target: p.target, freq: p.freq, owner: p.owner, note: p.note, status: p.status, by: p.created_by });

/** KPIs that are Red this week and were Red last week too. */
export function repeatReds(depts, results, prev) {
  const out = [];
  deptListOf(depts).forEach((d) => {
    const r = results[d.id], p = prev[d.id]; if (!r || !p) return;
    for (const [id, x] of Object.entries(r.rows || {})) {
      const y = (p.rows || {})[id];
      if (y && (statusOf(x)) === "R" && (statusOf(y)) === "R") out.push({ dept: d.id, name: d.name, no: x.no, text: x.text });
    }
  });
  return out;
}

/** Normalise an Indian mobile number to WhatsApp form: 91XXXXXXXXXX. Returns "" if not valid. */
export function normPhone(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  return d.length >= 11 && d.length <= 15 ? d : "";
}
/** Normalise a username: lowercase letters, digits, dot, dash, underscore; 3-30 long. Returns "" if not valid. */
export function normUsername(s) {
  const u = String(s || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u) ? u : "";
}
/** The hidden login address behind a username. Nobody types or sees it; it is never emailed. */
export const LOGIN_DOMAIN = "u.atlas-kpi.app";
export const userLogin = (username) => `${username}@${LOGIN_DOMAIN}`;

/* ---------- what Claude is sent (same from the app and from the server) ---------- */
/** The reported rows of one department, in the shape Claude's check reads. */
export function checkRows(dept, rows) {
  const out = [];
  for (const i of (dept && dept.items) || []) {
    const r = rows[i.id]; if (!hasValue(r)) continue;
    out.push({ no: i.no, kpi: i.text, target: i.target, freq: FREQ[i.freq] || i.freq, headline: !!i.star, actual: r.actual || "", achievement: r.ach != null ? r.ach + "%" : "", status: RAGN[statusOf(r)] || "", reason: r.reason || "", data: r.data || "", nextStep: r.next || "", attached: filesSummary(r) });
  }
  return out;
}
/** Headline weekly KPIs the HOD left blank. */
export function missingHeadline(dept, rows) {
  return ((dept && dept.items) || []).filter((i) => i.star && WEEKLY.has(i.freq) && !hasValue(rows[i.id])).map((i) => `${i.no} ${i.text}`);
}
/** Everything the MD review reads about every department. */
export function reviewDepartments({ depts, results, prev, actions, today }) {
  return deptListOf(depts).map((d) => {
    const r = results[d.id]; const p = prev[d.id];
    return {
      id: d.id, name: d.name, hod: d.hod, sheet: r ? r.status : "missing", via: r ? r.source : "", score: r ? summarize(r.rows).score : null, lastWeekScore: p ? summarize(p.rows).score : null,
      claudeCheck: r && r.ai ? { rating: r.ai.rating, evidenceScore: r.ai.score, summary: r.ai.summary } : null,
      rows: r ? Object.values(r.rows || {}).map((x) => ({ no: x.no, kpi: x.text, target: x.target, actual: x.actual, ach: x.ach, status: RAGN[statusOf(x)] || "", reason: x.reason || x.data || "", nextStep: x.next || "", attached: filesSummary(x),
        claude: x.ai ? { verdict: x.ai.verdict, proof: x.ai.proof || null, note: x.ai.summary } : null, finished: !!x.done })) : [],
      clarifications: r ? [
        ...Object.values(r.rows || {}).flatMap((x) => ((x.ai && x.ai.questions) || []).map((q) => ({ kpi: x.no, q: q.q, a: q.answer || "NOT ANSWERED" }))),
        ...(r.clar || []), ...((r.ai && r.ai.flags) || [])].map((c) => ({ kpi: c.kpi || c.kpiNo, q: c.q || c.question, a: c.a || c.answer || "NOT ANSWERED" })) : [],
      priorities: r ? (r.priorities || []).filter(Boolean) : [], support: r ? r.support : "",
      openActions: actions.filter((a) => a.dept === d.id && a.status !== "Done").map((a) => ({ action: a.action, owner: a.owner, due: a.due, overdue: !!(a.due && a.due < today), status: a.status })),
    };
  });
}
