// admin/people.js — pure helpers for the Customers and Mechanics tabs (no DOM, no Supabase), so they can be tested in Node.
const bikeLabel = (b) => [b.brand && b.brand !== 'Other' ? b.brand : '', b.model].filter(Boolean).join(' ') + (b.nickname ? ` "${b.nickname}"` : '');

export function customerRows(customers, bikes, leads) {
  const rows = customers.map((c) => {
    const mine = leads.filter((l) => l.customer_id === c.id);
    const last = mine.reduce((a, l) => (!a || l.created_at > a.created_at ? l : a), null);
    return {
      id: c.id, name: c.name, phone: c.phone, blocked: !!c.blocked, blockedReason: c.blocked_reason ?? null, notes: c.notes ?? null,
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

export function mechanicStats(mechanics, leads) {
  const rows = mechanics.map((m) => {
    const jobs = leads.filter((l) => l.mechanic_id === m.id && l.status !== 'lost');
    const done = jobs.filter((l) => l.status === 'completed');
    const revenue = done.reduce((s, l) => s + (l.paid_amount || 0), 0);
    return { id: m.id, name: m.name, active: m.active !== false, rate: m.payout_rate || 0, city: m.city || 'Bengaluru', specialties: m.specialties || '', years: m.experience_years || 0, certified: m.certified !== false, completed: done.length, open: jobs.length - done.length, revenue, payout: Math.round((revenue * (m.payout_rate || 0)) / 100) };
  });
  return rows.sort((a, b) => Number(b.active) - Number(a.active) || b.completed - a.completed || a.name.localeCompare(b.name));
}
