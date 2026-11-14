// What a garage sees of one job's money: the commission snapshot Admin kept (job_commission), plus who collected the customer's money, from the ledger.
// The commission itself is never worked out here: admin/commission.js does that once and the snapshot is read. The collection split below mirrors admin/ledger.js jobAccount (a test checks they agree).
export const r2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;
const CH = ['company_manual', 'company_portal', 'mechanic'];
export function activeLedger(entries: any[]): any[] {
  const reversed = new Set(entries.filter((e) => e.entry_type === 'reversal' && e.reverses_id).map((e) => e.reverses_id));
  return entries.filter((e) => e.entry_type !== 'reversal' && !reversed.has(e.id));
}
/** snapshot: a job_commission row. entries: that job's ledger rows. settlement: the garage_settlements row, if any. */
export function garageBreakdown(snap: any, entries: any[], settlement: any | null) {
  const act = activeLedger(entries), by: Record<string, number> = { company_manual: 0, company_portal: 0, mechanic: 0 };
  let remitted = 0, paidOut = 0;
  for (const e of act) {
    const ch = CH.includes(e.collected_by) ? e.collected_by : 'company_manual', amt = Number(e.amount) || 0;
    if (e.entry_type === 'customer_payment') by[ch] += amt; else if (e.entry_type === 'refund') by[ch] -= amt;
    else if (e.entry_type === 'remittance') remitted += amt; else if (e.entry_type === 'payout') paidOut += amt;
  }
  for (const k of CH) by[k] = r2(Math.max(0, by[k]));
  const collected = r2(by.company_manual + by.company_portal + by.mechanic), total = r2(snap.total), earnings = r2(snap.earnings);
  const denom = Math.max(total, collected), fc = denom > 0 ? (by.company_manual + by.company_portal) / denom : 0, fm = denom > 0 ? by.mechanic / denom : 0;
  const payoutOb = r2(earnings * fc), inHand = r2(earnings * fm), remitOb = r2(Math.max(0, by.mechanic - inHand));
  const payToMx = r2(Math.max(0, remitOb - remitted)), mxPays = r2(Math.max(0, payoutOb - paidOut));
  const settled = collected > 0 && payToMx <= 0.005 && mxPays <= 0.005;
  return {
    invoice_total: total, service_amount: r2(snap.service_base), gst: r2(snap.gst), pct: Number(snap.pct) || 0, rate_source: snap.rate_source ?? null, adjust: r2(snap.adjust), adjust_note: snap.adjust_note ?? null,
    commission: r2(snap.company), garage_earnings: earnings,
    collected_from_customer: collected, collected_by_company: r2(by.company_manual + by.company_portal), received_by_garage: by.mechanic,
    payable_to_mx: payToMx, payable_to_garage: mxPays,
    status: collected <= 0.005 ? 'awaiting_payment' : settled ? 'settled' : 'pending',
    payout_entered: settlement ? Number(settlement.amount) : null, payout_settled: settlement ? !!settlement.settled : false,
  };
}
