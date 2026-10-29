// admin/invoice-register.js — the invoice register and the mechanic's cut (no DOM, no Supabase), so the maths can be tested in Node.
//
// THE MATHS. An invoice has a total T, a taxable value X and GST G = T - X. The company chooses how a mechanic's percentage (m%) is worked out:
//   "before_gst": GST belongs to the government, so the cut is m% of the taxable value X.   With GST the base is X; with no GST (X = T) it is the whole amount.
//   "collected":  the cut is m% of the whole total T, GST included.
// The company keeps (base - cut). What is payable now follows what the customer has actually paid: cut x (paid / T), never more than the full cut.
const SLOTS_RATES = [0, 5, 12, 18];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const clampPct = (v) => Math.min(100, Math.max(0, Math.round(Number(v)) || 0));

export function mechanicCut(inv, ratePct, basis = 'collected') {
  const pct = clampPct(ratePct), total = Number(inv.total) || 0, taxable = Number(inv.taxable) || 0;
  const b = basis === 'before_gst' ? 'before_gst' : 'collected';
  const base = b === 'before_gst' ? taxable : total;
  const cut = r2((base * pct) / 100), company = r2(base - cut), gst = r2(total - taxable);
  const fraction = total > 0 ? Math.min(1, Math.max(0, (Number(inv.paid) || 0) / total)) : 0;
  const payableNow = r2(cut * fraction);
  return { basis: b, rate: pct, base: r2(base), cut, company, gst, payableNow, owed: r2(cut - payableNow) };
}

export function snapshotRow({ invoice, lead, customer, mechanic, via, basis, revision, now }) {
  const c = mechanicCut(invoice, mechanic ? mechanic.payout_rate : 0, basis), rate = SLOTS_RATES.includes(invoice.gstRate) ? invoice.gstRate : 18;
  const clean = (v, n) => (String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n) || null);
  return {
    doc_key: invoice.docKey || 'A', note: invoice.note || null, lead_id: lead.id, ref: invoice.ref, number: invoice.number + (revision > 1 ? '-R' + revision : ''), revision, issued_at: now, via: ['print', 'email', 'rebuilt'].includes(via) ? via : 'print',
    customer_id: lead.customer_id || (customer && customer.id) || null, customer_name: clean(invoice.customer.name, 80) || 'Customer', customer_phone: clean(invoice.customer.phone, 15), customer_email: clean(invoice.customer.email, 120), vehicle_reg: clean(invoice.vehicle && invoice.vehicle.reg, 14),
    customer_company: clean((customer && customer.company_name) || invoice.customer.company, 80), customer_gstin: clean((customer && customer.gstin) || invoice.customer.gstin, 15),
    mechanic_id: mechanic ? mechanic.id : null, mechanic_name: mechanic ? clean(mechanic.name, 80) : null,
    has_gst: rate > 0, gst_rate: rate, basis: invoice.basis === 'excl' ? 'excl' : 'incl',
    taxable: r2(invoice.taxable), cgst: r2(invoice.cgst), sgst: r2(invoice.sgst), discount: r2(invoice.discount), total: r2(invoice.total), paid: r2(invoice.paid), balance: r2(invoice.balance),
    payout_basis: c.basis, mechanic_rate: c.rate, mechanic_cut: c.cut, company_share: c.company, payable_now: c.payableNow,
    lines: (invoice.lines || []).map((l) => ({ name: clean(l.name, 80) || '', amount: r2(l.amount) })),
  };
}

// The same invoice, printed or emailed again? Then no new copy is saved. Payments are not compared: they change the balance, not the invoice.
export function sameFigures(a, b) {
  const keys = ['gst_rate', 'basis', 'taxable', 'cgst', 'sgst', 'discount', 'total', 'mechanic_id', 'mechanic_rate', 'payout_basis', 'customer_gstin', 'customer_company', 'customer_name'];
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null)) && JSON.stringify(a.lines || []) === JSON.stringify(b.lines || []);
}

const istDay = (iso) => new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10);
export function filterRegister(rows, f = {}) {
  const q = String(f.q || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.gst === 'with' && !r.has_gst) return false;
    if (f.gst === 'without' && r.has_gst) return false;
    if (f.rate !== undefined && f.rate !== '' && Number(f.rate) !== Number(r.gst_rate)) return false;
    if (f.mechanic === 'none' && r.mechanic_id) return false;
    if (f.mechanic && f.mechanic !== 'none' && r.mechanic_id !== f.mechanic) return false;
    const d = istDay(r.issued_at);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    if (q && ![r.number, r.ref, r.customer_name, r.customer_company, r.customer_gstin, r.mechanic_name].some((v) => String(v ?? '').toLowerCase().includes(q))) return false;
    return true;
  });
}

const sum = (rows, k) => r2(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0));
export function registerTotals(rows) {
  return { count: rows.length, taxable: sum(rows, 'taxable'), gst: r2(sum(rows, 'cgst') + sum(rows, 'sgst')), total: sum(rows, 'total'), paid: sum(rows, 'paid'), balance: sum(rows, 'balance'), cut: sum(rows, 'mechanic_cut'), company: sum(rows, 'company_share'), payable: sum(rows, 'payable_now') };
}

export function byMechanic(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.mechanic_id || 'none';
    const g = groups.get(key) || { id: key, name: r.mechanic_id ? (r.mechanic_name || 'Mechanic') : 'No mechanic', rows: [] };
    g.rows.push(r); groups.set(key, g);
  }
  const part = (rs) => ({ count: rs.length, total: sum(rs, 'total'), taxable: sum(rs, 'taxable'), gst: r2(sum(rs, 'cgst') + sum(rs, 'sgst')), cut: sum(rs, 'mechanic_cut'), company: sum(rs, 'company_share') });
  return [...groups.values()].map((g) => ({
    id: g.id, name: g.name, count: g.rows.length, total: sum(g.rows, 'total'), cut: sum(g.rows, 'mechanic_cut'), company: sum(g.rows, 'company_share'),
    payable: sum(g.rows, 'payable_now'), owed: r2(sum(g.rows, 'mechanic_cut') - sum(g.rows, 'payable_now')),
    withGst: part(g.rows.filter((r) => r.has_gst)), withoutGst: part(g.rows.filter((r) => !r.has_gst)),
  })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

export function gstSummary(rows) {
  return SLOTS_RATES.map((rate) => {
    const rs = rows.filter((r) => Number(r.gst_rate) === rate);
    return { rate, count: rs.length, taxable: sum(rs, 'taxable'), cgst: sum(rs, 'cgst'), sgst: sum(rs, 'sgst'), gst: r2(sum(rs, 'cgst') + sum(rs, 'sgst')), total: sum(rs, 'total') };
  }).filter((r) => r.count);
}

const HEAD = ['Invoice', 'Revision', 'Date', 'Booking', 'Customer', 'Company', 'GSTIN', 'GST', 'GST rate', 'Taxable', 'CGST', 'SGST', 'Total', 'Paid', 'Balance', 'Mechanic', 'Mechanic %', 'Mechanic cut', 'Company share', 'Payable now', 'Saved by'];
export function registerCsv(rows) {
  const cell = (v) => {
    let t = String(v ?? '');
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = "'" + t; // a spreadsheet must never run text as a formula
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const lines = rows.map((r) => [r.number, r.revision, istDay(r.issued_at), r.ref, r.customer_name, r.customer_company || '', r.customer_gstin || '', r.has_gst ? 'GST' : 'No GST', r.gst_rate + '%', r.taxable, r.cgst, r.sgst, r.total, r.paid, r.balance,
    r.mechanic_name || '', r.mechanic_rate, r.mechanic_cut, r.company_share, r.payable_now, r.via].map(cell).join(','));
  return [HEAD.join(','), ...lines].join('\n');
}

// A booking can carry several invoice documents. Sales and payments treat them as one bill: the amounts add up, the lines are listed together.
export const docKey = (r) => r.doc_key || 'A';
export const latestDocs = (rows) => { const best = new Map(); for (const r of rows) { const k = docKey(r), cur = best.get(k); if (!cur || r.revision > cur.revision) best.set(k, r); } return [...best.values()].sort((a, b) => docKey(a).localeCompare(docKey(b))); };
export const nextDocKey = (rows) => { const used = new Set(rows.map(docKey)); for (let c = 66; c <= 90; c++) { const k = String.fromCharCode(c); if (!used.has(k)) return k; } return null; };
export function combineDocs(main, extras) {
  if (!extras || !extras.length) return main;
  const sum = (k) => r2([main, ...extras].reduce((s, d) => s + (Number(d[k]) || 0), 0));
  return { ...main, taxable: sum('taxable'), cgst: sum('cgst'), sgst: sum('sgst'), discount: sum('discount'), total: sum('total'), has_gst: [main, ...extras].some((d) => d.has_gst), lines: [...(main.lines || []), ...extras.flatMap((d) => d.lines || [])], docs: 1 + extras.length };
}
