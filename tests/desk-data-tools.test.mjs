import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { presetRange, presetOf, parseCsv, toImportRows, makeXlsx, crc32, reportHtml } from '../crm/data-tools.js';

const NOW = Date.parse('2026-10-29T10:00:00+05:30');
test('quick ranges follow India time', () => {
  assert.deepEqual(presetRange('today', NOW), { from: '2026-10-29', to: '2026-10-29' });
  assert.deepEqual(presetRange('month', NOW), { from: '2026-10-01', to: '2026-10-29' });
  assert.deepEqual(presetRange('last_month', NOW), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(presetRange('d30', NOW), { from: '2026-09-30', to: '2026-10-29' });
  assert.deepEqual(presetRange('m3', NOW), { from: '2026-08-01', to: '2026-10-29' });
  assert.equal(presetRange('custom', NOW), null);
  assert.deepEqual(presetRange('last_month', Date.parse('2027-01-05T10:00:00+05:30')), { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(presetRange('m3', Date.parse('2027-01-05T10:00:00+05:30')), { from: '2026-11-01', to: '2027-01-05' });
  assert.deepEqual(presetRange('today', Date.parse('2026-10-29T01:00:00+05:30')), { from: '2026-10-29', to: '2026-10-29' });
});
test('the picker recognises a quick range, and custom otherwise', () => {
  assert.equal(presetOf('2026-10-29', '2026-10-29', NOW), 'today'); assert.equal(presetOf('2026-09-01', '2026-09-30', NOW), 'last_month');
  assert.equal(presetOf('2026-10-03', '2026-10-09', NOW), 'custom'); assert.equal(presetOf('', '', NOW), 'month');
});
test('CSV parsing handles quotes, commas, line breaks and a BOM', () => {
  assert.deepEqual(parseCsv('﻿Name,Phone\r\n"Rao, Asha",98765 43210\n"He said ""hi""",9000000001\n\n'), [['Name', 'Phone'], ['Rao, Asha', '98765 43210'], ['He said "hi"', '9000000001']]);
});
test('import rows are found by header name, or by column order when there is no header', () => {
  assert.deepEqual(toImportRows(parseCsv('Customer Name,Mobile Number,Locality\nAsha,9876543210,Indiranagar')), [{ name: 'Asha', phone: '9876543210', area: 'Indiranagar' }]);
  assert.deepEqual(toImportRows(parseCsv('Phone,Name\n9876543210,Asha')), [{ name: 'Asha', phone: '9876543210', area: '' }]);
  assert.deepEqual(toImportRows(parseCsv('Asha,9876543210,HSR')), [{ name: 'Asha', phone: '9876543210', area: 'HSR' }]);
});
test('crc32 matches the standard check value', () => assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926));
test('the workbook is a valid zip that unzip can read, with the right cells', () => {
  const bytes = makeXlsx([{ n: 'Asha & Co', v: 12.5, p: '9876543210' }], [['n', 'Name'], ['v', 'Amount'], ['p', 'Phone']], 'Leads');
  const dir = mkdtempSync(join(tmpdir(), 'xl-')); const f = join(dir, 't.xlsx'); writeFileSync(f, bytes);
  const list = execFileSync('unzip', ['-l', f]).toString(); for (const n of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) assert.ok(list.includes(n), n);
  assert.equal(execFileSync('unzip', ['-t', f]).toString().includes('No errors detected'), true);
  const sheet = execFileSync('unzip', ['-p', f, 'xl/worksheets/sheet1.xml']).toString();
  assert.ok(sheet.includes('Asha &amp; Co')); assert.ok(sheet.includes('<v>12.5</v>')); assert.ok(sheet.includes('9876543210'));
});
test('the PDF summary page escapes text and counts rows', () => {
  const h = reportHtml({ title: 'Leads <x>', rows: [{ a: '<b>' }], columns: [['a', 'A']] });
  assert.ok(h.includes('Leads &lt;x&gt;')); assert.ok(h.includes('&lt;b&gt;')); assert.ok(h.includes('1 rows'));
});

import { readFileSync } from 'node:fs';
const rd = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('the desk screens use the quick ranges, export formats, follow-up numbers and import', () => {
  const l = rd('crm/pages/leads.js'), d = rd('crm/pages/dashboard.js');
  for (const k of ['presetRange', 'exportButtons', 'bindExports', 'crm_import_leads', 'importLeads']) assert.ok(l.includes(k), 'leads ' + k);
  for (const k of ['presetRange', 'crm_followup_capacity', 'Workload', 'Overdue', "exportButtons('team')"]) assert.ok(d.includes(k), 'dashboard ' + k);
  assert.match(rd('crm/exports.js'), /crm_log_export[\s\S]*downloadFile/);
});
test('the database functions are guarded and audited', () => {
  const m = rd('supabase/migrations/20261205000000_desk_dashboard_brd.sql');
  assert.match(m, /crm_require\('export'\)/); assert.match(m, /crm_require\('assign_leads'\)/); assert.match(m, /'crm_export'/); assert.match(m, /'crm_import'/);
  assert.match(m, /at most 500 rows/); assert.match(m, /interval '30 days'/);
});

test('garage operating state, mechanic performance and the roster are wired and guarded', () => {
  const m = rd('supabase/migrations/20261206000000_desk_ops_roster.sql');
  assert.match(m, /crm_require\('manage_garages'\)/); assert.match(m, /crm_require\('manage_users'\)/); assert.match(m, /say why in the note/); assert.match(m, /enable row level security/);
  const g = rd('crm/pages/garages.js'), mc = rd('crm/pages/mechanics.js'), t = rd('crm/pages/team.js'), d = rd('crm/pages/dashboard.js');
  assert.ok(g.includes('crm_garage_ops_set') && g.includes('crm_garage_load') && g.includes('Taking jobs'));
  assert.ok(mc.includes('crm_mechanic_performance') && mc.includes('Customer rating'));
  assert.ok(t.includes('crm_roster_set') && t.includes('Duty roster')); assert.ok(d.includes('crm_on_duty') && d.includes('On duty today'));
});

test('the desk and the admin load the minimal theme and the builds ship it', () => {
  assert.match(rd('crm/index.html'), /assets\/css\/minimal\.css/); assert.match(rd('admin/index.html'), /assets\/css\/minimal\.css/);
  assert.match(rd('scripts/build_crm.sh'), /minimal\.css/); assert.match(rd('scripts/build_admin.sh'), /minimal\.css/);
  assert.match(rd('assets/css/minimal.css'), /@media print/);
});
