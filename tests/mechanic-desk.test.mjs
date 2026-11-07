// The Mechanic app card (crm/mechanic-desk.js, shared by Crew and the Admin) and the shop location / Open-Closed on the Garage app screen: every action calls the right
// crm_mechanic_* function with the right arguments, failures are shown, the card is hidden without Manage technicians, and the link and PIN are shown once.
// Placeholders only: no real mechanic, PIN or link.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as M from '../crm/mechanic-desk.js';
import * as G from '../crm/garage-desk.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const NOW = Date.parse('2026-11-07T10:00:00Z');
const PIN = '482915', LINK = 'https://example.invalid/mechanic/?m=PLACEHOLDERTOKEN';
const MECH = { id: 'm-1', name: '[Mechanic One]', phone: '9000000001' };
const ROW = { id: 'acc-1', mechanic_id: 'm-1', mechanic: '[Mechanic One]', active: true, revoked_at: null, locked_until: null, last_login_at: '2026-11-06T08:30:00Z', last_seen_at: '2026-11-07T09:00:00Z', created_at: '2026-11-01T00:00:00Z',
  availability: 'available', availability_at: '2026-11-07T08:00:00Z', last_lat: 12.9, last_lng: 77.6, last_loc_at: '2026-11-07T08:00:00Z', map_url: 'https://www.google.com/maps?q=12.9,77.6' };

function desk({ fail = {}, can = ['manage_technicians'], rows = [ROW] } = {}) {
  const calls = [], toasts = [], dialogs = [], copied = [], opened = [];
  const base = { crm_mechanic_access_list: rows, crm_mechanic_access_create: { access_id: 'acc-9', mechanic: MECH.name, link: LINK, note: 'x' }, crm_mechanic_link_new: { link: LINK }, crm_mechanic_pin_reset: { ok: true }, crm_mechanic_revoke: { ok: true }, crm_mechanic_enable: { ok: true } };
  const rpc = async (name, args) => { calls.push([name, args]); if (fail[name]) throw new Error(fail[name]); return base[name]; };
  const md = M.createMechanicDesk({ rpc, toast: (m, bad) => toasts.push({ m, bad: !!bad }), can: (a) => can.includes(a), dialog: (o) => { dialogs.push(o); return { form: null, close() {} }; },
    copy: async (t) => { copied.push(t); }, open: (u) => opened.push(u), random: (() => { let i = 0; return () => [4, 8, 2, 9, 1, 5][i++ % 6]; })(), now: () => NOW });
  return { md, calls, toasts, dialogs, copied, opened, last: () => dialogs[dialogs.length - 1], names: () => calls.map((c) => c[0]), rpcCalls: (n) => calls.filter((c) => c[0] === n).map((c) => c[1]) };
}
const form = (fields = {}, body = '') => {
  const f = {}; for (const [k, v] of Object.entries(fields)) f[k] = { value: v };
  const clicks = [];
  f.querySelectorAll = (sel) => { const re = sel === '[data-copy]' ? /data-copy="(\w+)"/g : sel === '[data-wa]' ? /data-wa="(1)"/g : null; return re ? [...body.matchAll(re)].map((m) => ({ dataset: { copy: m[1] }, addEventListener: (ev, fn) => clicks.push([sel === '[data-wa]' ? 'wa' : m[1], fn]) })) : []; };
  f.clicks = clicks; return f;
};
const submit = async (dlg, fields) => { const closed = []; await dlg.onSubmit(form(fields), { close: () => closed.push(1), say() {} }); return closed.length; };
const fakeRoot = () => ({ innerHTML: '', handlers: {}, isConnected: true, addEventListener(t, f) { this.handlers[t] = f; } });
const click = (root, act) => root.handlers.click({ target: { closest: (sel) => (sel === '[data-mx]' ? { dataset: { mx: act } } : null) } });

test('access state: none, active, locked, revoked; chip and map link rules', () => {
  assert.equal(M.mechAccessState([], NOW).label, 'No access');
  const on = M.mechAccessState([ROW], NOW); assert.equal(on.label, 'Active'); assert.equal(on.last, '2026-11-07T09:00:00Z');
  assert.match(M.mechAccessState([{ ...ROW, locked_until: '2026-11-07T10:10:00Z' }], NOW).label, /^Locked until/);
  assert.equal(M.mechAccessState([{ ...ROW, locked_until: '2026-11-07T09:00:00Z' }], NOW).label, 'Active');
  assert.equal(M.mechAccessState([{ ...ROW, active: false }], NOW).label, 'Revoked');
  assert.equal(M.mechAccessState([{ ...ROW, revoked_at: '2026-11-07T00:00:00Z' }], NOW).label, 'Revoked');
  assert.equal(M.availabilityChip(ROW).label, 'Available'); assert.equal(M.availabilityChip({ availability: 'busy' }).label, 'Busy'); assert.equal(M.availabilityChip({ availability: null }), null);
  assert.equal(M.safeMapUrl(ROW.map_url), ROW.map_url); assert.equal(M.safeMapUrl('javascript:alert(1)'), null); assert.equal(M.safeMapUrl('https://evil.example/?q=1,2'), null); assert.equal(M.safeMapUrl(null), null);
});
test('the card shows state, last seen, Available chip with time, and the location link', async () => {
  const d = desk(), root = fakeRoot(); await d.md.mountCard(root, MECH);
  assert.deepEqual(d.rpcCalls('crm_mechanic_access_list'), [{ p_mechanic: 'm-1' }]);
  for (const t of ['Mechanic app', 'Active', 'Available', 'Last seen', 'since', 'Last known location', 'https://www.google.com/maps?q=12.9,77.6', 'New link', 'Reset PIN', 'Revoke']) assert.ok(root.innerHTML.includes(t), t);
  assert.ok(!root.innerHTML.includes('Create access'));
});
test('card buttons by state: none gets Create access, revoked gets Switch on', async () => {
  let d = desk({ rows: [] }), root = fakeRoot(); await d.md.mountCard(root, MECH); assert.match(root.innerHTML, /No access/); assert.match(root.innerHTML, /Create access/); assert.doesNotMatch(root.innerHTML, /Last known location/);
  d = desk({ rows: [{ ...ROW, active: false }] }); root.innerHTML = ''; await d.md.mountCard(fakeRoot(), MECH); const r2 = fakeRoot(); await d.md.mountCard(r2, MECH); assert.match(r2.innerHTML, /Revoked/); assert.match(r2.innerHTML, /Switch on/); assert.doesNotMatch(r2.innerHTML, /Reset PIN/);
});
test('create calls crm_mechanic_access_create with the mechanic and PIN, then shows the link and PIN once', async () => {
  const d = desk({ rows: [] }); d.md.actions.create(MECH);
  assert.match(d.last().body, /value="482915"/, 'a random valid PIN is filled in');
  await assert.rejects(() => submit(d.last(), { pin: '1111' }), /not all the same digit/); assert.equal(d.rpcCalls('crm_mechanic_access_create').length, 0);
  await submit(d.last(), { pin: ' 4829 ' });
  assert.deepEqual(d.rpcCalls('crm_mechanic_access_create'), [{ p_mechanic: 'm-1', p_pin: '4829' }]);
  const s = d.last(); assert.match(s.title, /Private link and PIN/); assert.ok(s.body.includes(LINK)); assert.ok(s.body.includes('4829'));
  assert.match(s.body, /Shown once/); assert.match(s.body, /role="alert"/); assert.match(s.body, /Copy link/); assert.match(s.body, /Copy PIN/); assert.match(s.body, /Send on WhatsApp/); assert.match(s.body, /by phone, not in the same message/);
});
test('copy buttons copy the link and PIN; WhatsApp opens a wa.me link holding the link and never the PIN', async () => {
  const d = desk({ rows: [] }); d.md.actions.create(MECH); await submit(d.last(), { pin: PIN });
  const dlg = d.last(), f = form({}, dlg.body); dlg.onOpen(f);
  for (const [, fn] of f.clicks) fn(); await new Promise((r) => setTimeout(r));
  assert.ok(d.copied.includes(LINK) && d.copied.includes(PIN));
  assert.equal(d.opened.length, 1); const u = d.opened[0]; assert.match(u, /^https:\/\/wa\.me\/919000000001\?text=/);
  const text = decodeURIComponent(u.split('text=')[1]); assert.ok(text.includes(LINK)); assert.ok(!text.includes(PIN) && !u.includes(PIN), 'the PIN is never in the message');
  assert.match(M.waUrl('', LINK), /^https:\/\/wa\.me\/\?text=/, 'no phone: WhatsApp lets the person choose');
});
test('the link and PIN are kept nowhere: no toast, no list, no page, no state, no storage', async () => {
  const d = desk({ rows: [] }); d.md.actions.create(MECH); await submit(d.last(), { pin: PIN });
  assert.ok(d.toasts.every((t) => !t.m.includes(PIN) && !t.m.includes('PLACEHOLDERTOKEN')));
  assert.ok(d.dialogs.slice(0, -1).every((o) => !String(o.body).includes('PLACEHOLDERTOKEN')));
  const root = fakeRoot(); await d.md.mountCard(root, MECH);
  assert.ok(!root.innerHTML.includes(PIN) && !root.innerHTML.includes('PLACEHOLDERTOKEN'));
  assert.ok(!JSON.stringify(d.md.state).includes(PIN) && !JSON.stringify(d.md.state).includes('PLACEHOLDERTOKEN'));
  const src = read('crm/mechanic-desk.js'); assert.doesNotMatch(src, /localStorage|sessionStorage|indexedDB|document\.cookie/);
});
test('PIN reset and new link call their functions, show only what changed, and need a reason', async () => {
  const d = desk(); d.md.actions.pinReset(ROW, MECH);
  await assert.rejects(() => submit(d.last(), { pin: PIN, reason: ' ' }), /short reason/); assert.equal(d.rpcCalls('crm_mechanic_pin_reset').length, 0);
  await submit(d.last(), { pin: PIN, reason: 'Lost the phone' });
  assert.deepEqual(d.rpcCalls('crm_mechanic_pin_reset'), [{ p_access: 'acc-1', p_pin: PIN }]);
  assert.ok(d.last().body.includes(PIN)); assert.doesNotMatch(d.last().body, /data-copy="link"/); assert.match(d.last().body, /Shown once/);
  d.md.actions.newLink(ROW, MECH); await assert.rejects(() => submit(d.last(), { reason: 'a' }), /short reason/);
  await submit(d.last(), { reason: 'Link was shared' }); assert.deepEqual(d.rpcCalls('crm_mechanic_link_new'), [{ p_access: 'acc-1' }]);
  assert.ok(d.last().body.includes(LINK)); assert.doesNotMatch(d.last().body, /data-copy="pin"/); assert.match(d.last().body, /Shown once/);
});
test('revoke needs a reason; revoke and switch on call crm_mechanic_revoke and crm_mechanic_enable', async () => {
  const d = desk(); d.md.actions.revoke(ROW, MECH); await assert.rejects(() => submit(d.last(), { reason: '' }), /short reason/); assert.equal(d.rpcCalls('crm_mechanic_revoke').length, 0);
  assert.equal(await submit(d.last(), { reason: 'Left the team' }), 1); assert.deepEqual(d.rpcCalls('crm_mechanic_revoke'), [{ p_access: 'acc-1' }]); assert.ok(d.toasts.some((t) => /revoked/i.test(t.m)));
  d.md.actions.enable({ ...ROW, active: false }, MECH); await submit(d.last(), {}); assert.deepEqual(d.rpcCalls('crm_mechanic_enable'), [{ p_access: 'acc-1' }]); assert.ok(d.toasts.some((t) => /switched on/i.test(t.m)));
});
test('errors are shown: a failed button shows "That did not work", a failed dialog action throws to the dialog, a failed load shows a retry', async () => {
  const d = desk({ rows: [], fail: { crm_mechanic_access_create: 'this mechanic already has app access' } }), root = fakeRoot(); await d.md.mountCard(root, MECH);
  await click(root, 'create'); await d.last().onSubmit(form({ pin: PIN }), { close() {}, say() {} }).then(() => assert.fail('should throw'), (e) => assert.match(e.message, /already has app access/));
  assert.equal(d.dialogs.length, 1, 'no secret dialog after a failure');
  const d2 = desk({ fail: { crm_mechanic_access_list: 'boom' } }), r2 = fakeRoot(); await d2.md.mountCard(r2, MECH);
  assert.match(r2.innerHTML, /That did not work: boom/); assert.match(r2.innerHTML, /data-mx="retry"/);
  const d3 = desk({ can: [] }); assert.throws(() => d3.md.actions.revoke(ROW, MECH), /permission/);
});
test('without Manage technicians nothing is drawn and no database call is made', async () => {
  const d = desk({ can: ['manage_garages'] }), root = fakeRoot(); await d.md.mountCard(root, MECH);
  assert.equal(root.innerHTML, ''); assert.deepEqual(d.names(), []); assert.equal(d.md.visible(), false);
  for (const a of ['create', 'pinReset', 'newLink', 'revoke', 'enable']) assert.throws(() => d.md.actions[a](ROW, MECH), /permission/); assert.throws(() => d.md.openCard(MECH), /permission/);
  assert.deepEqual(d.names(), []); assert.equal(d.dialogs.length, 0);
});
test('wiring: shared file is copied byte for byte, listed, and used by Crew mechanics and the Admin mechanic sheet', () => {
  assert.equal(read('admin/mechanic-desk.js'), read('crm/mechanic-desk.js')); assert.match(read('scripts/shared-files.txt'), /^mechanic-desk\.js$/m);
  assert.match(read('crm/pages/mechanics.js'), /manage_technicians|mechanicDesk\.visible\(\)/); assert.match(read('crm/crm.js'), /createMechanicDesk\(\{ rpc, toast, can,/);
  assert.match(read('admin/admin.js'), /createMechanicDesk\(\{ rpc: adminRpc, toast, can: \(\) => isOwner\(\)/); assert.match(read('admin/admin.js'), /mechanicDesk\.mountCard/);
});

/* ---------- Garage app screen: shop location and Open/Closed ---------- */
const GROW = { id: 'acc-1', garage_id: 'g-1', garage: '[Garage One]', label: 'Owner', active: true, revoked_at: null, locked_until: null, last_login_at: '2026-11-06T08:30:00Z', created_at: '2026-11-01T00:00:00Z',
  is_open: true, is_open_at: '2026-11-07T07:00:00Z', shop_lat: 12.9, shop_lng: 77.6, shop_loc_at: '2026-11-06T09:00:00Z', map_url: 'https://www.google.com/maps?q=12.9,77.6' };
async function garageHtml(access) {
  const rpc = async (n) => ({ crm_garage_picker: [{ id: 'g-1', name: '[Garage One]', code: 'G-0001', status: 'live' }], crm_garage_access_list: access, crm_garage_assignments_list: [], crm_garage_estimates_inbox: [] }[n]);
  const gd = G.createGarageDesk({ rpc, toast() {}, can: () => true, canSettle: () => false, dialog() {}, now: () => NOW }); const root = { innerHTML: '', isConnected: true, addEventListener() {} }; await gd.mount(root); return root.innerHTML;
}
test('Garage app screen shows the Open chip with time and the shop location link', async () => {
  const h = await garageHtml([GROW]); assert.match(h, /Open/); assert.match(h, /Open since/); assert.match(h, /href="https:\/\/www\.google\.com\/maps\?q=12\.9,77\.6"[^>]*>Shop location/);
  assert.match(await garageHtml([{ ...GROW, is_open: false }]), /Closed since/);
});
test('Garage app screen: old rows without the new fields, or a bad map link, show no chip and no link', async () => {
  const { is_open, is_open_at, shop_lat, shop_lng, shop_loc_at, map_url, ...old } = GROW;
  const h = await garageHtml([old]); assert.doesNotMatch(h, /Closed|Open since/); assert.doesNotMatch(h, /Shop location<\/a>/);
  assert.doesNotMatch(await garageHtml([{ ...GROW, map_url: 'javascript:alert(1)' }]), /javascript:/);
  assert.equal(G.shopInfo([]).open, null);
  assert.equal(read('admin/garage-desk.js'), read('crm/garage-desk.js'));
});
