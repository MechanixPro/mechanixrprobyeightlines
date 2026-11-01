import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyAgentive, parseSignature, cleanKeypress, MENU } from '../supabase/functions/_shared/agentive.ts';

const hmac = async (s, d) => createHmac('sha256', s).update(d).digest('hex');
const eq = (a, b) => a === b;
const body = JSON.stringify({ id: 'evt_5b8e02d94c17a3f6e0d2', type: 'ivr.keypress', event: 'ivr.keypress', created: 1780591342, test: false, data: { call_uuid: 'c7d2e1f0', from_number: '919812345678', to_number: '911100000042', flow_id: 128, flow_name: 'Menu', key_path: '2', key_label: 'Book' } });
const sign = (t, secret = 's3cret') => `t=${t},v2=${createHmac('sha256', secret).update(t + '.' + body).digest('hex')}`;

test('a good V2 signature passes and a wrong secret, old time or missing header fails', async () => {
  const now = 1780591400 * 1000;
  assert.equal(await verifyAgentive(body, sign(1780591342), 's3cret', hmac, eq, now), true);
  assert.equal(await verifyAgentive(body, sign(1780591342, 'other'), 's3cret', hmac, eq, now), false);
  assert.equal(await verifyAgentive(body, sign(1780591342), 's3cret', hmac, eq, now + 400_000), false);
  assert.equal(await verifyAgentive(body, null, 's3cret', hmac, eq, now), false);
  assert.equal(await verifyAgentive(body + ' ', sign(1780591342), 's3cret', hmac, eq, now), false);
  assert.equal(parseSignature('sha256=abc'), null);
});
test('a key press is read, a bad one refused, and the menu matches the IVR doc', () => {
  const v = cleanKeypress(JSON.parse(body)); assert.equal(v.ok, true); assert.equal(v.value.phone, '9812345678'); assert.equal(v.value.keyPath, '2');
  assert.equal(cleanKeypress({ event: 'other' }).ok, false);
  assert.equal(MENU['1'].campaign, 'mxp_ivr_roadside'); assert.equal(MENU['5-2'].campaign, 'mxp_ivr_business'); assert.equal(MENU['3'].lead, false);
});
