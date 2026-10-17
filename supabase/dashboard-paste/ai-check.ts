// ai-check — single-file version to paste into Supabase → Edge Functions → Deploy a new function → Via Editor (function name: ai-check). Generated from supabase/functions/ai-check; edit the originals, not this file.

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
  const t0 = Date.now();
  console.log(`claude: asking ${opts.model} (${attachments.length} file block(s), prompt ${prompt.length} chars)`);
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      signal: AbortSignal.timeout(Number(Deno.env.get("CLAUDE_TIMEOUT_MS") ?? (opts.maxTokens > 4e3 ? 3e5 : 11e4))),
      method: "POST",
      headers: claudeHeaders(key),
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        messages: [{ role: "user", content: attachments.length ? [...attachments, { type: "text", text: prompt + "\n\nReply with the JSON object only \u2014 no other text." }] : prompt + "\n\nReply with the JSON object only \u2014 no other text." }]
      })
    });
  } catch (e) {
    console.error(`claude: no answer after ${Date.now() - t0} ms`, e);
    throw new HttpError(504, "Claude took too long to answer. Try again \u2014 or attach a smaller photo / shorter PDF.");
  }
  console.log(`claude: HTTP ${res.status} after ${Date.now() - t0} ms`);
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

// supabase/functions/_shared/ai.ts
var IMG = ["image/jpeg", "image/png", "image/gif", "image/webp"];
function b64(bytes) {
  let s = "";
  const CH = 32768;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}
async function proofBlocks(storage, files) {
  const blocks = [];
  const notes = [];
  let total = 0;
  for (const f of (files || []).slice(0, 6)) {
    const type = String(f.type || "").split(";")[0].toLowerCase();
    const label = f.name || f.path.split("/").pop();
    if (f.kind === "voice" || type.startsWith("audio/")) {
      notes.push(`${label}: voice note (Claude cannot listen to audio)`);
      continue;
    }
    const readable = IMG.includes(type) || type === "application/pdf" || type.startsWith("text/") || type === "application/csv";
    if (!readable) {
      notes.push(`${label}: ${type || "file"} (cannot be opened by Claude)`);
      continue;
    }
    if (blocks.length >= 4) {
      notes.push(`${label}: not read (only 4 files are read per KPI)`);
      continue;
    }
    const { data, error } = await storage.from("evidence").download(f.path);
    if (error || !data) {
      notes.push(`${label}: could not be downloaded`);
      continue;
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const limit = IMG.includes(type) ? 37e5 : type === "application/pdf" ? 12e6 : 2e5;
    if (bytes.length > limit || total + bytes.length > 2e7) {
      notes.push(`${label}: too big for Claude to read`);
      continue;
    }
    total += bytes.length;
    if (IMG.includes(type)) blocks.push({ type: "image", source: { type: "base64", media_type: type, data: b64(bytes) } });
    else if (type === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64(bytes) }, title: String(label).slice(0, 100) });
    else blocks.push({ type: "text", text: `Attached file ${label}:
` + new TextDecoder().decode(bytes).slice(0, 2e4) });
    notes.push(`${label}: attached above (file ${blocks.length})`);
  }
  return { blocks, notes };
}
async function checkKpi(b) {
  const tp = Date.now();
  const { blocks, notes } = await proofBlocks(b.storage, b.files);
  console.log(`ai-check: proof read in ${Date.now() - tp} ms \u2192 ${blocks.length} block(s) \xB7 ${notes.join(" | ")}`);
  const prompt = `You check ONE weekly KPI result that a Head of Department (HOD) at Atlas Maharani Group (textile retail, Kerala, 24 showrooms) has just entered. It will be presented to the MD office on Monday. The MD wants RESULT-ORIENTED reporting, not "work done".

KPI and the HOD's entry: ${JSON.stringify(b.kpi)}
Department: ${str(b.deptName, 80)} (HOD: ${str(b.hod, 120)}) \xB7 Week: ${str(b.week, 40)}
Attachments (proof): ${JSON.stringify(notes)}
Earlier questions on this KPI and the HOD's answers: ${JSON.stringify((b.earlier || []).slice(0, 10))}

What to do:
1. The status (Green/Amber/Red) is calculated from the achievement % and cannot be changed, so never question the colour; question the figure and the evidence.
2. READ every attached photo / PDF / file. Find the number in it that this KPI is about (a count, a total, a %, an amount). Put that number in proof.count, and set proof.matches = true if it supports the HOD's answer (allow small rounding), false if it does not, null if the proof does not show that number. Say in proof.note, in one Malayalam sentence, what the proof shows. If nothing could be read, proof.read = false.
3. Amber/Red needs a real root cause and a concrete next step (what, who, by when). "Will improve" / "will follow up" is not enough.
4. Ask at most 3 short questions, only where something is unclear, unsupported, or does not match. Mark a question "high" only when the result cannot be accepted without the answer (e.g. proof contradicts the figure, Red with no real cause, 100% with no proof). If everything is clear, ask nothing.
5. Do not repeat a question the HOD already answered well.
verdict: "ok" = clear and supported, "doubt" = something to clarify, "weak" = activity-only / unsupported / proof contradicts.

LANGUAGE: "summary", "proof.note" and every question in simple, polite MALAYALAM (Malayalam script). Keep numbers and business terms (ATV, UPT, GP, PO, GRN, KPI, report names) in English inside the sentence. Each question must be answerable in one WhatsApp message.

Reply with only this JSON:
{"verdict":"ok"|"doubt"|"weak","summary":"<1-2 short sentences in Malayalam>","proof":{"read":true|false,"count":<number or null>,"matches":true|false|null,"note":"<Malayalam>"},"questions":[{"q":"<Malayalam question>","severity":"high"|"medium"|"low"}]}`;
  const res = await askClaudeJson(prompt, { model: Deno.env.get("CLAUDE_MODEL_CHECK") ?? "claude-sonnet-5-5", maxTokens: 2e3 }, blocks);
  const sev = (s) => ["high", "medium", "low"].includes(String(s)) ? String(s) : "medium";
  const order = { high: 0, medium: 1, low: 2 };
  const pr = res.proof && typeof res.proof === "object" ? res.proof : null;
  const cnt = pr ? Number(pr.count) : NaN;
  return {
    verdict: ["ok", "doubt", "weak"].includes(res.verdict) ? res.verdict : "doubt",
    summary: str(res.summary, 600),
    proof: (b.files || []).length ? { read: !!(pr && pr.read), count: pr && pr.count != null && Number.isFinite(cnt) ? cnt : null, matches: pr && typeof pr.matches === "boolean" ? pr.matches : null, note: str(pr && pr.note, 400) } : null,
    questions: (Array.isArray(res.questions) ? res.questions : []).slice(0, 3).map((x) => ({ q: str(x.q ?? x.question, 500), severity: sev(x.severity), answer: "" })).filter((x) => x.q).sort((a, c) => order[a.severity] - order[c.severity])
  };
}
async function checkFiles(b) {
  const { blocks, notes } = await proofBlocks(b.storage, b.files);
  const texts = (b.texts || []).slice(0, 6).map((t) => `--- File "${str(t.name, 120)}" ---
${str(t.text, 6e4)}`).join("\n\n");
  const answering = !!(b.earlier && b.earlier.length);
  const prompt = `You are the analyst for the MD office of Atlas Maharani Group (textile retail, Kerala, 24 showrooms). The MD office has uploaded ${answering ? "the HOD's ANSWERS to earlier questions, together with" : ""} KPI working file(s) from the ${str(b.deptName, 80)} department (HOD: ${str(b.hod, 120)}) for week ${str(b.week, 40)}.

The department's KPIs, and what the HOD entered in the app ("hodResult"; empty = not entered yet):
${JSON.stringify((b.kpis || []).slice(0, 80))}

Photos / PDFs (attached above): ${JSON.stringify(notes)}
Spreadsheets / documents as text:
${texts || "(none)"}
${answering ? `
Earlier questions to the HOD: ${JSON.stringify(b.earlier)}
HOD's answer (text, may be Malayalam): ${JSON.stringify(str(b.answerText, 6e3))}
For each earlier question judge the answer: "ok" = clear and supported, "weak" = vague or not supported, "missing" = not answered.` : ""}

What to do:
1. Read every file carefully. For each KPI that the files give a figure for, report it in "kpis": the KPI number, the figure the file shows ("value", as a count, total, amount or %, e.g. "46/48" or "92%" or "1420"), whether it matches the HOD's entered result ("matches": true / false, or null when the HOD has not entered one), and a one-line Malayalam note on where it came from / what is wrong.
2. Ask up to 6 direct questions for the HOD where the file is unclear, a figure does not match, data is missing for an important KPI, or something looks wrong. Each question names its KPI number when it is about one KPI.
3. "summary": 2-3 short Malayalam sentences: what the files show overall and the main concern.
Never invent figures that are not in the files.

LANGUAGE: summary, every note and every question in simple, polite MALAYALAM (Malayalam script). Keep numbers, KPI numbers and business terms (ATV, UPT, GP, PO, GRN, KPI, report names) in English inside the sentence.

Reply with only this JSON:
{"summary":"<Malayalam>","kpis":[{"no":"<KPI no>","value":"<figure in file>","matches":true|false|null,"note":"<Malayalam>"}],"questions":[{"kpiNo":"<KPI no or empty>","q":"<Malayalam question>"}]${answering ? ',"answers":[{"q":"<the earlier question>","verdict":"ok"|"weak"|"missing","note":"<Malayalam>"}]' : ""}}`;
  const res = await askClaudeJson(prompt, { model: Deno.env.get("CLAUDE_MODEL_FILES") ?? Deno.env.get("CLAUDE_MODEL_CHECK") ?? "claude-sonnet-5-5", maxTokens: 4e3 }, blocks);
  return {
    summary: str(res.summary, 1200),
    kpis: (Array.isArray(res.kpis) ? res.kpis : []).slice(0, 80).map((x) => ({ no: str(x.no, 20), value: str(x.value, 60), note: str(x.note, 400), matches: typeof x.matches === "boolean" ? x.matches : null })).filter((x) => x.no),
    questions: (Array.isArray(res.questions) ? res.questions : []).slice(0, 6).map((x) => ({ kpiNo: str(x.kpiNo, 20), q: str(x.q ?? x.question, 500) })).filter((x) => x.q),
    answers: (Array.isArray(res.answers) ? res.answers : []).slice(0, 12).map((x) => ({ q: str(x.q, 500), verdict: ["ok", "weak", "missing"].includes(String(x.verdict)) ? String(x.verdict) : "weak", note: str(x.note, 400) }))
  };
}
var RATINGS_MAP = Object.fromEntries(RATINGS.map((r) => [r, true]));

// supabase/functions/ai-check/index.ts
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { profile, supabase } = await getCaller(req);
    const b = await req.json();
    const deptId = str(b.deptId, 80), week = str(b.week, 10);
    if (!(profile.role === "admin" || profile.role === "hod" && profile.dept_id === deptId)) {
      throw new HttpError(403, "Only this department's HOD or an admin can run the Claude check.");
    }
    if (b.mode === "files") {
      if (profile.role !== "admin") throw new HttpError(403, "Only the MD office (admin) can run a file check.");
      const files2 = (Array.isArray(b.files) ? b.files : []).slice(0, 6).filter((f) => typeof f?.path === "string" && f.path.startsWith(`${week}/${deptId}/`));
      const texts = (Array.isArray(b.texts) ? b.texts : []).slice(0, 6).map((t) => ({ name: str(t?.name, 120), text: str(t?.text, 6e4) }));
      if (!files2.length && !texts.some((t) => t.text.trim()) && !str(b.answerText, 10).trim()) throw new HttpError(400, "Add a file (or the HOD's answer) first.");
      console.log(`ai-check files: ${deptId} \xB7 ${files2.length} photo/PDF \xB7 ${texts.length} text file(s)${b.earlier ? " \xB7 answer round" : ""}`);
      const t02 = Date.now();
      const out2 = await checkFiles({
        deptName: str(b.deptName, 80),
        hod: str(b.hod, 120),
        week: str(b.weekLabel, 40),
        kpis: Array.isArray(b.kpis) ? b.kpis.slice(0, 80) : [],
        texts,
        files: files2,
        storage: supabase.storage,
        earlier: Array.isArray(b.earlier) ? b.earlier.slice(0, 12) : void 0,
        answerText: str(b.answerText, 6e3)
      });
      console.log(`ai-check files: done in ${Date.now() - t02} ms \xB7 ${out2.kpis.length} KPI(s) marked \xB7 ${out2.questions.length} question(s)`);
      return json(out2);
    }
    if (!b.kpi || typeof b.kpi !== "object") throw new HttpError(400, "Fill in the KPI first.");
    const files = (Array.isArray(b.files) ? b.files : []).slice(0, 8).filter((f) => typeof f?.path === "string" && f.path.startsWith(`${week}/${deptId}/`));
    console.log(`ai-check: ${profile.role} \xB7 ${deptId} \xB7 KPI ${str(b.kpi.no, 20)} \xB7 ${files.length} file(s)`);
    const t0 = Date.now();
    const out = await checkKpi({
      deptName: str(b.deptName, 80),
      hod: str(b.hod, 120),
      week: str(b.weekLabel, 40),
      kpi: b.kpi,
      earlier: Array.isArray(b.earlier) ? b.earlier.slice(0, 10) : [],
      storage: supabase.storage,
      files
    });
    console.log(`ai-check: done in ${Date.now() - t0} ms \xB7 verdict ${out.verdict} \xB7 ${out.questions.length} question(s)`);
    return json(out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    console.error(`ai-check: failed (${status})`, e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
