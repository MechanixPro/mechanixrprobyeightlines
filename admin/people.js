import { splitJob } from './split.js';
// admin/people.js — pure helpers for the Customers and Mechanics tabs (no DOM, no Supabase), so they can be tested in Node.
const bikeLabel = (b) => [b.brand && b.brand !== 'Other' ? b.brand : '', b.model].filter(Boolean).join(' ') + (b.nickname ? ` "${b.nickname}"` : '') + (b.reg_no ? ` · ${String(b.reg_no).toUpperCase()}` : '');

export function customerRows(customers, bikes, leads) {
  const rows = customers.map((c) => {
    const mine = leads.filter((l) => l.customer_id === c.id);
    const last = mine.reduce((a, l) => (!a || l.created_at > a.created_at ? l : a), null);
    return {
      id: c.id, name: c.name, phone: c.phone, blocked: !!c.blocked, blockedReason: c.blocked_reason ?? null, notes: c.notes ?? null,
      email: c.email ?? null, address: c.address ?? null, area: c.area ?? null, company: c.company_name ?? null, gstin: c.gstin ?? null,
      bikes: bikes.filter((b) => b.customer_id === c.id).map(bikeLabel),
      bookings: mine.length, paidTotal: mine.reduce((s, l) => s + (l.paid_amount || 0), 0),
      lastAt: last ? last.created_at : null, lastRef: last ? last.ref : null,
    };
  });
  return rows.sort((a, b) => (b.lastAt || '').localeCompare(a.lastAt || '') || String(a.name).localeCompare(String(b.name)));
}

export function searchCustomers(rows, q) {
  const n = String(q || '').trim().toLowerCase();
  if (!n) return rows;
  return rows.filter((r) => [r.name, r.phone, ...r.bikes].some((v) => String(v ?? '').toLowerCase().includes(n)));
}

export function mechanicStats(mechanics, leads, { basis = 'collected' } = {}) {
  const rows = mechanics.map((m) => {
    const jobs = leads.filter((l) => l.mechanic_id === m.id && l.status !== 'lost');
    const done = jobs.filter((l) => l.status === 'completed');
    const rate = m.payout_rate || 0;
    const revenue = done.reduce((t, l) => t + (l.paid_amount || 0), 0);
    const base = done.reduce((t, l) => t + splitJob(l.paid_amount || 0, rate, basis).base, 0);
    const sp = splitJob(base, rate, 'collected'); // one rounding for the whole total, so rows and totals agree
    return {
      id: m.id, name: m.name, active: m.active !== false, rate, companyRate: 100 - Math.min(100, Math.max(0, rate)),
      city: m.city || 'Bengaluru', specialties: m.specialties || '', years: m.experience_years || 0, certified: m.certified !== false,
      completed: done.length, open: jobs.length - done.length, revenue, payout: sp.mechanic, companyShare: sp.company, gst: revenue - base,
    };
  });
  return rows.sort((a, b) => Number(b.active) - Number(a.active) || b.completed - a.completed || a.name.localeCompare(b.name));
}

// What the admin types when editing a customer. Returns { ok, value } with tidy values, or { ok:false, error }.
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const tidy = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
export function cleanCustomerEdit(f) {
  const name = tidy(f.name, 80); if (name.length < 2) return { ok: false, error: 'Enter the customer name' };
  const phone = String(f.phone ?? '').replace(/\D/g, '').slice(-10); if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: 'Enter a valid 10-digit mobile number' };
  const email = tidy(f.email, 254).toLowerCase(); if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'That email address does not look right' };
  const gstin = tidy(f.gstin, 15).toUpperCase().replace(/\s/g, ''); if (gstin && !GSTIN.test(gstin)) return { ok: false, error: 'GSTIN must be 15 characters, like 29ABCDE1234F1Z5' };
  return { ok: true, value: { name, phone, email: email || null, address: tidy(f.address, 160) || null, area: tidy(f.area, 60) || null, company_name: tidy(f.company_name, 80) || null, gstin: gstin || null } };
}
export function cleanBikeEdit(f) {
  const brand = tidy(f.brand, 30), model = tidy(f.model, 40); if (!brand && !model) return { ok: false, error: 'Enter the bike brand or model' };
  const reg = tidy(f.reg_no, 14).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return { ok: true, value: { brand, model, reg_no: reg || null } };
}
