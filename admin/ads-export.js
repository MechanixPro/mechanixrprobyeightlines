// admin/ads-export.js — completed jobs that came from a Google ad click, as a file for Google Ads "offline conversions"
// (no DOM, no Supabase, so it can be tested in Node). Google then learns which clicks became real customers.
const GCLID = /^[A-Za-z0-9_-]{20,}$/;
const DAY = 86400000;
const ist = (iso) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
};

export function adsConversions(leads, { now = new Date(), name = 'Completed job' } = {}) {
  const skipped = { notCompleted: 0, noClick: 0, tooOld: 0, duplicate: 0, test: 0 };
  const seen = new Set(), rows = [];
  for (const l of leads || []) {
    if (l.status !== 'completed') { skipped.notCompleted++; continue; }
    const g = String(l.utm?.gclid ?? '').trim();
    if (!GCLID.test(g)) { skipped.noClick++; continue; }
    if (/^TEST/i.test(g)) { skipped.test++; continue; }
    if (now.getTime() - new Date(l.created_at).getTime() > 90 * DAY) { skipped.tooOld++; continue; } // Google accepts clicks up to 90 days old
    if (seen.has(g)) { skipped.duplicate++; continue; }
    seen.add(g);
    const when = l.completed_at || l.updated_at || l.created_at;
    const value = Number(l.paid_amount) > 0 ? Number(l.paid_amount) : Number(l.est_total) > 0 ? Number(l.est_total) : 1;
    rows.push({ gclid: g, name, time: ist(when), value, currency: 'INR', ref: l.ref });
  }
  rows.sort((a, b) => a.time.localeCompare(b.time));
  const csv = ['Parameters:TimeZone=Asia/Kolkata', 'Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency']
    .concat(rows.map((r) => [r.gclid, r.name, r.time, r.value, r.currency].join(','))).join('\n') + '\n';
  return { rows, skipped, csv };
}
