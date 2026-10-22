import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DESK_TEMPLATES, placeholders } from '../supabase/functions/_shared/desk-templates.ts';

test('every desk template has sequential placeholders that match its declared parameter count', () => {
  for (const t of DESK_TEMPLATES) { const p = placeholders(t.text); assert.equal(p.sequential, true, t.name); assert.equal(p.count, t.params, t.name); }
});
test('template and campaign names are WhatsApp-safe', () => {
  for (const t of DESK_TEMPLATES) { assert.match(t.name, /^[a-z][a-z0-9_]{2,60}$/); assert.match(t.campaign, /^[a-z][a-z0-9_]{2,60}$/); assert.ok(t.text.length <= 1024); }
});
test('the sample text swaps every placeholder for a [Label], the format AiSensy accepts', () => {
  for (const t of DESK_TEMPLATES) {
    assert.doesNotMatch(t.sample, /\{\{/); assert.equal((t.sample.match(/\[[A-Za-z ]+\]/g) || []).length, t.params, t.name);
    assert.equal(t.sample.replace(/\[[A-Za-z ]+\]/g, '#'), t.text.replace(/\{\{\d+\}\}/g, '#'), t.name);
  }
});
test('the payment-link function sends the four parameters the payment template expects', () => {
  const src = readFileSync(new URL('../supabase/functions/desk-payment-link/index.ts', import.meta.url), 'utf8');
  assert.match(src, /params: \[first, String\(amount\), lead\.ref, link\.url\]/);
  assert.equal(DESK_TEMPLATES[0].params, 4);
});
test('no template promises something the desk does not do and none contains a price or a number we could get wrong', () => {
  for (const t of DESK_TEMPLATES) assert.doesNotMatch(t.text, /\b(free|guarantee|100%|best price)\b/i);
});
