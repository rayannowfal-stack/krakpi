// The WhatsApp KPI chatbot. Asks a HOD each weekly KPI, records the answer in the app,
// then asks Claude's clarification questions (in Malayalam) and records those answers too.
import {
  addDays, buildDepts, calcAch, FREQ_ML, fmt, hasValue, isManual, istToday, itemsFor, mapResult, meetingWeek,
  RAG_ML, ragOf, RATING_ML, rowsHash, summarize, weekRange, checkRows, missingHeadline,
} from "./core.js";
import { checkSheet } from "./ai.ts";
import { sendText } from "./wa.ts";
import { getSettings, ppt } from "./jobs.ts";
// deno-lint-ignore-file no-explicit-any
type Db = any;

const WORDS = {
  start: ["start", "kpi", "report", "hi", "hello", "hai", "തുടങ്ങുക", "തുടങ്ങാം", "ഹായ്", "റിപ്പോർട്ട്"],
  restart: ["restart", "വീണ്ടും", "വീണ്ടും തുടങ്ങുക"],
  skip: ["skip", "ഒഴിവാക്കുക", "-", "next"],
  back: ["back", "മുമ്പത്തെ", "പിന്നോട്ട്"],
  stop: ["stop", "pause", "നിർത്തുക", "later"],
  status: ["status", "നില"],
  help: ["help", "സഹായം", "?"],
  none: ["no", "nil", "none", "ഇല്ല", "വേണ്ട", "na", "n/a"],
};
const is = (t: string, k: keyof typeof WORDS) => WORDS[k].includes(t);
const RAG_WORDS: Record<string, string> = { g: "G", green: "G", "പച്ച": "G", a: "A", amber: "A", "മഞ്ഞ": "A", r: "R", red: "R", "ചുവപ്പ്": "R" };

const HELP = "*സഹായം*\nSTART – റിപ്പോർട്ട് തുടങ്ങാൻ / തുടരാൻ\nSKIP – ഈ ചോദ്യം ഒഴിവാക്കാൻ\nBACK – മുമ്പത്തെ ചോദ്യം\nSTATUS – എത്ര പൂർത്തിയായി\nSTOP – പിന്നീട് തുടരാൻ\nRESTART – ആദ്യം മുതൽ മാറ്റാൻ";

/** Reads a WhatsApp answer: the first number is the figure; the rest is the note. */
export function parseAnswer(text: string, manual: boolean) {
  const t = text.trim();
  const first = t.split(/[\s,.:;\-]+/)[0].toLowerCase();
  if (manual && RAG_WORDS[first]) {
    return { kind: "rag", rag: RAG_WORDS[first], note: t.slice(t.split(/[\s,.:;\-]+/)[0].length).replace(/^[\s,.:;\-]+/, "").trim() };
  }
  const m = t.replace(/rs\.?\s*/ig, "").match(/-?\d[\d,]*(\.\d+)?/);
  if (!m) return { kind: "none" as const };
  const value = m[0].replace(/,/g, "");
  const note = t.replace(/rs\.?\s*/ig, "").replace(m[0], "").replace(/^[\s,.:;%\-]+/, "").trim();
  return { kind: "number" as const, value, note };
}

function askKpi(item: any, i: number, n: number, row: any) {
  let s = `*${i + 1}/${n} · KPI ${item.no}${item.star ? " ★" : ""}*\n${item.text}\nലക്ഷ്യം: ${item.target} (${FREQ_ML[item.freq] || item.freq})`;
  if (hasValue(row)) s += `\nഇപ്പോൾ: ${row.actual || (row.ach != null ? row.ach + "%" : RAG_ML[row.rag] || "")} — മാറ്റമില്ലെങ്കിൽ SKIP`;
  s += isManual(item)
    ? "\n\nഈ ആഴ്ചയിലെ ഫലം അയക്കുക: % (ഉദാ: 92) അല്ലെങ്കിൽ G / A / R. കൂടെ ഡാറ്റ എഴുതാം."
    : "\n\nഈ ആഴ്ചയിലെ യഥാർത്ഥ കണക്ക് അയക്കുക. കൂടെ ഡാറ്റ എഴുതാം (ഉദാ: 1420, billing report).";
  return s;
}
const askFlag = (f: any, i: number, n: number) =>
  `*Claude-ന്റെ ചോദ്യം ${i + 1}/${n}*${f.kpiNo ? " · KPI " + f.kpiNo : ""}${f.severity === "high" ? " (മറുപടി നിർബന്ധം)" : ""}\n${f.question}`;
const ASK_PRI = "*അടുത്ത ആഴ്ചയിലെ 3 പ്രധാന മുൻഗണനകൾ*\nഓരോന്നും പ്രതീക്ഷിക്കുന്ന നമ്പറോടെ, ഓരോ വരിയിൽ ഒന്ന്.\nഉദാ: Perumbavoor conversion 75% ആക്കുക";
const ASK_SUP = "*സഹായം വേണോ?*\nCEO-യിൽ നിന്നോ മറ്റ് വകുപ്പുകളിൽ നിന്നോ എന്ത് സഹായം വേണം? ഇല്ലെങ്കിൽ ‘ഇല്ല’ എന്ന് അയക്കുക.";

/** Handles one incoming WhatsApp text from a registered person. */
export async function handleMessage(db: Db, profile: any, textIn: string) {
  const text = (textIn || "").trim();
  const cmd = text.toLowerCase();
  const reply = (s: string) => sendText(db, profile.phone, s);

  // Admin / viewer: short commands only
  if (profile.role !== "hod" || !profile.dept_id) {
    if (profile.role === "admin" && cmd === "ppt") {
      await reply("ഈ ആഴ്ചയിലെ PPT തയ്യാറാക്കുന്നു… ഒരു മിനിറ്റ്.");
      const r = await ppt(db, meetingWeek(istToday()), { to: [profile.phone], makeReview: false });
      if (!r.sent.length) await reply("PPT തയ്യാറായി, പക്ഷേ WhatsApp-ൽ അയക്കാനായില്ല. ഡൗൺലോഡ്: " + r.link);
      return;
    }
    if (profile.role === "admin" && cmd === "status") {
      const week = meetingWeek(istToday());
      const { data: depts } = await db.from("departments").select("id, name, sort_order").order("sort_order");
      const { data: res } = await db.from("results").select("dept_id, status, score").eq("week", week);
      const lines = (depts || []).map((d: any) => {
        const r = (res || []).find((x: any) => x.dept_id === d.id);
        return `${r && r.status === "submitted" ? "✓" : r ? "…" : "✗"} ${d.name}${r && r.score != null ? " · " + r.score + "%" : ""}`;
      });
      await reply(`*${weekRange(week)} · സമർപ്പണ നില*\n${lines.join("\n")}`);
      return;
    }
    await reply(profile.role === "admin" ? "Admin commands:\nPPT – ഈ ആഴ്ചയിലെ PPT\nSTATUS – ആരൊക്കെ സമർപ്പിച്ചു" : "KPI റിപ്പോർട്ട് HOD-മാർക്ക് മാത്രമാണ്.");
    return;
  }

  // HOD
  const week = meetingWeek(istToday());
  const [{ data: dRow }, { data: kRows }, { data: rRow }, { data: sess }] = await Promise.all([
    db.from("departments").select("*").eq("id", profile.dept_id).maybeSingle(),
    db.from("kpis").select("*").eq("dept_id", profile.dept_id),
    db.from("results").select("*").eq("week", week).eq("dept_id", profile.dept_id).maybeSingle(),
    db.from("wa_sessions").select("*").eq("phone", profile.phone).maybeSingle(),
  ]);
  if (!dRow) { await reply("നിങ്ങളുടെ വകുപ്പ് കണ്ടെത്താനായില്ല. Admin-നെ അറിയിക്കുക."); return; }
  const dept = buildDepts([dRow], kRows || [])[profile.dept_id];
  const res = rRow ? mapResult(rRow) : { week, dept: profile.dept_id, status: "draft", rows: {}, priorities: [], support: "", ai: null, clar: [], source: "whatsapp" } as any;
  const byId: Record<string, any> = Object.fromEntries(dept.items.map((i: any) => [i.id, i]));

  let s: any = sess && sess.week === week ? { ...sess } : null;
  const save = async () => {
    const sm = summarize(res.rows);
    const { error } = await db.from("results").upsert({
      week, dept_id: profile.dept_id, status: res.status, rows: res.rows, priorities: res.priorities, support: res.support,
      score: sm.score, counts: sm.counts, ai: res.ai, clar: res.clar, source: "whatsapp", updated_by: profile.id, updated_at: new Date().toISOString(),
    }, { onConflict: "week,dept_id" });
    if (error) throw new Error(error.message);
  };
  const saveSession = async () => {
    s.updated_at = new Date().toISOString();
    await db.from("wa_sessions").upsert({ phone: profile.phone, user_id: profile.id, dept_id: profile.dept_id, week, step: s.step, idx: s.idx, items: s.items, sub: s.sub ?? null, updated_at: s.updated_at });
  };
  const start = async (fromBeginning: boolean) => {
    const st = await getSettings(db);
    let items = itemsFor(dept, false);
    if (st.bot_scope === "headline") items = items.filter((i: any) => i.star);
    s = { step: "kpi", idx: 0, items: items.map((i: any) => i.id), sub: null };
    if (!s.items.length) { s.step = "priorities"; }
    else if (!fromBeginning) { const first = s.items.findIndex((id: string) => !hasValue(res.rows[id])); s.idx = first < 0 ? s.items.length : first; }
    if (res.status === "submitted" && fromBeginning) { res.status = "draft"; await save(); }
    await saveSession();
    await reply(`നമസ്കാരം ${profile.full_name || ""}.\n*${dept.name}* – ഈ ആഴ്ചയിലെ KPI റിപ്പോർട്ട് (${weekRange(week)}, മീറ്റിംഗ് ${fmt(week)}).\n${s.items.length} KPI. ഓരോന്നിനും ഈ ആഴ്ചയിലെ കണക്ക് അയക്കുക.\nSKIP · BACK · STOP · HELP`);
    await askCurrent();
  };
  const askCurrent = async () => {
    if (s.step === "kpi") {
      if (s.idx >= s.items.length) { s.step = "priorities"; s.idx = 0; await saveSession(); return reply(ASK_PRI); }
      const it = byId[s.items[s.idx]];
      if (!it) { s.idx++; return askCurrent(); }
      if (s.sub === "reason") return reply(`KPI ${it.no}: ${RAG_ML[res.rows[it.id]?.rag || ragOf(res.rows[it.id]?.ach)] || ""}\nകാരണവും പരിഹാര നടപടിയും (എന്ത്, ആര്, എപ്പോൾ) എഴുതുക.`);
      return reply(askKpi(it, s.idx, s.items.length, res.rows[it.id]));
    }
    if (s.step === "priorities") return reply(ASK_PRI);
    if (s.step === "support") return reply(ASK_SUP);
    if (s.step === "clarify") { const fl = res.ai?.flags || []; return reply(askFlag(fl[s.idx], s.idx, fl.length)); }
  };
  const runCheck = async () => {
    await reply("നന്ദി. Claude നിങ്ങളുടെ റിപ്പോർട്ട് പരിശോധിക്കുന്നു… ഒരു മിനിറ്റ്.");
    // keep earlier answers as clarifications, so Claude doesn't ask them again
    for (const f of res.ai?.flags || []) if ((f.answer || "").trim() && !res.clar.some((c: any) => c.question === f.question)) res.clar.push({ kpiNo: f.kpiNo, question: f.question, answer: f.answer, at: new Date().toISOString() });
    try {
      const out = await checkSheet({
        deptName: dept.name, hod: dept.hod, week: weekRange(week), meeting: fmt(week),
        rows: checkRows(dept, res.rows), missing: missingHeadline(dept, res.rows), priorities: res.priorities, support: res.support,
        clarifications: res.clar.map((c: any) => ({ kpi: c.kpiNo, q: c.question, a: c.answer })),
      }, 5);
      res.ai = { ...out, at: new Date().toISOString(), hash: rowsHash(res.rows), flags: out.flags.map((f) => ({ ...f, answer: "" })) };
      await save();
    } catch (e) {
      console.error("claude check failed", e);
      await reply("Claude പരിശോധന ഇപ്പോൾ നടന്നില്ല. റിപ്പോർട്ട് സമർപ്പിക്കുന്നു; MD ഓഫീസ് പിന്നീട് പരിശോധിക്കും.");
      return finish();
    }
    if (!res.ai.flags.length) return finish();
    s.step = "clarify"; s.idx = 0; await saveSession();
    await reply(`Claude-ന് ${res.ai.flags.length} ചോദ്യങ്ങളുണ്ട്. ഓരോന്നിനും മറുപടി അയക്കുക.`);
    return askCurrent();
  };
  const finish = async () => {
    res.status = "submitted"; await save();
    s.step = "done"; s.idx = 0; await saveSession();
    const sm = summarize(res.rows);
    let msg = `*റിപ്പോർട്ട് സമർപ്പിച്ചു. നന്ദി.*\n${dept.name} · ${weekRange(week)}\nസ്കോർ ${sm.score != null ? sm.score + "%" : "—"} · Green ${sm.counts.G} · Amber ${sm.counts.A} · Red ${sm.counts.R}`;
    if (res.ai) msg += `\nClaude വിലയിരുത്തൽ: ${RATING_ML[res.ai.rating] || res.ai.rating}${res.ai.score != null ? ` (${res.ai.score}/100)` : ""}`;
    if (res.ai?.suggestions?.length) msg += `\n\n*നിർദ്ദേശങ്ങൾ*\n${res.ai.suggestions.map((x: string) => "• " + x).join("\n")}`;
    msg += "\n\nമാറ്റം വേണമെങ്കിൽ RESTART അയക്കുക, അല്ലെങ്കിൽ ആപ്പ് തുറക്കുക.";
    return reply(msg);
  };

  // ---- global commands ----
  if (is(cmd, "help")) return reply(HELP);
  if (is(cmd, "restart")) return start(true);
  if (is(cmd, "status")) {
    const items = itemsFor(dept, false); const done = items.filter((i: any) => hasValue(res.rows[i.id])).length;
    return reply(`${dept.name} · ${weekRange(week)}\n${done}/${items.length} KPI പൂർത്തിയായി · ${res.status === "submitted" ? "സമർപ്പിച്ചു" : "സമർപ്പിച്ചിട്ടില്ല"}`);
  }
  if (!s || s.step === "invited" || s.step === "idle") return start(false);
  if (s.step === "paused") { s.step = s.sub || "kpi"; s.sub = null; await saveSession(); await reply("തുടരാം."); return askCurrent(); }
  if (s.step === "done") {
    if (is(cmd, "start")) return reply(`ഈ ആഴ്ചത്തെ റിപ്പോർട്ട് ഇതിനകം സമർപ്പിച്ചു (${summarize(res.rows).score ?? "—"}%). മാറ്റം വേണമെങ്കിൽ RESTART അയക്കുക.`);
    return reply("ഈ ആഴ്ചത്തെ റിപ്പോർട്ട് സമർപ്പിച്ചു. മാറ്റം വേണമെങ്കിൽ RESTART അയക്കുക. സഹായത്തിന് HELP.");
  }
  if (is(cmd, "stop")) { s.sub = s.step; s.step = "paused"; await saveSession(); return reply("ശരി, നിർത്തി. തുടരാൻ എപ്പോൾ വേണമെങ്കിലും START അയക്കുക. ശനിയാഴ്ച 4:30-ന് മുമ്പ് പൂർത്തിയാക്കുക."); }
  if (is(cmd, "start")) return askCurrent();

  // ---- step answers ----
  if (s.step === "kpi") {
    const id = s.items[s.idx]; const it = byId[id];
    if (!it) { s.idx++; await saveSession(); return askCurrent(); }
    if (is(cmd, "back")) { s.sub = null; s.idx = Math.max(0, s.idx - 1); await saveSession(); return askCurrent(); }
    if (s.sub === "reason") {
      if (is(cmd, "skip")) { s.sub = null; s.idx++; await saveSession(); return askCurrent(); }
      res.rows[id] = { ...res.rows[id], reason: text }; await save();
      s.sub = null; s.idx++; await saveSession();
      return askCurrent();
    }
    if (is(cmd, "skip")) { s.idx++; await saveSession(); return askCurrent(); }
    const a = parseAnswer(text, isManual(it));
    const base = { no: it.no, text: it.text, target: it.target, star: !!it.star, kraNo: it.kraNo, freq: it.freq };
    const old = res.rows[id] || {};
    let row: any;
    if (a.kind === "rag") row = { ...old, ...base, actual: old.actual || "", ach: old.ach ?? null, rag: a.rag };
    else if (a.kind === "number") {
      const ach = isManual(it) ? Math.min(Math.round(parseFloat(a.value)), 120) : calcAch(it, a.value);
      row = { ...old, ...base, actual: isManual(it) ? old.actual || "" : a.value, ach, rag: "" };
    } else {
      return reply(isManual(it) ? "മനസ്സിലായില്ല. % (ഉദാ: 92) അല്ലെങ്കിൽ G / A / R അയക്കുക. ഒഴിവാക്കാൻ SKIP." : "ഒരു നമ്പർ അയക്കുക (ഉദാ: 1420). ഒഴിവാക്കാൻ SKIP.");
    }
    const rag = row.rag || ragOf(row.ach);
    if (a.note) { if (rag === "A" || rag === "R") row.reason = a.note; else row.data = a.note; }
    res.rows[id] = row; await save();
    const got = `✓ KPI ${it.no}: ${row.actual ? row.actual + " → " : ""}${row.ach != null ? row.ach + "% " : ""}${RAG_ML[rag] || ""}`;
    if ((rag === "A" || rag === "R") && !row.reason) {
      s.sub = "reason"; await saveSession();
      return reply(`${got}\nകാരണവും പരിഹാര നടപടിയും (എന്ത്, ആര്, എപ്പോൾ) എഴുതുക.`);
    }
    s.idx++; await saveSession();
    await reply(got);
    return askCurrent();
  }
  if (s.step === "priorities") {
    res.priorities = is(cmd, "skip") || is(cmd, "none") ? ["", "", ""] : text.split(/\n|;/).map((x) => x.replace(/^\s*[\d.)\-•*]+\s*/, "").trim()).filter(Boolean).slice(0, 3);
    while (res.priorities.length < 3) res.priorities.push("");
    await save(); s.step = "support"; await saveSession();
    return askCurrent();
  }
  if (s.step === "support") {
    res.support = is(cmd, "skip") || is(cmd, "none") ? "" : text;
    await save(); s.step = "checking"; await saveSession();
    return runCheck();
  }
  if (s.step === "checking") return reply("Claude ഇപ്പോഴും പരിശോധിക്കുന്നു… കുറച്ച് സമയം കാത്തിരിക്കുക.");
  if (s.step === "clarify") {
    const fl = res.ai?.flags || []; const f = fl[s.idx];
    if (!f) return finish();
    if (is(cmd, "skip")) {
      if (f.severity === "high") return reply("ഈ ചോദ്യത്തിന് മറുപടി നിർബന്ധമാണ്. ചുരുക്കി എഴുതിയാൽ മതി.");
    } else { f.answer = text; await save(); }
    s.idx++; await saveSession();
    if (s.idx >= fl.length) return finish();
    return askCurrent();
  }
  return start(false);
}

/** Week key helper exported for tests. */
export const currentWeek = () => meetingWeek(istToday());
export const lastWeek = () => addDays(meetingWeek(istToday()), -7);
