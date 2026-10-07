// The edge function runs on Deno, so Node checks that it is wired to the validator and stores every field.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanLeadFields } from '../supabase/functions/_shared/lead-fields.ts';

const src = readFileSync(new URL('../supabase/functions/submit-lead/index.ts', import.meta.url), 'utf8');

test('submit-lead imports and calls cleanLeadFields', () => {
  assert.match(src, /import \{ cleanLeadFields \} from '\.\.\/_shared\/lead-fields\.ts'/);
  assert.match(src, /cleanLeadFields\(b\)/);
});
test('submit-lead stores every validated field on the lead row', () => {
  const insertBlock = src.slice(src.indexOf("from('leads').insert("));
  for (const key of Object.keys(cleanLeadFields({}))) assert.match(insertBlock, new RegExp('\\.\\.\\.extra|\\b' + key + '\\b'), 'not stored: ' + key);
});
