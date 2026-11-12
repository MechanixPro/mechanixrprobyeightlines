import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GROUPS, ALL_TABS, groupOf, tabsOf, firstTab, navBadges } from '../admin/nav.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('five sections hold every page exactly once, with the daily work first', () => {
  assert.deepEqual(GROUPS.map((g) => g.id), ['today', 'bookings', 'money', 'team', 'more']);
  assert.deepEqual([...ALL_TABS].sort(), ['activity', 'board', 'callnow', 'conversion', 'coupons', 'custbook', 'customers', 'dash', 'dispatch', 'followups', 'garageapp', 'garages', 'homeimgs', 'invoices', 'issues', 'knowledge', 'kyc', 'leads', 'mechanics', 'mechledger', 'offers', 'pins', 'playbooks', 'prices', 'reports', 'rsa', 'sales', 'settings', 'team', 'tickets', 'visits', 'waitlist', 'watch', 'webleads', 'whatsapp']);
  assert.equal(new Set(ALL_TABS).size, ALL_TABS.length);
});
test('the pages sit where the client expects them', () => {
  assert.deepEqual(tabsOf('bookings').map((t) => t[0]), ['board', 'dispatch', 'leads', 'customers', 'custbook', 'issues', 'whatsapp', 'callnow', 'followups', 'playbooks', 'webleads']);
  assert.deepEqual(tabsOf('money').map((t) => t[0]), ['sales', 'mechledger', 'invoices', 'conversion', 'reports', 'coupons', 'prices']);
  assert.deepEqual(tabsOf('team').map((t) => t[0]), ['mechanics', 'garages', 'garageapp', 'kyc', 'pins', 'rsa', 'tickets', 'visits']); // changed on purpose 2026-11-10: Admin Garages tab (add, edit, delete)
  assert.equal(groupOf('invoices'), 'money'); assert.equal(groupOf('dash'), 'today'); assert.equal(groupOf('settings'), 'more'); assert.equal(groupOf('nonsense'), 'today');
  assert.equal(firstTab('money'), 'sales'); assert.equal(firstTab('nope'), 'dash');
});
test('badges show what needs the client: new bookings and open issues, and payments being waited on', () => {
  const leads = [{ status: 'new' }, { status: 'new' }, { status: 'payment_sent' }, { status: 'paid' }];
  const b = navBadges({ leads, issues: [{ status: 'open' }, { status: 'resolved' }] });
  assert.equal(b.bookings, 3); assert.equal(b.money, 1); assert.equal(b.today, 0); assert.equal(b.more, 0);
  assert.deepEqual(navBadges({ leads: [], issues: [] }), { today: 0, bookings: 0, money: 0, team: 0, more: 0 });
});
test('the page markup matches: a bar of sections, and a row of pages for each section, with every page reachable', () => {
  const h = read('admin/index.html');
  for (const g of GROUPS) { assert.match(h, new RegExp(`data-group="${g.id}"`), g.id); assert.match(h, new RegExp(`data-sub="${g.id}"`), 'sub ' + g.id); }
  for (const t of ALL_TABS) assert.match(h, new RegExp(`data-tab="${t}"`), t);
});
test('the admin script switches sections, remembers the last page in each, and shows the badges', () => {
  const a = read('admin/admin.js');
  assert.match(a, /data-group/); assert.match(a, /lastTab/); assert.match(a, /navBadges/); assert.match(a, /from '\.\/nav\.js'/);
});
test('the navigation is readable on a phone: sections scroll sideways and every button is at least 44px high', () => {
  // Phase 1: the tab look moved from admin.css to the shared ds.css (underline tabs); the rules are the same promises.
  const c = read('admin/ds.css');
  assert.match(c, /\.groups/); assert.match(c, /\.subtabs/); assert.match(c, /min-height:var\(--tap\)/); assert.match(c, /overflow-x:auto/); assert.match(c, /--tap:44px/);
});
test('a hidden section row and an empty badge really disappear (the display rules must not override the hidden attribute)', () => {
  // Phase 1: ds.css has one global [hidden]{display:none!important} rule, so no display rule can override the hidden attribute.
  assert.match(read('admin/ds.css'), /\[hidden\]\{display:none!important\}/);
});

test('only the sidebar buttons switch the page, so the Partner KYC inner tabs cannot break the view', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
  assert.match(src, /closest\('#side \[data-tab\]'\)/);
  assert.doesNotMatch(src, /e\.target\.closest\('\[data-tab\]'\)/);
});

test('the booking Update box lists partner garages and assigns the chosen one on save', () => {
  const src = read('admin/admin.js');
  assert.match(src, /optgroup/); assert.match(src, /crm_garage_picker/);
  assert.match(src, /startsWith\('g:'\)/); assert.match(src, /crm_garage_assign', \{ p_lead: l\.id, p_garage: gid/);
  assert.match(src, /Partner garage<\/label>/);
});

test('everything goes to a garage: convert, history, garage-only pick, and a database guard', () => {
  const sql = read('supabase/migrations/20270139000000_mechanic_to_garage.sql');
  assert.match(sql, /admin_mechanic_convert/); assert.match(sql, /admin_garage_history/); assert.match(sql, /leads_no_new_mechanic/);
  assert.match(sql, /kyc_need_admin\(\)/); assert.doesNotMatch(sql, /update public\.leads set mechanic_id/); assert.doesNotMatch(sql, /delete from public\.(mechanics|leads)/);
  assert.match(read('crm/flow-core.js'), /async assignPick\(lead\) \{ return actions\.garageAssign\(lead\); \}/);
  assert.equal(read('crm/flow-core.js'), read('admin/flow-core.js'));
  const a = read('admin/admin.js'); assert.match(a, /convertMechanic/); assert.match(a, /admin_mechanic_convert/); assert.doesNotMatch(a, /data-act="newMechanic"/);
  assert.match(read('admin/garages-view.js'), /data-hist/); assert.match(read('admin/garages-view.js'), /admin_garage_history/);
});
