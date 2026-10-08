import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INTERESTS, cleanWaitlist } from '../supabase/functions/_shared/waitlist.ts';
import { interestCounts, waitlistRows } from '../admin/waitlist-view.js';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const IDS = ['car', 'echallan', 'pdi', 'damage', 'rental', 'oem', 'insurance', 'franchise'];

test('the waitlist knows the eight coming-soon services', () => assert.deepEqual(INTERESTS.map((i) => i.id), IDS));
test('a good signup is cleaned and kept', () => {
  const r = cleanWaitlist({ name: ' Asha <b>K</b> ', phone: '+91 98765 43210', email: 'ASHA@Example.com', interests: ['car', 'rental', 'car', 'ghost'], city: ' Bengaluru ', note: 'hi', consent: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { name: 'Asha K', phone: '9876543210', email: 'asha@example.com', interests: ['car', 'rental'], city: 'Bengaluru', note: 'hi' });
});
test('at least one service, one way to reach the person, and their OK are required', () => {
  assert.equal(cleanWaitlist({ phone: '9876543210', interests: [], consent: true }).ok, false);
  assert.equal(cleanWaitlist({ interests: ['car'], consent: true }).ok, false);
  assert.equal(cleanWaitlist({ phone: '9876543210', interests: ['car'], consent: false }).ok, false);
  assert.equal(cleanWaitlist({ phone: '1234567890', interests: ['car'], consent: true }).ok, false);
  assert.equal(cleanWaitlist({ email: 'not-an-email', interests: ['car'], consent: true }).ok, false);
  assert.equal(cleanWaitlist({ email: 'a@b.in', interests: ['car'], consent: true }).ok, true);
});
test('long text is cut to size', () => {
  const v = cleanWaitlist({ phone: '9876543210', interests: ['franchise'], consent: true, name: 'x'.repeat(200), city: 'y'.repeat(200), note: 'z'.repeat(500) }).value;
  assert.equal(v.name.length, 60); assert.equal(v.city.length, 40); assert.equal(v.note.length, 200);
});
test('the table is private: staff read it, only the owner deletes, and each row has a way to reach the person', () => {
  const sql = read('../supabase/migrations/20261027000000_waitlist.sql');
  assert.match(sql, /create table if not exists public\.waitlist/); assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to authenticated using \(public\.is_admin\(\)\)/); assert.match(sql, /for delete to authenticated using \(public\.is_owner\(\)\)/);
  assert.doesNotMatch(sql, /to anon/); assert.match(sql, /phone is not null or email is not null/);
  for (const id of IDS) assert.ok(sql.includes(`'${id}'`), id);
});
test('join-waitlist is public but guarded: allowed websites only, a per-visitor limit, validated input, nothing logged', () => {
  const f = read('../supabase/functions/join-waitlist/index.ts');
  assert.match(f, /corsHeaders\(req\)/); assert.match(f, /cleanWaitlist\(/); assert.match(f, /429/); assert.match(f, /ip_hash/);
  assert.doesNotMatch(f, /console\.(log|error)\([^)]*(phone|email|name)/i);
  assert.match(read('../supabase/config.toml'), /\[functions\.join-waitlist\]\s*verify_jwt = false/);
});
test('the admin counts interest per service and filters the list', () => {
  const rows = [{ id: 1, name: 'A', phone: '9', email: null, interests: ['car', 'rental'], city: 'Bengaluru', created_at: '2026-10-08T10:00:00Z' }, { id: 2, name: 'B', phone: null, email: 'b@x.in', interests: ['car'], city: '', created_at: '2026-10-09T10:00:00Z' }, { id: 3, name: 'C', phone: '8', email: null, interests: ['franchise'], city: 'Mysuru', created_at: '2026-10-07T10:00:00Z' }];
  const c = interestCounts(rows);
  assert.deepEqual(c.slice(0, 2).map((x) => [x.id, x.count]), [['car', 2], ['rental', 1]]); assert.equal(c.find((x) => x.id === 'oem').count, 0); assert.equal(c.length, 8);
  assert.deepEqual(waitlistRows(rows).map((r) => r.id), [2, 1, 3]);
  assert.deepEqual(waitlistRows(rows, { interest: 'car' }).map((r) => r.id), [2, 1]);
  assert.deepEqual(waitlistRows(rows, { q: 'mysuru' }).map((r) => r.id), [3]);
});
test('the admin has a Waitlist tab with demand bars, a list, an export and an owner-only delete', () => {
  assert.match(read('../admin/index.html'), /data-tab="waitlist"/);
  const a = read('../admin/admin.js');
  assert.match(a, /from\('waitlist'\)/); for (const act of ['wlCsv', 'wlDelete']) assert.ok(a.includes(act), act);
});
test('the home page shows the eight coming-soon services as cards that open their own pages', () => {
  const h = read('../index.html');
  const s = h.slice(h.indexOf('id="coming-soon"'), h.indexOf('id="coming-soon"') + 14000);
  for (const t of ['Car service', 'E-challan services', 'AI PDI reports', 'AI damage analysis', 'Bike rental', 'OEM parts', 'Insurance claim service', 'Franchise model']) assert.ok(s.includes(t), t);
  assert.equal((s.match(/<a class="soon-card/g) || []).length, 8);
  for (const slug of ['car-service', 'e-challan-services', 'ai-pdi-reports', 'ai-damage-analysis', 'bike-rental', 'oem-parts', 'insurance-claim-service', 'franchise']) assert.ok(s.includes(`href="/coming-soon/${slug}/"`), slug);
  assert.match(s, /href="\/coming-soon\/"/); assert.match(h, /waitlist\.js/); assert.match(read('../terms/index.html'), /coming-soon/);
});
test('waitlist.js sends the signup to the function and thanks the person', () => {
  const js = read('../assets/js/waitlist.js');
  assert.match(js, /\/functions\/v1\/join-waitlist/); assert.match(js, /on the list/i); assert.match(read('../coming-soon/index.html'), /id="wlMsg" role="status" aria-live="polite"/);
});
