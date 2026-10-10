import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanAisensyLead } from '../supabase/functions/_shared/aisensy.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const ok = (o) => cleanAisensyLead({ name: 'Asha Rao', phone: '+91 98765 43210', service: 'general', bike_brand: 'Honda', bike_model: 'Activa 6G', area: 'HSR Layout', pincode: '560102', preferred_date: '2026-10-14', preferred_slot: 'morning', ...o });

test('a complete chatbot booking is cleaned: number to 10 digits, known service, slot and date kept', () => {
  const r = ok({});
  assert.equal(r.ok, true);
  assert.equal(r.value.phone, '9876543210'); assert.equal(r.value.name, 'Asha Rao'); assert.equal(r.value.service_id, 'general');
  assert.equal(r.value.pincode, '560102'); assert.equal(r.value.preferred_slot, 'morning'); assert.equal(r.value.preferred_date, '2026-10-14');
  assert.equal(r.value.bike_brand, 'Honda'); assert.equal(r.value.bike_model, 'Activa 6G');
});
test('name and a valid mobile number are the only required fields', () => {
  assert.equal(cleanAisensyLead({ name: 'Asha', phone: '9876543210' }).ok, true);
  assert.equal(cleanAisensyLead({ name: 'A', phone: '9876543210' }).ok, false);
  assert.equal(cleanAisensyLead({ name: 'Asha', phone: '12345' }).ok, false);
  assert.equal(cleanAisensyLead({}).ok, false);
});
test('unknown slots, bad dates and bad PIN codes are dropped, not trusted', () => {
  const v = ok({ preferred_slot: 'midnight', preferred_date: 'tomorrow', pincode: '56' }).value;
  assert.equal(v.preferred_slot, null); assert.equal(v.preferred_date, null); assert.equal(v.pincode, null);
});
test('text is stripped of markup and capped; the booking is marked as from WhatsApp with consent', () => {
  const v = ok({ name: '<b>Asha</b> Rao', note: 'x'.repeat(900) }).value;
  assert.equal(v.name, 'bAsha/b Rao'); assert.equal(v.note.length, 300);
  assert.equal(v.source, 'whatsapp'); assert.equal(v.consent_whatsapp, true);
});
test('campaign and referral tags are kept in a safe form', () => {
  const v = ok({ campaign: 'Monsoon Check!', ref_code: 'asha 12' }).value;
  assert.equal(v.campaign, 'monsooncheck'); assert.equal(v.ref_code, 'ASHA12');
});

const AI = read('supabase/functions/_shared/ai.ts');
test('the bot follows the real flow: quote first, the fee only after the customer approves, then a person sends the quote', () => {
  assert.match(AI, /quote first, work after their OK/i); assert.match(AI, /only after the customer approves the quote/i);
  assert.match(AI, /set action "handoff"/); assert.doesNotMatch(AI, /Goal: help the customer confirm a booking and pay/i);
  assert.match(AI, /Never state a price that is not in the lists above/i);
  assert.match(AI, /\$\{rupee\(ctx\.advance\)\}/); assert.match(AI, /\$\{svc\}/); // prices come from the live price list, never hard-coded
});
test('the bot is told not to invent claims, discounts, arrival times or ratings', () => {
  assert.match(AI, /Never promise exact arrival/i); assert.match(AI, /No discounts, offers, ratings or arrival times/i); assert.match(AI, /Never invent anything/i);
});
test('the AiSensy connection is a secured public function and the guide covers both options', () => {
  const cfg = read('supabase/config.toml');
  assert.match(cfg, /\[functions\.aisensy-lead\]\nverify_jwt = false/);
  const f = read('supabase/functions/aisensy-lead/index.ts');
  assert.match(f, /x-aisensy-secret/); assert.match(f, /safeEqual/); assert.match(f, /AISENSY_WEBHOOK_SECRET/);
  const d = read('docs/WHATSAPP-BOT.md');
  for (const k of ['Option A', 'Option B', 'AiSensy', 'x-aisensy-secret', 'support number', 'Frequently asked']) assert.ok(d.includes(k), k);
  assert.doesNotMatch(d, /cheapest|best price|guarantee|% off/i);
});
