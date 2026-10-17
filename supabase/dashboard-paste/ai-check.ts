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
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: claudeHeaders(key),
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: attachments.length ? [...attachments, { type: "text", text: prompt + "\n\nReply with the JSON object only \u2014 no other text." }] : prompt + "\n\nReply with the JSON object only \u2014 no other text." }]
    })
  });
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
  const { blocks, notes } = await proofBlocks(b.storage, b.files);
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
    if (!b.kpi || typeof b.kpi !== "object") throw new HttpError(400, "Fill in the KPI first.");
    const files = (Array.isArray(b.files) ? b.files : []).slice(0, 8).filter((f) => typeof f?.path === "string" && f.path.startsWith(`${week}/${deptId}/`));
    const out = await checkKpi({
      deptName: str(b.deptName, 80),
      hod: str(b.hod, 120),
      week: str(b.weekLabel, 40),
      kpi: b.kpi,
      earlier: Array.isArray(b.earlier) ? b.earlier.slice(0, 10) : [],
      storage: supabase.storage,
      files
    });
    return json(out);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : "Something went wrong." }, status);
  }
});
