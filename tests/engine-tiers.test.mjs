import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildServiceEdit } from '../admin/booking-edit.js';
import { buildInvoice } from '../admin/invoice.js';
import { buildInvoice as buildInvoiceFn } from '../supabase/functions/_shared/invoice.ts';
import { priceFromRows } from '../supabase/functions/_shared/engine-price.ts';
const require = createRequire(import.meta.url);
const L = require('../assets/js/logic.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const S = [
  { id: 'basic', kind: 'service', name: 'Basic service', price: 599 }, { id: 'general', kind: 'service', name: 'General service', price: 799 }, { id: 'full', kind: 'service', name: 'Full service', price: 1299 },
  { id: 'basic250', kind: 'service', name: 'Basic service 150-250cc', price: 799 }, { id: 'general250', kind: 'service', name: 'General service 150-250cc', price: 1299 }, { id: 'full250', kind: 'service', name: 'Full service 150-250cc', price: 1799 },
  { id: 'repair', kind: 'service', name: 'Repair or problem check', price: 799 }, { id: 'wash', kind: 'addon', name: 'Foam wash', price: 199 }, { id: 'bigbike', kind: 'fee', name: 'Above-250cc surcharge', price: 300 },
];
const CFG = { bigBikeSurcharge: 300, bookingAdvance: 349 };
const st = (o) => Object.assign({ name: 'Asha', phone: '9876543210', area: 'HSR Layout', brand: 'Honda', model: 'X', type: 'm', cc: 'std', nick: '', km: '', issues: [], note: '', service: 'general', addons: [], place: 'home', contact: 'whatsapp' }, o);

test('site: a package costs its own price per engine class, and above 250cc adds the surcharge to the 150-250cc price', () => {
  assert.equal(L.total(st({ cc: 'std' }), S, CFG), 799);
  assert.equal(L.total(st({ cc: 'mid' }), S, CFG), 1299);
  assert.equal(L.total(st({ cc: 'big' }), S, CFG), 1599);
  assert.equal(L.total(st({ cc: 'big', service: 'full', addons: ['wash'] }), S, CFG), 1799 + 300 + 199);
});
test('site: repair and roadside are never split by engine size', () => {
  for (const cc of ['std', 'mid', 'big']) assert.equal(L.total(st({ cc, service: 'repair' }), S, CFG), 799);
});
test('site: without the engine-size rows the old single price and surcharge still apply', () => {
  const old = S.filter((x) => !/250$/.test(x.id));
  assert.equal(L.hasTiers(old), false); assert.equal(L.total(st({ cc: 'big' }), old, CFG), 799 + 300); assert.equal(L.total(st({ cc: 'mid' }), old, CFG), 799);
  assert.equal(L.hasTiers(S), true);
});
test('site: the bike line and the payload carry the engine class', () => {
  assert.match(L.buildDraftMessage(st({ cc: 'mid' }), S, CFG, 'https://x'), /\(150-250cc\)/);
  assert.match(L.buildDraftMessage(st({ cc: 'big' }), S, CFG, 'https://x'), /\(above 250cc\)/);
  assert.equal(L.leadPayload(st({ cc: 'mid' }), '2026-11-01', '2026-10-23').engine_class, 'mid');
  assert.equal(L.leadPayload(st({ cc: 'big' }), '2026-11-01', '2026-10-23').big_bike, true);
  assert.equal(L.leadPayload(st({ cc: 'mid' }), '2026-11-01', '2026-10-23').big_bike, false);
  assert.equal(L.decodeBuild(L.encodeBuild(st({ cc: 'mid' })), { Honda: [['X', 'm', 0]] }, S).cc, 'mid');
});
test('site: the engine class is guessed from the model name, and the tier rows are not listed as services', () => {
  assert.equal(L.engineGuess('Pulsar NS200', 0), 'mid'); assert.equal(L.engineGuess('SP 160', 0), 'mid'); assert.equal(L.engineGuess('CB300F', 1), 'big');
  assert.equal(L.engineGuess('Shine 125', 0), 'std'); assert.equal(L.engineGuess('Activa 6G', 0), 'std'); assert.equal(L.engineGuess('Himalayan', 1), 'big');
  assert.equal(L.isTierRow('basic250'), true); assert.equal(L.isTierRow('basic'), false);
});
test('admin: editing a booking prices by engine class and saves it on the bike', () => {
  const ctx = { services: S, today: '2026-10-23' };
  const mid = buildServiceEdit({ service: 'general', engine: 'mid' }, ctx); assert.equal(mid.lead.est_total, 1299); assert.deepEqual(mid.bike, { big_bike: false, engine_class: 'mid' });
  const big = buildServiceEdit({ service: 'full', engine: 'big', addons: ['wash'] }, ctx); assert.equal(big.lead.est_total, 1799 + 300 + 199); assert.deepEqual(big.bike, { big_bike: true, engine_class: 'big' });
  assert.equal(buildServiceEdit({ service: 'repair', engine: 'big' }, ctx).lead.est_total, 799);
  assert.equal(buildServiceEdit({ service: 'general', bigBike: true }, { services: S.filter((x) => !/250$/.test(x.id)), today: '2026-10-23' }).lead.est_total, 799 + 300);
});
test('invoices bill the engine class price, in the admin and in the email, and the two agree', () => {
  const lead = { ref: 'MP-1', name: 'A', phone: '9', service_id: 'general', addons: ['wash'], coupon_discount: 0, paid_amount: 0, created_at: '2026-10-23T00:00:00Z' };
  for (const [engine, big, want] of [['std', false, 799 + 199], ['mid', false, 1299 + 199], ['big', true, 1299 + 300 + 199]]) {
    const l = { ...lead, engine_class: engine, big_bike: big };
    assert.equal(buildInvoice(l, S).total, want, engine); assert.equal(buildInvoiceFn(l, S).total, want, 'email ' + engine);
  }
  const old = { ...lead, big_bike: true }; assert.equal(buildInvoice(old, S).total, 799 + 300 + 199, 'a booking from before engine sizes keeps its old bill');
});
test('server: the price comes from the engine class, keeps the package id, and falls back when a tier row is missing', () => {
  const a = priceFromRows(S, 'general', ['wash'], false, 'mid'); assert.equal(a.total, 1299 + 199); assert.equal(a.service.id, 'general');
  const b = priceFromRows(S, 'full', [], true, 'big'); assert.equal(b.total, 1799 + 300);
  const noTier = S.filter((x) => !/250$/.test(x.id));
  assert.equal(priceFromRows(noTier, 'general', [], true, 'big').total, 799 + 300);
  assert.equal(priceFromRows(S, 'repair', [], true, 'big').total, 799);
  assert.equal(priceFromRows(S, 'general', [], true, null).total, 799 + 300, 'an old client without an engine class keeps the old rule');
  assert.equal(priceFromRows(S, 'ghost', [], false, null), null);
});
test('the booking page and the services page show the three engine sizes and the second price', () => {
  const app = read('assets/js/app.js'); assert.match(app, /Up to 149cc/); assert.match(app, /150 to 250cc/); assert.match(app, /Above 250cc/); assert.match(app, /pr2/);
  assert.match(read('services/index.html'), /150 to 250cc: <b>/);
  for (const f of ['supabase/functions/submit-lead/index.ts']) assert.match(read(f), /engine_class/);
});

// ---- The owner's price posters: a 251-500cc class with its own prices (no surcharge) ----
const S5 = [...S,
  { id: 'basic500', kind: 'service', name: 'Basic service (251-500cc)', price: 999 }, { id: 'general500', kind: 'service', name: 'Standard service (251-500cc)', price: 1499 }, { id: 'full500', kind: 'service', name: 'Full service (251-500cc)', price: 2199 }];
test('posters: 251-500cc has its own price per package and no surcharge on top', () => {
  assert.equal(L.hasBigRows(S5), true); assert.equal(L.hasBigRows(S), false);
  assert.equal(L.total(st({ cc: 'big', service: 'general' }), S5, CFG), 1499);
  assert.equal(L.total(st({ cc: 'big', service: 'full', addons: ['wash'] }), S5, CFG), 2199 + 199);
  assert.equal(L.total(st({ cc: 'mid', service: 'basic' }), S5, CFG), 799);
  assert.equal(L.total(st({ cc: 'big', service: 'repair' }), S5, CFG), 799);
  assert.match(L.buildDraftMessage(st({ cc: 'big' }), S5, CFG, 'https://x'), /\(251-500cc\)/);
});
test('posters: the server, the admin forms and both invoices agree on the 251-500cc price', () => {
  assert.equal(priceFromRows(S5, 'general', ['wash'], true, 'big').total, 1499 + 199);
  assert.equal(priceFromRows(S5, 'general', [], false, 'mid').total, 1299);
  assert.equal(priceFromRows(S5, 'general', [], true, null).total, 799 + 300, 'an old client without an engine class keeps the old rule');
  const ctx = { services: S5, today: '2026-10-23' };
  assert.equal(buildServiceEdit({ service: 'general', engine: 'big' }, ctx).lead.est_total, 1499);
  const lead = { ref: 'MP-1', name: 'A', phone: '9', service_id: 'general', addons: [], coupon_discount: 0, paid_amount: 0, created_at: '2026-10-23T00:00:00Z', engine_class: 'big', big_bike: true };
  assert.equal(buildInvoice(lead, S5).total, 1499); assert.equal(buildInvoiceFn(lead, S5).total, 1499);
  assert.equal(buildInvoice(lead, S).total, 1299 + 300, 'without 251-500cc rows the old surcharge still applies');
});
