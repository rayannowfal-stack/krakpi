// WhatsApp webhook: Meta sends every incoming message here.
// Deploy with JWT verification OFF (Meta does not send a Supabase login).
// Secrets: WA_TOKEN, WA_PHONE_NUMBER_ID, WA_VERIFY_TOKEN, WA_APP_SECRET (recommended), ANTHROPIC_API_KEY.
import { serviceClient } from "../_shared/claude.ts";
import { sendText, validSignature } from "../_shared/wa.ts";
import { handleMessage } from "../_shared/bot.ts";

// deno-lint-ignore no-explicit-any
async function handleOne(db: any, m: any) {
  const from = String(m.from || "");
  // voice notes, photos, documents (and videos) can be sent as proof for a KPI
  const mm = m.audio || m.voice || m.image || m.document || m.video;
  const media = mm && mm.id ? { id: String(mm.id), mime: String(mm.mime_type || ""), filename: String(m.document?.filename || ""), voice: !!(m.audio?.voice || m.voice) } : null;
  const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m.image?.caption ?? m.document?.caption ?? m.video?.caption ?? "";
  // ignore duplicates (Meta retries deliveries)
  const ins = await db.from("wa_log").insert({ msg_id: m.id, phone: from, direction: "in", body: (media ? `[${m.type}] ` : "") + (text || (media ? "" : `[${m.type}]`)) });
  if (ins.error) { if (String(ins.error.message).includes("duplicate")) return; console.error(ins.error); }

  const { data: profile } = await db.from("profiles").select("id, full_name, phone, role, dept_id").eq("phone", from).maybeSingle();
  if (!profile) return sendText(db, from, "ഈ നമ്പർ Atlas KPI Review-ൽ രജിസ്റ്റർ ചെയ്തിട്ടില്ല. Admin-നെ ബന്ധപ്പെടുക.");
  if (profile.role === "pending") return sendText(db, from, "നിങ്ങളുടെ അക്കൗണ്ടിന് Admin ഇതുവരെ അനുമതി നൽകിയിട്ടില്ല.");
  if (!text && !media) return sendText(db, from, "ടെക്സ്റ്റ്, ശബ്ദ സന്ദേശം, ഫോട്ടോ അല്ലെങ്കിൽ ഡോക്യുമെന്റ് മാത്രമേ സ്വീകരിക്കൂ.");
  try { await handleMessage(db, profile, text, media); }
  catch (e) {
    console.error("bot error", e);
    await sendText(db, from, "ക്ഷമിക്കണം, ഒരു പ്രശ്നം വന്നു. കുറച്ച് കഴിഞ്ഞ് START അയക്കുക.").catch(() => {});
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Meta's one-time webhook verification
  if (req.method === "GET") {
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === Deno.env.get("WA_VERIFY_TOKEN")) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("x-hub-signature-256")))) return new Response("Bad signature", { status: 401 });
  let body;
  try { body = JSON.parse(raw); } catch { return new Response("ok"); }

  const msgs = [];
  for (const e of body.entry ?? []) for (const c of e.changes ?? []) for (const m of c.value?.messages ?? []) msgs.push(m);
  if (!msgs.length) return new Response("ok"); // delivery/read receipts

  const db = serviceClient();
  // answer Meta at once; keep working in the background (Claude can take up to a minute)
  const work = (async () => { for (const m of msgs) await handleOne(db, m); })();
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(work); else await work;
  return new Response("ok");
});
