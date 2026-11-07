import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewHtml, phoneSet, isMissingRpc, MISSING_MSG, createImportPanel } from '../admin/import-panel.js';
import { validateRows, parseCsv } from '../admin/import-leads.js';

test('preview escapes every cell value', () => {
  const rows = parseCsv('name,phone,source,note\n"<img src=x onerror=alert(1)>",9811100001,"<b>x</b>",\nBad<script>,12345,,');
  const html = previewHtml(rows, validateRows(rows, new Set()));
  assert.ok(!/<img|<script|<b>x/.test(html));
  assert.match(html, /&lt;img src=x/);
});

test('counts and phoneSet', () => {
  const rows = parseCsv('name,phone\nAsha,9811100001\nBala,+91 98111 00002\nCee,123');
  const res = validateRows(rows, phoneSet([{ phone: '9811100002' }], [{ phone: null }]));
  assert.deepEqual([res.valid.length, res.duplicates.length, res.invalid.length], [1, 1, 1]);
  assert.match(previewHtml(rows, res), /Import 1 lead</);
});

test('owner-only gating: non-owner mount renders nothing; admin.js renders the section for owners only', async () => {
  const root = { innerHTML: 'x', addEventListener() {}, querySelector() { return null; } };
  await createImportPanel({ rpc: async () => ({}), canImport: () => false, phones: () => new Set(), dialog() {}, toast() {} }).mount(root);
  assert.equal(root.innerHTML, '');
  const src = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
  assert.match(src, /isOwner\(\) \? '<details class="ip-det">/);
  assert.match(src, /canImport: \(\) => isOwner\(\)/);
});

test('missing RPC shows the clear message, other errors do not', async () => {
  assert.ok(isMissingRpc({ code: 'PGRST202', message: 'x' }));
  assert.ok(isMissingRpc({ message: 'Could not find the function public.crm_import_leads_csv' }));
  assert.ok(!isMissingRpc({ message: 'permission denied' }));
  assert.equal(MISSING_MSG, 'Import is not available yet. The database update has not been applied.');
  const handlers = {}; const ta = { value: 'name,phone\nAsha,9811100001' }; const out = { innerHTML: '' };
  const root = { innerHTML: '', addEventListener: (t, f) => { handlers[t] = f; }, querySelector: (s) => (s === '#ipOut' ? out : s === '#ipText' ? ta : null) };
  let said = ''; let dlg;
  const p = createImportPanel({ rpc: async () => { throw { code: 'PGRST202', message: 'nope' }; }, canImport: () => true, phones: () => new Set(), dialog: (o) => { dlg = o; }, toast() {} });
  await p.mount(root);
  handlers.click({ target: { closest: () => ({ dataset: { ip: 'preview' } }) } });
  handlers.click({ target: { closest: () => ({ dataset: { ip: 'go' } }) } });
  await dlg.onSubmit({}, { close() {}, say: (m) => { said = m; } });
  assert.equal(said, MISSING_MSG);
});
