import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyAgentive, parseSignature, cleanKeypress, cleanCall, MENU } from '../supabase/functions/_shared/agentive.ts';

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

test('every new-lead path alerts the desk by email at once', async () => {
  const { readFileSync } = await import('node:fs');
  const rd = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  for (const f of ['supabase/functions/submit-lead/index.ts', 'supabase/functions/aisensy-lead/index.ts', 'supabase/functions/_shared/inbound.ts', 'supabase/functions/agentive-ivr/index.ts']) assert.match(rd(f), /alertNewLead\(/, f);
  assert.match(rd('supabase/functions/_shared/new-lead-alert.ts'), /lead_alert_emails/);
});

test('the desk follows the team rules: WhatsApp leads by hand, a call makes a mobile-only lead, dispositions as asked', async () => {
  const { readFileSync } = await import('node:fs');
  const rd = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.match(rd('supabase/functions/_shared/inbound.ts'), /desk_auto_whatsapp_leads/);
  assert.match(rd('supabase/functions/agentive-ivr/index.ts'), /name: k\.phone, phone: k\.phone/);
  const sql = rd('supabase/migrations/20261213000000_dispositions_v2.sql');
  for (const t of ['Will book later', 'No mechanic available', 'Was just checking', 'Service dislike', 'Sw off', 'Requested call back']) assert.match(sql, new RegExp(t));
  assert.match(rd('crm/crm.js'), /Call back date and time \(required\)/);
});

test('every inbound call event becomes a lead, mobiles only, missed calls flagged', () => {
  const ev = (type, data = {}) => ({ id: 'evt_abc12345678', type, event: type, data: { direction: 'inbound', from_number: '919845012345', call_id: 'c1', duration_sec: 40, ...data } });
  assert.deepEqual(cleanCall(ev('call.completed')).value, { id: 'evt_abc12345678', event: 'call.completed', callId: 'c1', phone: '9845012345', status: '', missed: false, seconds: 40 });
  assert.equal(cleanCall(ev('call.no_answer')).value.missed, true);
  assert.equal(cleanCall(ev('call.busy')).value.missed, true);
  assert.equal(cleanCall(ev('call.ringing')).ok, false);
  assert.equal(cleanCall(ev('call.completed', { direction: 'outbound' })).ok, false);
  assert.equal(cleanCall(ev('call.completed', { from_number: '08042303061' })).ok, false);
  assert.equal(cleanCall(ev('ivr.keypress')).ok, false);
});
