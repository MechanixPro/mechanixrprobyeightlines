// admin/invoice.js — builds the figures for a customer invoice (no DOM, no Supabase), so they can be tested in Node.
// Prices on the site include 18% GST, so the bill shows the taxable value and CGST + SGST carved out of the total.
// From this moment the price list is shown before GST and GST at the invoice rate is added on the final invoice. Bookings made earlier keep their old GST-inclusive bills.
const GST_ON_TOP_FROM = Date.parse('2026-10-27T09:00:00+05:30');
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

// The vehicle on the invoice: registration number in capitals, plus a readable bike name.
function vehicleOf(b) {
  const reg = String((b && b.reg_no) || '').replace(/[^A-Za-z0-9 -]/g, '').trim().toUpperCase().slice(0, 14);
  const label = [b && b.brand, b && b.model].filter(Boolean).join(' ').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60) || null;
  return { reg: reg || null, label };
}

// What an invoice must have before it can be saved, printed or emailed. Email is optional. Returns plain-words labels of what is missing.
export function missingDetails(inv) {
  const out = [], name = String((inv.customer && inv.customer.name) || '').trim(), phone = String((inv.customer && inv.customer.phone) || '').replace(/\D/g, '').slice(-10);
  if (name.length < 2 || /^customer$/i.test(name)) out.push('customer name');
  if (!/^[6-9]\d{9}$/.test(phone)) out.push('mobile number');
  if (!inv.vehicle || !inv.vehicle.reg || inv.vehicle.reg.replace(/[^A-Z0-9]/g, '').length < 4) out.push('vehicle number');
  return out;
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
  const basis = ov ? ov.basis : (Date.parse(String(lead.created_at || '')) >= GST_ON_TOP_FROM ? 'excl' : 'incl');
  // "excl": the lines are before GST, so the tax is added on what is left after discounts. "incl": the tax is carved out of the total.
  const rate = ov ? ov.rate : 18;
  const taxable = basis === 'excl' ? subtotal - discount : Math.round((subtotal - discount) / (1 + rate / 100));
  const gst = basis === 'excl' ? Math.round(taxable * rate / 100) : subtotal - discount - taxable, cgst = Math.round(gst / 2), sgst = gst - cgst;
  const total = taxable + gst;
  const paidRaw = paise(lead.paid_amount), paid = Math.min(total, paidRaw);
  const when = new Date(opts.date || Date.now());
  const dateLabel = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(when);
  return {
    number: 'INV-' + lead.ref, ref: lead.ref, dateLabel, customer: { name: lead.name, phone: lead.phone, company: clean80(opts.customer && opts.customer.company_name), gstin: clean80(opts.customer && opts.customer.gstin), address: clean80(opts.customer && opts.customer.address, 160), email: clean80((opts.customer && opts.customer.email) || lead.email, 120) },
    vehicle: vehicleOf(opts.bike),
    lines, subtotal: rupees(subtotal), discount: rupees(discount), couponDiscount: rupees(couponDiscount), extraDiscount: rupees(extraDiscount), extraNote: String(lead.extra_discount_note || '').slice(0, 80), total: rupees(total),
    basis, taxable: rupees(taxable), cgst: rupees(cgst), sgst: rupees(sgst), gstRate: rate,
    paid: rupees(paid), balance: rupees(total - paid), refund: rupees(Math.max(0, paidRaw - total)),
  };
}
