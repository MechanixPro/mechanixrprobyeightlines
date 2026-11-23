import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PILLS, pillsHtml, maskPhone } from '../admin/booking-pills.js';
const src = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');

test('every pill value is a status the list filter understands', () => {
  const f = src.slice(src.indexOf('function filtered('), src.indexOf('function renderList() {'));
  for (const [v] of PILLS) if (!['open', 'all', 'overdue', 'junk', 'cancelled', 'paid'].includes(v)) assert.ok(['new', 'contacted', 'quoted', 'payment_sent', 'completed', 'lost'].includes(v), v);
  assert.match(f, /'open'/); assert.match(f, /'overdue'/); assert.match(f, /'junk'/);
});
test('pills show counts, mark the active one, hide empty rare ones', () => {
  const h = pillsHtml({ open: 14, new: 3, paid: 5 }, 'open');
  assert.match(h, /data-pill="open" aria-pressed="true">Open <span class="pill-n">14/);
  assert.match(h, /data-pill="paid" aria-pressed="false">Booked <span class="pill-n">5/);
  assert.doesNotMatch(h, /data-pill="junk"/); assert.doesNotMatch(h, /data-pill="overdue"/);
  assert.match(pillsHtml({ junk: 2 }, 'open'), /data-pill="junk"/);
  assert.match(pillsHtml({}, 'junk'), /data-pill="junk"/);
});
test('phone mask keeps two digits at each end and never shows the middle', () => {
  assert.equal(maskPhone('9000000001'), '90•••••01');
  assert.equal(maskPhone('+91 90000 00001'), '90•••••01');
  assert.equal(maskPhone('123'), '•••••••'); assert.equal(maskPhone(null), '•••••••');
});
