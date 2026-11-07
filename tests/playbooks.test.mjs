import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBOOKS, byKind, fill, placeholders, searchPlaybooks } from '../crm/playbooks.js';

const all = (p) => [p.title, p.when || '', p.text || '', ...(p.steps || [])].join(' ');

test('every item has a unique id, title, kind and content', () => {
  const ids = new Set();
  for (const p of PLAYBOOKS) {
    assert.ok(p.id && p.title, p.id);
    assert.ok(!ids.has(p.id)); ids.add(p.id);
    assert.ok(['script', 'sop', 'reply'].includes(p.kind));
    assert.ok(p.kind === 'reply' ? p.text : p.steps.length >= 5, p.id);
  }
  assert.equal(byKind('script').length, 4); assert.equal(byKind('sop').length, 4); assert.equal(byKind('reply').length, 7);
});
test('no superlatives, no phone numbers, no stray prices', () => {
  for (const p of PLAYBOOKS) {
    const t = all(p);
    assert.doesNotMatch(t, /\b(best|cheapest|guarantee[sd]?|number one|no\.? ?1|lowest|unbeatable|100%)\b/i, p.id);
    assert.doesNotMatch(t, /\d{10}|\+91|\b\d{5}[ -]\d{5}\b/, p.id);
    for (const m of t.matchAll(/₹\s?\d+/g)) assert.ok(['₹49', '₹69', '₹99'].includes(m[0].replace(/\s/g, '')), p.id + ' ' + m[0]);
  }
});
test('payment scripts state the fee is adjusted and includes GST', () => {
  for (const id of ['call-new-enquiry', 'call-payment-reminder']) {
    const t = all(PLAYBOOKS.find((p) => p.id === id));
    assert.match(t, /₹49, ₹69 or ₹99/); assert.match(t, /GST/); assert.match(t, /adjusted in the final bill/);
  }
});
test('fill replaces known placeholders and leaves unknown ones visible', () => {
  assert.equal(fill('Hi {name}, {service} at {time} for {amount}', { name: 'Asha', service: 'oil change' }), 'Hi Asha, oil change at {time} for {amount}');
  assert.equal(fill('Hi {name}', { name: '  ' }), 'Hi {name}');
  assert.equal(fill('Hi {name}'), 'Hi {name}');
  assert.deepEqual(placeholders('{a} {b} {a}'), ['a', 'b']);
});
test('search filters by kind and text', () => {
  assert.ok(searchPlaybooks('script', 'sos').length === 1);
  assert.equal(searchPlaybooks('reply', 'zzzz').length, 0);
  assert.equal(searchPlaybooks('sop', '').length, 4);
});
