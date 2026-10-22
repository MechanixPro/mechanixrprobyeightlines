import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, esc, rupee } from '../crm/ui.js';

test('csv parsing handles quotes, commas inside quotes, blank lines and a byte-order mark', () => {
  const rows = parseCsv('﻿Name,Owner name,Mobile\n"Ravi, Motors",Ravi,9876543210\n\n"Say ""hi""",Asha,9876543211\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'Ravi, Motors', owner_name: 'Ravi', mobile: '9876543210' });
  assert.equal(rows[1].name, 'Say "hi"');
});
test('csv with only a header gives no rows', () => { assert.deepEqual(parseCsv('name,mobile\n'), []); });
test('csv export quotes what needs quoting', () => {
  const out = toCsv([{ a: 'x,y', b: 'plain' }], [['a', 'A'], ['b', 'B']]);
  assert.equal(out, 'A,B\n"x,y",plain');
});
test('text is escaped before it reaches the page', () => { assert.equal(esc('<img src=x onerror=1>"\''), '&lt;img src=x onerror=1&gt;&quot;&#39;'); });
test('rupee amounts use Indian grouping', () => { assert.equal(rupee(125000), '₹1,25,000'); });
