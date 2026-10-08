// Invoice figures for the invoice email. Same rules as admin/invoice.js (a test checks they give identical numbers).
// Prices include 18% GST, so the bill carves taxable value, CGST and SGST out of the total.
const SERVICE_PACKAGES = ['basic', 'general', 'full'];
const paise = (n: unknown) => Math.round(Number(n || 0) * 100);
const rupees = (p: number) => p / 100;
type Svc = { id: string; kind: string; name: string; price: number };
type LeadLike = { ref: string; name: string; phone: string; service_id?: string | null; addons?: string[] | null; big_bike?: boolean | null; coupon_discount?: number | null; paid_amount?: number | null };

export function buildInvoice(lead: LeadLike, services: Svc[], opts: { date?: string | number | Date } = {}) {
  const byId = new Map((services || []).map((s) => [s.id, s]));
  const lines: Array<{ name: string; amount: number }> = [];
  const svc = byId.get(String(lead.service_id));
  if (svc && svc.kind === 'service') lines.push({ name: svc.name, amount: svc.price });
  const big = byId.get('bigbike');
  if (svc && lead.big_bike && SERVICE_PACKAGES.includes(String(lead.service_id))) lines.push({ name: big ? big.name : 'Big bike surcharge', amount: big ? big.price : 300 });
  for (const id of lead.addons || []) { const a = byId.get(id); if (a && a.kind === 'addon') lines.push({ name: a.name, amount: a.price }); }

  const subtotal = lines.reduce((s, l) => s + paise(l.amount), 0);
  const discount = Math.min(subtotal, paise(lead.coupon_discount));
  const total = subtotal - discount;
  const taxable = Math.round(total / 1.18);
  const gst = total - taxable, cgst = Math.round(gst / 2), sgst = gst - cgst;
  const paid = Math.min(total, paise(lead.paid_amount));
  const when = new Date(opts.date || Date.now());
  const dateLabel = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(when);
  return {
    number: 'INV-' + lead.ref, ref: lead.ref, dateLabel, customer: { name: lead.name, phone: lead.phone },
    lines, subtotal: rupees(subtotal), discount: rupees(discount), total: rupees(total),
    taxable: rupees(taxable), cgst: rupees(cgst), sgst: rupees(sgst), gstRate: 18,
    paid: rupees(paid), balance: rupees(total - paid),
  };
}
export type Invoice = ReturnType<typeof buildInvoice>;
