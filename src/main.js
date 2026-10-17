// Atlas Maharani Group · Weekly KPI Review
// Vanilla JS single-page app on Supabase (Postgres + Auth + Realtime + Edge Functions for Claude and WhatsApp).
import "./styles.css";
import PptxGenJS from "pptxgenjs";
import { supabase } from "./supabase.js";
import {
  FREQ, WEEKLY, RAGN, RATINGS, RATING_ML, addDays, fmt, fmtShort, meetingWeek, weekRange, ymd,
  calcAch, ragOf, isManual, summarize, rowsHash, itemsFor, buildDepts, deptListOf,
  mapResult, mapAction, mapProposal, repeatReds, checkRows, missingHeadline, normPhone, normUsername, userLogin,
} from "../supabase/functions/_shared/core.js";
import { buildDeck } from "../supabase/functions/_shared/ppt-builder.js";

/* ---------- helpers ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem("akr:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("akr:" + k, JSON.stringify(v)); } catch (e) {} },
};
const ROLES = { admin: "Admin", hod: "HOD", viewer: "Viewer", pending: "Pending" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (s) => document.querySelector(s);
const today = () => ymd(new Date());
const nowIso = () => new Date().toISOString();
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const TABS = { admin: ["overview", "submit", "weekly", "master", "pending", "md", "users", "settings"], viewer: ["overview", "weekly", "master", "pending", "md"], hod: ["submit", "weekly", "master", "pending"] };

/* ---------- state ---------- */
const S = {
  session: null, me: null, isAdmin: false, canWrite: false, ready: false,
  depts: {}, proposals: [], results: {}, prev: {}, actions: [], review: null, profiles: [], settings: null, jobs: [],
  week: meetingWeek(today()), tab: LS.get("tab", "overview"), dept: LS.get("dept", "sales"),
  showAll: false, weeklyDept: LS.get("wdept", "all"), masterDept: LS.get("mdept", "sales"), q: "",
  pendFilter: "open", pendDept: "all",
  form: null, formDirty: false, aiBusy: false, mdBusy: false, jobBusy: "", channel: null,
};
const deptList = () => deptListOf(S.depts);
const nameOf = (uid) => { const p = S.profiles.find((x) => x.id === uid); return p ? p.full_name || p.username || p.phone : uid ? "a team member" : ""; };
const role = () => (S.me && S.me.role) || "pending";
const hodLocked = () => role() === "hod" && S.me.dept_id;
const mayEditDept = (id) => S.isAdmin || (role() === "hod" && S.me.dept_id === id);

/* ---------- toast & modal ---------- */
let toastT;
function toast(msg) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 4000);
}
function openModal(html, onReady) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="overlay" id="ov"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  $("#ov").addEventListener("click", (e) => { if (e.target.id === "ov" || e.target.closest("[data-close]")) closeModal(); });
  onReady && onReady(root.querySelector(".modal"));
  const f = root.querySelector("input,select,textarea"); f && f.focus();
}
function closeModal() { $("#modalRoot").innerHTML = ""; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
function confirmModal(text, label, fn) {
  openModal(`<h2>${esc(text)}</h2><div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cOk">${esc(label)}</button></div>`, (m) => {
    m.querySelector("#cOk").onclick = async () => { await fn(); closeModal(); };
  });
}

/* ---------- database: read ---------- */
async function loadDepts() {
  const [{ data: ds, error: e1 }, { data: ks, error: e2 }] = await Promise.all([supabase.from("departments").select("*"), supabase.from("kpis").select("*")]);
  if (e1 || e2) { toast("Couldn't load departments: " + (e1 || e2).message); return; }
  S.depts = buildDepts(ds, ks);
}
async function loadProposals() { const { data } = await supabase.from("proposals").select("*").order("created_at", { ascending: false }); S.proposals = (data || []).map(mapProposal); }
async function loadActions() { const { data } = await supabase.from("actions").select("*").order("created_at"); S.actions = (data || []).map(mapAction); }
async function loadProfiles() { const { data } = await supabase.from("profiles").select("*").order("full_name"); S.profiles = data || []; S.me = S.profiles.find((p) => p.id === S.session.user.id) || S.me; }
async function loadResults() {
  const w = S.week, pw = addDays(w, -7);
  const { data } = await supabase.from("results").select("*").in("week", [w, pw]);
  if (w !== S.week) return;
  const cur = {}, prev = {};
  (data || []).forEach((r) => { const x = mapResult(r); (x.week === w ? cur : prev)[x.dept] = x; });
  S.results = cur; S.prev = prev;
}
async function loadReview() {
  if (!["admin", "viewer"].includes(role())) { S.review = null; return; }
  const { data } = await supabase.from("reviews").select("*").eq("week", S.week).maybeSingle();
  S.review = data ? { ...data.data, at: data.created_at } : null;
}
async function loadAdmin() {
  if (!S.isAdmin) return;
  const [{ data: st }, { data: jobs }] = await Promise.all([
    supabase.from("app_settings").select("*").eq("id", 1).maybeSingle(),
    supabase.from("job_runs").select("*").order("at", { ascending: false }).limit(15),
  ]);
  S.settings = st; S.jobs = jobs || [];
}
async function loadAll() { await Promise.all([loadDepts(), loadProposals(), loadActions(), loadProfiles(), loadResults(), loadReview(), loadAdmin()]); }

function subscribe() {
  if (S.channel) supabase.removeChannel(S.channel);
  const pending = new Set(); let t;
  const loaders = { departments: loadDepts, kpis: loadDepts, proposals: loadProposals, actions: loadActions, results: loadResults, reviews: loadReview, profiles: loadProfiles, job_runs: loadAdmin };
  S.channel = supabase.channel("kpi-live").on("postgres_changes", { event: "*", schema: "public" }, (p) => {
    pending.add(p.table); clearTimeout(t);
    t = setTimeout(async () => {
      const fns = [...new Set([...pending].map((x) => loaders[x]).filter(Boolean))]; pending.clear();
      await Promise.all(fns.map((f) => f()));
      if (S.tab === "submit" && S.formDirty) return;
      if (S.tab === "submit") S.form = null;
      if (!S.aiBusy && !S.mdBusy && !document.querySelector(".overlay")) render();
    }, 400);
  }).subscribe();
}

/* ---------- database: write ---------- */
async function run(promise, okMsg) {
  const { error } = await promise;
  if (error) {
    const msg = /row-level security|permission/i.test(error.message) ? "You don't have permission to change this. Ask the admin to check your role and department." : error.message;
    toast("Couldn't save: " + msg); return false;
  }
  okMsg && toast(okMsg); return true;
}
const kpiRow = (deptId, i) => ({ id: i.id, dept_id: deptId, kra_no: i.kraNo, kra: i.kra || "", kra_weight: i.kraW || 0, no: i.no, text: i.text, target: i.target,
  tv: i.tv, dir: i.dir, freq: i.freq, owner: i.owner, star: !!i.star, updated_at: nowIso() });
async function callFn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); msg = j.error || msg; } catch (e) {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

/* ---------- sign in: username + password (no email at all) ---------- */
function showLogin() {
  $("#bar").hidden = true;
  $("#main").innerHTML = `<div class="login"><form class="card" id="loginForm" novalidate>
    <div><span class="ai-tag">Atlas Maharani Group</span><h1>Weekly KPI Review</h1></div>
    <p class="note">Sign in with the username and password the admin gave you.</p>
    <label class="f">Username<input class="inp" id="lid" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required value="${esc(LS.get("lid", ""))}" placeholder="e.g. jayan"></label>
    <label class="f">Password<input class="inp" id="lpw" type="password" autocomplete="current-password" required></label>
    <p class="note" id="lerr" role="alert" hidden></p>
    <button class="btn primary" type="submit" id="lbtn">Sign in</button>
    <p class="note">Forgot your password? Ask the admin to reset it.</p>
  </form></div>`;
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#lid").value.trim(), pw = $("#lpw").value, err = $("#lerr");
    const username = normUsername(id);
    if (!username) { err.textContent = id ? "Username has no spaces — letters and numbers only." : "Enter your username."; err.hidden = false; return; }
    const email = userLogin(username);
    if (!pw) { err.textContent = "Enter your password."; err.hidden = false; return; }
    $("#lbtn").disabled = true; $("#lbtn").textContent = "Signing in…";
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    $("#lbtn").disabled = false; $("#lbtn").textContent = "Sign in";
    if (error) { err.textContent = /invalid/i.test(error.message) ? "Username or password is wrong." : error.message; err.hidden = false; return; }
    LS.set("lid", username);
  });
}
function showPending() {
  $("#bar").hidden = true;
  $("#main").innerHTML = `<div class="login"><div class="card"><h1>Waiting for access</h1>
    <p>You're signed in, but the admin hasn't given you a role yet.</p>
    <p class="note">Once they do, this page opens by itself.</p>
    <button class="btn" id="out2">Sign out</button></div></div>`;
  $("#out2").onclick = () => supabase.auth.signOut();
}
function passwordModal() {
  openModal(`<h2>Change my password</h2><div class="form-grid">
    <label class="f wide">New password<input class="inp" id="np1" type="password" autocomplete="new-password" minlength="6"></label>
    <label class="f wide">Type it again<input class="inp" id="np2" type="password" autocomplete="new-password"></label></div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="npSave">Save password</button></div>`, (m) => {
    m.querySelector("#npSave").onclick = async () => {
      const a = m.querySelector("#np1").value, b = m.querySelector("#np2").value;
      if (a.length < 6) return toast("Use at least 6 characters.");
      if (a !== b) return toast("The two passwords don't match.");
      const { error } = await supabase.auth.updateUser({ password: a });
      if (error) return toast(error.message);
      closeModal(); toast("Password changed");
    };
  });
}

/* ---------- header ---------- */
function renderHeader() {
  $("#bar").hidden = false;
  $("#wkMeet").textContent = "Meeting " + fmt(S.week);
  $("#wkRange").textContent = "Covers " + weekRange(S.week);
  const allowed = TABS[role()] || [];
  document.querySelectorAll("#tabs button").forEach((b) => { b.hidden = !allowed.includes(b.dataset.tab); b.setAttribute("aria-current", b.dataset.tab === S.tab ? "page" : "false"); });
  $("#pptBtn").hidden = !["admin", "viewer"].includes(role());
  const deptName = S.me && S.me.dept_id && S.depts[S.me.dept_id] ? " · " + S.depts[S.me.dept_id].name : "";
  $("#roleChip").textContent = (ROLES[role()] || "") + (role() === "hod" ? deptName : "");
}
$("#wkPrev").onclick = () => setWeek(addDays(S.week, -7));
$("#wkNext").onclick = () => setWeek(addDays(S.week, 7));
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (!b) return; S.tab = b.dataset.tab; LS.set("tab", S.tab); render(); });
$("#pptBtn").onclick = () => makePpt();
$("#signOut").onclick = () => supabase.auth.signOut();
$("#myPw").onclick = () => passwordModal();

async function setWeek(w) {
  S.week = w; S.form = null; S.formDirty = false; S.results = {}; S.prev = {}; S.review = null; render();
  await Promise.all([loadResults(), loadReview()]); render();
}

/* ---------- render ---------- */
function render() {
  if (!S.ready) return;
  renderHeader();
  const m = $("#main");
  if (!deptList().length) {
    m.innerHTML = `<div class="empty">${S.isAdmin ? `No departments yet.<br><br><button class="btn primary" data-act="add-dept">Add the first department</button>` : role() === "hod" ? "Your department isn't set yet. Ask the admin to set it in Users." : "No departments yet."}</div>`;
    return;
  }
  if (hodLocked()) { S.dept = S.me.dept_id; S.masterDept = S.me.dept_id; S.weeklyDept = S.me.dept_id; }
  if (!S.depts[S.dept]) S.dept = deptList()[0].id;
  if (!S.depts[S.masterDept]) S.masterDept = deptList()[0].id;
  const allowed = TABS[role()] || [];
  if (!allowed.includes(S.tab)) S.tab = allowed[0];
  const fn = { overview: vOverview, submit: vSubmit, weekly: vWeekly, master: vMaster, pending: vPending, md: vMD, users: vUsers, settings: vSettings }[S.tab] || vOverview;
  renderHeader();
  m.innerHTML = fn();
  labelTables(m);
  if (S.tab === "submit") bindSubmit();
}
/* On phones, tables marked .resp become cards: copy each column heading onto its cells. */
function labelTables(root) {
  root.querySelectorAll("table.resp").forEach((t) => {
    const heads = [...t.querySelectorAll("thead th")].map((th) => th.dataset.label ?? th.textContent.trim());
    t.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => { if (!td.hasAttribute("data-label") && heads[i]) td.setAttribute("data-label", heads[i]); }));
  });
}
const viaBadge = (r) => (r && r.source === "whatsapp" ? ` <span class="pill wa">via WhatsApp</span>` : "");

/* Overview */
function vOverview() {
  const ds = deptList();
  let sub = 0; const all = { G: 0, A: 0, R: 0 }; const scores = [];
  const cards = ds.map((d) => {
    const r = S.results[d.id]; const submitted = r && r.status === "submitted";
    const sm = r ? summarize(r.rows) : { score: null, counts: { G: 0, A: 0, R: 0 }, rag: "none" };
    if (submitted) { sub++; for (const k in all) all[k] += sm.counts[k]; if (sm.score != null) scores.push(sm.score); }
    const pv = S.prev[d.id] ? summarize(S.prev[d.id].rows).score : null;
    const trend = sm.score != null && pv != null ? (sm.score > pv ? "↑" : sm.score < pv ? "↓" : "→") + ` from ${pv}%` : "";
    const open = S.actions.filter((a) => a.dept === d.id && a.status !== "Done").length;
    return `<button class="dcard ${submitted ? sm.rag : "none"}" data-act="goto-submit" data-dept="${d.id}">
      <div class="top"><h3>${esc(d.name)}</h3>${submitted ? `<span class="pill ${sm.rag}">${RAGN[sm.rag] || "—"}</span>` : r ? `<span class="pill none">Draft</span>` : `<span class="pill none">Not submitted</span>`}</div>
      <div class="top"><span class="score">${sm.score != null ? sm.score + "%" : "—"}</span><span class="meta">${esc(trend)}</span></div>
      <div class="rag-row"><span class="pill G">${sm.counts.G} G</span><span class="pill A">${sm.counts.A} A</span><span class="pill R">${sm.counts.R} R</span><span class="pill none">${open} open actions</span>${viaBadge(r)}</div>
      ${r && r.ai ? `<div class="meta">Claude: <span class="pill ${RATINGS[r.ai.rating] || "none"}">${esc(r.ai.rating)}</span>${r.ai.score != null ? ` · evidence ${esc(r.ai.score)}/100` : ""}</div>` : ""}
      <div class="meta">HOD: ${esc(d.hod || "—")}${r && r.at ? ` · ${r.status === "submitted" ? "Submitted" : "Saved"} ${esc(when(r.at))}` : ""}</div>
    </button>`;
  }).join("");
  const grp = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const overdue = S.actions.filter((a) => a.status !== "Done" && a.due && a.due < today()).length;
  return `<section class="panel">
    <div class="head-row"><div><h2>Week ${esc(weekRange(S.week))}</h2><p class="sub">Monday HOD meeting on ${esc(fmt(S.week))}. Reports close Saturday; the PPT goes to WhatsApp at 5 PM.</p></div>
    <button class="btn primary" data-act="ppt">Make PPT for this week</button></div>
    <div class="stats">
      <div class="stat"><b>${sub}/${ds.length}</b><span>Submitted</span></div>
      <div class="stat"><b>${grp != null ? grp + "%" : "—"}</b><span>Group score</span></div>
      <div class="stat"><b style="color:var(--g)">${all.G}</b><span>Green KPIs</span></div>
      <div class="stat"><b style="color:var(--a)">${all.A}</b><span>Amber KPIs</span></div>
      <div class="stat"><b style="color:var(--r)">${all.R}</b><span>Red KPIs</span></div>
      <div class="stat"><b class="${overdue ? "overdue" : ""}">${overdue}</b><span>Overdue actions</span></div>
    </div></section>
  <section class="grid">${cards}</section>
  <p class="note">Green ≥ 95% · Amber 80–94% · Red below 80% of target. Tap a department to open its result sheet.</p>`;
}

/* Submit */
function ensureForm() {
  const key = S.week + "__" + S.dept;
  if (S.form && S.form.key === key) return S.form;
  const r = S.results[S.dept];
  S.form = {
    key, rows: JSON.parse(JSON.stringify((r && r.rows) || {})), priorities: r && r.priorities ? r.priorities.slice() : ["", "", ""], support: (r && r.support) || "", newActions: [],
    ai: r && r.ai ? JSON.parse(JSON.stringify(r.ai)) : null, clar: r && r.clar ? r.clar.slice() : [],
  };
  while (S.form.priorities.length < 3) S.form.priorities.push("");
  S.formDirty = false;
  return S.form;
}
function vSubmit() {
  const ds = deptList(); const d = S.depts[S.dept]; const f = ensureForm(); const r = S.results[S.dept];
  const editable = mayEditDept(S.dept);
  const all = S.showAll || Object.keys(f.rows).some((id) => !WEEKLY.has(((d.items || []).find((i) => i.id === id) || {}).freq) && (f.rows[id].actual || f.rows[id].rag));
  const items = itemsFor(d, all);
  const dis = editable ? "" : "disabled";
  const rowsHtml = items.map((i) => {
    const row = f.rows[i.id] || {};
    const ach = row.ach != null ? row.ach : null; const rag = row.rag || ragOf(ach);
    const manual = isManual(i);
    return `<tr data-id="${esc(i.id)}">
      <td class="kpi" data-label=""><span class="no">${i.star ? '<span class="star" title="Headline KPI">★</span> ' : ""}${esc(i.no)}</span> ${esc(i.text)}<div class="who">${esc(i.owner)} · target ${esc(i.target)} <span class="freq">${esc(i.freq)}</span></div></td>
      <td><input class="inp num" data-f="actual" inputmode="decimal" aria-label="Actual for ${esc(i.no)}" value="${esc(row.actual ?? "")}" placeholder="${manual ? "value" : "actual"}" ${dis}></td>
      <td>${manual ? `<input class="inp num" data-f="ach" inputmode="decimal" aria-label="Achievement % for ${esc(i.no)}" value="${esc(ach ?? "")}" placeholder="%" ${dis}>` : `<span class="ach" data-out="ach">${ach != null ? ach + "%" : "—"}</span>`}</td>
      <td><select class="inp" data-f="rag" aria-label="Status for ${esc(i.no)}" ${dis}>
        <option value="">${rag && !row.rag ? "Auto: " + RAGN[rag] : "Auto"}</option>
        ${["G", "A", "R", "NA"].map((k) => `<option value="${k}" ${row.rag === k ? "selected" : ""}>${RAGN[k]}</option>`).join("")}
      </select></td>
      <td><textarea class="inp" data-f="reason" rows="1" aria-label="Reason or remarks for ${esc(i.no)}" placeholder="Reason if Amber/Red" ${dis}>${esc(row.reason || "")}</textarea></td>
      <td><textarea class="inp" data-f="data" rows="1" aria-label="Supporting data for ${esc(i.no)}" placeholder="e.g. 46 of 50 indents" ${dis}>${esc(row.data || "")}</textarea></td>
    </tr>`;
  }).join("");
  const open = S.actions.filter((a) => a.dept === S.dept && a.status !== "Done");
  const actHtml = open.length ? `<div class="tbl-wrap"><table class="resp"><thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Status</th><th>Result</th></tr></thead><tbody>
    ${open.map((a) => `<tr><td class="kpi">${esc(a.action)}<div class="who">${esc(a.kpiNo ? "KPI " + a.kpiNo : "")}</div></td><td>${esc(a.owner)}</td>
      <td class="${a.due && a.due < today() ? "overdue" : ""}">${a.due ? esc(fmtShort(a.due)) : "—"}</td>
      <td><select class="inp" data-act-status="${esc(a._id)}" ${dis}>${["Open", "In progress", "Done", "Not done"].map((s) => `<option ${a.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td><input class="inp" data-act-result="${esc(a._id)}" value="${esc(a.result || "")}" placeholder="Result shown" ${dis}></td></tr>`).join("")}
    </tbody></table></div>` : `<p class="note">No open actions for ${esc(d.name)}.</p>`;
  const kpiOpts = itemsFor(d, true).map((i) => `<option value="${esc(i.id)}">${esc(i.no)} · ${esc(i.text.slice(0, 60))}</option>`).join("");
  const naHtml = f.newActions.map((a, ix) => `<tr><td>${esc(a.kpiNo)}</td><td class="kpi">${esc(a.action)}</td><td>${esc(a.owner)}</td><td>${a.due ? esc(fmtShort(a.due)) : "—"}</td><td><button class="btn small ghost danger" data-act="rm-new" data-ix="${ix}">Remove</button></td></tr>`).join("");
  const chips = hodLocked() || ds.length < 2 ? "" : `<div class="chips" role="group" aria-label="Department">${ds.map((x) => `<button class="chip" data-act="set-dept" data-dept="${x.id}" aria-pressed="${x.id === S.dept}">${esc(x.name)}</button>`).join("")}</div>`;
  return `<section class="panel">
    <div class="head-row"><div><h2>${role() === "hod" ? "My KPI results" : "Submit results"}</h2><p class="sub">${esc(d.name)} · week ${esc(weekRange(S.week))} · HOD ${esc(d.hod || "")}</p></div>${chips}</div>
    ${!editable ? `<div class="banner">You can view this sheet. Only ${esc(d.name)}'s HOD or an admin can change it.</div>` : ""}
    ${r ? `<div class="banner ${r.status === "submitted" ? "ok" : ""}">${r.status === "submitted" ? "Submitted" : "Draft saved"}${r.source === "whatsapp" ? " on WhatsApp" : ""} by ${esc(nameOf(r.by))} on ${esc(new Date(r.at).toLocaleString("en-IN"))}.${editable ? " You can still correct it before Saturday 5 PM." : ""}</div>` : ""}
    ${role() === "hod" ? `<p class="note">You can also send your KPIs on WhatsApp: message <b>START</b> to the company KPI number.</p>` : ""}
    <div class="toolbar"><span class="note grow">Enter the week's actual figure. Achievement % and status fill in automatically; pick a status yourself where there is no number. ★ = headline KPI.</span>
      <label class="note"><input type="checkbox" id="showAll" ${S.showAll ? "checked" : ""}> Show monthly &amp; other KPIs</label></div>
    <div class="tbl-wrap"><table id="resTbl" class="resp sheet"><thead><tr><th data-label="">KPI</th><th>Actual</th><th>Ach %</th><th>Status</th><th>Reason / remarks</th><th>Supporting data</th></tr></thead><tbody>${rowsHtml || `<tr><td colspan="6" class="note">No weekly KPIs. Tick “Show monthly &amp; other KPIs”.</td></tr>`}</tbody></table></div>
  </section>
  <section class="two">
    <div class="panel"><h3>Last week's actions</h3><p class="note">Update each open action. Changes save straight away.</p>${actHtml}</div>
    <div class="panel"><h3>This week's plan</h3>
      ${[0, 1, 2].map((i) => `<label class="f">Priority ${i + 1}<input class="inp" data-pri="${i}" value="${esc(f.priorities[i] || "")}" placeholder="What, and the number you expect" ${dis}></label>`).join("")}
      <label class="f">Support needed from CEO / other departments<textarea class="inp" id="support" rows="2" ${dis}>${esc(f.support)}</textarea></label>
    </div>
  </section>
  ${editable ? `<section class="panel">
    <div class="head-row"><div><h3>New actions for Red KPIs</h3><p class="sub">Added to Pending points when you submit.</p></div></div>
    ${naHtml ? `<div class="tbl-wrap"><table class="resp"><thead><tr><th>KPI</th><th>Action</th><th>Owner</th><th>Due</th><th></th></tr></thead><tbody>${naHtml}</tbody></table></div>` : ""}
    <div class="form-grid">
      <label class="f">KPI<select class="inp" id="naKpi"><option value="">General</option>${kpiOpts}</select></label>
      <label class="f wide">Action<input class="inp" id="naText" placeholder="What will be done"></label>
      <label class="f">Owner<input class="inp" id="naOwner"></label>
      <label class="f">Due date<input class="inp" type="date" id="naDue"></label>
    </div>
    <div><button class="btn" data-act="add-new">Add action</button></div>
  </section>` : ""}
  ${aiPanel(editable)}
  ${editable ? `<div class="toolbar savebar"><span class="grow note" id="dirtyNote">${S.formDirty ? "Unsaved changes" : ""}</span>
    <button class="btn" data-act="save-draft">Save draft</button>
    <button class="btn primary" data-act="submit">Submit results</button></div>` : ""}`;
}
function markDirty() { S.formDirty = true; const n = $("#dirtyNote"); if (n) n.textContent = "Unsaved changes"; }
function bindSubmit() {
  const tbl = $("#resTbl");
  tbl && tbl.addEventListener("input", (e) => {
    const tr = e.target.closest("tr[data-id]"); if (!tr) return;
    const id = tr.dataset.id; const item = (S.depts[S.dept].items || []).find((i) => i.id === id);
    const row = (S.form.rows[id] = S.form.rows[id] || {});
    const fld = e.target.dataset.f; if (!fld) return;
    if (fld === "ach") { const v = parseFloat(e.target.value); row.ach = isNaN(v) ? null : Math.min(Math.round(v), 120); }
    else row[fld] = e.target.value;
    if (fld === "actual" && !isManual(item)) {
      row.ach = calcAch(item, row.actual);
      const o = tr.querySelector('[data-out="ach"]'); if (o) o.textContent = row.ach != null ? row.ach + "%" : "—";
    }
    if (fld === "actual" || fld === "ach") {
      const sel = tr.querySelector('[data-f="rag"]'); const auto = ragOf(row.ach);
      if (sel) sel.options[0].textContent = auto ? "Auto: " + RAGN[auto] : "Auto";
    }
    markDirty();
  });
  tbl && tbl.addEventListener("change", (e) => { if (e.target.dataset.f === "rag") { const id = e.target.closest("tr").dataset.id; (S.form.rows[id] = S.form.rows[id] || {}).rag = e.target.value; markDirty(); } });
  document.querySelectorAll("[data-pri]").forEach((el) => el.addEventListener("input", () => { S.form.priorities[+el.dataset.pri] = el.value; markDirty(); }));
  const sp = $("#support"); sp && sp.addEventListener("input", () => { S.form.support = sp.value; markDirty(); });
  const sa = $("#showAll"); sa && sa.addEventListener("change", () => { S.showAll = sa.checked; render(); });
  document.querySelectorAll("[data-act-status]").forEach((el) => el.addEventListener("change", () => updateAction(el.dataset.actStatus, { status: el.value })));
  document.querySelectorAll("[data-act-result]").forEach((el) => el.addEventListener("change", () => updateAction(el.dataset.actResult, { result: el.value })));
  document.querySelectorAll("[data-ai-ans]").forEach((el) => el.addEventListener("input", () => { const x = S.form.ai && S.form.ai.flags[+el.dataset.aiAns]; if (x) { x.answer = el.value; markDirty(); } }));
}
async function saveResult(status) {
  const d = S.depts[S.dept]; const f = S.form; const rows = {};
  for (const [id, r] of Object.entries(f.rows)) {
    const item = (d.items || []).find((i) => i.id === id); if (!item) continue;
    if (!(r.actual || r.rag || r.reason || r.data || r.ach != null)) continue;
    rows[id] = { actual: r.actual ?? "", ach: r.ach ?? null, rag: r.rag || "", reason: r.reason || "", data: r.data || "",
      no: item.no, text: item.text, target: item.target, star: !!item.star, kraNo: item.kraNo, freq: item.freq };
  }
  if (status === "submitted") {
    if (!Object.keys(rows).length) return toast("Enter at least one KPI result before submitting.");
    if (!f.ai) return toast("Check your results with Claude before submitting.");
    if (f.ai.hash !== rowsHash(f.rows)) return toast("You changed figures after Claude's check. Check again before submitting.");
    const openQ = (f.ai.flags || []).filter((x) => x.severity === "high" && !(x.answer || "").trim()).length;
    if (openQ) return toast(`Answer Claude's ${openQ} key question${openQ > 1 ? "s" : ""} before submitting.`);
  }
  const sm = summarize(rows);
  const ok = await run(supabase.from("results").upsert({
    week: S.week, dept_id: S.dept, status, rows, priorities: f.priorities, support: f.support, score: sm.score, counts: sm.counts,
    ai: f.ai || null, clar: f.clar || [], source: "app", updated_by: S.session.user.id, updated_at: nowIso(),
  }, { onConflict: "week,dept_id" }), status === "submitted" ? `${d.name} results submitted` : "Draft saved");
  if (!ok) return;
  if (status === "submitted" && f.newActions.length) {
    await run(supabase.from("actions").insert(f.newActions.map((a) => ({ dept_id: S.dept, week: S.week, kpi_no: a.kpiNo, kpi_text: a.kpiText, action: a.action, owner: a.owner, due: a.due || null, status: "Open" }))));
  }
  S.formDirty = false; S.form = null;
  await Promise.all([loadResults(), loadActions()]); render();
}
async function updateAction(id, patch) {
  const ok = await run(supabase.from("actions").update({ ...patch, updated_at: nowIso() }).eq("id", id), "Action updated");
  if (ok) await loadActions();
}

/* ---------- Claude check (questions in Malayalam) ---------- */
function aiPanel(editable) {
  const f = S.form; const ai = f.ai;
  if (!ai && !editable) return "";
  const changed = ai && ai.hash !== rowsHash(f.rows);
  const flags = (ai && ai.flags) || [];
  const openQ = flags.filter((x) => x.severity === "high" && !(x.answer || "").trim()).length;
  const dis = editable ? "" : "disabled";
  return `<section class="panel ai" id="aiPanel">
    <div class="head-row"><div><span class="ai-tag">Claude check</span><h3>Is this sheet result-oriented?</h3>
      <p class="sub">Claude reads your figures before the MD office does, asks for data behind each claim (in Malayalam), and suggests improvements. Answer its questions, then submit.</p></div>
      ${editable ? `<div class="toolbar"><button class="btn primary" data-act="ai-check" ${S.aiBusy ? "disabled" : ""}>${ai ? "Check again with Claude" : "Check with Claude"}</button></div>` : ""}</div>
    ${S.aiBusy ? `<div class="thinking">Claude is reading ${esc(S.depts[S.dept].name)}'s results… this takes up to a minute.</div>` : ""}
    ${ai ? `
      ${changed ? `<div class="banner">Figures changed after this check. Check again before submitting.</div>` : ""}
      <div class="toolbar"><span class="pill ${RATINGS[ai.rating] || "none"}">${esc(ai.rating || "—")}</span><span class="ml">${esc(RATING_ML[ai.rating] || "")}</span><b>Evidence ${ai.score != null ? esc(ai.score) + "/100" : "—"}</b><span class="note">checked ${esc(when(ai.at))}</span></div>
      <p class="ml" style="margin:0">${esc(ai.summary || "")}</p>
      ${flags.length ? `<h3>Questions to clarify ${openQ ? `<span class="pill R">${openQ} must answer</span>` : `<span class="pill G">All key questions answered</span>`}</h3>
        <div class="flags">${flags.map((x, ix) => `<div class="flag ${esc(x.severity)}"><div class="toolbar"><span class="freq">${x.kpiNo ? "KPI " + esc(x.kpiNo) : "General"}</span><span class="note ml">${esc(x.issue || "")}</span></div>
          <div class="q ml">${esc(x.question)}</div>
          <textarea class="inp" data-ai-ans="${ix}" rows="2" aria-label="Your answer" placeholder="${x.severity === "high" ? "മറുപടി നിർബന്ധം · answer required" : "നിങ്ങളുടെ മറുപടി"}" ${dis}>${esc(x.answer || "")}</textarea></div>`).join("")}</div>` : `<p class="note">No questions. Claude found the sheet clear.</p>`}
      ${(ai.suggestions || []).length ? `<h3>Suggestions</h3><ul class="ml" style="margin:0;padding-left:18px">${ai.suggestions.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${f.clar.length ? `<details><summary class="note">Earlier answers (${f.clar.length})</summary><div class="flags" style="margin-top:8px">${f.clar.map((c) => `<div class="qa ml"><b>${c.kpiNo ? "KPI " + esc(c.kpiNo) + ": " : ""}${esc(c.question)}</b>${esc(c.answer)}</div>`).join("")}</div></details>` : ""}
    ` : `<p class="note">Not checked yet.</p>`}
  </section>`;
}
async function runCheck() {
  const f = S.form; const d = S.depts[S.dept];
  const rows = checkRows(d, f.rows);
  if (!rows.length) return toast("Enter your results first, then ask Claude to check them.");
  if (f.ai && f.ai.flags) for (const x of f.ai.flags) {
    if ((x.answer || "").trim() && !f.clar.some((c) => c.question === x.question)) f.clar.push({ kpiNo: x.kpiNo || "", question: x.question, answer: x.answer.trim(), at: nowIso() });
  }
  S.aiBusy = true; render();
  try {
    const res = await callFn("ai-check", {
      deptId: S.dept, deptName: d.name, hod: d.hod, week: weekRange(S.week), meeting: fmt(S.week), rows, missing: missingHeadline(d, f.rows),
      priorities: f.priorities.filter(Boolean), support: f.support || "", clarifications: f.clar.map((c) => ({ kpi: c.kpiNo, q: c.question, a: c.answer })),
    });
    f.ai = { ...res, at: nowIso(), hash: rowsHash(f.rows), flags: (res.flags || []).map((x) => ({ ...x, answer: "" })) };
    markDirty();
  } catch (e) { toast("Claude check failed: " + e.message); }
  finally { S.aiBusy = false; render(); const p = $("#aiPanel"); p && p.scrollIntoView({ block: "start", behavior: "smooth" }); }
}

/* ---------- MD office ---------- */
function vMD() {
  const ds = deptList(); const rv = S.review; const t = today(); const rr = repeatReds(S.depts, S.results, S.prev);
  const rows = ds.map((d) => {
    const r = S.results[d.id]; const subm = r && r.status === "submitted"; const sm = r ? summarize(r.rows) : null; const ai = r && r.ai;
    const unanswered = ai ? (ai.flags || []).filter((x) => !(x.answer || "").trim()).length : 0;
    const answered = (r && r.clar ? r.clar.length : 0) + (ai ? (ai.flags || []).filter((x) => (x.answer || "").trim()).length : 0);
    const od = S.actions.filter((a) => a.dept === d.id && a.status !== "Done" && a.due && a.due < t).length;
    return `<tr><td><b>${esc(d.name)}</b><div class="who">${esc(d.hod || "")}</div></td>
      <td>${subm ? `<span class="pill G">Submitted</span>` : r ? `<span class="pill A">Draft</span>` : `<span class="pill R">Missing</span>`}${viaBadge(r)}</td>
      <td>${sm && sm.score != null ? `<span class="pill ${sm.rag}">${sm.score}%</span>` : "—"}</td>
      <td>${ai ? `<span class="pill ${RATINGS[ai.rating] || "none"}">${esc(ai.rating)}</span>` : `<span class="note">Not checked</span>`}</td>
      <td>${ai && ai.score != null ? esc(ai.score) + "/100" : "—"}</td>
      <td>${answered}${unanswered ? ` <span class="overdue">· ${unanswered} open</span>` : ""}</td>
      <td class="${od ? "overdue" : ""}">${od}</td>
      <td>${rr.filter((x) => x.dept === d.id).length || "—"}</td></tr>`;
  }).join("");
  const clarHtml = ds.map((d) => {
    const r = S.results[d.id]; if (!r) return "";
    const qa = [...(r.clar || []), ...((r.ai && r.ai.flags) || []).map((x) => ({ kpiNo: x.kpiNo, question: x.question, answer: x.answer }))];
    if (!qa.length) return "";
    return `<div class="rv-dept"><h3>${esc(d.name)}</h3><div class="flags">${qa.map((c) => `<div class="qa ml"><b>${c.kpiNo ? "KPI " + esc(c.kpiNo) + ": " : ""}${esc(c.question)}</b>${(c.answer || "").trim() ? esc(c.answer) : `<span class="overdue">Not answered</span>`}</div>`).join("")}</div></div>`;
  }).join("");
  return `<section class="panel">
    <div class="head-row"><div><h2>MD Office monitoring</h2><p class="sub">Week ${esc(weekRange(S.week))}. How each department reported: results or just duty, whether the data backs the claims, and what Claude asked them to clarify.</p></div></div>
    <div class="tbl-wrap"><table class="resp"><thead><tr><th>Department</th><th>Sheet</th><th>KPI score</th><th>Claude rating</th><th>Evidence</th><th>Clarified</th><th>Overdue actions</th><th>Red 2 weeks</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${rr.length ? `<div class="banner"><b>Red two weeks running:</b> ${rr.map((x) => `${esc(x.name)} ${esc(x.no)} (${esc(x.text)})`).join(" · ")}</div>` : ""}
  </section>
  <section class="panel ai">
    <div class="head-row"><div><span class="ai-tag">Claude review for the MD office</span><h3>Weekly review and questions for Monday</h3>
      <p class="sub">Runs by itself every Saturday at 4:30 PM, before the 5 PM PPT. You can also run it now.</p></div>
      <div class="toolbar"><button class="btn primary" data-act="md-review" ${S.isAdmin && !S.mdBusy ? "" : "disabled"}>${rv ? "Run review again" : "Generate MD review"}</button></div></div>
    ${!S.isAdmin ? `<p class="note">Only admins (MD office) can generate the review.</p>` : ""}
    ${S.mdBusy ? `<div class="thinking">Claude is reviewing all departments… this can take one to two minutes.</div>` : ""}
    ${rv ? mdReviewHtml(rv) : `<p class="note">No review for this week yet.</p>`}
  </section>
  ${clarHtml ? `<section class="panel"><h3>Clarifications from HODs</h3>${clarHtml}</section>` : ""}`;
}
function mdReviewHtml(rv) {
  const nm = (id) => (S.depts[id] || {}).name || id;
  return `<p class="note">Generated ${esc(new Date(rv.at).toLocaleString("en-IN"))}</p>
    <p style="margin:0;font-size:16px"><b>${esc(rv.headline || "")}</b></p>
    <p style="margin:0">${esc(rv.groupView || "")}</p>
    ${(rv.watchList || []).length ? `<div><h3>Watch list</h3><ul style="margin:6px 0 0;padding-left:18px">${rv.watchList.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    ${(rv.departments || []).map((x) => `<div class="rv-dept"><div class="toolbar"><h3>${esc(nm(x.dept))}</h3><span class="pill ${RATINGS[x.rating] || "none"}">${esc(x.rating || "")}</span></div>
      <p style="margin:0">${esc(x.verdict || "")}</p>
      ${(x.questions || []).length ? `<div><b>Ask on Monday</b><ul>${x.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}
      ${(x.suggestions || []).length ? `<div><b>Suggestions</b><ul>${x.suggestions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></div>` : ""}</div>`).join("")}
    ${(rv.crossDept || []).length ? `<div class="rv-dept"><h3>Across departments</h3><ul>${rv.crossDept.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}`;
}
async function runMdReview() {
  S.mdBusy = true; render();
  try { await callFn("ai-review", { week: S.week }); await loadReview(); toast("MD review saved"); }
  catch (e) { toast("Claude review failed: " + e.message); }
  finally { S.mdBusy = false; render(); }
}

/* ---------- weekly list & master ---------- */
function vWeekly() {
  const ds = deptList();
  const show = S.weeklyDept === "all" || !S.depts[S.weeklyDept] ? ds : ds.filter((d) => d.id === S.weeklyDept);
  const body = show.map((d) => {
    const items = itemsFor(d, false);
    return `<section class="panel"><div class="head-row"><div><h3>${esc(d.name)}</h3><p class="sub">HOD ${esc(d.hod || "")} · ${items.length} weekly KPIs, ${items.filter((i) => i.star).length} headline</p></div></div>
      <div class="tbl-wrap"><table class="resp"><thead><tr><th data-label="">KPI</th><th>Target</th><th>Freq</th><th>Owner</th></tr></thead><tbody>
      ${items.map((i) => `<tr><td class="kpi" data-label=""><span class="no">${i.star ? '<span class="star">★</span> ' : ""}${esc(i.no)}</span> ${esc(i.text)}</td><td>${esc(i.target)}</td><td><span class="freq">${esc(FREQ[i.freq] || i.freq)}</span></td><td>${esc(i.owner)}</td></tr>`).join("") || `<tr><td colspan="4" class="note">No daily or weekly KPIs.</td></tr>`}
      </tbody></table></div></section>`;
  }).join("");
  const chips = ds.length < 2 ? "" : `<div class="chips" role="group" aria-label="Department"><button class="chip" data-act="wdept" data-dept="all" aria-pressed="${S.weeklyDept === "all"}">All departments</button>${ds.map((x) => `<button class="chip" data-act="wdept" data-dept="${x.id}" aria-pressed="${x.id === S.weeklyDept}">${esc(x.name)}</button>`).join("")}</div>`;
  return `<section class="panel"><div class="head-row"><div><h2>Weekly KPI list</h2><p class="sub">Daily, weekly and 15-day KPIs reviewed every week. These are the KPIs the WhatsApp bot asks on Saturday. ★ = headline KPI.</p></div></div>${chips}</section>${body}`;
}
function vMaster() {
  const ds = deptList(); const d = S.depts[S.masterDept]; const q = S.q.trim().toLowerCase();
  const items = (d.items || []).filter((i) => !q || (i.text + " " + i.owner + " " + i.no + " " + i.kra).toLowerCase().includes(q));
  const kras = [...new Map(items.map((i) => [i.kraNo, { no: i.kraNo, name: i.kra, w: i.kraW }])).values()].sort((a, b) => a.no - b.no);
  const canPropose = ["admin", "hod"].includes(role());
  const rows = kras.map((k) => `<tr class="kra-row"><td colspan="${S.isAdmin ? 5 : 4}">KRA ${k.no || ""} · ${esc(k.name)}${k.w ? ` · ${k.w}%` : ""}</td></tr>` +
    items.filter((i) => i.kraNo === k.no).sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true })).map((i) => `<tr>
      <td class="kpi" data-label=""><span class="no">${i.star ? '<span class="star">★</span> ' : ""}${esc(i.no)}</span> ${esc(i.text)}</td><td>${esc(i.target)}</td>
      <td><span class="freq">${esc(FREQ[i.freq] || i.freq)}</span></td><td>${esc(i.owner)}</td>
      ${S.isAdmin ? `<td class="row-actions" data-label=""><button class="btn small" data-act="edit-kpi" data-id="${esc(i.id)}">Edit</button> <button class="btn small ghost danger" data-act="del-kpi" data-id="${esc(i.id)}">Delete</button></td>` : ""}</tr>`).join("")).join("");
  const props = S.proposals.filter((p) => p.status === "pending");
  const propHtml = props.length ? `<div class="tbl-wrap"><table class="resp"><thead><tr><th>Dept</th><th>KRA</th><th>Proposed KPI</th><th>Target</th><th>Freq</th><th>Owner</th><th>By</th>${S.isAdmin ? "<th></th>" : ""}</tr></thead><tbody>
    ${props.map((p) => `<tr><td>${esc((S.depts[p.dept] || {}).name || p.dept)}</td><td>${esc(p.kraName)}</td><td class="kpi">${esc(p.text)}${p.note ? `<div class="who">${esc(p.note)}</div>` : ""}</td><td>${esc(p.target)}</td><td><span class="freq">${esc(FREQ[p.freq] || p.freq)}</span></td><td>${esc(p.owner)}</td><td>${esc(nameOf(p.by))}</td>
      ${S.isAdmin ? `<td class="row-actions" data-label=""><button class="btn small primary" data-act="approve" data-id="${esc(p._id)}">Review &amp; add</button> <button class="btn small ghost danger" data-act="reject" data-id="${esc(p._id)}">Reject</button></td>` : ""}</tr>`).join("")}
    </tbody></table></div>` : `<p class="note">No proposals waiting.</p>`;
  const chips = ds.length < 2 ? "" : `<div class="chips" role="group" aria-label="Department">${ds.map((x) => `<button class="chip" data-act="mdept" data-dept="${x.id}" aria-pressed="${x.id === S.masterDept}">${esc(x.name)} <span class="note">${(x.items || []).length}</span></button>`).join("")}</div>`;
  return `<section class="panel">
    <div class="head-row"><div><h2>${role() === "hod" ? "My KRA &amp; KPI" : "All KRA &amp; KPI"}</h2><p class="sub">${S.isAdmin ? "The approved list. As admin you can add, edit and delete." : "Your approved list. Propose a new KRA or KPI; the admin approves it."}</p></div>
      <div class="toolbar">${S.isAdmin ? `<button class="btn" data-act="add-dept">Add department</button><button class="btn primary" data-act="add-kpi">Add KPI</button>` : canPropose ? `<button class="btn primary" data-act="propose">Propose KRA / KPI</button>` : ""}</div></div>
    ${chips}
    <div class="toolbar"><input class="inp grow" id="q" type="search" placeholder="Search KPI, owner or number" value="${esc(S.q)}" aria-label="Search KPIs">
      <span class="note">HOD: ${esc(d.hod || "—")}</span>${S.isAdmin ? `<button class="btn small" data-act="edit-dept">Edit department</button>` : ""}</div>
    <div class="tbl-wrap"><table class="resp"><thead><tr><th data-label="">KPI</th><th>Target</th><th>Frequency</th><th>Owner</th>${S.isAdmin ? "<th></th>" : ""}</tr></thead><tbody>${rows || `<tr><td colspan="5" class="note">No KPIs match.</td></tr>`}</tbody></table></div>
  </section>
  <section class="panel"><div class="head-row"><div><h3>Proposals</h3><p class="sub">New KRAs and KPIs waiting for admin approval.</p></div></div>${propHtml}</section>`;
}

/* ---------- pending points ---------- */
function vPending() {
  const ds = deptList(); const t = today();
  let acts = S.actions.slice();
  if (S.pendDept !== "all") acts = acts.filter((a) => a.dept === S.pendDept);
  if (S.pendFilter === "open") acts = acts.filter((a) => a.status !== "Done");
  if (S.pendFilter === "overdue") acts = acts.filter((a) => a.status !== "Done" && a.due && a.due < t);
  acts.sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const notSub = ds.filter((d) => !(S.results[d.id] && S.results[d.id].status === "submitted"));
  const reds = [];
  ds.forEach((d) => { const r = S.results[d.id]; if (!r) return; Object.values(r.rows || {}).forEach((x) => { const rag = x.rag || ragOf(x.ach); if (rag === "R" || rag === "A") reds.push({ d, x, rag }); }); });
  reds.sort((a, b) => (a.rag === "R" ? 0 : 1) - (b.rag === "R" ? 0 : 1));
  const canAdd = ["admin", "hod"].includes(role());
  const actRows = acts.map((a) => {
    const od = a.status !== "Done" && a.due && a.due < t; const dis = mayEditDept(a.dept) ? "" : "disabled";
    return `<tr><td>${esc((S.depts[a.dept] || {}).name || a.dept)}</td><td class="kpi">${esc(a.action)}${a.kpiNo ? `<div class="who">KPI ${esc(a.kpiNo)}${a.kpiText ? " · " + esc(a.kpiText) : ""}</div>` : ""}</td><td>${esc(a.owner)}</td>
      <td class="${od ? "overdue" : ""}">${a.due ? esc(fmtShort(a.due)) : "—"}${od ? " · overdue" : ""}</td>
      <td><select class="inp" data-pstat="${esc(a._id)}" ${dis}>${["Open", "In progress", "Done", "Not done"].map((s) => `<option ${a.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td><input class="inp" data-pres="${esc(a._id)}" value="${esc(a.result || "")}" placeholder="Result" ${dis}></td>
      <td class="row-actions" data-label="">${S.isAdmin ? `<button class="btn small ghost danger" data-act="del-action" data-id="${esc(a._id)}">Delete</button>` : ""}</td></tr>`;
  }).join("");
  return `<section class="panel"><div class="head-row"><div><h2>Pending points</h2><p class="sub">Everything that needs follow-up for the meeting on ${esc(fmt(S.week))}.</p></div>${canAdd ? `<button class="btn primary" data-act="add-action">Add action</button>` : ""}</div>
    <div class="two">
      <div><h3>Results not submitted</h3>${notSub.length ? `<ul class="list" style="margin-top:8px">${notSub.map((d) => `<li><span class="pill R">${S.results[d.id] ? "Draft only" : "Missing"}</span> ${esc(d.name)} <span class="note">${esc(d.hod || "")}</span></li>`).join("")}</ul>` : `<p class="note">All submitted.</p>`}</div>
      <div><h3>Red &amp; Amber KPIs this week</h3>${reds.length ? `<ul class="list" style="margin-top:8px">${reds.slice(0, 40).map(({ d, x, rag }) => `<li><span class="pill ${rag}">${x.ach != null ? x.ach + "%" : RAGN[rag]}</span> <span><b>${esc(d.name)}</b> ${esc(x.no)} ${esc(x.text)}${x.reason ? ` <span class="note">— ${esc(x.reason)}</span>` : ""}</span></li>`).join("")}</ul>` : `<p class="note">None reported yet.</p>`}</div>
    </div></section>
  <section class="panel"><div class="head-row"><div><h3>Action tracker</h3><p class="sub">An action closes only when the result is shown.</p></div>
    <div class="toolbar">${ds.length > 1 ? `<select class="inp" id="pendDept" aria-label="Department filter" style="width:auto"><option value="all">All departments</option>${ds.map((d) => `<option value="${d.id}" ${S.pendDept === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select>` : ""}
    <div class="chips">${[["open", "Open"], ["overdue", "Overdue"], ["all", "All"]].map(([k, l]) => `<button class="chip" data-act="pfilter" data-k="${k}" aria-pressed="${S.pendFilter === k}">${l}</button>`).join("")}</div></div></div>
    ${actRows ? `<div class="tbl-wrap"><table class="resp"><thead><tr><th>Dept</th><th>Action</th><th>Owner</th><th>Due</th><th>Status</th><th>Result</th><th></th></tr></thead><tbody>${actRows}</tbody></table></div>` : `<div class="empty">No actions here. HODs add actions for Red KPIs when they submit results, or use “Add action”.</div>`}
  </section>`;
}

/* ---------- users (admin): create logins with username + password ---------- */
function vUsers() {
  const ds = deptList();
  const pend = S.profiles.filter((p) => p.role === "pending").length;
  const noUser = S.profiles.filter((p) => !p.username).length;
  const deptOpts = (sel) => `<option value="">—</option>${ds.map((d) => `<option value="${d.id}" ${sel === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}`;
  const roleOpts = (sel) => Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${sel === k ? "selected" : ""}>${l}</option>`).join("");
  return `<section class="panel"><div class="head-row"><div><h2>Users</h2><p class="sub">Create a login for each person with a username and a password. Add their WhatsApp mobile number so the Saturday bot can reach them.</p></div><div>${pend ? `<span class="pill A">${pend} waiting for access</span>` : ""} ${noUser ? `<span class="pill R">${noUser} without a username — can't sign in</span>` : ""}</div></div>
    <form class="form-grid" id="newUser" novalidate>
      <label class="f">Name<input class="inp" id="nuName" required></label>
      <label class="f">Username<input class="inp" id="nuUser" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="e.g. jayan" required></label>
      <label class="f">WhatsApp mobile<input class="inp" id="nuPhone" inputmode="tel" placeholder="98765 43210"></label>
      <label class="f">Role<select class="inp" id="nuRole">${roleOpts("hod")}</select></label>
      <label class="f">Department<select class="inp" id="nuDept">${deptOpts("")}</select></label>
      <label class="f">Password<div class="inline"><input class="inp" id="nuPw" required minlength="6"><button type="button" class="btn small" data-act="gen-pw">Make one</button></div></label>
      <div class="f end"><button class="btn primary" type="submit" ${S.jobBusy === "user" ? "disabled" : ""}>Create login</button></div>
    </form>
    <p class="note">Share the username and password with the person. They can change the password after signing in (top bar → Password).</p>
  </section>
  <section class="panel"><h3>Everyone (${S.profiles.length})</h3>
    <div class="tbl-wrap"><table class="resp"><thead><tr><th>Name</th><th>Username (login)</th><th>WhatsApp mobile</th><th>Role</th><th>Department</th><th></th></tr></thead><tbody>
    ${S.profiles.map((p) => `<tr>
      <td><input class="inp" data-uname="${esc(p.id)}" value="${esc(p.full_name || "")}" aria-label="Name"></td>
      <td><input class="inp" data-uuser="${esc(p.id)}" autocapitalize="none" autocorrect="off" spellcheck="false" value="${esc(p.username || "")}" placeholder="set a username" aria-label="Username"></td>
      <td><input class="inp" data-uphone="${esc(p.id)}" inputmode="tel" value="${esc(p.phone ? p.phone.replace(/^91/, "") : "")}" placeholder="add number" aria-label="Mobile"></td>
      <td><select class="inp" data-urole="${esc(p.id)}" aria-label="Role" ${p.id === S.session.user.id ? "disabled" : ""}>${roleOpts(p.role)}</select></td>
      <td><select class="inp" data-udept="${esc(p.id)}" aria-label="Department">${deptOpts(p.dept_id)}</select></td>
      <td class="row-actions" data-label=""><button class="btn small" data-act="reset-pw" data-id="${esc(p.id)}">Reset password</button>${p.id !== S.session.user.id ? ` <button class="btn small ghost danger" data-act="del-user" data-id="${esc(p.id)}">Delete</button>` : ' <span class="note">(you)</span>'}</td>
    </tr>`).join("")}
    </tbody></table></div>
    <p class="note"><b>Admin</b> (MD office): everything · <b>HOD</b>: only their own department's KPIs, results and actions · <b>Viewer</b>: reads everything · <b>Pending</b>: no access.</p></section>`;
}
const genPw = () => { const c = "abcdefghjkmnpqrstuvwxyz23456789"; let s = ""; const a = new Uint32Array(8); crypto.getRandomValues(a); a.forEach((n) => (s += c[n % c.length])); return s; };
async function adminUser(body, msg) {
  try { await callFn("admin-users", body); toast(msg); await loadProfiles(); render(); return true; }
  catch (e) { toast(e.message); await loadProfiles(); render(); return false; }
}

/* ---------- settings (admin): WhatsApp + Saturday schedule ---------- */
function vSettings() {
  const st = S.settings || { report_numbers: [], bot_scope: "weekly", tpl_start: "kpi_weekly_start", tpl_report: "kpi_weekly_report", tpl_lang: "ml" };
  const busy = (k) => (S.jobBusy === k ? "disabled" : "");
  return `<section class="panel"><div class="head-row"><div><h2>WhatsApp &amp; Saturday schedule</h2><p class="sub">Every Saturday: 9:30 AM the bot asks each HOD · 1:30 PM reminder to those not finished · 4:30 PM Claude's MD review · 5 PM the PPT goes to the numbers below.</p></div></div>
    <form class="form-grid" id="stForm" novalidate>
      <label class="f wide">WhatsApp numbers that get the Saturday PPT (comma separated)<input class="inp" id="stNums" inputmode="tel" value="${esc((st.report_numbers || []).map((n) => n.replace(/^91/, "")).join(", "))}" placeholder="98765 43210, 98470 12345"></label>
      <label class="f">The bot asks<select class="inp" id="stScope"><option value="weekly" ${st.bot_scope === "weekly" ? "selected" : ""}>All weekly KPIs</option><option value="headline" ${st.bot_scope === "headline" ? "selected" : ""}>Only ★ headline KPIs</option></select></label>
      <label class="f">Kickoff template name<input class="inp" id="stTs" value="${esc(st.tpl_start)}"></label>
      <label class="f">PPT template name<input class="inp" id="stTr" value="${esc(st.tpl_report)}"></label>
      <label class="f">Template language code<input class="inp" id="stTl" value="${esc(st.tpl_lang)}"></label>
      <div class="f end"><button class="btn primary" type="submit">Save settings</button></div>
    </form></section>
  <section class="panel"><div class="head-row"><div><h3>Run now</h3><p class="sub">For week ${esc(weekRange(S.week))}. Use these to test, or if a scheduled run was missed.</p></div></div>
    <div class="toolbar">
      <button class="btn" data-act="job" data-job="kickoff" ${busy("kickoff")}>Send kickoff to all HODs</button>
      <button class="btn" data-act="job" data-job="remind" ${busy("remind")}>Remind HODs not finished</button>
      <button class="btn" data-act="job" data-job="review" ${busy("review")}>Run Claude MD review</button>
      <button class="btn primary" data-act="job" data-job="ppt" ${busy("ppt")}>Make PPT &amp; send to WhatsApp</button>
    </div>
    ${S.jobBusy ? `<div class="thinking">Working… this can take a minute.</div>` : ""}
  </section>
  <section class="panel"><h3>Recent runs</h3>
    ${S.jobs.length ? `<div class="tbl-wrap"><table class="resp"><thead><tr><th>When</th><th>Job</th><th>Week</th><th>Result</th><th>Details</th></tr></thead><tbody>
      ${S.jobs.map((j) => `<tr><td>${esc(when(j.at))}</td><td>${esc(j.job)}</td><td>${j.week ? esc(fmtShort(j.week)) : "—"}</td><td><span class="pill ${j.ok ? "G" : "R"}">${j.ok ? "OK" : "Failed"}</span></td><td class="kpi">${esc(j.detail || "")}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="note">Nothing has run yet.</p>`}
  </section>`;
}
async function runJob(job) {
  S.jobBusy = job; render();
  try {
    const r = await callFn("weekly-jobs", { action: job, week: S.week });
    if (job === "ppt") toast(r.sent && r.sent.length ? `PPT sent to ${r.sent.length} WhatsApp number(s)` : "PPT made, but not sent: add numbers above or check WhatsApp setup");
    else if (job === "review") { toast("MD review saved"); await loadReview(); }
    else toast(`${job === "kickoff" ? "Kickoff" : "Reminder"} sent to ${(r.sent || []).length} HOD(s)${r.failed && r.failed.length ? `, ${r.failed.length} failed` : ""}`);
  } catch (e) { toast("Failed: " + e.message); }
  finally { S.jobBusy = ""; await loadAdmin(); render(); }
}

/* ---------- modals: KPI, proposal, department, action, password ---------- */
function kraOptions(deptId, sel) {
  const d = S.depts[deptId];
  const kras = [...new Map(((d && d.items) || []).map((i) => [i.kraNo, { no: i.kraNo, name: i.kra }])).values()].sort((a, b) => a.no - b.no);
  return kras.map((k) => `<option value="${k.no}" ${String(sel) === String(k.no) ? "selected" : ""}>KRA ${k.no} · ${esc(k.name)}</option>`).join("") + `<option value="new">+ New KRA…</option>`;
}
function kpiModal(deptId, item, fromProposal) {
  const it = item || {}; const ds = deptList();
  openModal(`<h2>${item && item.id ? "Edit KPI" : "Add KPI"}</h2>
    <div class="form-grid">
      <label class="f">Department<select class="inp" id="mDept" ${item && item.id ? "disabled" : ""}>${ds.map((d) => `<option value="${d.id}" ${d.id === deptId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
      <label class="f">KRA<select class="inp" id="mKra">${kraOptions(deptId, it.kraNo)}</select></label>
      <label class="f" id="mNewKraW" hidden>New KRA name<input class="inp" id="mKraName" value="${esc(fromProposal ? it.kra || "" : "")}"></label>
      <label class="f" id="mNewKraW2" hidden>KRA weight %<input class="inp" id="mKraW" type="number" min="0" max="100"></label>
      <label class="f">KPI number<input class="inp" id="mNo" value="${esc(it.no || "")}" placeholder="e.g. 3.7"></label>
      <label class="f wide">KPI<textarea class="inp" id="mText" rows="2">${esc(it.text || "")}</textarea></label>
      <label class="f">Target (as shown)<input class="inp" id="mTarget" value="${esc(it.target || "")}" placeholder="95%, Rs.1,500, <= 150 days"></label>
      <label class="f">Target number<input class="inp" id="mTv" type="number" step="any" value="${it.tv ?? ""}" placeholder="blank = HOD picks status"></label>
      <label class="f">Better when<select class="inp" id="mDir"><option value="up" ${it.dir !== "down" && it.dir !== "zero" ? "selected" : ""}>Higher</option><option value="down" ${it.dir === "down" ? "selected" : ""}>Lower</option><option value="zero" ${it.dir === "zero" ? "selected" : ""}>Zero</option></select></label>
      <label class="f">Frequency<select class="inp" id="mFreq">${Object.entries(FREQ).map(([k, l]) => `<option value="${k}" ${(it.freq || "W") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f wide">Owner(s)<input class="inp" id="mOwner" value="${esc(it.owner || "")}"></label>
      <label class="note wide"><input type="checkbox" id="mStar" ${it.star ? "checked" : ""}> Headline KPI (★) – shown on the weekly scorecard</label>
    </div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="mSave">Save KPI</button></div>`, (m) => {
    const kra = m.querySelector("#mKra"); const dep = m.querySelector("#mDept");
    const toggle = () => { const n = kra.value === "new"; m.querySelector("#mNewKraW").hidden = !n; m.querySelector("#mNewKraW2").hidden = !n; };
    if (fromProposal && it.kraNo == null) kra.value = "new";
    toggle(); kra.onchange = toggle;
    dep.onchange = () => { kra.innerHTML = kraOptions(dep.value); toggle(); };
    m.querySelector("#mSave").onclick = async () => {
      const dId = dep.value; const items = S.depts[dId].items || [];
      const text = m.querySelector("#mText").value.trim(); if (!text) return toast("Write the KPI first.");
      let kraNo, kraName, kraW;
      if (kra.value === "new") {
        kraName = m.querySelector("#mKraName").value.trim(); if (!kraName) return toast("Give the new KRA a name.");
        kraNo = Math.max(0, ...items.map((i) => +i.kraNo || 0)) + 1; kraW = +m.querySelector("#mKraW").value || 0;
      } else { kraNo = +kra.value; const ex = items.find((i) => i.kraNo === kraNo) || {}; kraName = ex.kra; kraW = ex.kraW || 0; }
      const tvRaw = m.querySelector("#mTv").value; const dir = m.querySelector("#mDir").value;
      const rec = {
        id: it.id || dId + "-" + Date.now().toString(36), kraNo, kra: kraName, kraW, no: m.querySelector("#mNo").value.trim() || `${kraNo}.${items.filter((i) => i.kraNo === kraNo).length + 1}`,
        text, target: m.querySelector("#mTarget").value.trim() || "[set]", tv: dir === "zero" ? 0 : tvRaw === "" ? null : +tvRaw, dir,
        freq: m.querySelector("#mFreq").value, owner: m.querySelector("#mOwner").value.trim(), star: m.querySelector("#mStar").checked,
      };
      const ok = await run(supabase.from("kpis").upsert(kpiRow(dId, rec)), it.id ? "KPI updated" : "KPI added");
      if (ok && fromProposal && fromProposal._id) await run(supabase.from("proposals").update({ status: "approved", decided_at: nowIso() }).eq("id", fromProposal._id));
      if (ok) { closeModal(); await Promise.all([loadDepts(), loadProposals()]); render(); }
    };
  });
}
function proposeModal() {
  const ds = deptList().filter((d) => mayEditDept(d.id)); const dep0 = hodLocked() ? S.me.dept_id : S.masterDept;
  openModal(`<h2>Propose a KRA / KPI</h2><p class="note">The admin reviews it and adds it to the approved list.</p>
    <div class="form-grid">
      <label class="f">Department<select class="inp" id="pDept">${ds.map((d) => `<option value="${d.id}" ${d.id === dep0 ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
      <label class="f">KRA<select class="inp" id="pKra">${kraOptions(dep0)}</select></label>
      <label class="f wide" id="pNewW" hidden>New KRA name<input class="inp" id="pKraName"></label>
      <label class="f wide">KPI<textarea class="inp" id="pText" rows="2"></textarea></label>
      <label class="f">Target<input class="inp" id="pTarget" placeholder="e.g. 95%"></label>
      <label class="f">Frequency<select class="inp" id="pFreq">${Object.entries(FREQ).map(([k, l]) => `<option value="${k}" ${k === "W" ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f wide">Owner(s)<input class="inp" id="pOwner"></label>
      <label class="f wide">Why it is needed<textarea class="inp" id="pNote" rows="2"></textarea></label>
    </div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="pSave">Send proposal</button></div>`, (m) => {
    const kra = m.querySelector("#pKra"), dep = m.querySelector("#pDept");
    const tg = () => (m.querySelector("#pNewW").hidden = kra.value !== "new"); tg(); kra.onchange = tg;
    dep.onchange = () => { kra.innerHTML = kraOptions(dep.value); tg(); };
    m.querySelector("#pSave").onclick = async () => {
      const text = m.querySelector("#pText").value.trim(); if (!text) return toast("Write the KPI first.");
      let kraNo = null, kraName = m.querySelector("#pKraName").value.trim();
      if (kra.value !== "new") { kraNo = +kra.value; kraName = ((S.depts[dep.value].items || []).find((i) => i.kraNo === kraNo) || {}).kra || ""; }
      else if (!kraName) return toast("Give the new KRA a name.");
      const ok = await run(supabase.from("proposals").insert({ dept_id: dep.value, kra_no: kraNo, kra_name: kraName, text, target: m.querySelector("#pTarget").value.trim(),
        freq: m.querySelector("#pFreq").value, owner: m.querySelector("#pOwner").value.trim(), note: m.querySelector("#pNote").value.trim() }), "Proposal sent to admin");
      if (ok) { closeModal(); await loadProposals(); render(); }
    };
  });
}
function deptModal(id) {
  const d = id ? S.depts[id] : {};
  openModal(`<h2>${id ? "Edit department" : "Add department"}</h2>
    <div class="form-grid"><label class="f">Name<input class="inp" id="dName" value="${esc(d.name || "")}"></label>
    <label class="f">HOD<input class="inp" id="dHod" value="${esc(d.hod || "")}"></label>
    <label class="f">Order in meeting<input class="inp" id="dOrder" type="number" value="${d.order ?? deptList().length + 1}"></label></div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="dSave">Save</button></div>`, (m) => {
    m.querySelector("#dSave").onclick = async () => {
      const name = m.querySelector("#dName").value.trim(); if (!name) return toast("Give the department a name.");
      const nid = id || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "dept-" + Date.now();
      const ok = await run(supabase.from("departments").upsert({ id: nid, name, hod: m.querySelector("#dHod").value.trim(), sort_order: +m.querySelector("#dOrder").value || 99, updated_at: nowIso() }), id ? "Department updated" : "Department added");
      if (ok) { if (!id) S.masterDept = nid; closeModal(); await loadDepts(); render(); }
    };
  });
}
function actionModal() {
  const ds = deptList().filter((d) => mayEditDept(d.id)); const dep0 = S.pendDept !== "all" ? S.pendDept : S.dept;
  openModal(`<h2>Add action</h2><div class="form-grid">
    <label class="f">Department<select class="inp" id="aDept">${ds.map((d) => `<option value="${d.id}" ${d.id === dep0 ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
    <label class="f">KPI number (optional)<input class="inp" id="aKpi"></label>
    <label class="f wide">Action<textarea class="inp" id="aText" rows="2"></textarea></label>
    <label class="f">Owner<input class="inp" id="aOwner"></label><label class="f">Due date<input class="inp" type="date" id="aDue"></label></div>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="aSave">Add action</button></div>`, (m) => {
    m.querySelector("#aSave").onclick = async () => {
      const action = m.querySelector("#aText").value.trim(); if (!action) return toast("Describe the action.");
      const ok = await run(supabase.from("actions").insert({ dept_id: m.querySelector("#aDept").value, kpi_no: m.querySelector("#aKpi").value.trim(), action,
        owner: m.querySelector("#aOwner").value.trim(), due: m.querySelector("#aDue").value || null, status: "Open", week: S.week }), "Action added");
      if (ok) { closeModal(); await loadActions(); render(); }
    };
  });
}
function resetPwModal(id) {
  const p = S.profiles.find((x) => x.id === id); const pw = genPw();
  openModal(`<h2>Reset password</h2><p class="note">For ${esc(p.full_name || "")}${p.username ? ` (username <b>${esc(p.username)}</b>)` : ""}. Share the new password with them.</p>
    <label class="f">New password<input class="inp" id="rpw" value="${pw}" minlength="6"></label>
    <div class="actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rpSave">Set password</button></div>`, (m) => {
    m.querySelector("#rpSave").onclick = async () => { if (await adminUser({ action: "set_password", user_id: id, password: m.querySelector("#rpw").value }, "Password reset")) closeModal(); };
  });
}

/* ---------- clicks & inputs ---------- */
$("#main").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act;
  if (a === "goto-submit") { S.dept = b.dataset.dept; LS.set("dept", S.dept); S.tab = "submit"; LS.set("tab", "submit"); S.form = null; render(); window.scrollTo(0, 0); }
  else if (a === "set-dept") {
    const go = () => { S.formDirty = false; S.form = null; S.dept = b.dataset.dept; LS.set("dept", S.dept); render(); };
    if (S.formDirty) return confirmModal("Leave without saving this department's changes?", "Leave", go);
    go();
  }
  else if (a === "ppt") makePpt();
  else if (a === "save-draft") saveResult("draft");
  else if (a === "submit") saveResult("submitted");
  else if (a === "add-new") {
    const text = $("#naText").value.trim(); if (!text) return toast("Describe the action.");
    const kid = $("#naKpi").value; const it = kid ? (S.depts[S.dept].items || []).find((i) => i.id === kid) : null;
    S.form.newActions.push({ kpiNo: it ? it.no : "", kpiText: it ? it.text : "", action: text, owner: $("#naOwner").value.trim(), due: $("#naDue").value });
    markDirty(); render();
  }
  else if (a === "rm-new") { S.form.newActions.splice(+b.dataset.ix, 1); render(); }
  else if (a === "wdept") { S.weeklyDept = b.dataset.dept; LS.set("wdept", S.weeklyDept); render(); }
  else if (a === "mdept") { S.masterDept = b.dataset.dept; LS.set("mdept", S.masterDept); render(); }
  else if (a === "add-kpi") kpiModal(S.masterDept, null);
  else if (a === "edit-kpi") kpiModal(S.masterDept, (S.depts[S.masterDept].items || []).find((i) => i.id === b.dataset.id));
  else if (a === "del-kpi") {
    const id = b.dataset.id; const it = (S.depts[S.masterDept].items || []).find((i) => i.id === id);
    confirmModal(`Delete KPI ${it.no} from ${S.depts[S.masterDept].name}?`, "Delete", async () => { if (await run(supabase.from("kpis").delete().eq("id", id), "KPI deleted")) { await loadDepts(); render(); } });
  }
  else if (a === "add-dept") deptModal(null);
  else if (a === "edit-dept") deptModal(S.masterDept);
  else if (a === "propose") proposeModal();
  else if (a === "approve") { const p = S.proposals.find((x) => x._id === b.dataset.id); kpiModal(p.dept, { kraNo: p.kraNo, kra: p.kraName, text: p.text, target: p.target, freq: p.freq, owner: p.owner }, p); }
  else if (a === "reject") {
    const p = S.proposals.find((x) => x._id === b.dataset.id);
    confirmModal("Reject this proposal?", "Reject", async () => { if (await run(supabase.from("proposals").update({ status: "rejected", decided_at: nowIso() }).eq("id", p._id), "Proposal rejected")) { await loadProposals(); render(); } });
  }
  else if (a === "add-action") actionModal();
  else if (a === "del-action") confirmModal("Delete this action?", "Delete", async () => { if (await run(supabase.from("actions").delete().eq("id", b.dataset.id), "Action deleted")) { await loadActions(); render(); } });
  else if (a === "pfilter") { S.pendFilter = b.dataset.k; render(); }
  else if (a === "ai-check") { if (!S.aiBusy) runCheck(); }
  else if (a === "md-review") { if (!S.mdBusy) runMdReview(); }
  else if (a === "gen-pw") { $("#nuPw").value = genPw(); }
  else if (a === "reset-pw") resetPwModal(b.dataset.id);
  else if (a === "del-user") { const p = S.profiles.find((x) => x.id === b.dataset.id); confirmModal(`Delete ${p.full_name || p.username || "this user"}'s login?`, "Delete", () => adminUser({ action: "delete", user_id: p.id }, "User deleted")); }
  else if (a === "job") { if (!S.jobBusy) runJob(b.dataset.job); }
});
$("#main").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.id === "newUser") {
    const name = $("#nuName").value.trim(), user = normUsername($("#nuUser").value), phone = $("#nuPhone").value.trim(), pw = $("#nuPw").value;
    if (!name) return toast("Enter the person's name.");
    if (!user) return toast("Username: 3–30 letters or numbers, no spaces (dot, dash, underscore allowed).");
    if (phone && !normPhone(phone)) return toast("Enter a valid 10-digit mobile number (or leave it empty).");
    if (pw.length < 6) return toast("Password must be at least 6 characters.");
    S.jobBusy = "user";
    const ok = await adminUser({ action: "create", full_name: name, username: user, phone: phone || null, password: pw, role: $("#nuRole").value, dept_id: $("#nuDept").value || null }, `Login created for ${name}`);
    S.jobBusy = "";
    if (ok) toast(`Login created. Username ${user} · password ${pw}`);
    render();
  }
  if (e.target.id === "stForm") {
    const nums = $("#stNums").value.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    const bad = nums.filter((n) => !normPhone(n));
    if (bad.length) return toast("Not a valid mobile number: " + bad.join(", "));
    const ok = await run(supabase.from("app_settings").update({ report_numbers: nums.map(normPhone), bot_scope: $("#stScope").value, tpl_start: $("#stTs").value.trim(), tpl_report: $("#stTr").value.trim(), tpl_lang: $("#stTl").value.trim() || "ml", updated_at: nowIso() }).eq("id", 1), "Settings saved");
    if (ok) { await loadAdmin(); render(); }
  }
});
$("#main").addEventListener("input", (e) => {
  if (e.target.id === "q") { S.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); }
});
$("#main").addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "pendDept") { S.pendDept = t.value; render(); }
  else if (t.dataset.pstat) updateAction(t.dataset.pstat, { status: t.value });
  else if (t.dataset.pres) updateAction(t.dataset.pres, { result: t.value });
  else if (t.dataset.urole) adminUser({ action: "update", user_id: t.dataset.urole, role: t.value }, "Role updated");
  else if (t.dataset.udept) adminUser({ action: "update", user_id: t.dataset.udept, dept_id: t.value || null }, "Department updated");
  else if (t.dataset.uname) adminUser({ action: "update", user_id: t.dataset.uname, full_name: t.value.trim() }, "Name updated");
  else if (t.dataset.uphone) {
    if (t.value.trim() && !normPhone(t.value)) { toast("Enter a valid 10-digit mobile number."); return; }
    adminUser({ action: "update", user_id: t.dataset.uphone, phone: t.value.trim() }, "WhatsApp mobile updated");
  }
  else if (t.dataset.uuser) {
    const u = normUsername(t.value);
    if (!u) { toast("Username: 3–30 letters or numbers, no spaces (dot, dash, underscore allowed)."); return; }
    adminUser({ action: "update", user_id: t.dataset.uuser, username: u }, `Username changed — they now sign in as ${u}`);
  }
});

/* ---------- PowerPoint (same builder as the Saturday 5 PM job) ---------- */
async function makePpt() {
  const btn = $("#pptBtn"); btn.disabled = true; const old = btn.textContent; btn.textContent = "Building…";
  try {
    const deck = buildDeck(PptxGenJS, { week: S.week, depts: S.depts, results: S.results, prev: S.prev, actions: S.actions, review: S.review, today: today() });
    await deck.writeFile({ fileName: `HOD-Review-${S.week}.pptx` });
    toast("PowerPoint downloaded");
  } catch (e) { toast("Couldn't make the PPT: " + ((e && e.message) || "try again")); }
  finally { btn.disabled = false; btn.textContent = old; }
}

/* ---------- start ---------- */
async function start(session) {
  S.session = session;
  if (!session) { S.ready = false; if (S.channel) { supabase.removeChannel(S.channel); S.channel = null; } showLogin(); return; }
  $("#main").innerHTML = `<div class="empty">Loading…</div>`;
  await loadProfiles();
  if (!S.me || S.me.role === "pending") {
    showPending();
    if (S.channel) supabase.removeChannel(S.channel);
    S.channel = supabase.channel("me").on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${session.user.id}` }, () => start(S.session)).subscribe();
    return;
  }
  S.isAdmin = S.me.role === "admin"; S.canWrite = ["admin", "hod"].includes(S.me.role);
  if (!LS.get("tab", null)) S.tab = (TABS[role()] || ["submit"])[0];
  await loadAll(); S.ready = true; render(); subscribe();
}
let started = null;
supabase.auth.onAuthStateChange((event, session) => {
  const id = session ? session.user.id : null;
  if (event === "TOKEN_REFRESHED" && id === started) { S.session = session; return; }
  if (id === started && event !== "SIGNED_OUT" && event !== "INITIAL_SESSION") return;
  started = id; setTimeout(() => start(session), 0);
});
