// Bulk selection and validation rules (pure, no DOM).
export const MAX = 100;
export const emptySel = () => ({ ids: [] });
export const toggle = (sel, id) => {
  const ids = (sel && sel.ids) || [];
  if (ids.includes(id)) return { ids: ids.filter((x) => x !== id) };
  if (ids.length >= MAX) return { ids: ids.slice() };
  return { ids: [...ids, id] };
};
export const selectAll = (sel, visibleIds) => {
  const ids = ((sel && sel.ids) || []).slice();
  for (const id of visibleIds || []) { if (ids.length >= MAX) break; if (!ids.includes(id)) ids.push(id); }
  return { ids };
};
export const clear = () => emptySel();
export function validateAction(a, count) {
  const bad = (error) => ({ ok: false, error });
  if (!a || typeof a !== 'object') return bad('No action chosen.');
  if (!Number.isInteger(count) || count < 1) return bad('Select at least 1 lead.');
  if (count > MAX) return bad(`Select at most ${MAX} leads.`);
  if (a.kind === 'assign') return a.to ? { ok: true } : bad('Choose who to assign to.');
  if (a.kind === 'status') {
    if (!a.status) return bad('Choose a status.');
    if (a.status === 'lost' && !String(a.reason || '').trim()) return bad('A reason is required for Lost.');
    return { ok: true };
  }
  if (a.kind === 'snooze') {
    const d = Number(a.days);
    return Number.isInteger(d) && d >= 1 && d <= 3 ? { ok: true } : bad('Snooze must be 1 to 3 days.');
  }
  return bad('Unknown action.');
}
export function summaryText(kind, count, detail, isAdmin) {
  const n = `${count} lead${count === 1 ? '' : 's'}`;
  let t;
  if (kind === 'assign') t = `Assign ${n} to ${detail || 'the chosen owner'}`;
  else if (kind === 'status') t = `Mark ${n} as ${detail || 'the chosen status'}`;
  else if (kind === 'snooze') t = `Snooze ${n} for ${detail} day${Number(detail) === 1 ? '' : 's'}`;
  else t = `Update ${n}`;
  return `${t}.${isAdmin ? '' : ' Leads you do not own may be skipped.'}`;
}
