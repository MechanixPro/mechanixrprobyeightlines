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
