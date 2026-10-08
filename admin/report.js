import { splitJob } from './split.js';
// admin/report.js — pure report calculations for the Reports tab (no DOM, no Supabase), so they can be tested in Node.
const WENT_AHEAD = ['paid', 'scheduled', 'completed'];
const IST = 5.5 * 3600e3;
const DAYS = { '7d': 7, '30d': 30, '90d': 90 };

export function rangeFor(key, now = new Date()) {
  if (key === 'all') return { key, from: null, to: now };
  if (key === 'month') {
    const ist = new Date(now.getTime() + IST);
    return { key, from: new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST), to: now };
  }
  const days = DAYS[key] || 30;
  return { key: DAYS[key] ? key : '30d', from: new Date(now.getTime() - days * 864e5), to: now };
}

const group = (leads, nameOf) => {
  const m = new Map();
  for (const l of leads) { const n = nameOf(l); const g = m.get(n) || { name: n, count: 0, collected: 0 }; g.count += 1; g.collected += l.paid_amount || 0; m.set(n, g); }
  return [...m.values()].sort((a, b) => b.collected - a.collected || b.count - a.count || a.name.localeCompare(b.name));
};

export function buildReport(allLeads, { services = [], mechanics = [] } = {}, range) {
  const leads = allLeads.filter((l) => { const t = new Date(l.created_at); return (!range.from || t >= range.from) && t <= range.to; });
  const svc = (id) => services.find((s) => s.id === id)?.name ?? id ?? '—';
  const mech = (id) => mechanics.find((m) => m.id === id)?.name ?? 'Unassigned';
  const ahead = leads.filter((l) => WENT_AHEAD.includes(l.status));
  const paid = leads.filter((l) => (l.paid_amount || 0) > 0);
  const collected = leads.reduce((s, l) => s + (l.paid_amount || 0), 0);
  return {
    range,
    totals: {
      bookings: leads.length, wentAhead: ahead.length, conversion: leads.length ? Math.round((ahead.length / leads.length) * 100) : 0,
      collected, discount: ahead.reduce((s, l) => s + (l.coupon_discount || 0), 0), avgOrder: paid.length ? Math.round(collected / paid.length) : 0,
    },
    byService: group(leads, (l) => svc(l.service_id)),
    byArea: group(leads, (l) => l.area || 'Not given'),
    byMechanic: group(leads, (l) => mech(l.mechanic_id)),
    bySource: group(leads, (l) => l.utm?.utm_source || 'direct'),
    leads,
  };
}

const cell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const istDay = (iso) => new Date(new Date(iso).getTime() + IST).toISOString().slice(0, 10);

export function reportCsv(leads, { services = [], mechanics = [] } = {}) {
  const head = ['Ref', 'Date', 'Service', 'Area', 'Mechanic', 'Status', 'Estimate', 'Paid', 'Discount', 'Coupon', 'Source', 'Campaign'];
  const rows = leads.map((l) => [l.ref, istDay(l.created_at), services.find((s) => s.id === l.service_id)?.name ?? l.service_id, l.area, mechanics.find((m) => m.id === l.mechanic_id)?.name ?? 'Unassigned', l.status, l.est_total, l.paid_amount ?? 0, l.coupon_discount || 0, l.coupon_code, l.utm?.utm_source || 'direct', l.campaign]);
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

// What each mechanic earned and what the company kept, from completed jobs that have a mechanic.
// Each mechanic's total is split once, so the rows agree with the Mechanics tab.
export function payoutReport(leads, mechanics, basis = 'collected') {
  const byId = new Map(mechanics.map((m) => [m.id, m]));
  const acc = new Map();
  for (const l of leads) {
    if (l.status !== 'completed' || !byId.has(l.mechanic_id)) continue;
    const m = byId.get(l.mechanic_id), one = splitJob(l.paid_amount || 0, m.payout_rate || 0, basis);
    const r = acc.get(m.id) || { m, jobs: 0, collected: 0, base: 0 };
    r.jobs++; r.collected += l.paid_amount || 0; r.base += one.base; acc.set(m.id, r);
  }
  const list = [...acc.values()].map(({ m, jobs, collected, base }) => {
    const sp = splitJob(base, m.payout_rate || 0, 'collected');
    return { id: m.id, name: m.name, rate: sp.mechanicRate, jobs, collected, gst: collected - base, mechanic: sp.mechanic, company: sp.company };
  }).sort((a, b) => b.collected - a.collected || a.name.localeCompare(b.name));
  const totals = list.reduce((t, r) => ({ jobs: t.jobs + r.jobs, collected: t.collected + r.collected, gst: t.gst + r.gst, mechanic: t.mechanic + r.mechanic, company: t.company + r.company }), { jobs: 0, collected: 0, gst: 0, mechanic: 0, company: 0 });
  return { rows: list, totals };
}
