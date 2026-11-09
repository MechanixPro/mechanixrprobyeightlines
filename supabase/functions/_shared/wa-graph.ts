// Graph API calls for the WhatsApp Cloud inbox. Every call has a timeout. A send is NEVER retried here: if we cannot tell whether Meta accepted it, we say so.
import { env } from './util.ts';

const base = () => `https://graph.facebook.com/${env('WA_GRAPH_VERSION', 'v21.0')}`;
export const cloudReady = () => Boolean(env('WA_TOKEN') && env('WA_PHONE_NUMBER_ID'));
const auth = () => ({ Authorization: `Bearer ${env('WA_TOKEN')}` });

export type SendResult = { ok: true; id: string } | { ok: false; unknown: false; status: number; error: string } | { ok: false; unknown: true; error: string };

/** POST one message. 2xx with an id = sent. A 4xx answer from Meta = definitely not sent. A timeout, network error, 5xx or a 2xx without an id = delivery unknown. */
export async function sendMessage(payload: Record<string, unknown>, timeoutMs = 15000): Promise<SendResult> {
  let r: Response;
  try {
    r = await fetch(`${base()}/${env('WA_PHONE_NUMBER_ID')}/messages`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
  } catch { return { ok: false, unknown: true, error: 'No answer from WhatsApp in time' }; }
  const j: any = await r.json().catch(() => ({}));
  if (r.ok) return j?.messages?.[0]?.id ? { ok: true, id: String(j.messages[0].id) } : { ok: false, unknown: true, error: 'WhatsApp answered without a message id' };
  if (r.status >= 500) return { ok: false, unknown: true, error: 'WhatsApp had a problem on its side' };
  console.error('wa-send rejected', r.status, JSON.stringify(j?.error ?? {}).slice(0, 300));
  return { ok: false, unknown: false, status: r.status, error: String(j?.error?.error_user_msg ?? j?.error?.message ?? 'WhatsApp refused the message').slice(0, 300) };
}

/** Upload media so a reply can reference it. Uploading sends nothing to the customer, so a failure here is always safe. */
export async function uploadMedia(bytes: Uint8Array, mime: string, filename: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp'); fd.append('type', mime);
  fd.append('file', new Blob([bytes], { type: mime }), filename);
  try {
    const r = await fetch(`${base()}/${env('WA_PHONE_NUMBER_ID')}/media`, { method: 'POST', headers: auth(), body: fd, signal: AbortSignal.timeout(30000) });
    const j: any = await r.json().catch(() => ({}));
    if (r.ok && j?.id) return { ok: true, id: String(j.id) };
    return { ok: false, error: String(j?.error?.message ?? 'WhatsApp did not take the file').slice(0, 200) };
  } catch { return { ok: false, error: 'No answer from WhatsApp while uploading the file' }; }
}

/** Download a customer's media by Meta media id, on demand. The bytes go straight to the caller and are never stored. */
export async function fetchMedia(mediaId: string): Promise<{ ok: true; bytes: ArrayBuffer; mime: string } | { ok: false; status: number; error: string }> {
  try {
    const meta = await fetch(`${base()}/${encodeURIComponent(mediaId)}`, { headers: auth(), signal: AbortSignal.timeout(15000) });
    const m: any = await meta.json().catch(() => ({}));
    if (!meta.ok || !m?.url) return { ok: false, status: meta.status === 404 || meta.status === 400 ? 410 : 502, error: 'WhatsApp no longer has this file (media is kept about 30 days)' };
    const f = await fetch(String(m.url), { headers: auth(), signal: AbortSignal.timeout(30000) });
    if (!f.ok) return { ok: false, status: 502, error: 'Could not download the file from WhatsApp' };
    return { ok: true, bytes: await f.arrayBuffer(), mime: String(m.mime_type ?? f.headers.get('content-type') ?? 'application/octet-stream') };
  } catch { return { ok: false, status: 504, error: 'No answer from WhatsApp while downloading' }; }
}
