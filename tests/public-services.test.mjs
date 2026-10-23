import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicServices, PUBLIC_ITEMS } from '../supabase/functions/_shared/public-services.ts';
const rows = [{ id: 'basic', price: 599 }, { id: 'general', price: '799' }, { id: 'sos', price: 1299 }, { id: 'newfee', price: 1799 }, { id: 'wash', price: 199, active: false }, { id: 'tyre', price: 49 }];

test('the public list uses fixed names and live prices, and skips inactive or unknown rows', () => {
  const r = buildPublicServices(rows);
  assert.deepEqual(r.items.map((i) => i.id), ['basic', 'general', 'sos', 'tyre']);
  assert.equal(r.items[1].price_inr, 799);
  assert.ok(!JSON.stringify(r).includes('1799'));
});
test('every booking link carries the partner source and stays on mechanixpro.in', () => {
  const r = buildPublicServices(rows, 'axlio');
  for (const i of r.items) { assert.match(i.book_url, /^https:\/\/mechanixpro\.in\//); assert.match(i.book_url, /[?&]campaign=axlio$/); }
});
test('names are the website names and there is no secret or customer data', () => {
  assert.equal(PUBLIC_ITEMS.find((i) => i.id === 'repair').name, 'Repair or problem check');
  assert.doesNotMatch(JSON.stringify(buildPublicServices(rows)), /key|secret|token/i);
});
