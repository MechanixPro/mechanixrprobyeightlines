import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CANCEL_REASONS, cleanCancelReason } from '../supabase/functions/_shared/garage.ts';
const src = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('cancel reason: a listed reason, or Other with at least 10 characters', () => {
  for (const r of CANCEL_REASONS) assert.deepEqual(cleanCancelReason(r), { ok: true, value: r });
  assert.equal(cleanCancelReason('Other: engine seized, needs a bore').ok, true);
  assert.equal(cleanCancelReason('Other: short').ok, false);
  assert.equal(cleanCancelReason('Other:').ok, false);
  assert.equal(cleanCancelReason('because').ok, false);
  assert.equal(cleanCancelReason('').ok, false);
  assert.match(cleanCancelReason('Other: hi').error, /10 characters/);
});
test('the garage screen offers the same reasons plus Other, and the server enforces them', () => {
  const ui = src('assets/js/garage.js');
  for (const r of CANCEL_REASONS) assert.ok(ui.includes("'" + r + "'"), r);
  assert.match(ui, /'Other: ' \+ t0/);
  assert.match(src('supabase/functions/garage-app/index.ts'), /cleanCancelReason\(reason\)/);
});
test('Admin estimates have an Edit estimate button that opens the quote builder', () => {
  const gd = src('crm/garage-desk.js');
  assert.match(gd, /data-gd="editEst"/);
  assert.match(gd, /case 'editEst'/);
  assert.match(src('admin/admin.js'), /editEstimate: async \(e\) =>[\s\S]*flow\.actions\.quote/);
  assert.equal(src('admin/garage-desk.js'), gd);   // the Admin copy matches the source
});
