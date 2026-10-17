// The Saturday jobs: kickoff, reminder, MD review, PPT to WhatsApp.
// Used by the weekly-jobs function (schedule + admin buttons) and by the WhatsApp bot (admin "PPT" command).
import PptxGenJS from "npm:pptxgenjs@4.0.1";
import { buildDeck } from "./ppt-builder.js";
import { deptListOf, fmt, repeatReds, reviewDepartments, weekRange } from "./core.js";
import { loadWeek, logJob } from "./data.ts";
import { reviewWeek } from "./ai.ts";
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

/** Saturday morning: invite every HOD on WhatsApp to start this week's report. */
export async function kickoff(db: Db, week: string, onlyPending = false) {
  const st = await getSettings(db);
  const { data: depts } = await db.from("departments").select("id, name");
  const { data: res } = await db.from("results").select("dept_id, status").eq("week", week);
  // deno-lint-ignore no-explicit-any
  const done = new Set((res || []).filter((r: any) => r.status === "submitted").map((r: any) => r.dept_id));
  const sent: string[] = [], failed: string[] = [];
  for (const p of await hods(db)) {
    if (onlyPending && done.has(p.dept_id)) continue;
    // deno-lint-ignore no-explicit-any
    const dn = (depts || []).find((d: any) => d.id === p.dept_id)?.name || p.dept_id;
    try {
      await sendTemplate(db, p.phone, st.tpl_start, st.tpl_lang, [p.full_name || "HOD", dn, weekRange(week)]);
      if (!onlyPending) await db.from("wa_sessions").upsert({ phone: p.phone, user_id: p.id, dept_id: p.dept_id, week, step: "invited", idx: 0, items: [], sub: null, updated_at: new Date().toISOString() });
      sent.push(dn);
    } catch (e) { failed.push(`${dn}: ${(e as Error).message}`); }
  }
  const detail = `${onlyPending ? "Reminder" : "Kickoff"} sent to ${sent.length}: ${sent.join(", ")}${failed.length ? ` · failed ${failed.length}: ${failed.join("; ")}` : ""}`;
  await logJob(db, onlyPending ? "remind" : "kickoff", week, failed.length === 0, detail);
  return { sent, failed };
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
  const deck = buildDeck(PptxGenJS, d);
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
  const total = deptListOf(d.depts).length;
  // deno-lint-ignore no-explicit-any
  const submitted = Object.values(d.results).filter((r: any) => r.status === "submitted").length;
  const sent: string[] = [], failed: string[] = [];
  for (const n of to) {
    try { await sendTemplate(db, n, st.tpl_report, st.tpl_lang, [weekRange(week), `${submitted}/${total}`], { link, filename }); sent.push(n); }
    catch (e) { failed.push(`${n}: ${(e as Error).message}`); }
  }
  await logJob(db, "ppt", week, failed.length === 0 && (to.length === 0 || sent.length > 0),
    `${submitted}/${total} submitted · sent to ${sent.length} number(s)${to.length === 0 ? " (no numbers in Settings)" : ""}${failed.length ? ` · failed: ${failed.join("; ")}` : ""}`);
  return { link, filename, sent, failed, submitted, total };
}
