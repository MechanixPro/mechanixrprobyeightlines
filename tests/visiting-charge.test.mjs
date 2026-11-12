// The doorstep visiting charge (owner, 2026-11-12): Rs 349 for any doorstep visit. The confirmation fee (Rs 49 to 99) only confirms the slot.
// If the customer declines to continue once a technician is assigned, the visiting charge is payable and the confirmation fee counts towards it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const strip = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const site = JSON.parse(read('src/site.json'));

test('the figure comes from src/site.json and the browser copy agrees', () => {
  assert.equal(site.visitCharge, 349);
  assert.match(read('assets/js/app.js'), new RegExp(`var VISIT_CHARGE = '₹' \\+ ${site.visitCharge};`));
  assert.match(read('scripts/build_pages.py'), /\{\{visitcharge\}\}/);
});
test('every public place that explains fees also states the visiting charge and the decline rule', () => {
  for (const f of ['terms/index.html', 'refund-policy/index.html', 'help/index.html', 'book/index.html', 'our-process/index.html', 'rate-card/index.html']) {
    const t = strip(read(f));
    assert.match(t, /visiting charge of ₹349 applies to any doorstep visit|₹349 visiting charge/i, f);
    assert.match(t, /decline to continue|decide not to continue/i, f);
    assert.match(t, /confirmation fee[^.]{0,80}(counts? towards|already paid counts)/i, f);
  }
  const l = read('llms.txt'); assert.match(l, /Visiting charge: Rs 349 for any doorstep visit/); assert.match(l, /declines to continue/);
});
test('the pay note in the customer app says it too', () => {
  const a = read('assets/js/app.js'); assert.match(a, /A visiting charge of ' \+ VISIT_CHARGE \+ ' applies to any doorstep visit/);
});
test('the confirmation fee is never described as the visiting charge', () => {
  for (const f of ['terms/index.html', 'refund-policy/index.html', 'book/index.html']) assert.doesNotMatch(strip(read(f)), /confirmation fee is (the )?visiting charge|visiting charge is (the )?confirmation fee/i, f);
});
