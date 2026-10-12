// admin/board.js — which bookings belong on the Today board, and what the next honest step is (no DOM, no Supabase), so it can be tested in Node.
const SLOT_ORDER = { asap: 0, morning: 1, afternoon: 2, evening: 3 };
const istDay = (v) => new Date(new Date(v).getTime() + 330 * 60000).toISOString().slice(0, 10);

export function boardGroups(leads, { now = Date.now() } = {}) {
  const today = istDay(now), late = now - 30 * 60000, week = now - 7 * 864e5;
  const g = { needsReply: [], quotePay: [], visits: [], done: [] };
  for (const l of leads) {
    if (l.status === 'new' && new Date(l.created_at).getTime() < late && new Date(l.created_at).getTime() > week) g.needsReply.push(l);
    else if (['contacted', 'quoted', 'payment_sent'].includes(l.status)) g.quotePay.push(l);
    else if (['scheduled', 'paid'].includes(l.status) && l.preferred_date === today) g.visits.push(l);
    else if (l.status === 'completed' && l.completed_at && istDay(l.completed_at) === today) g.done.push(l);
  }
  const bySlot = (a, b) => (SLOT_ORDER[a.preferred_slot] ?? 9) - (SLOT_ORDER[b.preferred_slot] ?? 9) || String(a.preferred_time || '').localeCompare(String(b.preferred_time || ''));
  g.visits.sort(bySlot);
  g.needsReply.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  g.quotePay.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  return g;
}

// One tap moves a booking a single step. Steps that need a decision (confirming a quote, taking payment) open the full booking instead.
const NEXT = { new: ['Mark contacted', 'contacted'], contacted: ['Mark quoted', 'quoted'], paid: ['Confirm visit', 'scheduled'], scheduled: ['Mark done', 'completed'] };
export function nextStep(status) { const n = NEXT[status]; return n ? { label: n[0], to: n[1] } : null; }
