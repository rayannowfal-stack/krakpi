// The Saturday jobs: kickoff, reminder, MD review, PPT to WhatsApp.
// Used by the weekly-jobs function (schedule + admin buttons) and by the WhatsApp bot (admin "PPT" command).
import PptxGenJS from "npm:pptxgenjs@4.0.1";
import { buildDeck } from "./ppt-builder.js";
import { deptListOf, fmt, repeatReds, reviewDepartments, weekRange, progressOf, filesOf, kindOf, buildDepts } from "./core.js";
import { loadWeek, logJob } from "./data.ts";
import { reviewWeek, b64 } from "./ai.ts";
import { sendTemplate } from "./wa.ts";
// deno-lint-ignore no-explicit-any
type Db = any;

export async function getSettings(db: Db) {
  const { data } = await db.from("app_settings").select("*").eq("id", 1).maybeSingle();
  return data || { report_numbers: [], bot_scope: "weekly", tpl_start: "kpi_weekly_start", tpl_report: "kpi_weekly_report", tpl_lang: "ml" };
}

async function hods(db: Db) {
  const { data } = await db.from("profiles").select("id, full_name, phone, role, dept_id").eq("role", "hod");
  // deno-lint-ignore no-explicit-any
  return (data || []).filter((p: any) => p.phone && p.dept_id);
}

/** Each HOD's progress this week: { [dept_id]: { name, done, total, pending } } */
async function progressAll(db: Db, week: string, scope: string) {
  const [{ data: dRows }, { data: kRows }, { data: res }] = await Promise.all([
    db.from("departments").select("*").order("sort_order"), db.from("kpis").select("*"), db.from("results").select("dept_id, rows").eq("week", week),
  ]);
  const depts = buildDepts(dRows || [], kRows || []);
  const out: Record<string, { name: string; done: number; total: number; pending: number }> = {};
  // deno-lint-ignore no-explicit-any
  for (const d of (dRows || []) as any[]) {
    // deno-lint-ignore no-explicit-any
    const r = (res || []).find((x: any) => x.dept_id === d.id);
    const pg = progressOf(depts[d.id], r ? r.rows : {}, scope);
    out[d.id] = { name: d.name, done: pg.done, total: pg.total, pending: pg.total - pg.done };
  }
  return out;
}

/** Saturday morning (and the 1:30 PM reminder): tell every HOD how many KPIs are still pending. HODs who are done get nothing. */
export async function kickoff(db: Db, week: string, onlyPending = false) {
  const st = await getSettings(db);
  const prog = await progressAll(db, week, st.bot_scope);
  const sent: string[] = [], failed: string[] = [], skipped: string[] = [];
  for (const p of await hods(db)) {
    const pg = prog[p.dept_id]; const dn = pg ? pg.name : p.dept_id;
    if (!pg || !pg.total || pg.pending === 0) { skipped.push(dn); continue; }
    try {
      await sendTemplate(db, p.phone, st.tpl_start, st.tpl_lang, [p.full_name || "HOD", dn, weekRange(week), `${pg.pending} / ${pg.total}`]);
      await db.from("wa_sessions").upsert({ phone: p.phone, user_id: p.id, dept_id: p.dept_id, week, step: "invited", idx: 0, items: [], sub: null, updated_at: new Date().toISOString() });
      sent.push(`${dn} (${pg.pending})`);
    } catch (e) { failed.push(`${dn}: ${(e as Error).message}`); }
  }
  const detail = `${onlyPending ? "Reminder" : "Kickoff"} sent to ${sent.length}: ${sent.join(", ")}${skipped.length ? ` · already done: ${skipped.join(", ")}` : ""}${failed.length ? ` · failed ${failed.length}: ${failed.join("; ")}` : ""}`;
  await logJob(db, onlyPending ? "remind" : "kickoff", week, failed.length === 0, detail);
  return { sent, failed, skipped };
}

/** Claude's MD office review for the week, saved to `reviews`. */
export async function review(db: Db, week: string, userId: string | null = null) {
  const d = await loadWeek(db, week);
  const data = await reviewWeek({ weekLabel: weekRange(week), meeting: fmt(week), repeatReds: repeatReds(d.depts, d.results, d.prev).map((x) => `${x.name} ${x.no} ${x.text}`), departments: reviewDepartments(d) });
  const { error } = await db.from("reviews").upsert({ week, data, created_by: userId, created_at: new Date().toISOString() });
  if (error) throw new Error("Review could not be saved: " + error.message);
  await logJob(db, "review", week, true, data.headline);
  return data;
}

/** Builds the deck, stores it, and sends it on WhatsApp. Returns a download link. */
export async function ppt(db: Db, week: string, opts: { to?: string[]; makeReview?: boolean } = {}) {
  let d = await loadWeek(db, week);
  if (!d.review && opts.makeReview !== false && Deno.env.get("ANTHROPIC_API_KEY")) {
    try { await review(db, week); d = await loadWeek(db, week); } catch (e) { console.error("review before ppt failed", e); }
  }
  const { proofs, links } = await proofFor(db, d.results);
  const deck = buildDeck(PptxGenJS, { ...d, proofs, links, scope: (await getSettings(db)).bot_scope });
  const bytes = await deck.write({ outputType: "uint8array" }) as Uint8Array;
  const filename = `HOD-Review-${week}.pptx`;
  const path = `${week}/${filename}`;
  const up = await db.storage.from("reports").upload(path, bytes, { upsert: true, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
  if (up.error) throw new Error("Could not store the PPT: " + up.error.message);
  const signed = await db.storage.from("reports").createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signed.error) throw new Error("Could not create the PPT link: " + signed.error.message);
  const link = signed.data.signedUrl as string;

  const st = await getSettings(db);
  const to = (opts.to && opts.to.length ? opts.to : st.report_numbers) || [];
  // HOD-wise done / not done, for the admin
  const prog = await progressAll(db, week, st.bot_scope);
  const list = Object.values(prog).filter((x) => x.total);
  const doneNames = list.filter((x) => x.pending === 0).map((x) => x.name);
  const notDone = list.filter((x) => x.pending > 0).map((x) => `${x.name} (${x.pending} ബാക്കി)`);
  const total = list.length, submitted = doneNames.length;
  const sent: string[] = [], failed: string[] = [];
  for (const n of to) {
    try { await sendTemplate(db, n, st.tpl_report, st.tpl_lang, [weekRange(week), doneNames.join(", ") || "ആരുമില്ല", notDone.join(", ") || "ഇല്ല — എല്ലാവരും പൂർത്തിയാക്കി ✓"], { link, filename }); sent.push(n); }
    catch (e) { failed.push(`${n}: ${(e as Error).message}`); }
  }
  await logJob(db, "ppt", week, failed.length === 0 && (to.length === 0 || sent.length > 0),
    `${submitted}/${total} HODs done${notDone.length ? ` · not done: ${notDone.join(", ")}` : ""} · sent to ${sent.length} number(s)${to.length === 0 ? " (no numbers in Settings)" : ""}${failed.length ? ` · failed: ${failed.join("; ")}` : ""}`);
  return { link, filename, sent, failed, submitted, total, done: doneNames, notDone };
}

/** Photos go into the deck as pictures (max 40, 4 MB each); every attachment gets a 30-day link. */
// deno-lint-ignore no-explicit-any
async function proofFor(db: Db, results: Record<string, any>) {
  const proofs: Record<string, string> = {}, links: Record<string, string> = {};
  // deno-lint-ignore no-explicit-any
  const files: any[] = [];
  // deno-lint-ignore no-explicit-any
  Object.values(results || {}).forEach((r: any) => Object.values(r.rows || {}).forEach((x) => filesOf(x).forEach((f: any) => files.push(f))));
  for (const f of files) {
    try {
      const { data } = await db.storage.from("evidence").createSignedUrl(f.path, 60 * 60 * 24 * 30);
      if (data && data.signedUrl) links[f.path] = data.signedUrl;
    } catch (_) { /* no link */ }
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
      proofs[f.path] = `data:${type};base64,${b64(bytes)}`; n++;
    } catch (_) { /* skip */ }
  }
  return { proofs, links };
}
