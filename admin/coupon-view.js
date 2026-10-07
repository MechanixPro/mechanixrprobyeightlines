// admin/coupon-view.js — pure helpers for the Coupons tab (no DOM, no Supabase), so they can be tested in Node.
const WENT_AHEAD = ['paid', 'scheduled', 'completed'];
const istDate = (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

export function couponRows(coupons, leads, now = new Date()) {
  const today = istDate(now);
  const rows = coupons.map((c) => {
    const mine = leads.filter((l) => l.coupon_code === c.code);
    const used = mine.filter((l) => WENT_AHEAD.includes(l.status));
    const status = !c.active ? 'Off' : c.starts_on && today < c.starts_on ? 'Scheduled' : c.ends_on && today > c.ends_on ? 'Expired' : c.max_uses != null && used.length >= c.max_uses ? 'Used up' : 'Active';
    const min = c.min_amount ? ` orders of ₹${Number(c.min_amount).toLocaleString('en-IN')} or more` : '';
    return { id: c.id, code: c.code, kind: c.kind, value: c.value, minAmount: c.min_amount || 0, maxUses: c.max_uses ?? null, startsOn: c.starts_on, endsOn: c.ends_on, active: !!c.active, note: c.note ?? null,
      offer: (c.kind === 'percent' ? `${c.value}% off` : `₹${c.value} off`) + min, status, requested: mine.length, used: used.length, given: used.reduce((s, l) => s + (l.coupon_discount || 0), 0) };
  });
  return rows.sort((a, b) => Number(b.status === 'Active') - Number(a.status === 'Active') || a.code.localeCompare(b.code));
}
