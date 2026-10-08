// admin/lead-view.js — pure helpers for the admin panel (no DOM, no Supabase), so they can be tested in Node.
const KM = { new: 'New bike (first service)', lt3: 'Under 3,000 km', mid: '3,000–6,000 km', gt6: 'Over 6,000 km', unsure: 'Not sure' };
const TYPE = { m: 'Motorcycle', s: 'Scooter', e: 'Electric scooter' };
const PLACE = { home: 'Home or office', road: 'Stuck on the road', unsure: 'Not sure' };
const CONTACT = { whatsapp: 'WhatsApp chat', call: 'Phone call' };
const ISSUE = { start: 'Hard to start', pickup: 'Low pickup or mileage', brake: 'Brakes weak or noisy', chain: 'Chain noise or loose chain', clutch: 'Clutch hard or slipping', gear: 'Gear shifting problem', battery: 'Battery or self-start', tyre: 'Puncture or worn tyre', leak: 'Oil leak', heat: 'Engine heating', elec: 'Lights, horn or wiring', susp: 'Suspension noise', rain: 'Pre-monsoon check', range: 'Range dropped or charging problem', sw: 'Display or app problem' };

export function leadDetailRows(l) {
  const rows = [];
  if (l.bike_type) rows.push(['Bike type', TYPE[l.bike_type] ?? l.bike_type]);
  if (l.km_band) rows.push(['Last service', KM[l.km_band] ?? l.km_band]);
  if (Array.isArray(l.issues) && l.issues.length) rows.push(['Problems', l.issues.map((i) => ISSUE[i] ?? i).join(', ')]);
  if (l.note) rows.push(['Note', l.note]);
  if (l.place) rows.push(['Where', PLACE[l.place] ?? l.place]);
  if (l.contact_pref) rows.push(['Contact by', CONTACT[l.contact_pref] ?? l.contact_pref]);
  if (l.pincode) rows.push(['PIN code', l.pincode]);
  if (l.address) rows.push(['Address', l.address]);
  if (l.lat != null && l.lng != null) rows.push(['Map pin', 'https://maps.google.com/?q=' + Number(l.lat).toFixed(5) + ',' + Number(l.lng).toFixed(5)]);
  if (l.ref_code) rows.push(['Referred by', l.ref_code]);
  if (l.coupon_code) rows.push(['Coupon', l.coupon_discount > 0 ? `${l.coupon_code} (₹${Number(l.coupon_discount).toLocaleString('en-IN')} off)` : `${l.coupon_code} (not valid, no discount)`]);
  if (l.campaign) rows.push(['Campaign', l.campaign]);
  return rows;
}

export function sourceReport(leads) {
  const count = (values) => {
    const m = new Map();
    for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  };
  return {
    source: count(leads.map((l) => l.utm?.utm_source || 'direct')),
    campaign: count(leads.map((l) => l.campaign)),
    referrer: count(leads.map((l) => l.ref_code)),
  };
}
