// admin/sales-view.js — filters, CSV and plain labels for the Sales and Collections pages (no DOM, no Supabase).
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const day = (iso) => new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10);

export function filterAccounts(rows, { from, to, mechanic, status, q } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return rows.filter((a) => {
    const d = day(a.issuedAt);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (mechanic === 'none' ? a.mechanicId : mechanic && a.mechanicId !== mechanic) return false;
    if (status && !a.statusLabels.includes(status)) return false;
    if (needle && ![a.ref, a.number, a.customer, a.mechanicName].some((v) => String(v || '').toLowerCase().includes(needle))) return false;
    return true;
  });
}

export function entryLabel(e) {
  switch (e.entry_type) {
    case 'customer_payment': return e.collected_by === 'mechanic' ? 'Customer paid the mechanic' : e.collected_by === 'company_portal' ? 'Customer paid online' : 'Customer paid the company';
    case 'refund': return 'Refund to customer';
    case 'write_off': return 'Balance written off';
    case 'remittance': return 'Mechanic paid the company';
    case 'payout': return 'Company paid the mechanic';
    case 'reversal': return 'Cancelled an entry';
    default: return e.entry_type;
  }
}

const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function salesCsv(rows) {
  const head = ['Invoice', 'Booking', 'Date', 'Customer', 'Mechanic', 'GST', 'Service amount', 'GST amount', 'Invoice total', 'Collected by company (manual)', 'Collected online', 'Collected by mechanic', 'Customer balance', 'Mechanic earnings', 'Mechanic remittance due', 'Mechanic payout due', 'Gateway fees', 'Status'];
  const lines = rows.map((a) => [a.number, a.ref, day(a.issuedAt), a.customer, a.mechanicName || '', a.hasGst ? a.gstRate + '%' : 'No GST', a.service, a.gst, a.total, a.byChannel.company_manual, a.byChannel.company_portal, a.byChannel.mechanic, a.outstanding, a.earningsTotal, a.remitDue, a.payoutDue, r2(a.gatewayFees), a.statusLabels.join(' / ')].map(cell).join(','));
  return [head.join(','), ...lines].join('\n');
}
