// admin/invoice.js — builds the figures for a customer invoice (no DOM, no Supabase), so they can be tested in Node.
// Prices on the site include 18% GST, so the bill shows the taxable value and CGST + SGST carved out of the total.
const SERVICE_PACKAGES = ['basic', 'general', 'full'];
const RATES = [0, 5, 12, 18]; // GST rates the admin can choose per invoice; anything else falls back to 18%
const clean80 = (v, n = 80) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n) || null;
const paise = (n) => Math.round(Number(n || 0) * 100);
const rupees = (p) => p / 100;

// An edited invoice ("invoice_override") replaces the package lines. Amounts are before GST unless the admin says they include it.
function cleanOverride(o) {
  if (!o || typeof o !== 'object' || !Array.isArray(o.lines)) return null;
  const lines = o.lines.filter((l) => l && typeof l === 'object' && String(l.name ?? '').trim()).slice(0, 20)
    .map((l) => ({ name: String(l.name).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80), amount: Math.min(1000000, Math.max(0, Math.round(Number(l.amount || 0) * 100) / 100)) }))
    .filter((l) => l.name);
  return lines.length ? { basis: o.basis === 'incl' ? 'incl' : 'excl', rate: RATES.includes(Number(o.rate)) ? Number(o.rate) : 18, lines } : null;
}

export function buildInvoice(lead, services, opts = {}) {
  const byId = new Map((services || []).map((s) => [s.id, s]));
  const ov = cleanOverride(lead.invoice_override);
  const lines = [];
  const svc = ov ? undefined : byId.get(lead.service_id);
  // Bikes of 150 to 250cc and of 251 to 500cc are billed at their own price of the package, when that row exists.
  const eng = lead.engine_class;
  const isPkg = !!svc && SERVICE_PACKAGES.includes(lead.service_id);
  const tier = isPkg && (eng === 'mid' || eng === 'big') ? (eng === 'big' ? (byId.get(lead.service_id + '500') ?? byId.get(lead.service_id + '250')) : byId.get(lead.service_id + '250')) : null;
  const no500 = !byId.get(lead.service_id + '500');
  if (svc && svc.kind === 'service') lines.push(tier && tier.kind === 'service' ? { name: tier.name, amount: tier.price } : { name: svc.name, amount: svc.price });
  const big = byId.get('bigbike');
  // The old surcharge is for bookings made before engine classes, and for the large class when it has no 251-500cc price of its own.
  if (isPkg && (eng ? eng === 'big' && no500 : lead.big_bike)) lines.push({ name: big ? big.name : 'Big bike surcharge', amount: big ? big.price : 300 });
  if (ov) lines.push(...ov.lines);
  for (const id of ov ? [] : lead.addons || []) { const a = byId.get(id); if (a && a.kind === 'addon') lines.push({ name: a.name, amount: a.price }); }

  const subtotal = lines.reduce((s, l) => s + paise(l.amount), 0);
  const couponDiscount = Math.min(subtotal, paise(lead.coupon_discount));
  const extraDiscount = Math.min(subtotal - couponDiscount, paise(lead.extra_discount)); // a last-minute discount at the customer's request
  const discount = couponDiscount + extraDiscount;
  const basis = ov ? ov.basis : 'incl';
  // "excl": the lines are before GST, so the tax is added on what is left after discounts. "incl": the tax is carved out of the total.
  const rate = ov ? ov.rate : 18;
  const taxable = basis === 'excl' ? subtotal - discount : Math.round((subtotal - discount) / (1 + rate / 100));
  const gst = basis === 'excl' ? Math.round(taxable * rate / 100) : subtotal - discount - taxable, cgst = Math.round(gst / 2), sgst = gst - cgst;
  const total = taxable + gst;
  const paidRaw = paise(lead.paid_amount), paid = Math.min(total, paidRaw);
  const when = new Date(opts.date || Date.now());
  const dateLabel = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(when);
  return {
    number: 'INV-' + lead.ref, ref: lead.ref, dateLabel, customer: { name: lead.name, phone: lead.phone, company: clean80(opts.customer && opts.customer.company_name), gstin: clean80(opts.customer && opts.customer.gstin), address: clean80(opts.customer && opts.customer.address, 160) },
    lines, subtotal: rupees(subtotal), discount: rupees(discount), couponDiscount: rupees(couponDiscount), extraDiscount: rupees(extraDiscount), extraNote: String(lead.extra_discount_note || '').slice(0, 80), total: rupees(total),
    basis, taxable: rupees(taxable), cgst: rupees(cgst), sgst: rupees(sgst), gstRate: rate,
    paid: rupees(paid), balance: rupees(total - paid), refund: rupees(Math.max(0, paidRaw - total)),
  };
}
