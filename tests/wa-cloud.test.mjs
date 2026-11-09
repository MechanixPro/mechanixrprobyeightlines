import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizePhone, verifyMetaSignature, parseWebhook, parseMessage, canAdvanceStatus, windowOpen, windowMsLeft, decideSend, normalizeLang, cloudTemplates, checkMedia, templatePayload, mediaPayload, textPayload, WINDOW_CLOSED_MESSAGE } from '../supabase/functions/_shared/wa-cloud.ts';

const PH = '919800000001'; // placeholder customer number
const envelope = (value) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA_ID', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '918310621498', phone_number_id: 'PHONE_NUMBER_ID' }, ...value } }] }] });
const contacts = [{ profile: { name: 'Test Customer' }, wa_id: PH }];

test('phone normalisation: +91, 91, 0 prefixes and spaces give the last 10 digits; junk gives null', () => {
  assert.equal(normalizePhone('+91 98000 00001'), '9800000001');
  assert.equal(normalizePhone('919800000001'), '9800000001');
  assert.equal(normalizePhone('09800000001'), '9800000001');
  assert.equal(normalizePhone('9800000001'), '9800000001');
  for (const bad of ['', null, undefined, '12345', '5800000001', '+1 415 555 0100', '98000000012345']) assert.equal(normalizePhone(bad), null, String(bad));
});

test('signature: valid passes; invalid, wrong secret, tampered body, missing header, missing secret and bad prefix all fail', async () => {
  const raw = JSON.stringify(envelope({ messages: [] })), secret = 'test-app-secret';
  const good = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(await verifyMetaSignature(secret, raw, good), true);
  assert.equal(await verifyMetaSignature(secret, raw, good.replace(/.$/, (c) => (c === '0' ? '1' : '0'))), false);
  assert.equal(await verifyMetaSignature('other', raw, good), false);
  assert.equal(await verifyMetaSignature(secret, raw + ' ', good), false);
  assert.equal(await verifyMetaSignature(secret, raw, null), false);
  assert.equal(await verifyMetaSignature(secret, raw, ''), false);
  assert.equal(await verifyMetaSignature('', raw, good), false);
  assert.equal(await verifyMetaSignature(secret, raw, good.replace('sha256=', 'sha1=')), false);
  assert.equal(await verifyMetaSignature(secret, raw, 'sha256=short'), false);
});

test('payload parsing: text, image, voice note, audio, document, location, button, interactive, sticker, video', () => {
  const ts = '1767000000';
  const msgs = [
    { from: PH, id: 'wamid.T', timestamp: ts, type: 'text', text: { body: 'Hello' } },
    { from: PH, id: 'wamid.I', timestamp: ts, type: 'image', image: { id: 'MEDIA_I', mime_type: 'image/jpeg', caption: 'Flat tyre' } },
    { from: PH, id: 'wamid.V', timestamp: ts, type: 'audio', audio: { id: 'MEDIA_V', mime_type: 'audio/ogg; codecs=opus', voice: true } },
    { from: PH, id: 'wamid.A', timestamp: ts, type: 'audio', audio: { id: 'MEDIA_A', mime_type: 'audio/mpeg' } },
    { from: PH, id: 'wamid.D', timestamp: ts, type: 'document', document: { id: 'MEDIA_D', mime_type: 'application/pdf', filename: 'rc-book.pdf' } },
    { from: PH, id: 'wamid.L', timestamp: ts, type: 'location', location: { latitude: 12.9, longitude: 77.6, name: 'Test Place' } },
    { from: PH, id: 'wamid.B', timestamp: ts, type: 'button', button: { text: 'Yes', payload: 'YES' } },
    { from: PH, id: 'wamid.X', timestamp: ts, type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'b1', title: 'Book now' } } },
    { from: PH, id: 'wamid.X2', timestamp: ts, type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'l1', title: 'Brake service' } } },
    { from: PH, id: 'wamid.S', timestamp: ts, type: 'sticker', sticker: { id: 'MEDIA_S', mime_type: 'image/webp' } },
    { from: PH, id: 'wamid.VD', timestamp: ts, type: 'video', video: { id: 'MEDIA_VD', mime_type: 'video/mp4' } },
    { from: PH, id: 'wamid.U', timestamp: ts, type: 'order' },
  ];
  const { messages, statuses } = parseWebhook(envelope({ contacts, messages: msgs }));
  assert.equal(statuses.length, 0); assert.equal(messages.length, msgs.length);
  const by = Object.fromEntries(messages.map((m) => [m.id, m]));
  assert.equal(by['wamid.T'].body, 'Hello'); assert.equal(by['wamid.T'].media, null);
  assert.equal(by['wamid.T'].phone, '9800000001'); assert.equal(by['wamid.T'].profileName, 'Test Customer'); assert.equal(by['wamid.T'].waNumber, '918310621498');
  assert.equal(by['wamid.T'].at, new Date(1767000000e3).toISOString());
  assert.deepEqual([by['wamid.I'].body, by['wamid.I'].media.id, by['wamid.I'].media.mime, by['wamid.I'].media.type], ['Flat tyre', 'MEDIA_I', 'image/jpeg', 'image']);
  assert.equal(by['wamid.V'].body, '[Voice note]'); assert.equal(by['wamid.V'].media.voice, true); assert.equal(by['wamid.V'].media.type, 'audio');
  assert.equal(by['wamid.A'].body, '[Audio]');
  assert.equal(by['wamid.D'].media.filename, 'rc-book.pdf'); assert.match(by['wamid.D'].body, /rc-book\.pdf/);
  assert.match(by['wamid.L'].body, /maps\.google\.com\/\?q=12\.9,77\.6/); assert.equal(by['wamid.L'].media.type, 'location');
  assert.equal(by['wamid.B'].body, 'Yes'); assert.equal(by['wamid.X'].body, 'Book now'); assert.equal(by['wamid.X2'].body, 'Brake service');
  assert.equal(by['wamid.S'].body, '[Sticker]'); assert.equal(by['wamid.VD'].body, '[Video]'); assert.equal(by['wamid.U'].body, '[order]');
  // media bytes are never part of a parsed message: only id and mime
  for (const m of messages) if (m.media && m.media.id) assert.ok(!('data' in m.media) && !('base64' in m.media));
});

test('payload parsing: statuses, with the failure reason, and garbage shapes are skipped', () => {
  const sts = [
    { id: 'wamid.O1', status: 'sent', timestamp: '1767000001', recipient_id: PH },
    { id: 'wamid.O1', status: 'delivered', timestamp: '1767000002', recipient_id: PH },
    { id: 'wamid.O1', status: 'read', timestamp: '1767000003', recipient_id: PH },
    { id: 'wamid.O2', status: 'failed', timestamp: '1767000004', recipient_id: PH, errors: [{ code: 131047, title: 'Re-engagement message', message: 'Re-engagement message' }] },
    { id: 'wamid.O3', status: 'deleted' },
  ];
  const { messages, statuses } = parseWebhook(envelope({ statuses: sts }));
  assert.equal(messages.length, 0); assert.deepEqual(statuses.map((s) => s.status), ['sent', 'delivered', 'read', 'failed']);
  assert.equal(statuses[3].error, 'Re-engagement message'); assert.equal(statuses[0].error, null); assert.equal(statuses[0].phone, '9800000001');
  for (const junk of [null, {}, { entry: 'x' }, { entry: [{ changes: 'x' }] }, { entry: [null, { changes: [null, { value: { messages: [{}] } }] }] }]) assert.deepEqual(parseWebhook(junk), { messages: [], statuses: [] });
  assert.equal(parseMessage({ id: 'x', from: PH, type: 'text', text: { body: 'a'.repeat(9000) } }).body.length, 4000);
});

test('status ordering: only forward; failed only before delivery', () => {
  assert.equal(canAdvanceStatus(null, 'sent'), true); assert.equal(canAdvanceStatus('unknown', 'sent'), true);
  assert.equal(canAdvanceStatus('sent', 'delivered'), true); assert.equal(canAdvanceStatus('delivered', 'read'), true); assert.equal(canAdvanceStatus('sent', 'read'), true);
  assert.equal(canAdvanceStatus('read', 'delivered'), false); assert.equal(canAdvanceStatus('delivered', 'sent'), false); assert.equal(canAdvanceStatus('read', 'read'), false);
  assert.equal(canAdvanceStatus('sent', 'failed'), true); assert.equal(canAdvanceStatus(null, 'failed'), true);
  assert.equal(canAdvanceStatus('delivered', 'failed'), false); assert.equal(canAdvanceStatus('read', 'failed'), false); assert.equal(canAdvanceStatus('failed', 'delivered'), false);
  assert.equal(canAdvanceStatus('sent', 'bogus'), false);
});

test('24 hour window: open inside 24 hours, closed at and after, closed with no inbound message', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  assert.equal(windowOpen(new Date(now - 3600e3).toISOString(), now), true);
  assert.equal(windowOpen(new Date(now - 23.99 * 3600e3).toISOString(), now), true);
  assert.equal(windowOpen(new Date(now - 24 * 3600e3).toISOString(), now), false);
  assert.equal(windowOpen(new Date(now - 30 * 3600e3).toISOString(), now), false);
  assert.equal(windowOpen(null, now), false); assert.equal(windowOpen('garbage', now), false);
  assert.equal(windowMsLeft(new Date(now - 23 * 3600e3).toISOString(), now), 3600e3); assert.equal(windowMsLeft(null, now), 0);
});

test('send rules: free text and media need an open window (409), a template is always allowed, opted out is refused', () => {
  const open = { windowOpen: true, optedOut: false }, closed = { windowOpen: false, optedOut: false };
  assert.deepEqual(decideSend({ text: 'hi' }, open), { ok: true, kind: 'text' });
  const r = decideSend({ text: 'hi' }, closed); assert.equal(r.ok, false); assert.equal(r.status, 409); assert.equal(r.code, 'window_closed'); assert.equal(r.error, WINDOW_CLOSED_MESSAGE); assert.match(r.error, /template/i);
  assert.equal(decideSend({ media: { base64: 'AAAA', type: 'audio' } }, closed).status, 409);
  assert.deepEqual(decideSend({ media: { base64: 'AAAA', type: 'audio' } }, open), { ok: true, kind: 'media' });
  assert.deepEqual(decideSend({ template: { name: 'mxp_followup', lang: 'hi', vars: ['A'] } }, closed), { ok: true, kind: 'template' });
  assert.equal(decideSend({ text: '   ' }, open).status, 400);
  assert.equal(decideSend({ template: { name: 'x', lang: 'fr' } }, open).status, 400);
  assert.equal(decideSend({ text: 'hi' }, { windowOpen: true, optedOut: true }).status, 400);
  assert.equal(decideSend({ template: { name: 'x', lang: 'en' } }, { windowOpen: true, optedOut: true }).status, 400);
});

test('template languages and list; payload shapes; media limits', () => {
  assert.deepEqual(['English', 'hi', 'Kannada', 'kn', 'en_US'].map(normalizeLang), ['en', 'hi', 'kn', 'kn', 'en_US']); assert.equal(normalizeLang('fr'), null); assert.equal(normalizeLang(undefined), 'en');
  const list = cloudTemplates((k, d) => d); assert.equal(list.length, 5); assert.ok(list.find((t) => t.key === 'payment').vars.length === 4);
  assert.equal(cloudTemplates((k, d) => (k === 'WA_TPL_PAID' ? 'custom_paid' : d)).find((t) => t.key === 'paid').name, 'custom_paid');
  const tp = templatePayload('9800000001', 'mxp_followup', 'kn', ['A', 'B']); assert.equal(tp.to, '919800000001'); assert.equal(tp.template.language.code, 'kn'); assert.equal(tp.template.components[0].parameters.length, 2);
  assert.deepEqual(templatePayload('9800000001', 'n', 'en', []).template.components, []);
  assert.equal(textPayload('9800000001', 'x').text.body, 'x');
  assert.deepEqual(mediaPayload('9800000001', 'audio', 'M1', { caption: 'ignored' }).audio, { id: 'M1' });
  assert.equal(mediaPayload('9800000001', 'document', 'M2', { filename: 'a.pdf', caption: 'c' }).document.filename, 'a.pdf');
  assert.equal(checkMedia({ type: 'audio', mime: 'audio/ogg; codecs=opus', base64: 'AAAA' }).ok, true);
  assert.equal(checkMedia({ type: 'audio', mime: 'audio/webm', base64: 'AAAA' }).ok, false);
  assert.equal(checkMedia({ type: 'image', mime: 'image/gif', base64: 'AAAA' }).ok, false);
  assert.equal(checkMedia({ type: 'video', mime: 'video/mp4', base64: 'AAAA' }).ok, false);
  assert.equal(checkMedia({ type: 'image', mime: 'image/png', base64: 'A'.repeat(7_000_000) }).ok, false);
});

test('migration: idempotent shapes, closed tables, no secrets, rollback notes', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20270106000000_wa_inbox.sql', import.meta.url), 'utf8');
  assert.match(sql, /Roll back/); assert.match(sql, /add column if not exists channel text not null default 'aisensy'/);
  for (const t of ['wa_conversations', 'wa_notes', 'wa_reads']) { assert.match(sql, new RegExp(`create table if not exists public\\.${t}`)); assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`)); }
  for (const f of ['crm_wa_inbox', 'crm_wa_thread', 'crm_wa_claim', 'crm_wa_close', 'crm_wa_note', 'crm_wa_mark_read', 'admin_wa_overview']) assert.match(sql, new RegExp(`create or replace function public\\.${f}\\(`));
  assert.doesNotMatch(sql, /create policy/); assert.doesNotMatch(sql, /\b(?:est_total|paid_amount|payment_link)\b/);
  assert.match(readFileSync(new URL('../supabase/local-test/run.sh', import.meta.url), 'utf8'), /20270106000000_wa_inbox/);
});
