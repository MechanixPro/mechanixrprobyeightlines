// WhatsApp Cloud API inbox: pure helpers shared by whatsapp-webhook, wa-send and wa-media (no Deno or network calls, so tests import it directly).

/** Indian mobile, last 10 digits, or null when it is not one. Accepts +91, 91, 0 prefixes and spaces. */
export function normalizePhone(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2); else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

const te = new TextEncoder();
async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', te.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(data)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Meta signs the RAW body with the app secret: header x-hub-signature-256 = "sha256=<hex>". Missing secret, header or a wrong value all fail. */
export async function verifyMetaSignature(secret: string, rawBody: string, header: string | null | undefined): Promise<boolean> {
  if (!secret || !header || !header.startsWith('sha256=')) return false;
  const got = header.slice(7).toLowerCase(), want = await hmacHex(secret, rawBody);
  if (got.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export type MediaRef = { type: 'image' | 'audio' | 'video' | 'document' | 'sticker'; id: string; mime?: string; filename?: string; caption?: string; voice?: boolean };
export type ParsedMessage = { id: string; from: string; phone: string | null; type: string; body: string; media: MediaRef | Record<string, unknown> | null; at: string | null; profileName: string; waNumber: string; replyTo?: string };
export type ParsedStatus = { id: string; status: 'sent' | 'delivered' | 'read' | 'failed'; at: string | null; error: string | null; phone: string | null };

const iso = (ts: unknown) => { const n = Number(ts); return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null; };

/** One Meta message object to what we store: a readable body plus the media id and mime only (never the bytes). */
export function parseMessage(msg: any, profileName = '', waNumber = ''): ParsedMessage {
  const type = String(msg?.type ?? 'unknown');
  let body = ''; let media: ParsedMessage['media'] = null;
  const mediaOf = (t: MediaRef['type'], o: any, label: string) => {
    media = { type: t, id: String(o?.id ?? ''), mime: o?.mime_type ? String(o.mime_type) : undefined, filename: o?.filename ? String(o.filename).slice(0, 120) : undefined, caption: o?.caption ? String(o.caption).slice(0, 1000) : undefined, voice: t === 'audio' ? !!o?.voice : undefined };
    body = o?.caption ? String(o.caption) : label;
  };
  switch (type) {
    case 'text': body = String(msg.text?.body ?? ''); break;
    case 'image': mediaOf('image', msg.image, '[Photo]'); break;
    case 'audio': mediaOf('audio', msg.audio, msg.audio?.voice ? '[Voice note]' : '[Audio]'); break;
    case 'video': mediaOf('video', msg.video, '[Video]'); break;
    case 'sticker': mediaOf('sticker', msg.sticker, '[Sticker]'); break;
    case 'document': mediaOf('document', msg.document, msg.document?.filename ? `[Document: ${String(msg.document.filename).slice(0, 80)}]` : '[Document]'); break;
    case 'location': {
      const la = msg.location?.latitude, lo = msg.location?.longitude;
      media = { type: 'location', latitude: la, longitude: lo, name: msg.location?.name ?? null };
      body = `My location: https://maps.google.com/?q=${la},${lo}`; break;
    }
    case 'button': body = String(msg.button?.text ?? msg.button?.payload ?? ''); media = { type: 'button', payload: msg.button?.payload ?? null }; break;
    case 'interactive': {
      const r = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
      body = String(r?.title ?? ''); media = { type: 'interactive', id: r?.id ?? null }; break;
    }
    case 'reaction': body = `[Reaction ${msg.reaction?.emoji ?? ''}]`; break;
    default: body = `[${type}]`;
  }
  return { id: String(msg?.id ?? ''), from: String(msg?.from ?? ''), phone: normalizePhone(msg?.from), type, body: body.slice(0, 4000), media, at: iso(msg?.timestamp), profileName, waNumber, replyTo: msg?.context?.id };
}

/** Whole webhook body: every message and every delivery status, from every entry and change. Bad shapes are skipped, never thrown. */
export function parseWebhook(body: any): { messages: ParsedMessage[]; statuses: ParsedStatus[] } {
  const messages: ParsedMessage[] = [], statuses: ParsedStatus[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
    const v = change?.value ?? {}; const wa = String(v.metadata?.display_phone_number ?? '').replace(/\D/g, '');
    const names: Record<string, string> = {}; for (const c of v.contacts ?? []) if (c?.wa_id) names[String(c.wa_id)] = String(c.profile?.name ?? '');
    for (const m of v.messages ?? []) if (m?.id) messages.push(parseMessage(m, names[String(m.from)] ?? v.contacts?.[0]?.profile?.name ?? '', wa));
    for (const s of v.statuses ?? []) {
      const st = String(s?.status ?? '');
      if (s?.id && ['sent', 'delivered', 'read', 'failed'].includes(st))
        statuses.push({ id: String(s.id), status: st as ParsedStatus['status'], at: iso(s.timestamp), error: st === 'failed' ? String(s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? 'Delivery failed').slice(0, 300) : null, phone: normalizePhone(s.recipient_id) });
    }
  }
  return { messages, statuses };
}

/** Delivery status only moves forward: unknown < sent < delivered < read; failed only before delivery. Mirrors public.wa_apply_status in the database. */
const RANK: Record<string, number> = { unknown: 1, sent: 2, delivered: 3, read: 4 };
export function canAdvanceStatus(current: string | null | undefined, next: string): boolean {
  if (!['sent', 'delivered', 'read', 'failed'].includes(next)) return false;
  const cur = current ?? '';
  if (next === 'failed') return !['delivered', 'read', 'failed'].includes(cur);
  if (cur === 'failed') return false;
  return (RANK[next] ?? 0) > (RANK[cur] ?? 0);
}

/** WhatsApp lets us send free-form messages only within 24 hours of the customer's last message. */
export const WINDOW_MS = 24 * 3600_000;
export function windowOpen(lastInboundAt: string | Date | null | undefined, now: number = Date.now()): boolean {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  return Number.isFinite(t) && now - t < WINDOW_MS;
}
export function windowMsLeft(lastInboundAt: string | Date | null | undefined, now: number = Date.now()): number {
  return lastInboundAt ? Math.max(0, new Date(lastInboundAt).getTime() + WINDOW_MS - now) : 0;
}
export const WINDOW_CLOSED_MESSAGE = 'More than 24 hours since the customer wrote. WhatsApp only allows an approved template message now. Pick a template.';

export type SendRequest = { phone?: unknown; text?: unknown; template?: { name?: unknown; lang?: unknown; vars?: unknown } | null; media?: { type?: unknown; base64?: unknown; mime?: unknown; filename?: unknown; caption?: unknown } | null };
export type SendDecision = { ok: true; kind: 'text' | 'template' | 'media' } | { ok: false; status: number; error: string; code?: string };
/** Decide what wa-send may do before any network call. Free-form text and media need an open window (409 otherwise); a template is always allowed. */
export function decideSend(req: SendRequest, ctx: { windowOpen: boolean; optedOut: boolean }): SendDecision {
  if (ctx.optedOut) return { ok: false, status: 400, error: 'This customer asked not to get messages' };
  if (req.template && req.template.name) {
    if (!normalizeLang(req.template.lang)) return { ok: false, status: 400, error: 'Pick English, Hindi or Kannada for the template' };
    return { ok: true, kind: 'template' };
  }
  const kind = req.media && req.media.base64 ? 'media' : String(req.text ?? '').trim() ? 'text' : null;
  if (!kind) return { ok: false, status: 400, error: 'Write a message first' };
  if (!ctx.windowOpen) return { ok: false, status: 409, error: WINDOW_CLOSED_MESSAGE, code: 'window_closed' };
  return { ok: true, kind };
}

/** Template language codes the desk can send: English, Hindi, Kannada. */
export const LANGS: Record<string, string> = { en: 'en', english: 'en', en_us: 'en_US', hi: 'hi', hindi: 'hi', kn: 'kn', kannada: 'kn' };
export function normalizeLang(l: unknown): string | null { return LANGS[String(l ?? 'en').toLowerCase()] ?? null; }

export type CloudTemplate = { key: string; name: string; label: string; vars: string[] };
/** The templates the desk may send from the Cloud number. Names can be overridden with the same WA_TPL_* secrets the website uses. */
export function cloudTemplates(get: (key: string, fallback: string) => string): CloudTemplate[] {
  return [
    { key: 'followup', name: get('WA_TPL_FOLLOWUP', 'mxp_followup'), label: 'Follow-up', vars: ['Customer first name', 'Booking ID'] },
    { key: 'received', name: get('WA_TPL_RECEIVED', 'mxp_booking_received'), label: 'Booking received', vars: ['Customer first name', 'Booking ID', 'Service'] },
    { key: 'payment', name: get('WA_TPL_PAYMENT', 'mxp_payment_reminder'), label: 'Payment reminder', vars: ['Customer first name', 'Amount', 'Booking ID', 'Payment link'] },
    { key: 'paid', name: get('WA_TPL_PAID', 'mxp_payment_received'), label: 'Payment received', vars: ['Amount', 'Booking ID'] },
    { key: 'last', name: get('WA_TPL_LAST', 'mxp_last_reminder'), label: 'Last reminder', vars: ['Customer first name', 'Booking ID'] },
  ];
}

const MEDIA_TYPES: Record<string, { max: number; mimes: RegExp }> = {
  audio: { max: 16_000_000, mimes: /^audio\/(ogg|mpeg|mp4|aac|amr|opus)/ },
  image: { max: 5_000_000, mimes: /^image\/(jpeg|png)/ },
  document: { max: 100_000_000, mimes: /^(application\/(pdf|msword|vnd\.|zip)|text\/plain)/ },
};
/** A media reply: type, mime and size must be ones WhatsApp accepts. WhatsApp does not take WebM, so a voice note must be Ogg Opus, MP3, M4A, AAC or AMR. */
export function checkMedia(m: SendRequest['media']): { ok: true; type: 'audio' | 'image' | 'document'; mime: string } | { ok: false; error: string } {
  const type = String(m?.type ?? ''), mime = String(m?.mime ?? '').toLowerCase(), rule = MEDIA_TYPES[type];
  if (!rule) return { ok: false, error: 'Send an audio file, a photo or a document' };
  if (!rule.mimes.test(mime)) return { ok: false, error: type === 'audio' ? 'WhatsApp accepts voice notes as Ogg Opus, MP3, M4A, AAC or AMR, not WebM or WAV' : type === 'image' ? 'Photos must be JPEG or PNG' : 'That document type is not supported' };
  const bytes = Math.floor(String(m?.base64 ?? '').length * 3 / 4);
  if (bytes > rule.max) return { ok: false, error: `That file is too large (limit ${Math.round(rule.max / 1e6)} MB)` };
  return { ok: true, type: type as 'audio' | 'image' | 'document', mime };
}

export function templatePayload(to10: string, name: string, lang: string, vars: string[]) {
  return { messaging_product: 'whatsapp', to: '91' + to10, type: 'template', template: { name, language: { code: lang }, components: vars.length ? [{ type: 'body', parameters: vars.map((t) => ({ type: 'text', text: String(t).slice(0, 200) })) }] : [] } };
}
export const textPayload = (to10: string, body: string) => ({ messaging_product: 'whatsapp', to: '91' + to10, type: 'text', text: { preview_url: true, body: body.slice(0, 4000) } });
export function mediaPayload(to10: string, type: 'audio' | 'image' | 'document', mediaId: string, o: { caption?: string; filename?: string } = {}) {
  const obj: Record<string, unknown> = { id: mediaId };
  if (type !== 'audio' && o.caption) obj.caption = o.caption.slice(0, 1000);
  if (type === 'document' && o.filename) obj.filename = o.filename.slice(0, 120);
  return { messaging_product: 'whatsapp', to: '91' + to10, type, [type]: obj };
}
/** Human-readable body stored for a template send. */
export const templateBody = (name: string, vars: string[]) => `Template ${name}${vars.length ? ': ' + vars.join(' | ') : ''}`.slice(0, 1000);
