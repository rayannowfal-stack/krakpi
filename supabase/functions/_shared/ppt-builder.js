// Builds the weekly HOD review deck. Used by the app ("Make PPT") and by the Saturday 5 PM job,
// so both produce exactly the same format. Pass in the PptxGenJS class and the week's data.
import { RAGN, RATINGS, ragOf, summarize, fmt, fmtShort, weekRange, deptListOf } from "./core.js";

const INK = "12343B", GOLD = "B8892B", MUT = "5A6B6F", LINE = "D3DBD8", TXT = "13262B", RED = "B23434";
const RC = { G: ["DDF0E4", "25734A"], A: ["F8E9CC", "9A6412"], R: ["F7DEDC", "B23434"], NA: ["E4E9E8", "6B7779"], none: ["E4E9E8", "6B7779"], "": ["FFFFFF", "5A6B6F"] };
const FONT = "Calibri";

/**
 * @param PptxGenJS the PptxGenJS class
 * @param d { week, depts, results, prev, actions, review, today }
 * @returns a PptxGenJS presentation (call .write / .writeFile on it)
 */
export function buildDeck(PptxGenJS, d) {
  const { week, depts, results, actions, review, today } = d;
  const pptx = new PptxGenJS(); pptx.layout = "LAYOUT_WIDE"; pptx.title = "HOD Review " + week;
  pptx.defineSlideMaster({
    title: "M", background: { color: "FFFFFF" }, objects: [
      { rect: { x: 0, y: 7.18, w: 13.33, h: 0.04, fill: { color: GOLD } } }, { rect: { x: 0, y: 7.26, w: 13.33, h: 0.04, fill: { color: GOLD } } },
      { text: { text: "Atlas Maharani Group · Weekly HOD Review · " + fmt(week), options: { x: 0.5, y: 6.8, w: 9, h: 0.3, fontSize: 9, color: MUT, fontFace: FONT } } }],
    slideNumber: { x: 12.4, y: 6.8, w: 0.5, h: 0.3, fontSize: 9, color: MUT },
  });
  const head = (s, title, sub) => {
    s.addText(title, { x: 0.5, y: 0.3, w: 12.3, h: 0.6, fontSize: 26, bold: true, color: INK, fontFace: FONT });
    if (sub) s.addText(sub, { x: 0.5, y: 0.9, w: 12.3, h: 0.4, fontSize: 13, color: MUT, fontFace: FONT });
  };
  const H = (t) => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: INK }, fontSize: 11 } });
  const ragCell = (rag) => ({ text: RAGN[rag] || "—", options: { bold: true, fill: { color: RC[rag || ""][0] }, color: RC[rag || ""][1], align: "center" } });
  const ratingCell = (rating) => { const k = RATINGS[rating] || ""; return { text: rating || "—", options: { bold: true, fill: { color: RC[k][0] }, color: RC[k][1] } }; };
  const tblOpts = (colW) => ({ x: 0.5, y: 1.45, w: 12.33, colW, fontSize: 10, fontFace: FONT, color: TXT, border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", margin: 0.05 });
  const bullets = (s, lines) => { if (lines.length) s.addText(lines, { x: 0.5, y: 1.45, w: 12.3, h: 5.2, valign: "top", fontFace: FONT, color: TXT, fit: "shrink" }); };
  const sec = (t, color, first) => ({ text: t, options: { bold: true, fontSize: 16, color: color || INK, breakLine: true, paraSpaceBefore: first ? 0 : 10 } });
  const bl = (t, size) => ({ text: String(t), options: { bullet: true, fontSize: size || 14, breakLine: true } });

  // Title
  const t = pptx.addSlide(); t.background = { color: INK };
  t.addShape(pptx.ShapeType.rect, { x: 0, y: 5.2, w: 13.33, h: 0.06, fill: { color: GOLD } });
  t.addShape(pptx.ShapeType.rect, { x: 0, y: 5.32, w: 13.33, h: 0.06, fill: { color: GOLD } });
  t.addText("ATLAS MAHARANI GROUP", { x: 0.8, y: 1.4, w: 11, h: 0.4, fontSize: 14, color: "D9AE55", bold: true, charSpacing: 4, fontFace: FONT });
  t.addText("Weekly HOD Review", { x: 0.8, y: 1.9, w: 11, h: 1, fontSize: 44, color: "FFFFFF", bold: true, fontFace: FONT });
  t.addText(`KRA & KPI results · week ${weekRange(week)}`, { x: 0.8, y: 3.0, w: 11, h: 0.5, fontSize: 20, color: "E4ECEA", fontFace: FONT });
  t.addText(`Meeting: Monday ${fmt(week)}`, { x: 0.8, y: 3.6, w: 11, h: 0.4, fontSize: 16, color: "93A5A8", fontFace: FONT });

  // Group snapshot
  const ds = deptListOf(depts);
  const snap = pptx.addSlide({ masterName: "M" });
  const scores = []; const tot = { G: 0, A: 0, R: 0 };
  const srows = [[H("Department"), H("HOD"), H("Submitted"), H("Score"), H("Status"), H("Green"), H("Amber"), H("Red"), H("Open actions")]];
  ds.forEach((dp) => {
    const r = results[dp.id]; const subm = r && r.status === "submitted"; const sm = r ? summarize(r.rows) : { score: null, counts: { G: 0, A: 0, R: 0 }, rag: "none" };
    if (subm) { if (sm.score != null) scores.push(sm.score); for (const k in tot) tot[k] += sm.counts[k]; }
    srows.push([{ text: dp.name, options: { bold: true } }, dp.hod || "", subm ? "Yes" : r ? "Draft" : "No", sm.score != null ? sm.score + "%" : "—", ragCell(subm ? sm.rag : "none"),
      String(sm.counts.G), String(sm.counts.A), String(sm.counts.R), String(actions.filter((a) => a.dept === dp.id && a.status !== "Done").length)]);
  });
  const grp = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  head(snap, "Group snapshot", `${scores.length} of ${ds.length} departments submitted · group score ${grp != null ? grp + "%" : "—"} · ${tot.G} Green, ${tot.A} Amber, ${tot.R} Red KPIs`);
  snap.addTable(srows, tblOpts([2.3, 2.6, 1.1, 0.9, 1.2, 0.9, 0.9, 0.9, 1.53]));

  // Claude MD review
  if (review) {
    const s = pptx.addSlide({ masterName: "M" }); head(s, "MD office review (by Claude)", review.headline || "");
    const lines = [];
    if (review.groupView) lines.push({ text: review.groupView, options: { fontSize: 14, breakLine: true, paraSpaceAfter: 8 } });
    if ((review.watchList || []).length) { lines.push(sec("Watch list this week", INK, true)); review.watchList.forEach((x) => lines.push(bl(x, 13))); }
    if ((review.crossDept || []).length) { lines.push(sec("Across departments")); review.crossDept.forEach((x) => lines.push(bl(x, 13))); }
    bullets(s, lines);
    const rr = [[H("Department"), H("Claude rating"), H("Verdict")]];
    (review.departments || []).forEach((x) => rr.push([(depts[x.dept] || {}).name || x.dept, ratingCell(x.rating), x.verdict]));
    if (rr.length > 1) { const s2 = pptx.addSlide({ masterName: "M" }); head(s2, "Result-oriented or just duty?", "Claude's rating of how each department reported this week"); s2.addTable(rr, tblOpts([2.2, 2.1, 8.03])); }
  }

  // Per department: scorecard, then plan & Claude's questions
  const order = { R: 0, A: 1, G: 2, NA: 3, "": 4 };
  ds.forEach((dp) => {
    const r = results[dp.id]; const sm = r ? summarize(r.rows) : null;
    if (!r) {
      const s = pptx.addSlide({ masterName: "M" }); head(s, dp.name, `HOD ${dp.hod || ""}`);
      s.addText("Results not submitted for this week.", { x: 0.5, y: 2.5, w: 12.3, h: 1, fontSize: 24, color: RED, bold: true, align: "center", fontFace: FONT });
      return;
    }
    const rows = Object.entries(r.rows || {}).map(([id, x]) => ({ id, ...x, rag: x.rag || ragOf(x.ach) }))
      .sort((a, b) => order[a.rag] - order[b.rag] || (b.star ? 1 : 0) - (a.star ? 1 : 0) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
    const per = 9; const pages = Math.max(1, Math.ceil(rows.length / per));
    for (let p = 0; p < pages; p++) {
      const s = pptx.addSlide({ masterName: "M" });
      head(s, `${dp.name} — ${sm.score != null ? sm.score + "%" : "—"} ${sm.rag !== "none" ? "· " + RAGN[sm.rag] : ""}`,
        `HOD ${dp.hod || ""} · ${sm.counts.G} Green, ${sm.counts.A} Amber, ${sm.counts.R} Red${r.status !== "submitted" ? " · DRAFT, not submitted" : ""}${r.source === "whatsapp" ? " · via WhatsApp" : ""}${pages > 1 ? ` · page ${p + 1} of ${pages}` : ""}`);
      const tr = [[H(""), H("#"), H("KPI"), H("Target"), H("Actual"), H("Ach %"), H("Status"), H("Reason / data")]];
      rows.slice(p * per, p * per + per).forEach((x) => tr.push([x.star ? { text: "★", options: { color: GOLD, align: "center" } } : "", x.no, x.text, x.target, String(x.actual || ""), x.ach != null ? x.ach + "%" : "—", ragCell(x.rag), [x.reason, x.data].filter(Boolean).join(" · ")]));
      if (tr.length === 1) tr.push(["", "", "No KPI rows entered", "", "", "", "", ""]);
      s.addTable(tr, tblOpts([0.35, 0.6, 4.1, 1.35, 1.0, 0.8, 0.95, 3.18]));
    }
    const pri = (r.priorities || []).filter(Boolean); const newActs = actions.filter((a) => a.dept === dp.id && a.week === week);
    const drv = review && (review.departments || []).find((x) => x.dept === dp.id); const ai = r.ai;
    if (pri.length || r.support || newActs.length || drv || ai) {
      const s = pptx.addSlide({ masterName: "M" });
      head(s, `${dp.name} — plan & Claude's questions`, ai ? `Claude check: ${ai.rating}${ai.score != null ? " · evidence " + ai.score + "/100" : ""}` : "Not checked by Claude");
      const lines = [];
      if (drv && (drv.questions || []).length) { lines.push(sec("Ask on Monday", RED, !lines.length)); drv.questions.forEach((x) => lines.push(bl(x))); }
      const qa = (ai && ai.flags) || [];
      const unans = qa.filter((x) => !(x.answer || "").trim());
      const ans = [...(r.clar || []), ...qa.filter((x) => (x.answer || "").trim())];
      if (unans.length) { lines.push(sec("Claude's questions not answered by HOD", RED, !lines.length)); unans.forEach((x) => lines.push(bl((x.kpiNo ? "KPI " + x.kpiNo + ": " : "") + x.question, 13))); }
      if (ans.length) { lines.push(sec("HOD's answers to Claude", INK, !lines.length)); ans.slice(0, 6).forEach((x) => lines.push(bl(`${x.kpiNo ? "KPI " + x.kpiNo + ": " : ""}${x.question} → ${x.answer}`, 12))); }
      if (drv && (drv.suggestions || []).length) { lines.push(sec("Suggestions", INK, !lines.length)); drv.suggestions.forEach((x) => lines.push(bl(x))); }
      if (pri.length) { lines.push(sec("Top priorities", INK, !lines.length)); pri.forEach((x) => lines.push(bl(x))); }
      if (newActs.length) { lines.push(sec("Actions for Red KPIs", INK, !lines.length)); newActs.forEach((a) => lines.push(bl(`${a.kpiNo ? "KPI " + a.kpiNo + ": " : ""}${a.action} — ${a.owner || "owner?"}, by ${a.due ? fmtShort(a.due) : "date?"}`))); }
      if (r.support) { lines.push(sec("Support needed", INK, !lines.length)); lines.push({ text: r.support, options: { fontSize: 14, breakLine: true } }); }
      bullets(s, lines);
    }
  });

  // Red KPIs across the group
  const reds = [];
  ds.forEach((dp) => { const r = results[dp.id]; if (!r) return; Object.values(r.rows || {}).forEach((x) => { if ((x.rag || ragOf(x.ach)) === "R") reds.push([dp.name, x.no, x.text, x.target, String(x.actual || ""), x.ach != null ? x.ach + "%" : "—", x.reason || ""]); }); });
  for (let p = 0; p < Math.max(1, Math.ceil(reds.length / 10)); p++) {
    const s = pptx.addSlide({ masterName: "M" });
    head(s, "Red KPIs across the group", reds.length ? `${reds.length} KPIs below 80% of target — each needs an owner, action and date` : "No Red KPIs reported this week");
    if (reds.length) s.addTable([[H("Department"), H("#"), H("KPI"), H("Target"), H("Actual"), H("Ach %"), H("Reason")], ...reds.slice(p * 10, p * 10 + 10)], tblOpts([1.8, 0.6, 4.0, 1.4, 1.0, 0.8, 2.73]));
  }

  // Pending points
  const acts = actions.filter((a) => a.status !== "Done").sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  for (let p = 0; p < Math.max(1, Math.ceil(acts.length / 11)); p++) {
    const s = pptx.addSlide({ masterName: "M" }); const od = acts.filter((a) => a.due && a.due < today).length;
    head(s, "Pending points — action tracker", acts.length ? `${acts.length} open actions · ${od} overdue` : "No open actions");
    if (acts.length) s.addTable([[H("Department"), H("KPI"), H("Action"), H("Owner"), H("Due"), H("Status")], ...acts.slice(p * 11, p * 11 + 11).map((a) => {
      const late = a.due && a.due < today;
      return [(depts[a.dept] || {}).name || a.dept, a.kpiNo || "", a.action, a.owner || "", { text: a.due ? fmtShort(a.due) + (late ? " · overdue" : "") : "—", options: late ? { color: RED, bold: true } : {} }, a.status];
    })], tblOpts([1.8, 0.7, 5.3, 1.8, 1.4, 1.33]));
  }
  return pptx;
}
