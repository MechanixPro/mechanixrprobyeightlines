import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCampaignRequest, sendCampaign } from '../supabase/functions/_shared/aisensy-send.ts';

const ok = { apiKey: 'KEY123', campaignName: 'mxp_desk_payment_link', phone: '+91 98765 43210', name: 'Asha Rao', params: ['Asha', '349', 'MP-ABC123', 'https://rzp.io/x'] };

test('the request carries an Indian number with +91, the campaign and the template params in order', () => {
  const r = buildCampaignRequest(ok);
  assert.equal(r.ok, true);
  assert.equal(r.body.destination, '+919876543210'); assert.equal(r.body.campaignName, 'mxp_desk_payment_link');
  assert.deepEqual(r.body.templateParams, ['Asha', '349', 'MP-ABC123', 'https://rzp.io/x']);
});
test('no key, a bad campaign name or a bad number is refused before any call', () => {
  assert.equal(buildCampaignRequest({ ...ok, apiKey: '' }).ok, false);
  assert.equal(buildCampaignRequest({ ...ok, campaignName: 'x y!' }).ok, false);
  assert.equal(buildCampaignRequest({ ...ok, phone: '12345' }).ok, false);
});
test('a failure from AiSensy comes back as a message and never contains the key', async () => {
  const f = async () => new Response('bad apiKey KEY123', { status: 401 });
  const r = await sendCampaign(ok, f);
  assert.equal(r.ok, false); assert.match(r.error, /401/); assert.doesNotMatch(r.error, /KEY123/);
});
test('a network failure is a clean error, not a crash', async () => {
  const r = await sendCampaign(ok, async () => { throw new Error('down'); });
  assert.deepEqual(r, { ok: false, error: 'Could not reach AiSensy' });
});
test('a good response is ok', async () => { assert.deepEqual(await sendCampaign(ok, async () => new Response('{}', { status: 200 })), { ok: true }); });

import { cleanAisensyInbound } from '../supabase/functions/_shared/aisensy.ts';
test('an incoming message accepts the common field names and keeps the last ten digits', () => {
  const r = cleanAisensyInbound({ waNumber: '+91 98765 43210', userMessage: 'Hi, I need a service', userName: 'Asha' });
  assert.equal(r.ok, true); assert.equal(r.value.phone, '9876543210'); assert.equal(r.value.text, 'Hi, I need a service'); assert.equal(r.value.name, 'Asha');
});
test('an incoming message needs a real mobile number and some text', () => {
  assert.equal(cleanAisensyInbound({ phone: '12345', message: 'hi' }).ok, false);
  assert.equal(cleanAisensyInbound({ phone: '9876543210', message: '   ' }).ok, false);
});
test('markup characters are stripped from an incoming message', () => {
  assert.equal(cleanAisensyInbound({ phone: '9876543210', message: 'a<b>c' }).value.text, 'abc');
});

import { inboundFromNotification } from '../supabase/functions/_shared/aisensy.ts';
test('a native webhook message from a user becomes an inbound message', () => {
  const m = inboundFromNotification({ topic: 'message.sender.user', data: { message: { phone_number: '919876543210', message_type: 'TEXT', message_content: { text: { body: 'Need a service tomorrow' } }, messageId: 'wamid.ABC' } } });
  assert.deepEqual(m, { phone: '9876543210', name: '', text: 'Need a service tomorrow', id: 'as:wamid.ABC' });
});
test('other webhook topics and bad numbers are ignored', () => {
  assert.equal(inboundFromNotification({ topic: 'message.status.updated', data: {} }), null);
  assert.equal(inboundFromNotification({ topic: 'message.sender.user', data: { message: { phone_number: '12345' } } }), null);
});
test('a message with no text still records its type', () => {
  assert.equal(inboundFromNotification({ topic: 'message.sender.user', data: { message: { phone_number: '9876543210', message_type: 'IMAGE', message_content: { image: {} } } } }).text, '[image]');
});

import { buildSessionText, sendSessionText } from '../supabase/functions/_shared/aisensy-project.ts';
test('a session text goes to the project messages path with a 91 number', () => {
  const r = buildSessionText({ projectId: 'abc123def456', phone: '98765 43210', text: ' Hello ' });
  assert.equal(r.ok, true); assert.equal(r.path, '/project/abc123def456/messages');
  assert.deepEqual(r.body, { to: '919876543210', type: 'text', recipient_type: 'individual', text: { body: 'Hello' } });
});
test('a session text needs a project id, a mobile number and some text', () => {
  assert.equal(buildSessionText({ projectId: '', phone: '9876543210', text: 'x' }).ok, false);
  assert.equal(buildSessionText({ projectId: 'abc123def456', phone: '1', text: 'x' }).ok, false);
  assert.equal(buildSessionText({ projectId: 'abc123def456', phone: '9876543210', text: '  ' }).ok, false);
});
test('the project password goes in the header and never into an error', async () => {
  let seen;
  const f = async (url, init) => { seen = init.headers; return new Response('bad PWD123', { status: 401 }); };
  const r = await sendSessionText({ projectId: 'abc123def456', password: 'PWD123', phone: '9876543210', text: 'hi' }, f);
  assert.equal(seen['X-AiSensy-Project-API-Pwd'], 'PWD123'); assert.equal(r.ok, false); assert.doesNotMatch(r.error, /PWD123/);
});
test('a good send returns the message id', async () => {
  const r = await sendSessionText({ projectId: 'abc123def456', password: 'p', phone: '9876543210', text: 'hi' }, async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.X' }] }), { status: 200 }));
  assert.deepEqual(r, { ok: true, id: 'wamid.X' });
});
