// A tiny in-memory stand-in for the Supabase client: just the query calls the Edge Functions use. Tables are arrays of plain rows; rpc routes to functions you pass in.
const get = (row, col) => { if (col.includes('->>')) { const [a, k] = col.split('->>'); return row[a] == null ? undefined : String(row[a][k]); } return row[col]; };
class Q {
  constructor(db, table) { this.db = db; this.table = table; this.f = []; this.cols = '*'; this.opts = {}; this.ord = null; this.lim = null; this.op = 'select'; this.payload = null; this.single = false; }
  select(cols = '*', opts = {}) { this.cols = cols; this.opts = opts; return this; }
  insert(p) { this.op = 'insert'; this.payload = p; return this; }
  update(p) { this.op = 'update'; this.payload = p; return this; }
  eq(c, v) { this.f.push((r) => get(r, c) === v); return this; }
  neq(c, v) { this.f.push((r) => get(r, c) !== v); return this; }
  in(c, a) { this.f.push((r) => a.includes(get(r, c))); return this; }
  is(c, v) { this.f.push((r) => (v === null ? get(r, c) == null : get(r, c) === v)); return this; }
  not(c, op, v) { if (op === 'is') this.f.push((r) => !(v === null ? get(r, c) == null : get(r, c) === v)); else if (op === 'in') { const set = String(v).replace(/[()]/g, '').split(','); this.f.push((r) => !set.includes(String(get(r, c)))); } return this; }
  gte(c, v) { this.f.push((r) => get(r, c) != null && String(get(r, c)) >= String(v)); return this; }
  lte(c, v) { this.f.push((r) => get(r, c) != null && String(get(r, c)) <= String(v)); return this; }
  lt(c, v) { this.f.push((r) => get(r, c) != null && String(get(r, c)) < String(v)); return this; }
  order(c, o = {}) { this.ord = [c, o.ascending === false ? -1 : 1]; return this; }
  limit(n) { this.lim = n; return this; }
  maybeSingle() { this.single = true; return this; }
  then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
  run() {
    const t = (this.db.tables[this.table] ??= []);
    this.db.log.push({ table: this.table, op: this.op, cols: this.cols });
    if (this.op === 'insert') { const rows = [].concat(this.payload).map((r) => ({ id: 'row' + (t.length + 1), created_at: new Date(this.db.now()).toISOString(), ...r })); t.push(...rows); return { data: null, error: null }; }
    let rows = t.filter((r) => this.f.every((fn) => fn(r)));
    if (this.op === 'update') { rows.forEach((r) => Object.assign(r, this.payload)); return { data: null, error: null }; }
    if (this.ord) rows = [...rows].sort((a, b) => (a[this.ord[0]] > b[this.ord[0]] ? 1 : a[this.ord[0]] < b[this.ord[0]] ? -1 : 0) * this.ord[1]);
    if (this.lim != null) rows = rows.slice(0, this.lim);
    const count = this.opts.count ? rows.length : null;
    if (this.opts.head) return { data: null, error: null, count };
    // Only the asked columns come back, like PostgREST (a '*' select returns whole rows).
    const pick = (r) => (this.cols === '*' ? { ...r } : Object.fromEntries(this.cols.split(',').map((c) => c.trim()).filter((c) => c in r).map((c) => [c, r[c]])));
    return this.single ? { data: rows[0] ? pick(rows[0]) : null, error: null } : { data: rows.map(pick), error: null, count };
  }
}
export function fakeDb(tables = {}, rpcs = {}, now = () => Date.now()) {
  const db = { tables, log: [], now, rpcs, from: (t) => new Q(db, t), rpc: async (fn, args) => { db.log.push({ rpc: fn, args }); if (!rpcs[fn]) return { data: null, error: { code: 'NOFN' } }; const data = await rpcs[fn](args, db); return { data, error: null }; } };
  return db;
}
