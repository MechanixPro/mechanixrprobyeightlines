// Regression tests for the desk action audit (docs/DESK-ACTION-AUDIT.md): actions that did nothing, or failed without saying so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInvoice, missingDetails } from '../admin/invoice.js';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = read('supabase/migrations/20270102000000_desk_actions_technician_lead_restore.sql');

test('the Technician lead can read the technician board and the unstaffed alert again (the 225 migration had dropped manage_technicians)', () => {
  const last = (fn) => readdirSync(new URL('../supabase/migrations', import.meta.url)).sort().filter((f) => read('supabase/migrations/' + f).includes('function public.' + fn)).pop();
  assert.equal(last('crm_tech_board'), '20261225000000_booking_id_after_confirmation.sql', 'the bug: the last full definition only checks assign_leads');
  assert.match(MIG, /crm_tech_board\(date\)/); assert.match(MIG, /crm_unstaffed_jobs\(\)/);
  assert.match(MIG, /crm_can\(''assign_leads''\) or public\.crm_can\(''manage_technicians''\)/);
  assert.match(MIG, /position\('manage_technicians' in d\) = 0/, 'idempotent: skipped when already patched');
  assert.doesNotMatch(MIG, /\bdrop\b|\bdelete\b|\btruncate\b/i);
  assert.match(read('supabase/local-test/desk-actions.sql'), /Technician lead can read the technician board/);
  assert.match(read('supabase/local-test/run.sh'), /desk-actions\.sql/);
});

test('an action that fails without a catch still shows a message in Crew and in the Admin', () => {
  assert.match(read('crm/crm.js'), /addEventListener\('unhandledrejection'[\s\S]{0,200}toast\('That did not work: '/);
  const a = read('admin/admin.js');
  assert.match(a, /addEventListener\('unhandledrejection'[\s\S]{0,260}toast\('That did not work: '/);
  assert.match(a, /p\.catch\(\(x\) => \{ console\.error\('act'[\s\S]{0,200}toast\('That did not work: '/, 'every ACT handler is guarded');
});

test('the Admin paid-confirmation card says so when it cannot load, and the Retry button is wired', () => {
  const a = read('admin/admin.js');
  assert.doesNotMatch(a, /catch \(e\) \{ el\.innerHTML = ''; \}/, 'no silent blank card');
  assert.match(a, /The paid-confirmation card could not be loaded[\s\S]{0,200}data-flow="reloadFlow"/);
});

test('a message is never hidden under a dialog', () => {
  const crm = read('crm/crm.css'), flow = read('crm/flow.css'), adm = read('admin/admin.css');
  const z = (css, sel) => Number((css.match(new RegExp(sel + '\\{[^}]*z-index:(\\d+)')) || [])[1]);
  assert.ok(z(crm, '\\.toast') > z(flow, '\\.flow-modal'), 'Crew toast sits above flow dialogs');
  assert.match(adm, /\.toast\{z-index:1100!important\}/);
});

test('the Admin money pages show an error with Retry instead of a blank page if the money model throws', () => {
  const a = read('admin/admin.js');
  assert.match(a, /function render\(\) \{ try \{ renderPage\(\); \} catch \(e\) \{[^}]*errorHtml\('This page could not be shown\.'/);
  assert.match(a, /function moneyCard\(l\) \{\s*try \{ return moneyCardBody\(l\); \} catch/);
  assert.match(a, /if \(b\.dataset\.retry === 'render'\) render\(\)/);
});

const SVC = [{ id: 'repair', kind: 'service', name: 'Repair or problem check', price: 349 }, { id: 'basic', kind: 'service', name: 'Basic service', price: 499 }];
const NEW = { name: '[Customer Name]', phone: '9000000001', booking_id: 'MP-26-27-0001', created_at: '2026-11-05T05:00:00Z', paid_amount: 99, addons: null };
test('invoice: a car booking from the new /book/ flow has no package, and says so instead of failing', () => {
  const v = buildInvoice({ ...NEW, service_id: null, est_total: null, vehicle: 'car' }, SVC, {});
  assert.equal(v.lines.length, 0); assert.equal(v.total, 0);
  assert.deepEqual(missingDetails(v).includes('vehicle number'), true);
});
test('invoice: the quote the customer approved fills the invoice (before GST, its own rate), not the checkup package', () => {
  const quote = [{ name: 'Brake pads', amount: 800 }, { name: 'Labour', amount: 400 }];
  const v = buildInvoice({ ...NEW, service_id: 'repair', quote_lines: quote, quote_rate: 18 }, SVC, {});
  assert.deepEqual(v.lines.map((l) => l.name), ['Brake pads', 'Labour']);
  assert.equal(v.basis, 'excl'); assert.equal(v.taxable, 1200); assert.equal(v.total, 1416); assert.equal(v.paid, 99); assert.equal(v.balance, 1317, 'the confirmation fee already paid is credited');
  const car = buildInvoice({ ...NEW, service_id: null, quote_lines: quote, quote_rate: 18 }, SVC, {});
  assert.equal(car.lines.length, 2, 'a car booking is billed from its quote too');
});
test('invoice: an invoice the admin corrected wins over the quote; no quote leaves the package as before', () => {
  const ov = { basis: 'excl', rate: 5, lines: [{ name: 'Custom', amount: 100 }] };
  assert.deepEqual(buildInvoice({ ...NEW, service_id: 'repair', quote_lines: [{ name: 'X', amount: 1 }], invoice_override: ov }, SVC, {}).lines.map((l) => l.name), ['Custom']);
  assert.deepEqual(buildInvoice({ ...NEW, service_id: 'basic' }, SVC, {}).lines.map((l) => l.name), ['Basic service']);
});
test('Admin: the quote is attached before the invoice opens, and an empty invoice opens the edit box with a plain message', () => {
  const a = read('admin/admin.js');
  assert.match(a, /async function ensureInvNo\(lead\) \{\s*await attachQuote\(lead\);/);
  assert.match(a, /crm_quote_get', \{ p_lead: lead\.id \}[\s\S]{0,200}q\.status === 'approved'/);
  assert.match(a, /id="invEditBox"\$\{v\.lines\.length \? ' hidden' : ''\}/);
  assert.match(a, /Add the items first: this booking has no priced item/);
});

test('a dialog that stays open after Save (Find by PIN) gets its button back', () => {
  const u = read('crm/ui.js');
  assert.match(u, /finally \{ if \(btn && el\.isConnected\) btn\.disabled = false; \}/);
  assert.doesNotMatch(u, /catch \(x\) \{ err\.textContent = clean\(x\); if \(btn\) btn\.disabled = false; \}\s*\n/);
});

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
test('click-through: every element on Dispatch and Issues does something and nothing throws (skips without Chrome)', { skip: !existsSync(CHROME) && 'Chrome not installed', timeout: 180000 }, () => {
  const out = mkdtempSync(join(tmpdir(), 'mxp-ct-'));
  for (const only of ['crew dispatch', 'crew issues']) {
    const r = spawnSync('node', ['scripts/ui-clicks.mjs', '--out', out, '--app', 'crew', '--persona', 'owner', '--only', only], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', timeout: 80000 });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const j = JSON.parse(readFileSync(join(out, 'clicks-crew-owner.json'), 'utf8'));
    assert.equal(j.error, 0, JSON.stringify(j.rows.filter((x) => x.result === 'ERROR')));
    assert.ok(j.total > 3, 'something was pressed');
  }
});
