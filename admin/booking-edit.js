// admin/booking-edit.js — checks what the admin types when editing a booking's service or payment (no DOM, no Supabase), so it can be tested in Node.
const SLOTS = ['morning', 'afternoon', 'evening', 'asap'];
const PACKAGES = ['basic', 'general', 'full'];
const txt = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const MAX = 100000;

// The service side of a booking: package, add-ons, visit day and slot, place and the problem note. Recalculates the estimate from the live prices.
export function buildServiceEdit(f, { services = [], today, currentDate = null } = {}) {
  const svc = f.service ? services.find((s) => s.id === f.service && s.kind === 'service') : null;
  if (f.service && !svc) return { ok: false, error: 'Choose a valid service' };
  const addons = svc ? [...new Set((f.addons || []).filter((id) => services.some((s) => s.id === id && s.kind === 'addon')))] : [];
  const bigFee = services.find((s) => s.id === 'bigbike' && s.kind === 'fee')?.price ?? 300;
  // Engine size: 'mid' (150 to 250cc) and 'big' (251 to 500cc) use the package's own price for that class. Without the 251-500cc row, 'big' is the 150-250cc price plus the old surcharge.
  // Without an engine value, the old yes/no box applies.
  const engine = ['std', 'mid', 'big'].includes(f.engine) ? f.engine : null;
  const big = engine ? engine === 'big' : !!f.bigBike;
  const isPkg = !!svc && PACKAGES.includes(svc.id);
  const row = (sfx) => services.find((s) => s.id === svc.id + sfx && s.kind === 'service' && s.active !== false);
  const tier = isPkg && (engine === 'mid' || engine === 'big') ? (engine === 'big' ? row('500') || row('250') : row('250')) : null;
  const surcharge = isPkg ? (engine ? (engine === 'big' && !row('500') ? bigFee : 0) : (f.bigBike ? bigFee : 0)) : 0;
  const est = svc ? (tier ? tier.price : svc.price) + surcharge + addons.reduce((t, id) => t + services.find((s) => s.id === id).price, 0) : null;
  const pincode = String(f.pincode ?? '').replace(/\s/g, '');
  if (pincode && !/^\d{6}$/.test(pincode)) return { ok: false, error: 'PIN code must be 6 digits' };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : null;
  const slot = SLOTS.includes(f.slot) ? f.slot : null;
  if (date && !slot) return { ok: false, error: 'Pick a time slot for that day' };
  if (date && today && date < today && date !== currentDate) return { ok: false, error: 'That day is in the past' };
  return {
    ok: true,
    lead: {
      service_id: svc ? svc.id : null, addons, est_total: est,
      preferred_date: date, preferred_slot: date ? slot : null, preferred_time: date ? txt(f.time, 30) || null : null,
      area: txt(f.area, 40) || null, pincode: pincode || null, address: txt(f.address, 200) || null, note: txt(f.note, 500) || null,
    },
    bike: svc ? (engine ? { big_bike: big, engine_class: engine } : { big_bike: !!f.bigBike }) : null,
  };
}

// The money side of a booking: what is due, what was received (whole rupees, the column is an integer), and when.
export function buildPaymentEdit(f, { today, now }) {
  const num = (v) => (String(v ?? '').trim() === '' ? 0 : Number(String(v).replace(/[, ₹]/g, '')));
  const due = num(f.due), paid = num(f.paid);
  if (!(Number.isFinite(due) && due >= 0 && due <= MAX)) return { ok: false, error: 'Check the amount due (₹0 to ₹1,00,000)' };
  if (!(Number.isFinite(paid) && paid >= 0 && paid <= MAX)) return { ok: false, error: 'Check the amount received (₹0 to ₹1,00,000)' };
  const on = /^\d{4}-\d{2}-\d{2}$/.test(f.paidOn || '') ? f.paidOn : null;
  if (on && today && on > today) return { ok: false, error: 'The day the money was received cannot be in the future' };
  return { ok: true, lead: { amount_due: Math.round(due), paid_amount: Math.round(paid), paid_at: paid > 0 ? (on ? on + 'T05:00:00.000Z' : now) : null } };
}
