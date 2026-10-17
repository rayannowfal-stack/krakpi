// Shared helpers for the Claude-powered Edge Functions.
// The Claude API key lives only here, as a Supabase secret (ANTHROPIC_API_KEY) — never in the browser.
import { createClient } from "jsr:@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

/** A Supabase client with full access, for server jobs (cron, WhatsApp). Never sent to the browser. */
export function serviceClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

/** Returns the signed-in user's profile and a Supabase client acting as that user, or throws. */
export async function getCaller(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new HttpError(401, "Please sign in again.");
  const { data: profile } = await supabase.from("profiles").select("id, role, dept_id").eq("id", user.id).maybeSingle();
  if (!profile || profile.role === "pending") throw new HttpError(403, "Your account is waiting for the admin to give you access.");
  return { supabase, user, profile };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Sends one prompt to Claude and returns the reply parsed as JSON. */
export async function askClaudeJson(prompt: string, opts: { model: string; maxTokens: number }) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new HttpError(500, "Claude is not set up: add the ANTHROPIC_API_KEY secret in Supabase.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: prompt + "\n\nReply with the JSON object only — no other text." }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("Claude API error", res.status, detail);
    if (res.status === 429 || res.status === 529) throw new HttpError(503, "Claude is busy right now. Try again in a minute.");
    if (res.status === 401) throw new HttpError(500, "The Claude API key is not valid. Check the ANTHROPIC_API_KEY secret.");
    throw new HttpError(502, "Claude could not answer. Try again.");
  }
  const data = await res.json();
  const text: string = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("");
  return parseJson(text);
}

/** Tolerant JSON extraction: the whole reply, a ```json fence, or the outermost {...}. */
export function parseJson(text: string) {
  const tries = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) tries.push(fence[1].trim());
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) { try { return JSON.parse(t); } catch { /* next */ } }
  throw new HttpError(502, "Claude's answer came back in the wrong shape. Try again.");
}

export const RATINGS = ["Result-oriented", "Partly result-oriented", "Activity only"];
export const str = (v: unknown, max = 600) => String(v ?? "").slice(0, max);
export const strArr = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => str(x, 400)) : []);
