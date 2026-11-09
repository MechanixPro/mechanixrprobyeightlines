// WhatsApp Cloud inbox: pure rules shared by the Crew inbox and the Admin supervision page (no DOM, no Supabase, so Node can test them).
// This file is mirrored byte for byte in admin/wa-rules.js (tests/wa-inbox-ui.test.mjs checks the copy).
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const WINDOW_MS = 24 * 3600e3;

export const TABS = [['unread', 'Unread'], ['mine', 'Mine'], ['unassigned', 'Unassigned'], ['waiting', 'Waiting on us'], ['closed', 'Closed']];
export const LANGS = [['en', 'English'], ['hi', 'Hindi'], ['kn', 'Kannada']];
export const QUICK_REPLIES = [
  ['Thanks', 'Thank you for writing to Mechanix Pro. We are looking at this and will reply shortly.'],
  ['Share location', 'Please share your live location here so our mechanic can reach you.'],
  ['Share photo', 'Please send a clear photo or a short video of the problem.'],
  ['Booking ID', 'Please share your booking ID so we can find your booking quickly.'],
  ['Calling you', 'We are calling you now. Please keep your phone nearby.'],
  ['Done', 'Your request is complete. Message us here anytime if you need anything else.'],
];

/** "+91 98000 00001" from a 10 digit number. */
export const phoneLabel = (p) => { const d = String(p ?? '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : String(p ?? ''); };

/** Milliseconds left in the 24 hour window, from the last inbound message. 0 when closed or when the customer never wrote. */
export function msLeft(lastInboundAt, now = Date.now()) {
  const t = lastInboundAt ? new Date(lastInboundAt).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, t + WINDOW_MS - now) : 0;
}
/** The 24 hour countdown chip: text and tone (good over 6 hours, warn from 1 to 6, bad under 1 hour, closed at 0). */
export function windowChip(lastInboundAt, now = Date.now()) {
  const ms = msLeft(lastInboundAt, now);
  if (ms <= 0) return { open: false, text: 'Window closed: use a template', tone: 'bad' };
  const h = Math.floor(ms / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return { open: true, text: h > 0 ? `${h}h ${m}m left to reply freely` : `${m}m left to reply freely`, tone: ms > 6 * 3600e3 ? 'good' : ms > 3600e3 ? 'warn' : 'bad' };
}

/** Delivery ticks for an outgoing message. */
export function ticks(direction, status) {
  if (direction !== 'out') return null;
  switch (status) {
    case 'read': return { glyph: '✓✓', cls: 'read', label: 'Read' };
    case 'delivered': return { glyph: '✓✓', cls: 'delivered', label: 'Delivered' };
    case 'sent': return { glyph: '✓', cls: 'sent', label: 'Sent' };
    case 'failed': return { glyph: '!', cls: 'failed', label: 'Not delivered' };
    case 'unknown': return { glyph: '?', cls: 'unknown', label: 'Not sure it was delivered. Check before sending again' };
    default: return { glyph: '', cls: 'none', label: 'Sent from the AiSensy desk number' };
  }
}

const IST = { timeZone: 'Asia/Kolkata' };
export const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', IST);
export function dayLabel(iso, now = Date.now()) {
  const k = dayKey(iso);
  if (k === dayKey(new Date(now).toISOString())) return 'Today';
  if (k === dayKey(new Date(now - 86400e3).toISOString())) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-IN', { ...IST, day: '2-digit', month: 'short', year: 'numeric' });
}
export const timeLabel = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { ...IST, hour: 'numeric', minute: '2-digit' }) : '');

/** Messages and internal notes in time order with a date separator whenever the (IST) day changes. */
export function groupThread(items = [], notes = [], now = Date.now()) {
  const all = [...items.map((i) => ({ ...i, kind: 'msg' })), ...notes.map((n) => ({ ...n, kind: 'note' }))].filter((r) => r.at).sort((a, b) => new Date(a.at) - new Date(b.at) || (a.kind === 'note') - (b.kind === 'note'));
  const out = []; let last = '';
  for (const r of all) { const k = dayKey(r.at); if (k !== last) { out.push({ kind: 'day', label: dayLabel(r.at, now), key: k }); last = k; } out.push(r); }
  return out;
}

/** What a media placeholder says before the Load button is pressed. */
export function mediaInfo(media) {
  if (!media || typeof media !== 'object') return null;
  const t = media.type;
  if (t === 'location') return { kind: 'location', label: 'Location', url: Number.isFinite(Number(media.latitude)) ? `https://maps.google.com/?q=${Number(media.latitude)},${Number(media.longitude)}` : null };
  if (t === 'template' || t === 'button' || t === 'interactive') return null;
  if (!media.id) return null;
  const label = t === 'audio' ? (media.voice ? 'Voice note' : 'Audio') : t === 'image' ? 'Photo' : t === 'video' ? 'Video' : t === 'sticker' ? 'Sticker' : media.filename ? `Document: ${media.filename}` : 'Document';
  return { kind: t, label, id: String(media.id), mime: media.mime || '', loadable: ['image', 'audio', 'video', 'document', 'sticker'].includes(t) };
}

/** Minutes waiting, in words. */
export function waitText(mins) {
  if (mins == null) return '';
  const m = Math.max(0, Math.round(mins));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d`;
}
export function secsText(s) {
  if (s == null || !Number.isFinite(Number(s))) return 'no data';
  const n = Math.round(Number(s));
  return n < 90 ? `${n}s` : n < 5400 ? `${Math.round(n / 60)} min` : `${(n / 3600).toFixed(1)} h`;
}
/** Template variable defaults from what the thread already knows. */
export function templateDefaults(tpl, ctx = {}) {
  const first = String(ctx.name || '').trim().split(/\s+/)[0] || '';
  return (tpl?.vars || []).map((v) => /first name/i.test(v) ? first : /booking/i.test(v) ? (ctx.booking_id || '') : '');
}
/** Plain message for a failed call: never silent. */
export const failText = (e) => 'That did not work: ' + String(e?.message || e || 'something went wrong').replace(/^Error:\s*/, '');
