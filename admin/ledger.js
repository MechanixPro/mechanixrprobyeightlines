// admin/ledger.js — sales, collections and mechanic settlement from a transaction ledger (no DOM, no Supabase), so every rupee can be tested in Node.
//
// THE RULES (agreed with the client)
//  * Mechanix Pro issues every invoice. An invoice has a service amount X (before GST), GST G and a total T = X + G.
//  * The mechanic's percentage m% is applied to X only. Earnings E = X x m%. Company share C = X - E. GST is kept apart from both: E + C + G = T.
//  * Money events are ledger entries and are never edited or deleted. A mistake is cancelled by a reversal entry (with a reason) and re-entered.
//      customer_payment / refund  how much the customer paid, and through whom: company_manual, company_portal or mechanic
//      write_off                  clears part of a customer balance with no cash (reason needed)
//      remittance                 money the mechanic hands over to Mechanix Pro
//      payout                     money Mechanix Pro pays to the mechanic
//  * Earnings build up in proportion to the money collected (collected / invoice total).
//      Collected by the company  -> the company owes the mechanic that share of E (payout obligation).
//      Collected by the mechanic -> he keeps that share of E in hand and must remit the rest of what he took (remittance obligation). No double counting.
//  * Customer balance, mechanic remittance due and mechanic payout due are three separate balances.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CHANNELS = ['company_manual', 'company_portal', 'mechanic'];
const EPS = 0.005;

export function activeEntries(entries) {
  const reversed = new Set(entries.filter((e) => e.entry_type === 'reversal' && e.reverses_id).map((e) => e.reverses_id));
  return entries.filter((e) => e.entry_type !== 'reversal' && !reversed.has(e.id));
}

export function jobStatus({ outstanding = 0, remitDue = 0, payoutDue = 0, collected = 0, total = 1, overdue = false }) {
  const out = [];
  if (total > 0 || outstanding > 0) out.push(collected <= EPS && outstanding > EPS ? 'Unpaid' : outstanding > EPS ? 'Partially Paid' : 'Fully Paid');
  if (outstanding > EPS) out.push('Customer Due');
  if (overdue && outstanding > EPS) out.push('Overdue');
  if (remitDue > EPS) out.push('Mechanic Remittance Due');
  if (payoutDue > EPS) out.push('Mechanic Payout Due');
  if (outstanding <= EPS && remitDue <= EPS && payoutDue <= EPS && collected > EPS) out.push('Settled');
  return out;
}

export function jobAccount({ invoice, entries = [], mechanic = null, now = Date.now(), overdueDays = 7, allocated = {} }) {
  const act = activeEntries(entries);
  const byChannel = { company_manual: 0, company_portal: 0, mechanic: 0 };
  let writtenOff = 0, gatewayFees = 0;
  for (const e of act) {
    const ch = CHANNELS.includes(e.collected_by) ? e.collected_by : 'company_manual', amt = Number(e.amount) || 0;
    if (e.entry_type === 'customer_payment') { byChannel[ch] += amt; if (ch === 'company_portal') gatewayFees += Number(e.gateway_fee) || 0; }
    else if (e.entry_type === 'refund') byChannel[ch] -= amt;
    else if (e.entry_type === 'write_off') writtenOff += amt;
  }
  for (const k of CHANNELS) byChannel[k] = r2(Math.max(0, byChannel[k]));
  const total = r2(invoice.total), service = r2(invoice.taxable), gst = r2(total - service);
  const collected = r2(byChannel.company_manual + byChannel.company_portal + byChannel.mechanic);
  const outstanding = r2(Math.max(0, total - collected - writtenOff)), credit = r2(Math.max(0, collected + writtenOff - total));
  const hasMech = !!(invoice.mechanic_id || mechanic);
  const pct = hasMech ? Math.min(100, Math.max(0, Math.round(Number(invoice.mechanic_id ? invoice.mechanic_rate : (mechanic && mechanic.payout_rate)) || 0))) : 0;
  const earningsTotal = r2((service * pct) / 100), companyShareTotal = r2(service - earningsTotal);
  const denom = Math.max(total, collected);
  const fc = denom > 0 ? (byChannel.company_manual + byChannel.company_portal) / denom : 0, fm = denom > 0 ? byChannel.mechanic / denom : 0;
  const payoutObligation = r2(earningsTotal * fc), inHand = r2(earningsTotal * fm), remitObligation = r2(Math.max(0, byChannel.mechanic - inHand));
  const remitDue = r2(Math.max(0, remitObligation - (allocated.remit || 0))), payoutDue = r2(Math.max(0, payoutObligation - (allocated.payout || 0)));
  const overdue = outstanding > EPS && now - new Date(invoice.issued_at).getTime() > overdueDays * 864e5;
  return {
    lead_id: invoice.lead_id, ref: invoice.ref, number: invoice.number, issuedAt: invoice.issued_at, customer: invoice.customer_name, phone: invoice.customer_phone || null, hasGst: !!invoice.has_gst, gstRate: invoice.gst_rate,
    mechanicId: invoice.mechanic_id || (mechanic && mechanic.id) || null, mechanicName: invoice.mechanic_name || (mechanic && mechanic.name) || null,
    service, gst, total, mechanicPct: pct, companyPct: 100 - pct, earningsTotal, companyShareTotal,
    byChannel, collected, outstanding, credit, writtenOff: r2(writtenOff), gatewayFees: r2(gatewayFees),
    payoutObligation, inHand, remitObligation, remitAllocated: r2(allocated.remit || 0), payoutAllocated: r2(allocated.payout || 0), remitDue, payoutDue,
    entries: act, statusLabels: jobStatus({ outstanding, remitDue, payoutDue, collected, total, overdue }),
  };
}

// Remittances and payouts are mostly recorded per mechanic, not per job. An entry that names a job goes to that job first; the rest settles the oldest jobs first.
function allocate(accounts, entries, type, obligationKey, dueKey) {
  const act = activeEntries(entries).filter((e) => e.entry_type === type);
  const ordered = [...accounts].sort((a, b) => new Date(a.issuedAt) - new Date(b.issuedAt));
  const applied = new Map(ordered.map((a) => [a.lead_id, 0]));
  let pool = 0;
  for (const e of act) {
    const amt = Number(e.amount) || 0, a = e.lead_id && applied.has(e.lead_id) ? ordered.find((x) => x.lead_id === e.lead_id) : null;
    if (!a) { pool += amt; continue; }
    const room = Math.max(0, a[obligationKey] - applied.get(a.lead_id)), take = Math.min(room, amt);
    applied.set(a.lead_id, applied.get(a.lead_id) + take); pool += amt - take;
  }
  for (const a of ordered) {
    const room = Math.max(0, a[obligationKey] - applied.get(a.lead_id)), take = Math.min(room, pool);
    applied.set(a.lead_id, applied.get(a.lead_id) + take); pool -= take;
  }
  return { applied, total: r2(act.reduce((t, e) => t + (Number(e.amount) || 0), 0)) };
}

function settle(accounts, entries, now) {
  const rem = allocate(accounts, entries, 'remittance', 'remitObligation'), pay = allocate(accounts, entries, 'payout', 'payoutObligation');
  const jobs = accounts.map((a) => jobAccount({ invoice: a.__invoice, entries: a.__entries, mechanic: a.__mechanic, now, allocated: { remit: rem.applied.get(a.lead_id) || 0, payout: pay.applied.get(a.lead_id) || 0 } }));
  return { jobs, remitted: rem.total, paidOut: pay.total };
}

export function mechanicAccount({ mechanic, jobs, entries = [], now = Date.now() }) {
  const base = jobs.map((j) => { const a = jobAccount({ invoice: j.invoice, entries: j.entries, mechanic, now }); a.__invoice = j.invoice; a.__entries = j.entries; a.__mechanic = mechanic; return a; });
  const { jobs: ja, remitted, paidOut } = settle(base, entries, now);
  const sum = (k) => r2(ja.reduce((t, a) => t + a[k], 0));
  const remitTotalDue = sum('remitObligation'), payoutTotalDue = sum('payoutObligation');
  const remitRemaining = r2(Math.max(0, remitTotalDue - remitted)), payoutRemaining = r2(Math.max(0, payoutTotalDue - paidOut));
  const net = r2(payoutRemaining - remitRemaining);
  const settled = remitRemaining <= EPS && payoutRemaining <= EPS;
  return {
    mechanic, jobs: ja.length, serviceSales: sum('service'), directCollected: r2(ja.reduce((t, a) => t + a.byChannel.mechanic, 0)), earnings: r2(ja.reduce((t, a) => t + a.payoutObligation + a.inHand, 0)),
    remitTotalDue, remitted, remitRemaining, remitCredit: r2(Math.max(0, remitted - remitTotalDue)),
    payoutTotalDue, paidOut, payoutRemaining, payoutCredit: r2(Math.max(0, paidOut - payoutTotalDue)),
    net, netLabel: settled ? 'Settled' : net < 0 ? 'Mechanic owes Mechanix Pro' : net > 0 ? 'Mechanix Pro owes mechanic' : 'Both sides owe the same, net nil',
    status: settled ? 'Settled' : net < 0 ? 'Mechanic Remittance Due' : 'Mechanic Payout Due', jobAccounts: ja.map(({ __invoice, __entries, __mechanic, ...rest }) => rest),
  };
}

// The nine figures at the top of Sales and Collections. accounts = one jobAccount per invoice; entries = every ledger entry.
export function summaryCards(accounts, entries = []) {
  const byMech = new Map();
  for (const a of accounts) { const k = a.mechanicId || 'none'; (byMech.get(k) || byMech.set(k, []).get(k)).push(a); }
  let owe = 0, pending = 0;
  for (const [k, list] of byMech) {
    if (k === 'none') continue;
    const mine = entries.filter((e) => e.mechanic_id === k);
    const full = list.map((a) => { const x = { ...a }; x.__invoice = { lead_id: a.lead_id, ref: a.ref, number: a.number, issued_at: a.issuedAt, customer_name: a.customer, has_gst: a.hasGst, gst_rate: a.gstRate, total: a.total, taxable: a.service, mechanic_id: a.mechanicId, mechanic_rate: a.mechanicPct, mechanic_name: a.mechanicName }; x.__entries = a.entries; x.__mechanic = null; return x; });
    const s = settle(full, mine, Date.now());
    const ro = r2(s.jobs.reduce((t, a) => t + a.remitObligation, 0)), po = r2(s.jobs.reduce((t, a) => t + a.payoutObligation, 0));
    owe += Math.max(0, ro - s.remitted); pending += Math.max(0, po - s.paidOut);
  }
  const sum = (f) => r2(accounts.reduce((t, a) => t + f(a), 0));
  const paidOut = r2(activeEntries(entries).filter((e) => e.entry_type === 'payout').reduce((t, e) => t + (Number(e.amount) || 0), 0));
  return {
    invoiceSales: sum((a) => a.total), collectedManual: sum((a) => a.byChannel.company_manual), collectedPortal: sum((a) => a.byChannel.company_portal), collectedMechanic: sum((a) => a.byChannel.mechanic),
    customerOutstanding: sum((a) => a.outstanding), mechanicsOweCompany: r2(owe), payoutsPending: r2(pending), payoutsPaid: paidOut, gst: sum((a) => a.gst), gatewayFees: sum((a) => a.gatewayFees),
    companyShare: sum((a) => a.companyShareTotal * (a.total > 0 ? Math.min(1, a.collected / a.total) : 0)), jobs: accounts.length,
  };
}
