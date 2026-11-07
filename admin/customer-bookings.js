// admin/customer-bookings.js — everything one customer has booked, with what was billed, paid and is due (no DOM, no Supabase).
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const time = (l) => new Date(l.created_at).getTime() || 0;

// Phone numbers are compared by their last 10 digits, so "+91 98765 43210", "09876543210" and "9876543210" are the same number.
export const normPhone = (p) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const live = (l) => l && !l.deleted_at && l.status !== 'junk';

// ONE rule for "this customer's bookings": not deleted or junk, linked by customer_id OR by the same normalised phone. The list and the detail both call this.
export function customerLeads(customer, leads) {
  const ph = normPhone(customer.phone);
  return leads.filter((l) => live(l) && (l.customer_id === customer.id || (ph && normPhone(l.phone) === ph))).sort((a, b) => time(b) - time(a));
}

export function bookingRows({ customer, leads, accounts = [], svcName = (x) => x }) {
  const byLead = new Map(accounts.map((a) => [a.lead_id, a]));
  return customerLeads(customer, leads).map((l) => {
    const a = byLead.get(l.id);
    return a
      ? { id: l.id, ref: l.booking_id || 'Lead', createdAt: l.created_at, when: l.preferred_date || '', service: svcName(l.service_id), status: l.status, kind: 'invoice', total: r2(a.total), paid: r2(a.collected), balance: r2(a.outstanding) }
      : { id: l.id, ref: l.booking_id || 'Lead', createdAt: l.created_at, when: l.preferred_date || '', service: svcName(l.service_id), status: l.status, kind: 'estimate', total: r2(l.est_total), paid: r2(l.paid_amount), balance: 0 };
  });
}

export function summarize(rows) {
  return { bookings: rows.length, billed: r2(rows.filter((r) => r.kind === 'invoice').reduce((t, r) => t + r.total, 0)), paid: r2(rows.reduce((t, r) => t + r.paid, 0)), due: r2(rows.reduce((t, r) => t + r.balance, 0)) };
}

// ONE source of truth for the Customers screen. Bookings, paid total and last booking date come from the same customerLeads() the detail uses.
export function customerSummaries({ customers, leads, bikes = [], q = '', filter = '' }) {
  const needle = String(q || '').trim().toLowerCase(), nd = needle.replace(/\D/g, '');   // digits typed in any format (+91, spaces) still find the number
  const byPhone = new Map();
  for (const c of customers) { const p = normPhone(c.phone); if (p) byPhone.set(p, (byPhone.get(p) || 0) + 1); }
  const OPEN = ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled'];
  const rows = customers.map((c) => {
    const ls = customerLeads(c, leads), p = normPhone(c.phone);
    const bk = bikes.filter((b) => b.customer_id === c.id).map((b) => [b.brand && b.brand !== 'Other' ? b.brand : '', b.model].filter(Boolean).join(' ')).filter(Boolean);
    return { id: c.id, name: String(c.name || '').trim(), phone: c.phone, phone10: p, email: c.email || '', bikes: bk, bookings: ls.length, open: ls.filter((l) => OPEN.includes(l.status)).length,
      lastAt: ls[0] ? time(ls[0]) : 0, paid: r2(ls.reduce((t, l) => t + (Number(l.paid_amount) || 0), 0)), duplicate: !!p && byPhone.get(p) > 1, blocked: !!c.blocked };
  });
  return rows
    .filter((r) => !needle || [r.name, r.phone, r.phone10, r.email, ...r.bikes].some((v) => String(v || '').toLowerCase().includes(needle)) || (nd.length >= 3 && r.phone10.includes(nd.slice(-10))))
    .filter((r) => !filter || (filter === 'open' ? r.open > 0 : filter === 'paid' ? r.paid > 0 : filter === 'noname' ? !r.name : filter === 'dup' ? r.duplicate : true))
    .sort((a, b) => b.lastAt - a.lastAt || Number(!a.name) - Number(!b.name) || String(a.name).localeCompare(String(b.name)));   // newest first; blank names after named ones on a tie
}
export const customerList = customerSummaries;
