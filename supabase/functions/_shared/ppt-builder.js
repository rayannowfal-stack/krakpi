// Builds the weekly HOD review deck — colourful, with charts, KPI tiles, the HODs' proof photos and links to their files.
// Used by the app ("Make PPT" / a HOD's "My PPT") and by the Saturday 5 PM job, so all produce the same format.
import { RAGN, statusOf, filesOf, kindOf, summarize, fmt, fmtShort, weekRange, deptListOf, progressOf } from "./core.js";

const INK = "12343B", GOLD = "C9962E", MUT = "5A6B6F", LINE = "D9E1DE", TXT = "13262B", WHITE = "FFFFFF";
const ST = { G: { bg: "E3F5EA", fg: "1E7A48", solid: "2EAD5B" }, A: { bg: "FFF1D6", fg: "9A6412", solid: "F2A93B" }, R: { bg: "FBE3E1", fg: "B23434", solid: "E05A4F" }, "": { bg: "EEF2F1", fg: "5A6B6F", solid: "9AA7A9" } };
// one bright accent per department, so every department has its own colour through the deck
const ACCENTS = ["E4572E", "1B9AAA", "F2A93B", "6A4C93", "2E86AB", "D1495B", "3BB273", "EDAE49", "00798C", "8E5572"];
const FONT = "Calibri", FONT_ML = "Nirmala UI"; // Nirmala UI shows Malayalam on Windows; other systems fall back
const VERD = { ok: ["✓ Clear", "G"], doubt: ["? Needs clarity", "A"], weak: ["✗ Weak / not proved", "R"], skipped: ["Not checked", ""] };
const clean = (s, n = 400) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * @param PptxGenJS the PptxGenJS class
 * @param d { week, depts, results, prev, actions, review, today, proofs?: {path: dataUrl}, links?: {path: url}, single?: bool, scope? }
 */
export function buildDeck(PptxGenJS, d) {
  const { week, depts, results, actions, review, today } = d;
  const proofs = d.proofs || {}, links = d.links || {}, single = !!d.single, scope = d.scope || "weekly";
  const pptx = new PptxGenJS(); pptx.layout = "LAYOUT_WIDE"; pptx.title = "HOD Review " + week;
  const ds = deptListOf(depts);
  const accent = (id) => ACCENTS[Math.max(0, ds.findIndex((x) => x.id === id)) % ACCENTS.length];

  pptx.defineSlideMaster({
    title: "M", background: { color: "FAFBFA" }, objects: [
      { rect: { x: 0, y: 7.2, w: 13.33, h: 0.3, fill: { color: INK } } },
      { text: { text: "Atlas Maharani Group · Weekly HOD Review · " + fmt(week), options: { x: 0.5, y: 7.2, w: 9, h: 0.3, fontSize: 9, color: "C9D6D3", fontFace: FONT } } }],
    slideNumber: { x: 12.4, y: 7.2, w: 0.6, h: 0.3, fontSize: 9, color: "C9D6D3" },
  });
  /** A slide with a coloured band on top. */
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
  const H = (t, color = INK) => ({ text: t, options: { bold: true, color: WHITE, fill: { color }, fontSize: 11 } });
  const tbl = (s, rows, colW, y = 1.45, fontSize = 10) => s.addTable(rows, { x: 0.5, y, w: 12.33, colW, fontSize, fontFace: FONT, color: TXT, border: { type: "solid", pt: 0.5, color: LINE }, valign: "middle", margin: 0.06, autoPage: false });
  const ragCell = (rag) => { const c = ST[rag || ""]; return { text: rag ? "● " + RAGN[rag] : "—", options: { bold: true, fill: { color: c.bg }, color: c.fg, align: "center" } }; };
  const ml = (t, o = {}) => ({ text: clean(t, 700), options: { fontFace: FONT_ML, fontSize: 13, breakLine: true, ...o } });
  const sec = (t, color = INK) => ({ text: t, options: { bold: true, fontSize: 15, color, breakLine: true, paraSpaceBefore: 8, fontFace: FONT } });
  const bl = (t, o = {}) => ({ text: clean(t, 600), options: { bullet: { code: "25CF" }, fontSize: 13, breakLine: true, fontFace: FONT_ML, ...o } });

  // ---------- title ----------
  const t = pptx.addSlide(); t.background = { color: INK };
  ACCENTS.slice(0, 6).forEach((c, i) => t.addShape(pptx.ShapeType.rect, { x: 8.6 + i * 0.78, y: 0, w: 0.78, h: 7.5, fill: { color: c, transparency: 10 + i * 6 } }));
  t.addShape(pptx.ShapeType.rect, { x: 0.8, y: 4.35, w: 3.2, h: 0.08, fill: { color: GOLD } });
  t.addText("ATLAS MAHARANI GROUP", { x: 0.8, y: 1.3, w: 7.6, h: 0.4, fontSize: 14, color: "F2C66D", bold: true, charSpacing: 4, fontFace: FONT });
  t.addText(single && ds[0] ? ds[0].name : "Weekly HOD Review", { x: 0.8, y: 1.8, w: 7.6, h: 1.3, fontSize: 46, color: WHITE, bold: true, fontFace: FONT, fit: "shrink" });
  t.addText(`${single ? "KPI results" : "KRA & KPI results"} · week ${weekRange(week)}`, { x: 0.8, y: 3.15, w: 7.6, h: 0.5, fontSize: 20, color: "E4ECEA", fontFace: FONT });
  t.addText(`Monday meeting ${fmt(week)}${single && ds[0] && ds[0].hod ? " · HOD " + ds[0].hod : ""}`, { x: 0.8, y: 3.7, w: 7.6, h: 0.4, fontSize: 15, color: "A9BCBF", fontFace: FONT });

  // ---------- group snapshot (charts) + scoreboard ----------
  const info = ds.map((dp) => {
    const r = results[dp.id]; const sm = r ? summarize(r.rows) : { score: null, counts: { G: 0, A: 0, R: 0 }, rag: "none" };
    const pg = progressOf(dp, r ? r.rows : {}, scope);
    return { dp, r, sm, pg };
  });
  if (!single) {
    const tot = { G: 0, A: 0, R: 0 }; const scores = [];
    info.forEach((x) => { for (const k in tot) tot[k] += x.sm.counts[k]; if (x.sm.score != null) scores.push(x.sm.score); });
    const grp = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    const doneN = info.filter((x) => x.pg.complete).length;
    const s = slide("Group snapshot", `${doneN} of ${ds.length} HODs finished · group score ${grp != null ? grp + "%" : "—"} · ${tot.G} Green · ${tot.A} Amber · ${tot.R} Red`);
    const labels = info.map((x) => x.dp.name);
    const by = (k) => info.map((x) => (x.sm.score != null && (x.sm.rag === k) ? x.sm.score : 0));
    s.addText("Department score (% of target)", { x: 0.5, y: 1.4, w: 7.4, h: 0.35, fontSize: 14, bold: true, color: INK, fontFace: FONT });
    s.addChart(pptx.ChartType.bar, [{ name: "Green", labels, values: by("G") }, { name: "Amber", labels, values: by("A") }, { name: "Red", labels, values: by("R") }],
      { x: 0.4, y: 1.75, w: 7.6, h: 5.25, barDir: "bar", barGrouping: "stacked", chartColors: [ST.G.solid, ST.A.solid, ST.R.solid], valAxisMaxVal: 120, valAxisMinVal: 0,
        showValue: true, dataLabelFormatCode: "0;;;", dataLabelColor: WHITE, dataLabelFontBold: true, showLegend: false, catAxisLabelFontSize: 11, valAxisLabelFontSize: 9, catAxisOrientation: "maxMin" });
    s.addText("All KPIs this week", { x: 8.3, y: 1.4, w: 4.5, h: 0.35, fontSize: 14, bold: true, color: INK, fontFace: FONT });
    s.addChart(pptx.ChartType.doughnut, [{ name: "KPIs", labels: ["Green", "Amber", "Red"], values: [tot.G, tot.A, tot.R] }],
      { x: 8.3, y: 1.75, w: 4.5, h: 3.6, holeSize: 58, chartColors: [ST.G.solid, ST.A.solid, ST.R.solid], showPercent: true, showLegend: true, legendPos: "b", dataLabelColor: WHITE, dataLabelFontBold: true });
    s.addShape(pptx.ShapeType.roundRect, { x: 8.3, y: 5.5, w: 2.15, h: 1.4, fill: { color: INK }, rectRadius: 0.12 });
    s.addText([{ text: grp != null ? grp + "%" : "—", options: { fontSize: 30, bold: true, color: "F2C66D", breakLine: true } }, { text: "group score", options: { fontSize: 11, color: WHITE } }], { x: 8.3, y: 5.5, w: 2.15, h: 1.4, align: "center", valign: "middle", fontFace: FONT });
    s.addShape(pptx.ShapeType.roundRect, { x: 10.65, y: 5.5, w: 2.15, h: 1.4, fill: { color: doneN === ds.length ? ST.G.solid : ST.A.solid }, rectRadius: 0.12 });
    s.addText([{ text: `${doneN}/${ds.length}`, options: { fontSize: 30, bold: true, color: WHITE, breakLine: true } }, { text: "HODs done", options: { fontSize: 11, color: WHITE } }], { x: 10.65, y: 5.5, w: 2.15, h: 1.4, align: "center", valign: "middle", fontFace: FONT });

    // scoreboard: one coloured tile per department
    const b = slide("Department scoreboard", "Score, KPIs finished, and Claude's view of the proof — tap through the next slides for each department");
    const cols = 4, tw = 2.95, th = 2.65;
    info.forEach((x, i) => {
      const cx = 0.5 + (i % cols) * (tw + 0.18), cy = 1.45 + Math.floor(i / cols) * (th + 0.18); if (cy > 6.5) return;
      const ac = accent(x.dp.id);
      b.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: tw, h: th, fill: { color: WHITE }, line: { color: LINE }, rectRadius: 0.1, shadow: { type: "outer", blur: 4, offset: 1.5, angle: 90, color: "000000", opacity: 0.12 } });
      b.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: tw, h: 0.55, fill: { color: ac } });
      b.addText(x.dp.name, { x: cx + 0.12, y: cy, w: tw - 0.24, h: 0.55, fontSize: 14, bold: true, color: WHITE, valign: "middle", fontFace: FONT, fit: "shrink" });
      b.addText(x.sm.score != null ? x.sm.score + "%" : "—", { x: cx + 0.12, y: cy + 0.6, w: 1.6, h: 0.75, fontSize: 30, bold: true, color: (ST[x.sm.rag] || ST[""]).fg, fontFace: FONT });
      b.addText(`${x.pg.done}/${x.pg.total}\nKPIs done`, { x: cx + 1.6, y: cy + 0.65, w: tw - 1.72, h: 0.7, fontSize: 11, color: MUT, align: "right", fontFace: FONT });
      const c = x.sm.counts;
      pill(b, `${c.G} G`, cx + 0.12, cy + 1.45, 0.85, "G"); pill(b, `${c.A} A`, cx + 1.05, cy + 1.45, 0.85, "A"); pill(b, `${c.R} R`, cx + 1.98, cy + 1.45, 0.85, "R");
      const t2 = tally(x.r);
      b.addText(`Claude: ${t2.ok} clear · ${t2.doubt} doubt · ${t2.weak} weak${t2.mismatch ? `\n📎 ${t2.mismatch} proof ≠ figure` : ""}`, { x: cx + 0.12, y: cy + 1.88, w: tw - 0.24, h: 0.65, fontSize: 10, color: t2.mismatch ? ST.R.fg : MUT, fontFace: FONT, valign: "top" });
    });
  }

  // ---------- MD office review (Malayalam) ----------
  if (review && !single) {
    const s = slide("MD office review · Claude", "", "6A4C93");
    s.addText(clean(review.headline, 300), { x: 0.5, y: 0.6, w: 12.3, h: 0.5, fontSize: 14, color: WHITE, fontFace: FONT_ML, fit: "shrink" });
    const lines = [];
    if (review.groupView) lines.push(ml(review.groupView, { fontSize: 14, paraSpaceAfter: 6 }));
    if ((review.watchList || []).length) { lines.push(sec("ഈ ആഴ്ച ശ്രദ്ധിക്കേണ്ടവ · Watch list", "6A4C93")); review.watchList.forEach((x) => lines.push(bl(x))); }
    if ((review.crossDept || []).length) { lines.push(sec("വകുപ്പുകൾ തമ്മിൽ · Across departments", "6A4C93")); review.crossDept.forEach((x) => lines.push(bl(x))); }
    s.addText(lines, { x: 0.5, y: 1.4, w: 12.3, h: 5.6, valign: "top", color: TXT, fit: "shrink" });
    const rr = [[H("Department", "6A4C93"), H("Claude rating", "6A4C93"), H("വിലയിരുത്തൽ · verdict", "6A4C93")]];
    (review.departments || []).forEach((x) => { const k = { "Result-oriented": "G", "Partly result-oriented": "A", "Activity only": "R" }[x.rating] || ""; rr.push([(depts[x.dept] || {}).name || x.dept, { text: x.rating || "—", options: { bold: true, fill: { color: ST[k].bg }, color: ST[k].fg } }, { text: clean(x.verdict, 400), options: { fontFace: FONT_ML } }]); });
    if (rr.length > 1) { const s2 = slide("Result-oriented or just duty?", "Claude's rating of how each department reported this week", "6A4C93"); tbl(s2, rr, [2.2, 2.2, 7.93], 1.45, 11); }
  }

  // ---------- each department ----------
  const order = { R: 0, A: 1, G: 2, "": 3 };
  const empty = info.filter((x) => !x.r || !Object.keys(x.r.rows || {}).length);
  if (empty.length) {
    const s = slide(single ? ds[0].name : "Not reported yet", single ? "No KPI results this week" : `${empty.length} department${empty.length > 1 ? "s have" : " has"} not entered any KPI this week`, "B23434");
    empty.forEach((x, i) => {
      const cx = 0.5 + (i % 2) * 6.25, cy = 1.5 + Math.floor(i / 2) * 1.05;
      s.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: 6.05, h: 0.9, fill: { color: ST.R.bg }, line: { color: ST.R.bg }, rectRadius: 0.08 });
      s.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: 0.14, h: 0.9, fill: { color: accent(x.dp.id) } });
      s.addText([{ text: x.dp.name, options: { bold: true, fontSize: 16, color: TXT, breakLine: true } }, { text: `HOD ${x.dp.hod || "—"} · 0/${x.pg.total} KPIs`, options: { fontSize: 11, color: ST.R.fg } }], { x: cx + 0.3, y: cy, w: 5.6, h: 0.9, valign: "middle", fontFace: FONT });
    });
  }
  info.forEach(({ dp, r, sm, pg }) => {
    const ac = accent(dp.id);
    if (!r || !Object.keys(r.rows || {}).length) return;
    const rows = Object.entries(r.rows || {}).map(([id, x]) => ({ id, ...x, rag: statusOf(x) }))
      .sort((a, b) => order[a.rag] - order[b.rag] || (b.star ? 1 : 0) - (a.star ? 1 : 0) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
    const sub = `HOD ${dp.hod || ""} · ${pg.done}/${pg.total} KPIs done${pg.complete ? " ✓" : ""} · ${sm.counts.G} Green · ${sm.counts.A} Amber · ${sm.counts.R} Red${r.source === "whatsapp" ? " · via WhatsApp" : ""}`;

    // 1) KPI tiles — the scorecard at a glance (12 per slide)
    const per = 12;
    for (let p = 0; p < Math.ceil(rows.length / per); p++) {
      const s = slide(`${dp.name} — ${sm.score != null ? sm.score + "%" : "—"}`, sub + (rows.length > per ? ` · ${p + 1}/${Math.ceil(rows.length / per)}` : ""), ac);
      rows.slice(p * per, p * per + per).forEach((x, i) => {
        const cx = 0.5 + (i % 3) * 4.15, cy = 1.45 + Math.floor(i / 3) * 1.38; const c = ST[x.rag || ""];
        s.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: 4.0, h: 1.26, fill: { color: c.bg }, line: { color: c.bg }, rectRadius: 0.08 });
        s.addShape(pptx.ShapeType.rect, { x: cx, y: cy, w: 0.12, h: 1.26, fill: { color: c.solid } });
        s.addText(`${x.star ? "★ " : ""}${x.no}  ${clean(x.text, 80)}`, { x: cx + 0.2, y: cy + 0.04, w: 3.75, h: 0.55, fontSize: 10.5, bold: true, color: TXT, fontFace: FONT, valign: "top", fit: "shrink" });
        s.addText([{ text: x.ach != null ? x.ach + "%" : "—", options: { fontSize: 22, bold: true, color: c.fg } }, { text: `   ${clean(x.actual, 20)} vs ${clean(x.target, 24)}`, options: { fontSize: 10, color: MUT } }],
          { x: cx + 0.2, y: cy + 0.58, w: 3.75, h: 0.42, fontFace: FONT, valign: "middle" });
        const v = x.ai ? VERD[x.ai.verdict] || VERD.doubt : null; const nf = filesOf(x).length;
        s.addText(`${v ? "Claude " + v[0] : "Not checked"}${x.ai && x.ai.proof && x.ai.proof.matches === false ? " · proof ≠ figure" : ""}${nf ? `  ·  📎 ${nf}` : ""}`, { x: cx + 0.2, y: cy + 0.96, w: 3.75, h: 0.28, fontSize: 9, color: v ? ST[v[1]].fg : MUT, bold: !!(x.ai && x.ai.proof && x.ai.proof.matches === false), fontFace: FONT });
      });
    }
    // 2) Reason, next step and what Claude found — for Amber/Red and anything Claude doubted
    const why = rows.filter((x) => x.rag === "A" || x.rag === "R" || (x.ai && x.ai.verdict !== "ok" && x.ai.verdict !== "skipped") || x.reason || x.data || x.next);
    for (let p = 0; p < Math.ceil(why.length / 6); p++) {
      const s = slide(`${dp.name} — reasons & next steps`, "Why it is below target, what happens next, and what Claude read in the proof", ac);
      const tr = [[H("KPI", ac), H("Result", ac), H("Reason", ac), H("Next step", ac), H("Claude · proof", ac)]];
      why.slice(p * 6, p * 6 + 6).forEach((x) => {
        const pr = x.ai && x.ai.proof;
        tr.push([{ text: `${x.no} ${clean(x.text, 70)}`, options: { bold: true } }, ragCellText(x), { text: clean(x.reason || x.data, 220), options: { fontFace: FONT_ML } }, { text: clean(x.next, 200), options: { fontFace: FONT_ML } },
          { text: x.ai ? clean(`${(VERD[x.ai.verdict] || VERD.doubt)[0]}. ${pr ? (pr.count != null ? `Proof shows ${pr.count}${pr.matches === true ? " ✓" : pr.matches === false ? " ✗ does not match" : ""}. ` : "") + (pr.note || "") : x.ai.summary || ""}`, 260) : "Not checked",
            options: { fontFace: FONT_ML, color: pr && pr.matches === false ? ST.R.fg : TXT } }]);
      });
      tbl(s, tr, [2.9, 1.35, 2.85, 2.6, 2.63], 1.45, 10);
    }
    // 3) Proof: photos inside the deck, other files as links
    const files = rows.flatMap((x) => filesOf(x).map((f) => ({ ...f, kpi: x })));
    const pics = files.filter((f) => proofs[f.path]);
    for (let p = 0; p < Math.ceil(pics.length / 4); p++) {
      const s = slide(`${dp.name} — proof`, "Photos the HOD attached, with what Claude read in them", ac);
      pics.slice(p * 4, p * 4 + 4).forEach((f, i) => {
        const cx = 0.5 + (i % 2) * 6.25, cy = 1.4 + Math.floor(i / 2) * 2.9;
        s.addShape(pptx.ShapeType.roundRect, { x: cx, y: cy, w: 6.05, h: 2.75, fill: { color: WHITE }, line: { color: LINE }, rectRadius: 0.06 });
        s.addImage({ data: String(proofs[f.path]).replace(/^data:/, ""), x: cx + 0.1, y: cy + 0.1, w: 3.2, h: 2.55, sizing: { type: "contain", w: 3.2, h: 2.55 }, hyperlink: links[f.path] ? { url: links[f.path] } : undefined });
        const pr = f.kpi.ai && f.kpi.ai.proof;
        s.addText([{ text: `KPI ${f.kpi.no}`, options: { bold: true, fontSize: 13, color: ac, breakLine: true } }, { text: clean(f.kpi.text, 90), options: { fontSize: 10, color: TXT, breakLine: true } },
          { text: `Result: ${clean(f.kpi.actual, 20)} → ${f.kpi.ach != null ? f.kpi.ach + "%" : "—"}`, options: { fontSize: 11, bold: true, color: (ST[statusOf(f.kpi)] || ST[""]).fg, breakLine: true } },
          ...(pr ? [{ text: pr.count != null ? `Claude counted ${pr.count}${pr.matches === true ? " ✓ matches" : pr.matches === false ? " ✗ does not match" : ""}` : "Claude read it", options: { fontSize: 11, bold: true, color: pr.matches === false ? ST.R.fg : ST.G.fg, breakLine: true } },
            { text: clean(pr.note, 180), options: { fontSize: 10, color: MUT, fontFace: FONT_ML } }] : [])],
          { x: cx + 3.4, y: cy + 0.1, w: 2.55, h: 2.55, valign: "top", fontFace: FONT, fit: "shrink" });
      });
    }
    const others = files.filter((f) => !proofs[f.path]);
    if (others.length) {
      const s = slide(`${dp.name} — attached files`, "Click a file to open it (links work for 7–30 days)", ac);
      const lines = others.slice(0, 22).map((f) => {
        const k = f.kind || kindOf(f.type); const icon = k === "voice" ? "🎤" : k === "photo" ? "📷" : "📎";
        return { text: `${icon}  KPI ${f.kpi.no} · ${f.name || "file"}${f.via === "whatsapp" ? " (WhatsApp)" : ""}`, options: { fontSize: 13, breakLine: true, color: links[f.path] ? "1B6FB3" : TXT, hyperlink: links[f.path] ? { url: links[f.path] } : undefined } };
      });
      s.addText(lines, { x: 0.6, y: 1.45, w: 12.1, h: 5.5, valign: "top", fontFace: FONT, fit: "shrink" });
    }
    // 4) Claude's questions to the HOD, and the answers (Malayalam)
    const qa = rows.flatMap((x) => ((x.ai && x.ai.questions) || []).map((q) => ({ no: x.no, q: q.q, a: q.answer })));
    const drv = review && (review.departments || []).find((x) => x.dept === dp.id);
    const pri = (r.priorities || []).filter(Boolean);
    {
      const lines = [];
      if (drv && (drv.questions || []).length) { lines.push(sec("തിങ്കളാഴ്ച ചോദിക്കേണ്ടത് · Ask on Monday", ST.R.fg)); drv.questions.forEach((x) => lines.push(bl(x))); }
      if (qa.length) {
        lines.push(sec("Claude-ന്റെ ചോദ്യങ്ങൾ, HOD-ന്റെ മറുപടി", ac));
        qa.slice(0, 8).forEach((x) => { lines.push(bl(`KPI ${x.no}: ${x.q}`, { bold: true, fontSize: 12 })); lines.push({ text: "→ " + (clean(x.a, 300) || "മറുപടി ഇല്ല (not answered)"), options: { fontSize: 12, breakLine: true, indentLevel: 1, fontFace: FONT_ML, color: x.a ? TXT : ST.R.fg } }); });
      }
      if (pri.length) { lines.push(sec("Next week's priorities", INK)); pri.forEach((x) => lines.push(bl(x))); }
      if (r.support) { lines.push(sec("Support needed", INK)); lines.push(ml(r.support)); }
      const s = lines.length ? slide(`${dp.name} — Claude's questions & next week`, "", ac) : null;
      if (s) s.addText(lines, { x: 0.5, y: 1.4, w: 12.3, h: 5.65, valign: "top", color: TXT, fit: "shrink" });
    }
  });

  // ---------- Red KPIs across the group ----------
  if (!single) {
    const reds = [];
    ds.forEach((dp) => { const r = results[dp.id]; if (!r) return; Object.values(r.rows || {}).forEach((x) => { if (statusOf(x) === "R") reds.push([{ text: dp.name, options: { bold: true, color: accent(dp.id) } }, x.no, clean(x.text, 90), clean(x.actual, 20) + " / " + clean(x.target, 20), { text: x.ach != null ? x.ach + "%" : "—", options: { bold: true, color: ST.R.fg } }, { text: clean(x.reason || x.data, 160), options: { fontFace: FONT_ML } }, { text: clean(x.next, 160), options: { fontFace: FONT_ML } }]); }); });
    for (let p = 0; p < Math.max(1, Math.ceil(reds.length / 8)); p++) {
      const s = slide("Red KPIs across the group", reds.length ? `${reds.length} KPIs below 80% of target — each needs an owner, action and date` : "No Red KPIs this week 🎉", "B23434");
      if (reds.length) tbl(s, [[H("Department", "B23434"), H("#", "B23434"), H("KPI", "B23434"), H("Result / target", "B23434"), H("Ach", "B23434"), H("Reason", "B23434"), H("Next step", "B23434")], ...reds.slice(p * 8, p * 8 + 8)], [1.6, 0.55, 3.3, 1.5, 0.7, 2.4, 2.28]);
    }
  }

  // ---------- pending points ----------
  const acts = actions.filter((a) => a.status !== "Done" && (!single || depts[a.dept])).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  for (let p = 0; p < Math.max(1, Math.ceil(acts.length / 10)); p++) {
    const od = acts.filter((a) => a.due && a.due < today).length;
    const s = slide("Pending points — action tracker", acts.length ? `${acts.length} open actions · ${od} overdue` : "No open actions", "00798C");
    if (acts.length) tbl(s, [[H("Department", "00798C"), H("KPI", "00798C"), H("Action", "00798C"), H("Owner", "00798C"), H("Due", "00798C"), H("Status", "00798C")], ...acts.slice(p * 10, p * 10 + 10).map((a) => {
      const late = a.due && a.due < today;
      return [{ text: (depts[a.dept] || {}).name || a.dept, options: { bold: true, color: accent(a.dept) } }, a.kpiNo || "", { text: clean(a.action, 200), options: { fontFace: FONT_ML } }, a.owner || "", { text: a.due ? fmtShort(a.due) + (late ? " · overdue" : "") : "—", options: late ? { color: ST.R.fg, bold: true } : {} }, a.status];
    })], [1.8, 0.7, 5.3, 1.8, 1.4, 1.33]);
  }
  return pptx;

  function ragCellText(x) { const c = ST[x.rag || ""]; return { text: `${clean(x.actual, 18)}\n${x.ach != null ? x.ach + "%" : "—"} ${x.rag ? RAGN[x.rag] : ""}`, options: { bold: true, fill: { color: c.bg }, color: c.fg, align: "center" } }; }
}

function tally(r) {
  const t = { ok: 0, doubt: 0, weak: 0, mismatch: 0 };
  Object.values((r && r.rows) || {}).forEach((x) => { if (!x.ai || !t.hasOwnProperty(x.ai.verdict)) return; t[x.ai.verdict]++; if (x.ai.proof && x.ai.proof.matches === false) t.mismatch++; });
  return t;
}
