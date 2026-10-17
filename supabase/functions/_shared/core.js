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
export function summarize(rows) {
  const c = { G: 0, A: 0, R: 0 }; let sum = 0, n = 0;
  for (const r of Object.values(rows || {})) {
    const rag = r.rag || ragOf(r.ach);
    if (c[rag] != null) c[rag]++;
    if (typeof r.ach === "number") { sum += Math.min(r.ach, 120); n++; }
    else if (rag === "G") { sum += 100; n++; } else if (rag === "A") { sum += 87; n++; } else if (rag === "R") { sum += 60; n++; }
  }
  const score = n ? Math.round(sum / n) : null;
  return { score, counts: c, rag: score == null ? "none" : ragOf(score) };
}
export const hasValue = (r) => !!r && !!(r.actual || r.rag || r.reason || r.data || r.ach != null);
/** Fingerprint of the figures, so a Claude check is redone when figures change. */
export function rowsHash(rows) {
  return Object.keys(rows || {}).sort().map((k) => { const r = rows[k]; return [k, r.actual ?? "", r.ach ?? "", r.rag || "", r.reason || "", r.data || ""].join("|"); }).join("~");
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
      if (y && (x.rag || ragOf(x.ach)) === "R" && (y.rag || ragOf(y.ach)) === "R") out.push({ dept: d.id, name: d.name, no: x.no, text: x.text });
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
    out.push({ no: i.no, kpi: i.text, target: i.target, freq: FREQ[i.freq] || i.freq, headline: !!i.star, actual: r.actual || "", achievement: r.ach != null ? r.ach + "%" : "", status: RAGN[r.rag || ragOf(r.ach)] || "", reason: r.reason || "", data: r.data || "" });
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
      rows: r ? Object.values(r.rows || {}).map((x) => ({ no: x.no, kpi: x.text, target: x.target, actual: x.actual, ach: x.ach, status: RAGN[x.rag || ragOf(x.ach)] || "", reason: x.reason, data: x.data })) : [],
      clarifications: r ? [...(r.clar || []), ...((r.ai && r.ai.flags) || [])].map((c) => ({ kpi: c.kpiNo, q: c.question, a: c.answer || "NOT ANSWERED" })) : [],
      priorities: r ? (r.priorities || []).filter(Boolean) : [], support: r ? r.support : "",
      openActions: actions.filter((a) => a.dept === d.id && a.status !== "Done").map((a) => ({ action: a.action, owner: a.owner, due: a.due, overdue: !!(a.due && a.due < today), status: a.status })),
    };
  });
}
