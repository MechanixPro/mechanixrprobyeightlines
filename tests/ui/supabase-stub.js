// Stands in for @supabase/supabase-js in the screenshot harness. The harness page sets window.__UI = { scenario, fail: [names], hang: [names] } before the app loads.
// scenario: ok | empty | error (every read fails except the sign-in checks) | loading (reads never finish).
import { fixtures } from '/tests/ui/fixtures.js';

const ui = () => window.__UI || { scenario: 'ok' };
const never = () => new Promise(() => {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const calls = (window.__UI_CALLS = []);
const unknown = new Set();

function emptyCrew(name, a) {
  const list = ['crm_queue', 'crm_call_queue', 'crm_my_leads', 'crm_leads_list', 'crm_dispatch_list', 'crm_open_issues', 'crm_replies_waiting', 'crm_unstaffed_jobs', 'crm_conversion_rows'];
  if (list.includes(name)) return [];
  if (name === 'crm_leads_summary') return { all: 0, new: 0, followups: 0, converted: 0, won: 0, lost: 0, junk: 0, unassigned: 0, pct: null, by_vehicle: {} };
  if (name === 'crm_dashboard') return { range: { from: new Date().toISOString() }, leads: { total: 0, won: 0, won_pct: 0, lost: 0, lost_pct: 0 }, unassigned: 0, chats: { unreplied: 0, total: 0 }, targets: { team: { daily_done: 0, daily_target: 30, monthly_done: 0, monthly_target: 600 }, me: { daily_done: 0, daily_target: 8, monthly_done: 0, monthly_target: 160 } }, agents: [], attribution: [] };
  if (name === 'crm_tech_board') return { techs: [], unassigned: [] };
  return undefined;
}

async function rpcImpl(name, args) {
  const u = ui(); calls.push(name);
  const gate = !['crm_me'].includes(name);
  if (u.hang && u.hang.includes(name)) return never();
  if (gate && u.scenario === 'loading') return never();
  if ((u.fail && u.fail.includes(name)) || (gate && u.scenario === 'error')) return { data: null, error: { message: 'Could not reach the server. Check your connection and try again.' } };
  await wait(5);
  const h = fixtures.crewHandlers[name] || fixtures.adminRpc[name];
  if (!h) { if (!unknown.has(name)) { unknown.add(name); console.warn('[harness] no fixture for rpc ' + name); } return { data: null, error: null }; }
  if (u.scenario === 'empty') { const e = emptyCrew(name, args); if (e !== undefined) return { data: e, error: null }; }
  return { data: h(args || {}, u), error: null };
}

class Query {
  constructor(table) { this.t = table; this.op = 'select'; this.single = false; this.rows = null; }
  select() { return this; } insert() { this.op = 'write'; return this; } update() { this.op = 'write'; return this; } delete() { this.op = 'write'; return this; } upsert() { this.op = 'write'; return this; }
  eq() { return this; } is() { return this; } not() { return this; } in() { return this; } order() { return this; } limit() { return this; } match() { return this; } gte() { return this; } lte() { return this; } neq() { return this; } or() { return this; }
  maybeSingle() { this.single = true; return this; } single_() { return this; }
  then(res, rej) { return this.run().then(res, rej); }
  async run() {
    const u = ui(); calls.push('from:' + this.t);
    const gate = this.t !== 'admins';
    if (u.hang && u.hang.includes(this.t)) return never();
    if (gate && u.scenario === 'loading') return never();
    if ((u.fail && u.fail.includes(this.t)) || (gate && u.scenario === 'error')) return { data: null, error: { message: 'Could not load ' + this.t } };
    await wait(5);
    if (this.op === 'write') return { data: null, error: null };
    let rows = fixtures.adminTables[this.t];
    if (rows === undefined) { if (!unknown.has('t:' + this.t)) { unknown.add('t:' + this.t); console.warn('[harness] no fixture for table ' + this.t); } rows = []; }
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
    rpc: (name, args) => rpcImpl(name, args),
    from: (t) => new Query(t),
    functions: { invoke: async () => ({ data: { ok: false }, error: null }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'stub' } }), getPublicUrl: () => ({ data: { publicUrl: '' } }), upload: async () => ({ error: null }), remove: async () => ({}) }) },
    channel: () => chain,
  };
}
