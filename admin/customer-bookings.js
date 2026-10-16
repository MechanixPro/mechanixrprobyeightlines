// admin/customer-bookings.js — everything one customer has booked, with what was billed, paid and is due (no DOM, no Supabase).
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const time = (l) => new Date(l.created_at).getTime() || 0;

export function customerLeads(customer, leads) {
  return leads.filter((l) => l.customer_id === customer.id || (!l.customer_id && l.phone && l.phone === customer.phone)).sort((a, b) => time(b) - time(a));
}

export function bookingRows({ customer, leads, accounts = [], svcName = (x) => x }) {
  const byLead = new Map(accounts.map((a) => [a.lead_id, a]));
  return customerLeads(customer, leads).map((l) => {
    const a = byLead.get(l.id);
    return a
      ? { id: l.id, ref: l.ref, createdAt: l.created_at, when: l.preferred_date || '', service: svcName(l.service_id), status: l.status, kind: 'invoice', total: r2(a.total), paid: r2(a.collected), balance: r2(a.outstanding) }
      : { id: l.id, ref: l.ref, createdAt: l.created_at, when: l.preferred_date || '', service: svcName(l.service_id), status: l.status, kind: 'estimate', total: r2(l.est_total), paid: r2(l.paid_amount), balance: 0 };
  });
}

export function summarize(rows) {
  return { bookings: rows.length, billed: r2(rows.filter((r) => r.kind === 'invoice').reduce((t, r) => t + r.total, 0)), paid: r2(rows.reduce((t, r) => t + r.paid, 0)), due: r2(rows.reduce((t, r) => t + r.balance, 0)) };
}

export function customerList({ customers, leads, q = '' }) {
  const needle = String(q || '').trim().toLowerCase();
  return customers
    .filter((c) => !needle || [c.name, c.phone, c.email].some((v) => String(v || '').toLowerCase().includes(needle)))
    .map((c) => { const ls = customerLeads(c, leads); return { id: c.id, name: c.name, phone: c.phone, bookings: ls.length, lastAt: ls[0] ? time(ls[0]) : 0, paid: r2(ls.reduce((t, l) => t + (Number(l.paid_amount) || 0), 0)) }; })
    .sort((a, b) => b.lastAt - a.lastAt || String(a.name).localeCompare(String(b.name)));
}
