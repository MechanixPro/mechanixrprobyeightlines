// J3 (2026-11-09): the garage confirms the customer's code and runs the job with one big button per step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { garageStepChips } from '../crm/garage-assign.js';
const require = createRequire(import.meta.url);
const G = require('../assets/js/garage.js');
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const EVENTS = ['received', 'work_started', 'ready'];

test('jobPage: offer, navigate, phone, code, inspect (or estimate), ready, done; Back views keep the choices', () => {
  const j = (o) => ({ status: 'received', code_needed: true, code: 'open', can_start: true, open: true, ...o });
  assert.equal(G.jobPage(j({ status: 'sent' }), {}), 'offer');
  assert.equal(G.jobPage(j(), {}), 'navigate');
  assert.equal(G.jobPage(j(), { arrived: true }), 'phone');
  assert.equal(G.jobPage(j(), { arrived: true, found: true }), 'code');
  assert.equal(G.jobPage(j(), { arrived: true, found: true, view: 'phone' }), 'phone');   // Back
  assert.equal(G.jobPage(j(), { view: 'done' }), 'navigate');                            // a view never skips ahead
  assert.equal(G.jobPage(j({ code: 'verified' }), {}), 'inspect');
  assert.equal(G.jobPage(j({ code: 'verified', can_start: false }), { view: 'estimate' }), 'estimate');
  assert.equal(G.jobPage(j({ code_needed: false }), {}), 'inspect');
  assert.equal(G.jobPage(j({ status: 'in_work' }), {}), 'ready');
  assert.equal(G.jobPage(j({ status: 'ready' }), {}), 'done');
});
test('every page event is one the database accepts; pages are in the owner order', () => {
  for (const e of Object.values(G.STEP_EVENT)) assert.ok(e === null || EVENTS.includes(e));
  assert.deepEqual(G.PAGES, ['offer', 'navigate', 'phone', 'code', 'inspect', 'ready', 'done']);
});
test('code boxes: digits only, four at most', () => {
  assert.equal(G.cleanCode('12a-345'), '1234'); assert.equal(G.cleanCode(null), '');
  assert.ok(G.isCode('0042')); assert.ok(!G.isCode('123')); assert.ok(!G.isCode('12345')); assert.ok(!G.isCode('12a4'));
});
test('garage.js: one primary step button, numeric keypad code boxes, Can’t take it goes to the team, no inline style', () => {
  const g = read('assets/js/garage.js');
  assert.match(g, /gStepAccept/); assert.match(g, /gStepCode/); assert.match(g, /gStepReady/); assert.match(g, /gCantTake/);
  assert.match(g, /inputmode: 'numeric'/); assert.match(g, /verify_code/); assert.match(g, /teamButtons\(\)/);
  assert.ok(!/setAttribute\('style'|\.style\./.test(g));
  const c = read('assets/css/garage.css');
  assert.match(c, /\.g-step-btn\{min-height:56px/); assert.match(g, /gStepArrived/); assert.match(g, /gStepFound/); assert.match(g, /g-dots/);
});
test('garage-app: verify_code uses the shared check (hash, counted try, lockout) and never returns the code', () => {
  const f = read('supabase/functions/garage-app/index.ts');
  assert.match(f, /ACTIONS = \[[^\]]*'verify_code'/);
  const v = f.slice(f.indexOf("action === 'verify_code'"), f.indexOf("action === 'progress'"));
  for (const k of ['handoverHash', 'sameHash', 'afterWrongTry', 'MAX_ATTEMPTS', "attempts: row.attempts + 1", 'locked_at', 'Customer code confirmed by garage', 'door_code_verified']) assert.ok(v.includes(k), k);
  assert.ok(!/code_hash\s*[,}]\s*\}\)/.test(v) && !/json\(req, \{[^}]*row\.code/.test(v));
});
test('migration: work_started is refused until the code is verified, signature unchanged', () => {
  const m = read('supabase/migrations/20270115000000_garage_code_gate.sql');
  assert.match(m, /create or replace function public\.garage_progress_set\(p_access uuid, p_assignment uuid, p_event text, p_photos text\[\] default '\{\}', p_note text default null\)/);
  assert.match(m, /p_event = 'work_started' and \(l\.confirm_fee is not null or exists/); assert.match(m, /h\.kind = 'start' and h\.verified_at is not null/);
  assert.match(m, /'blocked', 'code'/);
});
test('Dispatch: garage step chip, and the red chip only after 15 minutes unaccepted', () => {
  const now = new Date('2026-11-09T10:00:00Z');
  const r = (o) => ({ garage_id: 'g', garage_status: 'sent', garage_assigned_at: '2026-11-09T09:40:00Z', ...o });
  assert.equal(garageStepChips(r(), now).at(-1).tone, 'bad');
  assert.equal(garageStepChips(r({ garage_assigned_at: '2026-11-09T09:50:00Z' }), now).length, 1);
  assert.equal(garageStepChips(r({ garage_status: 'in_work' }), now)[0].text, 'Work started');
  assert.deepEqual(garageStepChips({}, now), []);
});
