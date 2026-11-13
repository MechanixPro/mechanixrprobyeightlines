import test from 'node:test';
import assert from 'node:assert/strict';
import { findOrCreateCustomer } from '../supabase/functions/_shared/customer.ts';

// A tiny in-memory customers table with the three calls the helper makes.
function fakeDb(rows) {
  const log = [];
  const q = (op, pay) => ({
    _f: null, eq(c, v) { this._f = [c, v]; return this; },
    select() { return this; },
    maybeSingle() { const r = rows.find((x) => x[this._f[0]] === this._f[1]); return Promise.resolve({ data: r ? { ...r } : null, error: null }); },
    single() { const row = { id: 'new', blocked: false, email: null, ...pay }; rows.push(row); return Promise.resolve({ data: { ...row }, error: null }); },
    then(res) { const r = rows.find((x) => x[this._f[0]] === this._f[1]); if (r) Object.assign(r, pay); log.push(['update', pay]); return Promise.resolve({ error: null }).then(res); },
  });
  return { log, from: () => ({ select: () => q('select'), insert: (p) => q('insert', p), update: (p) => q('update', p) }) };
}

test('an existing customer keeps their saved name and email when someone else uses their phone', async () => {
  const rows = [{ id: 'c1', phone: '9000000001', name: 'Real Owner', email: 'real@example.com', blocked: false }];
  const db = fakeDb(rows);
  const r = await findOrCreateCustomer(db, { phone: '9000000001', name: 'Someone Else', email: 'attacker@example.com' });
  assert.equal(r.data.id, 'c1');
  assert.equal(rows[0].email, 'real@example.com');
  assert.equal(rows[0].name, 'Real Owner');
});
test('an existing customer with no email gets the one from the form', async () => {
  const rows = [{ id: 'c2', phone: '9000000002', name: 'No Mail', email: null, blocked: false }];
  await findOrCreateCustomer(fakeDb(rows), { phone: '9000000002', name: 'No Mail', email: 'new@example.com' });
  assert.equal(rows[0].email, 'new@example.com');
});
test('a new phone number creates a customer', async () => {
  const rows = [];
  const r = await findOrCreateCustomer(fakeDb(rows), { phone: '9000000003', name: 'Fresh', email: 'f@example.com' });
  assert.equal(rows.length, 1);
  assert.equal(r.data.id, 'new');
});
