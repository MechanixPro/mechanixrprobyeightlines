// Stands in for @supabase/supabase-js in the screenshot harness. The harness page sets window.__UI = { scenario, fail: [names], hang: [names] } before the app loads.
// scenario: ok | empty | error (every read fails except the sign-in checks) | loading (reads never finish).
import { fixtures } from '/tests/ui/fixtures.js';
import { moneyTables } from '/tests/ui/money-fixtures.js';

const ui = () => window.__UI || { scenario: 'ok' };
const never = () => new Promise(() => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const calls = (window.__UI_CALLS = []);
// Click-through harness: every rpc, Edge Function and table call is also logged with its arguments (window.__UI_LOG).
export const log = (window.__UI_LOG = []);
const note = (k, n, a) => { try { log.push({ k, n, a: JSON.parse(JSON.stringify(a ?? null)) }); } catch (e) { log.push({ k, n, a: null }); } };
const unknown = new Set();
window.__UI_PENDING = 0;   // calls still in flight; the click-through harness waits for 0
const track = (p) => { window.__UI_PENDING++; return Promise.resolve(p).finally(() => { window.__UI_PENDING--; }); };

function emptyCrew(name, a) {
  const list = ['crm_queue', 'crm_call_queue', 'crm_my_leads', 'crm_leads_list', 'crm_dispatch_list', 'crm_open_issues', 'crm_replies_waiting', 'crm_unstaffed_jobs', 'crm_conversion_rows', 'crm_duplicate_customers'];
  if (list.includes(name)) return [];
  if (name === 'crm_leads_summary') return { all: 0, new: 0, followups: 0, converted: 0, won: 0, lost: 0, junk: 0, unassigned: 0, pct: null, by_vehicle: {} };
  if (name === 'crm_dashboard') return { range: { from: new Date().toISOString() }, leads: { total: 0, won: 0, won_pct: 0, lost: 0, lost_pct: 0 }, unassigned: 0, chats: { unreplied: 0, total: 0 }, targets: { team: { daily_done: 0, daily_target: 30, monthly_done: 0, monthly_target: 600 }, me: { daily_done: 0, daily_target: 8, monthly_done: 0, monthly_target: 160 } }, agents: [], attribution: [] };
  if (name === 'crm_tech_board') return { techs: [], unassigned: [] };
  if (name === 'crm_targets_progress') return { now_ist: '2027-01-12T15:00:00', can_see_all: true, people: [] };
  if (name === 'crm_funnel') return { stages: [], money: false };
  return undefined;
}

async function rpcImpl(name, args) {
  const u = ui(); calls.push(name); note('rpc', name, args);
  const gate = !['crm_me'].includes(name);
  if (u.hang && u.hang.includes(name)) return never();
  if (gate && u.scenario === 'loading') return never();
  if ((u.fail && u.fail.includes(name)) || (gate && u.scenario === 'error')) return { data: null, error: { message: 'Could not reach the server. Check your connection and try again.' } };
  await wait(5);
  const h = fixtures.crewHandlers[name] || fixtures.writeResults[name] || fixtures.adminRpc[name];
  if (name === 'crm_me' && u.persona && fixtures.personas[u.persona]) return { data: fixtures.personas[u.persona], error: null };
  if (u.denied && u.denied.includes(name)) return { data: null, error: { message: 'you do not have permission to do this', code: '42501' } };
  if (!h) { if (!unknown.has(name)) { unknown.add(name); console.warn('[harness] no fixture for rpc ' + name); } return { data: null, error: null }; }
  if (u.scenario === 'empty') { const e = emptyCrew(name, args); if (e !== undefined) return { data: e, error: null }; }
  return { data: h(args || {}, u), error: null };
}

class Query {
  constructor(table) { this.t = table; this.op = 'select'; this.single = false; this.rows = null; }
  select() { return this; } insert(p) { this.op = 'write'; this.verb = 'insert'; this.payload = p; return this; } update(p) { this.op = 'write'; this.verb = 'update'; this.payload = p; return this; } delete() { this.op = 'write'; this.verb = 'delete'; return this; } upsert(p) { this.op = 'write'; this.verb = 'upsert'; this.payload = p; return this; }
  eq() { return this; } is() { return this; } not() { return this; } in() { return this; } order() { return this; } limit() { return this; } match() { return this; } gte() { return this; } lte() { return this; } neq() { return this; } or() { return this; }
  maybeSingle() { this.single = true; return this; } single_() { return this; }
  then(res, rej) { return track(this.run()).then(res, rej); }
  async run() {
    const u = ui(); calls.push('from:' + this.t); if (this.op === 'write') note('table', this.t + '.' + this.verb, this.payload);
    const gate = this.t !== 'admins';
    if (u.hang && u.hang.includes(this.t)) return never();
    if (gate && u.scenario === 'loading') return never();
    if ((u.fail && u.fail.includes(this.t)) || (gate && u.scenario === 'error')) return { data: null, error: { message: 'Could not load ' + this.t } };
    await wait(5);
    if (this.op === 'write') return { data: null, error: null };
    let rows = u.money && moneyTables[this.t] ? moneyTables[this.t] : fixtures.adminTables[this.t];
    if (this.t === 'admins' && u.persona === 'staff') rows = [{ user_id: 'me-1', name: '[Staff Admin]', role: 'staff' }];
    if (rows === undefined) { if (!unknown.has('t:' + this.t)) { unknown.add('t:' + this.t); console.warn('[harness] no fixture for table ' + this.t); } rows = []; }
    if (u.scenario === 'dense' && fixtures.adminTables.dense[this.t]) rows = fixtures.adminTables.dense[this.t];   // 60+ bookings and 80+ customers, for density shots
    if (u.scenario === 'empty' && this.t !== 'admins') rows = [];
    return { data: this.single ? (rows[0] || null) : rows, error: null };
  }
}
const chain = { on() { return chain; }, subscribe() { return chain; }, unsubscribe() {} };

export function createClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'me-1' } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: 'me-1' } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }), signInWithPassword: async () => ({ error: null }), signInWithOtp: async () => ({ error: null }), verifyOtp: async () => ({ error: null }),
      resetPasswordForEmail: async () => ({ error: null }), updateUser: async () => ({ error: null }),
    },
    rpc: (name, args) => track(rpcImpl(name, args)),
    from: (t) => new Query(t),
    functions: { invoke: (fn, o) => track((async () => { note('fn', fn, o && o.body); const u = ui(); if (u.fnFail && u.fnFail.includes(fn)) return { data: null, error: { message: 'Edge Function returned a non-2xx status code' } }; return { data: (fixtures.functionReply || (() => ({ ok: false })))(fn, o && o.body), error: null }; })()) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'stub' } }), getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: async () => ({ error: null }), remove: async () => ({}) }) },
    channel: () => chain,
  };
}
