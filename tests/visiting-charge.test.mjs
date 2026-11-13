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
  for (const f of ['terms/index.html', 'refund-policy/index.html', 'help/index.html', 'book/index.html', 'our-process/index.html', 'rate-card/index.html', 'services/index.html']) {
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

test('the Home and Services pages show the visiting charge where customers look first (it was missing there)', () => {
  const home = strip(read('index.html')), sv = strip(read('services/index.html'));
  assert.match(home, /Visiting charge: ₹349 for any doorstep visit/); assert.match(home, /₹349 visiting charge applies to any doorstep visit|visiting charge applies to any doorstep visit/i);
  assert.match(sv, /Visiting charge: ₹349 for any doorstep visit/);
  assert.match(read('book/index.html'), /class="note bk-visit" id="bk-visit"/);
});

test('owner 2026-11-13: when the customer goes ahead, no visiting charge is added to the bill (stated where the decline rule is)', () => {
  for (const f of ['terms/index.html', 'refund-policy/index.html', 'help/index.html', 'book/index.html', 'services/index.html']) {
    assert.match(strip(read(f)), /If you go ahead with the service, no visiting charge is added to your bill/, f);
  }
});
test('the booking page and Services page show the GST total and the tracking and Redo Promise lines', () => {
  const b = strip(read('book/index.html')), s = strip(read('services/index.html'));
  assert.match(b, /Follow your job on a private page/); assert.match(b, /Redo Promise/);
  assert.match(s, /₹588\.82 in total/);
});

test('owner 2026-11-13: the visiting charge is waived on a first booking, and the confirmation fee then follows the cancellation rules', () => {
  for (const f of ['terms/index.html', 'refund-policy/index.html', 'help/index.html', 'book/index.html', 'services/index.html', 'our-process/index.html']) {
    assert.match(strip(read(f)), /On your first booking with us, the visiting charge is waived and your confirmation fee follows the cancellation rules/, f);
  }
  assert.match(read('llms.txt'), /first booking the visiting charge is waived/);
});
