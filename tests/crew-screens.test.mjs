import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { CREW_TABS, isCrewTab, crewView } from '../admin/crew-screens.js';
import { ALL_TABS, groupOf } from '../admin/nav.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('every Crew screen missing from Admin now has exactly one Admin tab', () => {
  assert.deepEqual([...CREW_TABS].sort(), ['callnow', 'followups', 'knowledge', 'playbooks', 'rsa', 'team', 'tickets', 'visits', 'webleads']);
  for (const t of CREW_TABS) { assert.equal(ALL_TABS.filter((x) => x === t).length, 1, t); assert.ok(isCrewTab(t)); assert.ok(existsSync(new URL(`../crm/pages/${t}.js`, import.meta.url)), t); }
  assert.equal(isCrewTab('dash'), false);
});
test('tabs are grouped where people look for them', () => {
  for (const t of ['callnow', 'followups', 'playbooks', 'webleads']) assert.equal(groupOf(t), 'bookings');
  for (const t of ['rsa', 'tickets', 'visits']) assert.equal(groupOf(t), 'team');
  for (const t of ['knowledge', 'team']) assert.equal(groupOf(t), 'more');
});
test('Admin draws the Crew host and mounts the page; the build copies the same page files and scopes their styles', () => {
  assert.match(crewView('Tickets'), /id="crewRoot"/);
  const a = read('admin/admin.js'); assert.match(a, /isCrewTab\(S\.tab\)/); assert.match(a, /mountCrew\(S\.tab/);
  const b = read('scripts/build_admin.sh'); assert.match(b, /crew-scoped\.css/); assert.match(b, /crm\/pages/);
  assert.match(read('admin/index.html'), /crew-scoped\.css/);
});
test('Crew pages only ever import files the Admin build copies', () => {
  for (const t of CREW_TABS) for (const m of read(`crm/pages/${t}.js`).matchAll(/from '\.\.\/([\w-]+\.js)'/g)) assert.ok(existsSync(new URL('../crm/' + m[1], import.meta.url)), `${t} -> ${m[1]}`);
});
