// admin/issue-view.js — pure helpers for the Issues tab (no DOM, no Supabase), so they can be tested in Node.
export const KIND_LABEL = { complaint: 'Complaint', refund: 'Refund', warranty: 'Warranty redo' };
export const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' };

export function issueRows(issues, leads, filter = 'all') {
  const byId = new Map(leads.map((l) => [l.id, l]));
  return issues
    .filter((i) => filter === 'all' || (filter === 'open' ? i.status !== 'resolved' : i.status === filter))
    .map((i) => { const l = byId.get(i.lead_id); return { ...i, ref: l ? l.ref : '—', customer: l ? l.name : '—', phone: l ? l.phone : '' }; })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}
export const openIssueCount = (issues) => issues.filter((i) => i.status !== 'resolved').length;

// Warranty starts on the service day and lasts `days` days. Only finished jobs are covered.
export function warrantyInfo(lead, days = 30, now = new Date()) {
  if (!lead || lead.status !== 'completed' || !lead.preferred_date) return { active: false, endsOn: null, daysLeft: 0 };
  const end = new Date(lead.preferred_date + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + days);
  const left = Math.ceil((end - now) / 864e5);
  return { active: left > 0, endsOn: end.toISOString().slice(0, 10), daysLeft: Math.max(0, left) };
}
