import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { garageLabel, garageSeenChip, isHandled, hasGarage, istTime } from '../crm/garage-assign.js';
import { dispatchOrder } from '../crm/flow-rules.js';

const now = new Date('2026-11-09T06:00:00Z');   // 11:30 IST on 9 Nov
const row = (o) => ({ id: 'a', garage_id: 'g', garage_name: '[Garage Name]', preferred_date: '2026-11-10', garage_seen_at: null, ...o });

test('label only when a garage is set', () => {
  assert.equal(garageLabel(row()), 'Garage: [Garage Name]');
  assert.equal(garageLabel({ id: 'a' }), null);
  assert.equal(garageLabel(row({ garage_name: null })), 'Garage: Partner garage');
});
test('seen time is shown in India time', () => {
  assert.equal(istTime('2026-11-09T08:35:00Z'), '14:05');
  assert.equal(istTime(null), null);
  assert.deepEqual(garageSeenChip(row({ garage_seen_at: '2026-11-09T08:35:00Z' }), now), { text: 'Seen by garage 14:05', tone: 'good' });
});
test('red chip when not seen and the visit is today or tomorrow', () => {
  assert.equal(garageSeenChip(row({ preferred_date: '2026-11-09' }), now).tone, 'bad');
  assert.equal(garageSeenChip(row({ preferred_date: '2026-11-10' }), now).text, 'Garage has not seen it');
  assert.equal(garageSeenChip(row({ preferred_date: '2026-11-12' }), now).tone, 'warn');
  assert.equal(garageSeenChip({ id: 'a' }, now), null);
});
test('a garage booking counts as handled and sorts after unassigned', () => {
  assert.ok(isHandled({ garage_id: 'g' }) && isHandled({ mechanic_id: 'm' }) && !isHandled({}) && hasGarage({ garage_id: 'g' }));
  const o = dispatchOrder([{ id: 'g', garage_id: 'x', preferred_date: '2026-11-09' }, { id: 'u', preferred_date: '2026-11-10' }]);
  assert.deepEqual(o.map((r) => r.id), ['u', 'g']);
});
test('migration keeps every old dispatch key and adds the garage keys; no new table', () => {
  const old = readFileSync(new URL('../supabase/migrations/20261228000000_paid_confirmation.sql', import.meta.url), 'utf8').match(/function public\.crm_dispatch_list[\s\S]*?end; \$\$;/)[0];
  const neu = readFileSync(new URL('../supabase/migrations/20270112000000_dispatch_garage.sql', import.meta.url), 'utf8');
  for (const k of [...old.matchAll(/'([a-z_]+)', /g)].map((m) => m[1])) assert.ok(neu.includes(`'${k}'`), k);
  for (const k of ['garage_id', 'garage_name', 'garage_assigned_at', 'garage_seen_at']) assert.ok(neu.includes(`'${k}'`), k);
  assert.ok(!/create table|alter table/i.test(neu));
});
