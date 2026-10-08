// admin/invoice.js — builds the figures for a customer invoice (no DOM, no Supabase), so they can be tested in Node.
// Prices on the site include 18% GST, so the bill shows the taxable value and CGST + SGST carved out of the total.
const SERVICE_PACKAGES = ['basic', 'general', 'full'];
const paise = (n) => Math.round(Number(n || 0) * 100);
const rupees = (p) => p / 100;

export function buildInvoice(lead, services, opts = {}) {
  const byId = new Map((services || []).map((s) => [s.id, s]));
  const lines = [];
  const svc = byId.get(lead.service_id);
  if (svc && svc.kind === 'service') lines.push({ name: svc.name, amount: svc.price });
  const big = byId.get('bigbike');
  if (svc && lead.big_bike && SERVICE_PACKAGES.includes(lead.service_id)) lines.push({ name: big ? big.name : 'Big bike surcharge', amount: big ? big.price : 300 });
  for (const id of lead.addons || []) { const a = byId.get(id); if (a && a.kind === 'addon') lines.push({ name: a.name, amount: a.price }); }

  const subtotal = lines.reduce((s, l) => s + paise(l.amount), 0);
  const couponDiscount = Math.min(subtotal, paise(lead.coupon_discount));
  const extraDiscount = Math.min(subtotal - couponDiscount, paise(lead.extra_discount)); // a last-minute discount at the customer's request
  const discount = couponDiscount + extraDiscount;
  const total = subtotal - discount;
  const taxable = Math.round(total / 1.18);
  const gst = total - taxable, cgst = Math.round(gst / 2), sgst = gst - cgst;
  const paidRaw = paise(lead.paid_amount), paid = Math.min(total, paidRaw);
  const when = new Date(opts.date || Date.now());
  const dateLabel = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(when);
  return {
    number: 'INV-' + lead.ref, ref: lead.ref, dateLabel, customer: { name: lead.name, phone: lead.phone },
    lines, subtotal: rupees(subtotal), discount: rupees(discount), couponDiscount: rupees(couponDiscount), extraDiscount: rupees(extraDiscount), extraNote: String(lead.extra_discount_note || '').slice(0, 80), total: rupees(total),
    taxable: rupees(taxable), cgst: rupees(cgst), sgst: rupees(sgst), gstRate: 18,
    paid: rupees(paid), balance: rupees(total - paid), refund: rupees(Math.max(0, paidRaw - total)),
  };
}
