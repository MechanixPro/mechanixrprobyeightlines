// admin/ledger-forms.js — turns a form into one ledger row, or says why it cannot (no DOM, no Supabase).
const CHANNELS = ['company_manual', 'company_portal', 'mechanic'];
const r2 = (n) => Math.round(n * 100) / 100;
const fail = (error) => ({ ok: false, error });
const clean = (s, n) => String(s ?? '').trim().slice(0, n);

export function buildEntry(kind, f, ctx = {}) {
  const { today, lead, target } = ctx;
  const on = clean(f.on, 10) || today;
  if (today && on > today) return fail('The date cannot be in the future.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on || '')) return fail('Choose a date.');
  const common = { occurred_on: on, method: clean(f.method, 40) || null, reference: clean(f.reference, 80) || null, note: clean(f.note, 300) || null, source: 'admin' };
  if (kind === 'reversal') {
    if (!target) return fail('Choose the entry to cancel.');
    if (target.entry_type === 'reversal') return fail('A cancellation cannot be cancelled. Enter the payment again instead.');
    const reason = clean(f.reason, 200); if (!reason) return fail('Say why this entry is being cancelled.');
    return { ok: true, entry: { ...common, entry_type: 'reversal', reverses_id: target.id, lead_id: target.lead_id ?? null, mechanic_id: target.mechanic_id ?? null, amount: target.amount, reason } };
  }
  const amount = r2(Number(f.amount));
  if (!(amount > 0) || !Number.isFinite(amount)) return fail('Enter an amount above zero.');
  if (amount > 10000000) return fail('That amount looks too large.');
  if (kind === 'payment' || kind === 'refund') {
    const by = f.by;
    if (!CHANNELS.includes(by)) return fail('Choose who received the money.');
    if (by === 'mechanic' && !lead?.mechanic_id) return fail('This job has no mechanic. Assign one first.');
    const base = { ...common, lead_id: lead.id, mechanic_id: lead.mechanic_id ?? null, collected_by: by, amount };
    if (kind === 'payment') return { ok: true, entry: { ...base, entry_type: 'customer_payment' } };
    const reason = clean(f.reason, 200); if (!reason) return fail('Say why the money is being refunded.');
    if (amount > (ctx.collectedBy?.[by] ?? 0) + 0.005) return fail('That is more than was collected this way.');
    return { ok: true, entry: { ...base, entry_type: 'refund', reason } };
  }
  if (kind === 'write_off') {
    const reason = clean(f.reason, 200); if (!reason) return fail('Say why the balance is being written off.');
    if (amount > (ctx.outstanding ?? 0) + 0.005) return fail('That is more than the customer owes.');
    return { ok: true, entry: { ...common, entry_type: 'write_off', lead_id: lead.id, mechanic_id: lead.mechanic_id ?? null, amount, reason } };
  }
  if (kind === 'remittance' || kind === 'payout') {
    if (!f.mechanic) return fail('Choose the mechanic.');
    return { ok: true, entry: { ...common, entry_type: kind, mechanic_id: f.mechanic, lead_id: lead?.id ?? null, amount } };
  }
  return fail('Unknown entry.');
}
