// Pro Check 20 server actions (tech-job and garage-app): source-pattern checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('tech-job: check actions are registered, run behind the job link check, bikes only, mechanic kind', () => {
  const s = read('supabase/functions/tech-job/index.ts');
  assert.match(s, /const CHECK_ACTIONS = \['check_get', 'check_save'\]/);
  assert.match(s, /CHECK_ACTIONS\.includes\(action\)\) return await proCheck\(/);
  assert.match(s, /p_kind: 'mechanic', p_by: link\.mechanic_id/);
  assert.match(s, /Pro Check 20 is for bikes/);
  assert.match(s, /cleanResults\(body\?\.results\)/);
});
test('garage-app: check actions only for a job assigned to this garage, garage kind', () => {
  const s = read('supabase/functions/garage-app/index.ts');
  assert.match(s, /'check_get', 'check_save'(, 'leads', 'claim')?\]/);
  const i = s.indexOf("action === 'check_get' || action === 'check_save'"); assert.ok(i > 0);
  const block = s.slice(i, i + 1500);
  assert.match(block, /mine\(jobId\)/); assert.match(block, /p_kind: 'garage', p_by: garageId/); assert.match(block, /Accept the job first/);
});
test('results are never logged', () => {
  for (const f of ['tech-job', 'garage-app']) assert.doesNotMatch(read(`supabase/functions/${f}/index.ts`), /console\.(log|error)\([^)]*results/);
});
test('track-booking returns pro_check only for a finished check on a bike, via customerView (no job details)', () => {
  const s = read('supabase/functions/track-booking/index.ts');
  assert.match(s, /lead\.vehicle === 'car' \? null : await rpc\('job_check_get'/);
  assert.match(s, /isComplete\(chk\.results\)\) pro_check = customerView\(chk\.results\)/);
  assert.match(s, /token_mode: true, journey, pro_check/);
  const t = read('assets/js/track.js');
  assert.match(t, /put\('trCheck', proCheckCard\(v\.pro_check\)/); assert.match(t, /Pro Check 20/);
});

test('the tracking page has a placeholder for every section it fills (a missing one would overwrite the whole page)', () => {
  const t = readFileSync(new URL('../assets/js/track.js', import.meta.url), 'utf8');
  const list = t.match(/var SECTIONS = \[([^\]]*)\]/)[1];
  for (const m of t.matchAll(/put\('(tr[A-Za-z]+)'/g)) assert.ok(list.includes("'" + m[1] + "'"), m[1] + ' must be in SECTIONS');
});
