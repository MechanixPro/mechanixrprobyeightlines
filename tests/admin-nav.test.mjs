import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GROUPS, ALL_TABS, groupOf, tabsOf, firstTab, navBadges } from '../admin/nav.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('five sections hold every page exactly once, with the daily work first', () => {
  assert.deepEqual(GROUPS.map((g) => g.id), ['today', 'bookings', 'money', 'team', 'more']);
  assert.deepEqual([...ALL_TABS].sort(), ['activity', 'coupons', 'customers', 'dash', 'homeimgs', 'invoices', 'issues', 'leads', 'mechanics', 'offers', 'pins', 'prices', 'reports', 'settings', 'waitlist']);
  assert.equal(new Set(ALL_TABS).size, ALL_TABS.length);
});
test('the pages sit where the client expects them', () => {
  assert.deepEqual(tabsOf('bookings').map((t) => t[0]), ['leads', 'customers', 'issues']);
  assert.deepEqual(tabsOf('money').map((t) => t[0]), ['invoices', 'reports', 'coupons', 'prices']);
  assert.deepEqual(tabsOf('team').map((t) => t[0]), ['mechanics', 'pins']);
  assert.equal(groupOf('invoices'), 'money'); assert.equal(groupOf('dash'), 'today'); assert.equal(groupOf('settings'), 'more'); assert.equal(groupOf('nonsense'), 'today');
  assert.equal(firstTab('money'), 'invoices'); assert.equal(firstTab('nope'), 'dash');
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
  const c = read('admin/admin.css');
  assert.match(c, /\.groups/); assert.match(c, /\.subtabs/); assert.match(c, /min-height:44px/); assert.match(c, /overflow-x:auto/);
});
test('a hidden section row and an empty badge really disappear (the display rules must not override the hidden attribute)', () => {
  assert.match(read('admin/admin.css'), /\.subtabs \.sub\[hidden\][^{]*\{display:none\}/); assert.match(read('admin/admin.css'), /\.badge\[hidden\]/);
});
