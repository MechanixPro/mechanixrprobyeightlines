// What a mechanic owes Mechanix Pro, job by job: a line-for-line port of admin/ledger.js (jobAccount, allocate, settle, mechanicAccount) so the mechanic app shows exactly the figures
// the Admin "Mechanic ledgers" page shows. No Deno APIs, so node --test can run it; tests/mechanic-dues.test.mjs runs both on the same rows and requires identical results.
// If admin/ledger.js changes, change this file the same way (the parity test fails until you do).
const r2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;
const CHANNELS = ['company_manual', 'company_portal', 'mechanic'];
const EPS = 0.005;

export function activeEntries(entries: any[]): any[] {
  const reversed = new Set(entries.filter((e) => e.entry_type === 'reversal' && e.reverses_id).map((e) => e.reverses_id));
  return entries.filter((e) => e.entry_type !== 'reversal' && !reversed.has(e.id));
}

export function jobAccount({ invoice, entries = [], mechanic = null, allocated = {} }: { invoice: any; entries?: any[]; mechanic?: any; allocated?: { remit?: number; payout?: number } }) {
  const act = activeEntries(entries);
  const byChannel: Record<string, number> = { company_manual: 0, company_portal: 0, mechanic: 0 };
  let writtenOff = 0;
  for (const e of act) {
    const ch = CHANNELS.includes(e.collected_by) ? e.collected_by : 'company_manual', amt = Number(e.amount) || 0;
    if (e.entry_type === 'customer_payment') byChannel[ch] += amt;
    else if (e.entry_type === 'refund') byChannel[ch] -= amt;
    else if (e.entry_type === 'write_off') writtenOff += amt;
  }
  for (const k of CHANNELS) byChannel[k] = r2(Math.max(0, byChannel[k]));
  const total = r2(invoice.total), service = r2(invoice.taxable), gst = r2(total - service);
  const collected = r2(byChannel.company_manual + byChannel.company_portal + byChannel.mechanic);
  const outstanding = r2(Math.max(0, total - collected - writtenOff));
  const hasMech = !!(invoice.mechanic_id || mechanic);
  const pct = hasMech ? Math.min(100, Math.max(0, Math.round(Number(invoice.mechanic_id ? invoice.mechanic_rate : (mechanic && mechanic.payout_rate)) || 0))) : 0;
  const adjust = Number(invoice.commission_adjust) || 0, earningsTotal = r2(Math.min(service, Math.max(0, (service * pct) / 100 + adjust))), companyShareTotal = r2(service - earningsTotal);
  const denom = Math.max(total, collected);
  const fc = denom > 0 ? (byChannel.company_manual + byChannel.company_portal) / denom : 0, fm = denom > 0 ? byChannel.mechanic / denom : 0;
  const payoutObligation = r2(earningsTotal * fc), inHand = r2(earningsTotal * fm), remitObligation = r2(Math.max(0, byChannel.mechanic - inHand));
  const remitDue = r2(Math.max(0, remitObligation - (allocated.remit || 0))), payoutDue = r2(Math.max(0, payoutObligation - (allocated.payout || 0)));
  return {
    lead_id: invoice.lead_id, ref: invoice.ref, issuedAt: invoice.issued_at, service, gst, total, mechanicPct: pct, earningsTotal, companyShareTotal,
    byChannel, collected, outstanding, payoutObligation, inHand, remitObligation, remitAllocated: r2(allocated.remit || 0), payoutAllocated: r2(allocated.payout || 0), remitDue, payoutDue,
  };
}

// Remittances and payouts are mostly recorded per mechanic, not per job. An entry that names a job goes to that job first; the rest settles the oldest jobs first.
function allocate(accounts: any[], entries: any[], type: string, obligationKey: string) {
  const act = activeEntries(entries).filter((e) => e.entry_type === type);
  const ordered = [...accounts].sort((a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime());
  const applied = new Map<string, number>(ordered.map((a) => [a.lead_id, 0]));
  let pool = 0;
  for (const e of act) {
    const amt = Number(e.amount) || 0, a = e.lead_id && applied.has(e.lead_id) ? ordered.find((x) => x.lead_id === e.lead_id) : null;
    if (!a) { pool += amt; continue; }
    const room = Math.max(0, a[obligationKey] - (applied.get(a.lead_id) as number)), take = Math.min(room, amt);
    applied.set(a.lead_id, (applied.get(a.lead_id) as number) + take); pool += amt - take;
  }
  for (const a of ordered) {
    const room = Math.max(0, a[obligationKey] - (applied.get(a.lead_id) as number)), take = Math.min(room, pool);
    applied.set(a.lead_id, (applied.get(a.lead_id) as number) + take); pool -= take;
  }
  return { applied, total: r2(act.reduce((t, e) => t + (Number(e.amount) || 0), 0)) };
}

/** jobs = [{ invoice, entries }] (entries: every ledger row of that booking); entries = every ledger row of this mechanic. Same result shape fields as admin mechanicAccount that the app needs. */
export function mechanicDues({ mechanic, jobs, entries = [] }: { mechanic: any; jobs: { invoice: any; entries: any[] }[]; entries?: any[] }) {
  const base = jobs.map((j) => { const a: any = jobAccount({ invoice: j.invoice, entries: j.entries, mechanic }); a.__invoice = j.invoice; a.__entries = j.entries; return a; });
  const rem = allocate(base, entries, 'remittance', 'remitObligation'), pay = allocate(base, entries, 'payout', 'payoutObligation');
  const ja = base.map((a) => jobAccount({ invoice: a.__invoice, entries: a.__entries, mechanic, allocated: { remit: rem.applied.get(a.lead_id) || 0, payout: pay.applied.get(a.lead_id) || 0 } }));
  const sum = (k: string) => r2(ja.reduce((t: number, a: any) => t + a[k], 0));
  const remitTotalDue = sum('remitObligation'), payoutTotalDue = sum('payoutObligation');
  const remitRemaining = r2(Math.max(0, remitTotalDue - rem.total)), payoutRemaining = r2(Math.max(0, payoutTotalDue - pay.total));
  return { jobAccounts: ja, remitTotalDue, remitted: rem.total, remitRemaining, payoutTotalDue, paidOut: pay.total, payoutRemaining, net: r2(payoutRemaining - remitRemaining), earnings: r2(ja.reduce((t: number, a: any) => t + a.payoutObligation + a.inHand, 0)) };
}

/** The mechanic's "Previous unsettled" rows: the jobs where he still owes the company (remitDue), oldest first, with the three figures the screen shows.
 *  total_collected = cash he took at the door, mechanic_payout = the part of that he keeps (his labour share), due = what he still owes for the job. */
export function unsettledRows(dues: ReturnType<typeof mechanicDues>) {
  return dues.jobAccounts.filter((a: any) => a.remitDue > EPS).sort((a: any, b: any) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime())
    .map((a: any) => ({ lead_id: a.lead_id, ref: a.ref, issued_at: a.issuedAt, total_collected: a.byChannel.mechanic, mechanic_payout: a.inHand, due_to_platform: a.remitDue }));
}

/** Month figures: bookings in the month, completions, and the average invoice total of the completed ones. */
export function monthlyStats(rows: { status: string; month_booking: boolean; month_completed: boolean; total?: number }[]) {
  const bookings = rows.filter((r) => r.month_booking).length, done = rows.filter((r) => r.month_completed);
  const sumT = done.reduce((t, r) => t + (Number(r.total) || 0), 0);
  return { bookings, completions: done.length, avg_ticket: done.length ? r2(sumT / done.length) : 0 };
}
