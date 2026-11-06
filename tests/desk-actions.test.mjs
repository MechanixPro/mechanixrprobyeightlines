// Regression tests for the desk action audit (docs/DESK-ACTION-AUDIT.md): actions that did nothing, or failed without saying so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG = read('supabase/migrations/20270101000000_desk_actions_technician_lead_restore.sql');

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
