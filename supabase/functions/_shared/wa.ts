// WhatsApp Business Platform (Meta Cloud API) helpers.
// Secrets needed: WA_TOKEN (permanent access token), WA_PHONE_NUMBER_ID (the sending number's ID).
// deno-lint-ignore no-explicit-any
type Db = any;
// API version: override with the WA_API_VERSION secret when Meta retires this one (about 2 years after release).
const API = () => `https://graph.facebook.com/${Deno.env.get("WA_API_VERSION") ?? "v25.0"}`;

async function post(body: Record<string, unknown>) {
  const token = Deno.env.get("WA_TOKEN"), id = Deno.env.get("WA_PHONE_NUMBER_ID");
  if (!token || !id) throw new Error("WhatsApp is not set up: add the WA_TOKEN and WA_PHONE_NUMBER_ID secrets.");
  const res = await fetch(`${API()}/${id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("WhatsApp error " + res.status + ": " + JSON.stringify(j.error || j).slice(0, 300));
  return j;
}

/** Free-text reply (allowed within 24 hours of the person's last message). */
export async function sendText(db: Db, to: string, text: string) {
  // WhatsApp limits a message to 4096 characters
  const parts = text.length > 4000 ? text.match(/[\s\S]{1,4000}/g)! : [text];
  for (const p of parts) await post({ to, type: "text", text: { body: p, preview_url: false } });
  if (db) await db.from("wa_log").insert({ phone: to, direction: "out", body: text.slice(0, 4000) });
}

/** Approved template message (needed to start a conversation, e.g. the Saturday kickoff). */
export async function sendTemplate(db: Db, to: string, name: string, lang: string, bodyParams: string[], headerDoc?: { link: string; filename: string }) {
  const components: Record<string, unknown>[] = [];
  if (headerDoc) components.push({ type: "header", parameters: [{ type: "document", document: { link: headerDoc.link, filename: headerDoc.filename } }] });
  if (bodyParams.length) components.push({ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) });
  await post({ to, type: "template", template: { name, language: { code: lang }, components } });
  if (db) await db.from("wa_log").insert({ phone: to, direction: "out", body: `[template ${name}] ${bodyParams.join(" | ")}${headerDoc ? " + " + headerDoc.filename : ""}` });
}

/** A document (e.g. the PPT) inside the 24-hour window. */
export async function sendDocument(db: Db, to: string, link: string, filename: string, caption: string) {
  await post({ to, type: "document", document: { link, filename, caption } });
  if (db) await db.from("wa_log").insert({ phone: to, direction: "out", body: `[document ${filename}] ${caption}` });
}

/** Downloads a voice note / photo / document someone sent (Meta keeps it about 30 days). */
export async function downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const token = Deno.env.get("WA_TOKEN");
  if (!token) throw new Error("WhatsApp is not set up: add the WA_TOKEN secret.");
  const meta = await fetch(`${API()}/${mediaId}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await meta.json().catch(() => ({}));
  if (!meta.ok || !j.url) throw new Error("WhatsApp media lookup failed " + meta.status + ": " + JSON.stringify(j.error || j).slice(0, 200));
  const file = await fetch(j.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!file.ok) throw new Error("WhatsApp media download failed " + file.status);
  return { bytes: new Uint8Array(await file.arrayBuffer()), mime: String(j.mime_type || file.headers.get("content-type") || "application/octet-stream").split(";")[0] };
}

/** Checks Meta's signature on incoming webhooks (when WA_APP_SECRET is set). */
export async function validSignature(raw: string, header: string | null) {
  const secret = Deno.env.get("WA_APP_SECRET");
  if (!secret) return true;
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === header.slice(7);
}
