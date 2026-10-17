// The WhatsApp KPI chatbot — ONE KPI AT A TIME, like the app:
// the HOD sees the pending KPIs, picks one (or goes in order), sends the figure (count or %), the reason / next step
// and any proof (photo, PDF, voice). Claude then checks THAT KPI — reading the photo/PDF — and asks its questions
// in Malayalam. When they are answered the KPI is done, and the bot moves to the next pending one.
// The HOD can stop any time and continue another day; everything is saved as they go.
import {
  addDays, buildDepts, fmt, isManual, istToday, itemsFor, mapResult, meetingWeek, RAG_ML, statusOf, filesOf, kindOf, KIND_ML,
  weekRange, resultFrom, answerKind, kpiHash, kpiState, progressOf, kpiCheckInput,
} from "./core.js";
import { checkKpi } from "./ai.ts";
import { sendText, downloadMedia } from "./wa.ts";
import { getSettings, ppt } from "./jobs.ts";
// deno-lint-ignore-file no-explicit-any
type Db = any;
export type Media = { id: string; mime: string; filename?: string; voice?: boolean };

const WORDS = {
  start: ["start", "kpi", "report", "hi", "hello", "hai", "തുടങ്ങുക", "തുടങ്ങാം", "ഹായ്", "റിപ്പോർട്ട്"],
  menu: ["menu", "list", "pending", "ലിസ്റ്റ്", "ബാക്കി"],
  all: ["all", "restart", "edit", "എല്ലാം", "വീണ്ടും"],
  ok: ["ok", "okay", "yes", "go", "ശരി", "next"],
  skip: ["skip", "ഒഴിവാക്കുക", "-", "later"],
  back: ["back", "മുമ്പത്തെ", "പിന്നോട്ട്"],
  stop: ["stop", "pause", "നിർത്തുക"],
  status: ["status", "നില"],
  help: ["help", "സഹായം", "?"],
  none: ["no", "nil", "none", "ഇല്ല", "വേണ്ട", "na", "n/a"],
};
const is = (t: string, k: keyof typeof WORDS) => WORDS[k].includes(t);
// Status is locked to the achievement %: colour words are not an answer.
const RAG_WORDS = new Set(["g", "green", "പച്ച", "a", "amber", "മഞ്ഞ", "r", "red", "ചുവപ്പ്", "yes", "no", "done", "ok"]);

const HELP = "*സഹായം*\nMENU – ബാക്കിയുള്ള KPI ലിസ്റ്റ്\n(നമ്പർ) – ലിസ്റ്റിൽ നിന്ന് ഒരു KPI തിരഞ്ഞെടുക്കാൻ\nSKIP – ഈ KPI പിന്നീട്\nBACK – മുമ്പത്തെ KPI\nSTATUS – എത്ര പൂർത്തിയായി\nSTOP – നിർത്താൻ (പിന്നീട് START)\nALL – പൂർത്തിയായവ മാറ്റാൻ\n\nതെളിവായി ഫോട്ടോ / PDF / ശബ്ദ സന്ദേശം അയക്കാം. Claude ഫോട്ടോയും PDF-ഉം വായിക്കും.";

/** Reads a WhatsApp answer for a KPI: count or % (also "46/48"), the rest is the note. */
export function parseAnswer(text: string, item: any) {
  const t = text.trim();
  const first = t.split(/[\s,.:;\-]+/)[0].toLowerCase();
  if (RAG_WORDS.has(first)) return { kind: "colour" as const };
  const r = resultFrom(item, t);
  if (!r) return { kind: "none" as const };
  const m = t.replace(/rs\.?\s*/ig, "").match(/(\d[\d,]*(?:\.\d+)?)\s*(?:\/|of|out of)\s*(\d[\d,]*(?:\.\d+)?)|-?\d[\d,]*(?:\.\d+)?/i);
  const note = m ? t.replace(/rs\.?\s*/ig, "").replace(m[0], "").replace(/^[\s,.:;%\-]+/, "").trim() : "";
  return { kind: "number" as const, actual: r.actual, ach: r.ach, note };
}

const ASK_REASON = (no: string, rag: string) => `KPI ${no}: ${RAG_ML[rag] || ""}\n*കാരണം* എന്താണ്? ടൈപ്പ് ചെയ്യുക, അല്ലെങ്കിൽ ഫോട്ടോ / PDF / ശബ്ദ സന്ദേശം അയക്കുക.`;
const ASK_NEXT = (no: string) => `KPI ${no}: *അടുത്ത നടപടി* എന്താണ്? (എന്ത്, ആര്, എപ്പോൾ)\nഉദാ: Perumbavoor-ൽ 2 staff കൂടി, Manager Rajesh, 25 Oct-നകം`;
const ASK_PRI = "*അടുത്ത ആഴ്ചയിലെ 3 പ്രധാന മുൻഗണനകൾ* (optional)\nഓരോന്നും പ്രതീക്ഷിക്കുന്ന നമ്പറോടെ, ഓരോ വരിയിൽ ഒന്ന്. വേണ്ടെങ്കിൽ SKIP.";
const ASK_SUP = "*സഹായം വേണോ?*\nCEO-യിൽ നിന്നോ മറ്റ് വകുപ്പുകളിൽ നിന്നോ എന്ത് സഹായം വേണം? ഇല്ലെങ്കിൽ ‘ഇല്ല’.";

function askKpi(item: any, n: number, total: number, row: any) {
  let s = `*KPI ${item.no}${item.star ? " ★" : ""}* (${n}/${total})\n${item.text}\nലക്ഷ്യം: *${item.target}*`;
  if (row && (row.actual || row.ach != null)) s += `\nഇപ്പോൾ: ${row.actual || ""}${row.ach != null ? " → " + row.ach + "%" : ""}${filesOf(row).length ? " · 📎 " + filesOf(row).length : ""}`;
  s += answerKind(item) === "pct"
    ? `\n\n${isManual(item) ? "എത്ര ശതമാനം പൂർത്തിയായി?" : "ഈ ആഴ്ചയിലെ ശതമാനം?"} അയക്കുക (ഉദാ: 92) — അല്ലെങ്കിൽ എണ്ണം: 46/48`
    : "\n\nഈ ആഴ്ചയിലെ കണക്ക് (എണ്ണം / തുക) അയക്കുക (ഉദാ: 1420).";
  s += "\nകൂടെ ഫോട്ടോ / PDF തെളിവ് അയക്കാം. നിറം തനിയെ വരും 🔒";
  return s;
}

/** Handles one incoming WhatsApp message (text and/or a voice note, photo or document) from a registered person. */
export async function handleMessage(db: Db, profile: any, textIn: string, media: Media | null = null) {
  const text = (textIn || "").trim();
  const cmd = text.toLowerCase();
  const reply = (s: string) => sendText(db, profile.phone, s);

  // ---------- Admin / viewer: short commands only ----------
  if (profile.role !== "hod" || !profile.dept_id) {
    if (profile.role === "admin" && cmd === "ppt") {
      await reply("ഈ ആഴ്ചയിലെ PPT തയ്യാറാക്കുന്നു… ഒരു മിനിറ്റ്.");
      const r = await ppt(db, meetingWeek(istToday()), { to: [profile.phone], makeReview: false });
      if (!r.sent.length) await reply("PPT തയ്യാറായി, പക്ഷേ WhatsApp-ൽ അയക്കാനായില്ല. ഡൗൺലോഡ്: " + r.link);
      return;
    }
    if (profile.role === "admin" && cmd === "status") {
      const week = meetingWeek(istToday());
      const st = await getSettings(db);
      const [{ data: dRows }, { data: kRows }, { data: res }] = await Promise.all([
        db.from("departments").select("*").order("sort_order"), db.from("kpis").select("*"), db.from("results").select("*").eq("week", week),
      ]);
      const depts = buildDepts(dRows || [], kRows || []);
      const lines = (dRows || []).map((d: any) => {
        const r = (res || []).find((x: any) => x.dept_id === d.id);
        const pg = progressOf(depts[d.id], r ? r.rows : {}, st.bot_scope);
        return `${pg.complete ? "✓" : pg.done ? "…" : "✗"} ${d.name} · ${pg.done}/${pg.total}${r && r.score != null ? " · " + r.score + "%" : ""}`;
      });
      await reply(`*${weekRange(week)} · HOD നില*\n${lines.join("\n")}`);
      return;
    }
    await reply(profile.role === "admin" ? "Admin commands:\nPPT – ഈ ആഴ്ചയിലെ PPT\nSTATUS – HOD-മാരുടെ നില" : "KPI റിപ്പോർട്ട് HOD-മാർക്ക് മാത്രമാണ്.");
    return;
  }

  // ---------- HOD ----------
  const week = meetingWeek(istToday());
  const [{ data: dRow }, { data: kRows }, { data: rRow }, { data: sess }, st] = await Promise.all([
    db.from("departments").select("*").eq("id", profile.dept_id).maybeSingle(),
    db.from("kpis").select("*").eq("dept_id", profile.dept_id),
    db.from("results").select("*").eq("week", week).eq("dept_id", profile.dept_id).maybeSingle(),
    db.from("wa_sessions").select("*").eq("phone", profile.phone).maybeSingle(),
    getSettings(db),
  ]);
  if (!dRow) { await reply("നിങ്ങളുടെ വകുപ്പ് കണ്ടെത്താനായില്ല. Admin-നെ അറിയിക്കുക."); return; }
  const dept = buildDepts([dRow], kRows || [])[profile.dept_id];
  const res = rRow ? mapResult(rRow) : { week, dept: profile.dept_id, status: "draft", rows: {}, priorities: [], support: "", source: "whatsapp" } as any;
  const byId: Record<string, any> = Object.fromEntries(dept.items.map((i: any) => [i.id, i]));
  const scope = st.bot_scope;
  const prog = () => progressOf(dept, res.rows, scope);

  let s: any = sess && sess.week === week ? { ...sess } : null;
  const saveSession = async () => {
    await db.from("wa_sessions").upsert({ phone: profile.phone, user_id: profile.id, dept_id: profile.dept_id, week, step: s.step, idx: s.idx, items: s.items, sub: s.sub ?? null, updated_at: new Date().toISOString() });
  };
  /** Saves one KPI row (merged into the week's sheet; the app's edits to other KPIs are untouched). */
  const saveRow = async (id: string, row: any) => {
    const it = byId[id];
    const full = { ...row, no: it.no, text: it.text, target: it.target, star: !!it.star, kraNo: it.kraNo, freq: it.freq, files: filesOf(row), updated_at: new Date().toISOString() };
    delete full.rag;
    res.rows[id] = full;
    const { error } = await db.rpc("save_kpi", { p_week: week, p_dept: profile.dept_id, p_kpi: id, p_row: full, p_source: "whatsapp", p_complete: prog().complete });
    if (error) throw new Error(error.message);
  };
  const cur = () => (s && s.step === "kpi" ? s.items[s.idx] : null);

  // proof from WhatsApp → storage → this KPI
  const storeMedia = async (folder: string) => {
    const m = media!;
    const { bytes, mime } = await downloadMedia(m.id);
    if (bytes.length > 16 * 1024 * 1024) throw new Error("file too big");
    const type = mime || m.mime || "application/octet-stream";
    const kind = m.voice ? "voice" : kindOf(type);
    const ext = (type.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
    const name = (m.filename || `${kind}-whatsapp.${ext}`).replace(/[^\w.\-]+/g, "_").slice(-60);
    const path = `${week}/${profile.dept_id}/${folder}/${Date.now()}-${name}`;
    const up = await db.storage.from("evidence").upload(path, bytes, { contentType: type, upsert: false });
    if (up.error) throw new Error(up.error.message);
    return { path, name, type, size: bytes.length, kind, at: new Date().toISOString(), via: "whatsapp" };
  };
  const attach = async (id: string) => {
    try {
      const meta = await storeMedia(id);
      const old = res.rows[id] || { actual: "", ach: null };
      await saveRow(id, { ...old, files: [...filesOf(old), meta] });
      return meta.kind as "voice" | "photo" | "file";
    } catch (e) { console.error("attach failed", e); await reply("ഫയൽ സേവ് ചെയ്യാനായില്ല. വീണ്ടും അയക്കുക, അല്ലെങ്കിൽ ടൈപ്പ് ചെയ്യുക."); return null; }
  };

  // ---------- screens ----------
  const showMenu = async (all = false) => {
    const pg = prog();
    const list = all ? pg.list : pg.pending;
    s = { step: "menu", idx: 0, items: list.map((x: any) => x.item.id), sub: all ? "all" : null };
    await saveSession();
    if (!list.length) {
      if (pg.total) return reply(`*${dept.name}* · ${weekRange(week)}\nഎല്ലാ ${pg.total} KPI-കളും പൂർത്തിയായി ✓ നന്ദി!\nമാറ്റം വേണമെങ്കിൽ ALL അയക്കുക.`);
      return reply("ഈ ആഴ്ച നിങ്ങൾക്ക് KPI ഇല്ല.");
    }
    const lines = list.map((x: any, i: number) => `${i + 1}. ${x.state === "done" ? "✓ " : ""}KPI ${x.item.no}${x.item.star ? "★" : ""} – ${x.item.text.slice(0, 48)}${x.item.text.length > 48 ? "…" : ""}`);
    return reply(`നമസ്കാരം ${profile.full_name || ""}.\n*${dept.name}* · ${weekRange(week)} · ${pg.done}/${pg.total} പൂർത്തിയായി\nശനിയാഴ്ച 5 PM-ന് മുമ്പ് തീർക്കുക.\n\n*${all ? "എല്ലാ KPI" : "ബാക്കിയുള്ള KPI"}:*\n${lines.join("\n")}\n\nഒരു KPI തിരഞ്ഞെടുക്കാൻ അതിന്റെ *നമ്പർ* അയക്കുക, ക്രമത്തിൽ പോകാൻ *OK*.`);
  };
  const openKpi = async (id: string) => {
    const pg = prog(); const pos = pg.list.findIndex((x: any) => x.item.id === id);
    s = { step: "kpi", idx: Math.max(0, s && s.items ? s.items.indexOf(id) : 0), items: s && s.items && s.items.includes(id) ? s.items : [id], sub: null };
    await saveSession();
    return reply(askKpi(byId[id], pos + 1, pg.total, res.rows[id]));
  };
  const nextPending = async () => {
    const pg = prog();
    if (pg.complete || !pg.pending.length) {
      if (!(res.priorities || []).some(Boolean)) { s = { step: "plan", idx: 0, items: [], sub: "pri" }; await saveSession(); return reply(`🎉 എല്ലാ KPI-കളും പൂർത്തിയായി (${pg.done}/${pg.total}). റിപ്പോർട്ട് സമർപ്പിച്ചു ✓\n\n${ASK_PRI}`); }
      s = { step: "done", idx: 0, items: [], sub: null }; await saveSession();
      return reply(`🎉 എല്ലാ KPI-കളും പൂർത്തിയായി (${pg.done}/${pg.total}). റിപ്പോർട്ട് സമർപ്പിച്ചു ✓ നന്ദി!`);
    }
    // keep going through the chosen list, else any pending KPI
    const order: string[] = (s && s.items && s.items.length ? s.items : pg.pending.map((x: any) => x.item.id));
    const nextId = order.find((id) => kpiState(res.rows[id]) !== "done") || pg.pending[0].item.id;
    s = { step: "kpi", idx: order.includes(nextId) ? order.indexOf(nextId) : 0, items: order.includes(nextId) ? order : [nextId], sub: null };
    await saveSession();
    const pos = pg.list.findIndex((x: any) => x.item.id === nextId);
    return reply(askKpi(byId[nextId], pos + 1, pg.total, res.rows[nextId]));
  };
  /** Claude checks this one KPI (reads its photos / PDFs) and asks its questions. */
  const runCheck = async (id: string) => {
    const it = byId[id]; const row = res.rows[id];
    await reply(`Claude KPI ${it.no} പരിശോധിക്കുന്നു${filesOf(row).length ? " (തെളിവും വായിക്കുന്നു)" : ""}…`);
    const earlier = [...(row.qa || []), ...((row.ai && row.ai.questions) || []).filter((q: any) => (q.answer || "").trim()).map((q: any) => ({ q: q.q, a: q.answer }))];
    try {
      const out = await checkKpi({ deptName: dept.name, hod: dept.hod, week: weekRange(week), kpi: kpiCheckInput(it, row), earlier, storage: db.storage, files: filesOf(row) });
      const next = { ...row, qa: earlier.slice(-10), ai: { ...out, at: new Date().toISOString() } };
      next.ai.hash = kpiHash(next);
      await saveRow(id, next);
    } catch (e) {
      console.error("claude check failed", e);
      // don't block the HOD: keep the KPI, mark it done without Claude; the MD office sees "not checked"
      const skipped: any = { ...row, done: true, ai: { verdict: "skipped", summary: "", proof: null, questions: [], at: new Date().toISOString() } };
      skipped.ai.hash = kpiHash(skipped);
      await saveRow(id, skipped);
      await reply(`Claude പരിശോധന ഇപ്പോൾ നടന്നില്ല. KPI ${it.no} സേവ് ചെയ്തു (MD ഓഫീസ് പിന്നീട് നോക്കും).`);
      return nextPending();
    }
    const ai = res.rows[id].ai;
    let msg = `*Claude · KPI ${it.no}*\n${ai.summary || ""}`;
    if (ai.proof) msg += `\n📎 ${ai.proof.read ? (ai.proof.count != null ? `തെളിവിൽ: *${ai.proof.count}*${ai.proof.matches === true ? " ✓ ശരി" : ai.proof.matches === false ? " ✗ കണക്കുമായി ചേരുന്നില്ല" : ""}` : "തെളിവ് വായിച്ചു") : "തെളിവ് വായിക്കാനായില്ല"}${ai.proof.note ? "\n" + ai.proof.note : ""}`;
    if (!(ai.questions || []).length) {
      await saveRow(id, { ...res.rows[id], done: true });
      await reply(msg + `\n\n✓ KPI ${it.no} പൂർത്തിയായി (${prog().done}/${prog().total}).`);
      return nextPending();
    }
    s.sub = "q:0"; await saveSession();
    await reply(msg);
    return askQ(id, 0);
  };
  const askQ = (id: string, qi: number) => {
    const q = res.rows[id].ai.questions[qi]; const n = res.rows[id].ai.questions.length;
    return reply(`*ചോദ്യം ${qi + 1}/${n}*${q.severity === "high" ? " (മറുപടി നിർബന്ധം)" : " (വേണ്ടെങ്കിൽ SKIP)"}\n${q.q}`);
  };
  /** After the figure (and reason / next step when Amber or Red) — move to the Claude check. */
  const afterFigure = async (id: string) => {
    const row = res.rows[id]; const st = kpiState(row);
    if (st === "need-reason") { s.sub = "reason"; await saveSession(); return reply(ASK_REASON(byId[id].no, statusOf(row))); }
    if (st === "need-next") { s.sub = "next"; await saveSession(); return reply(ASK_NEXT(byId[id].no)); }
    return runCheck(id);
  };

  // ---------- global commands ----------
  if (!media) {
    if (is(cmd, "help")) return reply(HELP);
    if (is(cmd, "status")) { const pg = prog(); return reply(`${dept.name} · ${weekRange(week)}\n${pg.done}/${pg.total} KPI പൂർത്തിയായി${pg.complete ? " ✓ സമർപ്പിച്ചു" : ` · ${pg.pending.length} ബാക്കി`}\nലിസ്റ്റിന് MENU.`); }
    if (is(cmd, "menu") || (is(cmd, "start") && (!s || ["menu", "done", "idle", "invited", "paused"].includes(s.step)))) return showMenu(false);
    if (is(cmd, "all")) return showMenu(true);
    if (is(cmd, "stop")) { if (s) { s.sub = s.step + "|" + (s.sub || ""); s.step = "paused"; await saveSession(); } return reply("ശരി, നിർത്തി. എല്ലാം സേവ് ചെയ്തിട്ടുണ്ട്. തുടരാൻ START അയക്കുക. ശനിയാഴ്ച 5 PM-ന് മുമ്പ് തീർക്കുക."); }
  }
  if (!s || ["invited", "idle", "paused"].includes(s.step)) return showMenu(false);

  // ---------- menu: pick a KPI ----------
  if (s.step === "menu") {
    if (media) return reply("ആദ്യം ഒരു KPI തിരഞ്ഞെടുക്കുക (നമ്പർ അയക്കുക), എന്നിട്ട് തെളിവ് അയക്കുക.");
    const n = parseInt(cmd, 10);
    if (Number.isFinite(n) && n >= 1 && n <= s.items.length && /^\d+$/.test(cmd)) return openKpi(s.items[n - 1]);
    if (is(cmd, "ok") || is(cmd, "start")) return s.items.length ? openKpi(s.items[0]) : showMenu(false);
    return reply(`ലിസ്റ്റിലെ ഒരു നമ്പർ (1–${s.items.length}) അയക്കുക, അല്ലെങ്കിൽ OK.`);
  }

  // ---------- one KPI ----------
  if (s.step === "kpi") {
    const id = cur(); const it = id ? byId[id] : null;
    if (!it) return showMenu(false);
    const sub = String(s.sub || "");
    if (!media && is(cmd, "back")) { s.sub = null; s.idx = Math.max(0, s.idx - 1); await saveSession(); return openKpi(s.items[s.idx]); }
    if (!media && is(cmd, "skip") && !sub.startsWith("q:")) { s.sub = null; s.idx++; await saveSession(); if (s.idx >= s.items.length) return showMenu(false); return openKpi(s.items[s.idx]); }

    // Claude's questions
    if (sub.startsWith("q:")) {
      const qi = parseInt(sub.slice(2), 10) || 0; const row = res.rows[id]; const q = row.ai && row.ai.questions[qi];
      if (!q) { await saveRow(id, { ...row, done: true }); return nextPending(); }
      if (media) {
        const kind = await attach(id); if (!kind) return;
        res.rows[id].ai.questions[qi].answer = text || `(${KIND_ML[kind]} ചേർത്തു)`;
        res.rows[id].ai.hash = kpiHash(res.rows[id]); // proof added as an answer, not a change of figure
      } else if (is(cmd, "skip")) {
        if (q.severity === "high") return reply("ഈ ചോദ്യത്തിന് മറുപടി നിർബന്ധമാണ്. ചുരുക്കി എഴുതിയാൽ മതി, അല്ലെങ്കിൽ ഫോട്ടോ / PDF അയക്കുക.");
      } else res.rows[id].ai.questions[qi].answer = text;
      await saveRow(id, res.rows[id]);
      if (qi + 1 < row.ai.questions.length) { s.sub = "q:" + (qi + 1); await saveSession(); return askQ(id, qi + 1); }
      await saveRow(id, { ...res.rows[id], done: true });
      s.sub = null; await saveSession();
      await reply(`✓ KPI ${it.no} പൂർത്തിയായി (${prog().done}/${prog().total}). നന്ദി.`);
      return nextPending();
    }
    if (sub === "reason") {
      const row = res.rows[id] || {};
      if (media) { const kind = await attach(id); if (!kind) return; if (text || !(row.reason || "").trim()) await saveRow(id, { ...res.rows[id], reason: text || `(${KIND_ML[kind]} ചേർത്തു)` }); }
      else await saveRow(id, { ...row, reason: text });
      return afterFigure(id);
    }
    if (sub === "next") {
      if (media) { const kind = await attach(id); if (!kind) return; await saveRow(id, { ...res.rows[id], next: text || `(${KIND_ML[kind]} ചേർത്തു)` }); }
      else await saveRow(id, { ...res.rows[id], next: text });
      return afterFigure(id);
    }
    // the figure
    if (media) {
      const kind = await attach(id); if (!kind) return;
      const a0 = text ? parseAnswer(text, it) : { kind: "none" as const };
      if (a0.kind !== "number") return reply(`📎 ${KIND_ML[kind]} KPI ${it.no}-ൽ ചേർത്തു. ഇനി ${answerKind(it) === "pct" ? "ശതമാനം (ഉദാ: 92) അല്ലെങ്കിൽ എണ്ണം (46/48)" : "ഈ ആഴ്ചയിലെ കണക്ക്"} അയക്കുക.`);
    }
    const a = parseAnswer(text, it);
    if (a.kind === "colour") return reply(`നിറം / Yes-No വേണ്ട — ${answerKind(it) === "pct" ? "ശതമാനം (ഉദാ: 92) അല്ലെങ്കിൽ എണ്ണം (46/48)" : "എണ്ണം / തുക (ഉദാ: 1420)"} അയക്കുക. നിറം തനിയെ വരും 🔒`);
    if (a.kind !== "number") return reply(answerKind(it) === "pct" ? "മനസ്സിലായില്ല. ശതമാനം (ഉദാ: 92) അല്ലെങ്കിൽ എണ്ണം (46/48) അയക്കുക. പിന്നീട് ചെയ്യാൻ SKIP." : "ഒരു നമ്പർ അയക്കുക (ഉദാ: 1420). പിന്നീട് ചെയ്യാൻ SKIP.");
    const old = res.rows[id] || {};
    const row: any = { ...old, actual: a.actual, ach: a.ach, done: false };
    delete row.data;
    const rag = statusOf(row);
    if (a.note) { if ((rag === "A" || rag === "R") && !(old.reason || "").trim()) row.reason = a.note; else row.reason = [old.reason, a.note].filter(Boolean).join(" · "); }
    await saveRow(id, row);
    await reply(`✓ KPI ${it.no}: ${row.actual}${row.ach != null ? " → " + row.ach + "%" : ""} ${RAG_ML[rag] || ""} 🔒`);
    return afterFigure(id);
  }

  // ---------- optional plan for next week ----------
  if (s.step === "plan") {
    if (media) return reply("ഇവിടെ ടൈപ്പ് ചെയ്ത് മറുപടി അയക്കുക.");
    if (s.sub === "pri") {
      res.priorities = is(cmd, "skip") || is(cmd, "none") ? ["", "", ""] : text.split(/\n|;/).map((x) => x.replace(/^\s*[\d.)\-•*]+\s*/, "").trim()).filter(Boolean).slice(0, 3);
      while (res.priorities.length < 3) res.priorities.push("");
      await db.from("results").update({ priorities: res.priorities }).eq("week", week).eq("dept_id", profile.dept_id);
      s.sub = "sup"; await saveSession(); return reply(ASK_SUP);
    }
    res.support = is(cmd, "skip") || is(cmd, "none") ? "" : text;
    await db.from("results").update({ support: res.support }).eq("week", week).eq("dept_id", profile.dept_id);
    s = { step: "done", idx: 0, items: [], sub: null }; await saveSession();
    return reply("നന്ദി! ഈ ആഴ്ചത്തെ റിപ്പോർട്ട് പൂർത്തിയായി ✓\nമാറ്റം വേണമെങ്കിൽ ALL അയക്കുക, അല്ലെങ്കിൽ ആപ്പ് തുറക്കുക.");
  }
  if (s.step === "done") {
    if (media) return reply("റിപ്പോർട്ട് പൂർത്തിയായി. ഒരു KPI-ൽ തെളിവ് ചേർക്കാൻ ALL അയച്ച് ആ KPI തിരഞ്ഞെടുക്കുക.");
    return reply(`ഈ ആഴ്ചത്തെ റിപ്പോർട്ട് പൂർത്തിയായി ✓ (${prog().done}/${prog().total}). മാറ്റം വേണമെങ്കിൽ ALL അയക്കുക.`);
  }
  return showMenu(false);
}

/** Week key helpers exported for tests. */
export const currentWeek = () => meetingWeek(istToday());
export const lastWeek = () => addDays(meetingWeek(istToday()), -7);
export { itemsFor, fmt };
