import { rpc, esc, modal, field, toast, rupee, SLOTS, clean } from '../ui.js';
import { rankTechs } from '../crm-rules.js';

let catalog = null;
const getCatalog = async () => (catalog ||= await rpc('crm_booking_catalog'));
const SOURCES = [['phone', 'Phone call'], ['whatsapp', 'WhatsApp'], ['walk_in', 'Walk in'], ['instagram', 'Meta (Instagram)'], ['website', 'Website']];

/** Create a booking. It becomes the same lead the admin sees: customer, bike, service, add-ons, slot, address and quote. */
/** The package price for an engine class, from the catalog the database sends. 150 to 250cc and 251 to 500cc have their own prices. Without 251-500cc prices, the large class is the 150-250cc price plus the old surcharge (big_fee). */
export const ENGINES = [['std', 'Up to 149cc'], ['mid', '150 to 250cc'], ['big', '251 to 500cc']];
export function packagePrice(cat, s, engine) {
  const t = cat.tiers || {}, mid = (t.mid || {})[s.id], big = (t.big || {})[s.id];
  if (engine === 'mid') return mid ?? s.price;
  if (engine === 'big') return big ?? ((mid ?? s.price) + (['basic', 'general', 'full'].includes(s.id) ? Number(cat.big_fee || 0) : 0));
  return s.price;
}
export async function newBooking(ctx, pre = {}) {
  let cat; try { cat = await getCatalog(); } catch (e) { return toast(clean(e), true); }
  const today = new Date().toISOString().slice(0, 10);
  const body = `<div class="grid2">${field('Customer name', 'name', { required: true, value: pre.name, half: true })}${field('Mobile number', 'phone', { type: 'tel', inputmode: 'tel', required: true, value: pre.phone, placeholder: '10 digits', half: true })}
    ${field('PIN code', 'pincode', { inputmode: 'numeric', required: true, hint: 'Must be inside the Bengaluru service area.', half: true })}${field('Area', 'area', { half: true })}</div>
    ${field('Address', 'address', { type: 'textarea', rows: 2, max: 200 })}
    <div class="grid2">${field('Bike brand', 'brand', { half: true })}${field('Bike model', 'model', { half: true })}${field('Registration number', 'reg_no', { placeholder: 'KA01AB1234', half: true })}
    ${field('Where is the job?', 'job_place', { type: 'select', blank: false, options: [['doorstep', 'At the customer'], ['garage', 'At a garage']], half: true })}</div>
    ${Object.keys((cat.tiers || {}).mid || {}).length ? field('Engine size', 'engine_class', { type: 'select', blank: false, options: ENGINES, hint: 'Bikes of 150 to 250cc have their own package prices.' }) : ''}
    ${field('Service', 'service_id', { type: 'select', required: true, options: cat.services.map((s) => [s.id, `${s.name} from ${rupee(s.price)}`]) })}
    ${cat.addons.length ? field('Add-ons', 'addons', { type: 'checks', options: cat.addons.map((a) => [a.id, `${a.name} · ${rupee(a.price)}`]) }) : ''}
    <div class="grid2">${field('Preferred date', 'preferred_date', { type: 'date', min: today, half: true })}${field('Time slot', 'preferred_slot', { type: 'select', options: SLOTS, half: true })}
    ${field('Where did it come from?', 'source', { type: 'select', blank: false, options: SOURCES, value: pre.source || 'phone', half: true })}${field('Coupon code', 'coupon_code', { half: true })}</div>
    ${field('Requirements and notes', 'notes', { type: 'textarea', rows: 3, hint: 'What the customer asked for. Never write Aadhaar, PAN, bank or card numbers.' })}
    <p class="quote" id="quote" aria-live="polite"></p>`;
  const m = modal({ title: 'New booking', intro: 'This creates the booking in the admin too. Check the quote before you save.', body, submit: 'Create booking', wide: true,
    onOpen: (form) => {
      const total = () => {
        const s = cat.services.find((x) => x.id === form.service_id.value); if (!s) { form.querySelector('#quote').textContent = ''; return; }
        const adds = [...form.querySelectorAll('[name=addons]:checked')].map((c) => cat.addons.find((a) => a.id === c.value)).filter(Boolean);
        form.querySelector('#quote').textContent = 'Quote: ' + rupee(packagePrice(cat, s, form.engine_class ? form.engine_class.value : 'std') + adds.reduce((n, a) => n + a.price, 0)) + (form.coupon_code.value ? ' before the coupon. The coupon is checked when you save.' : '');
      };
      form.addEventListener('change', total); total();
    },
    onSubmit: async (form, d, close) => {
      const r = await rpc('crm_create_booking', { p: { ...d, addons: d.addons || [] } });
      close();
      if (r.duplicate) { toast('This customer already has an open booking. Opening it.'); } else { toast('Lead created. Confirm the booking when it is agreed.' + (r.coupon_discount ? ` Coupon saved ${rupee(r.coupon_discount)}.` : '')); }
      ctx.reload(); ctx.openLead(r.id);
    } });
  return m;
}

/** Edit the parts of a booking an agent may change. The service of a confirmed booking is changed in the admin. */
export async function editBooking(ctx, lead) {
  const confirmed = ['paid', 'scheduled', 'completed'].includes(lead.status);
  let cat = null; if (!confirmed) { try { cat = await getCatalog(); } catch (e) { cat = null; } }
  // Only people who may assign leads may set the technician; the database checks this too.
  // The board for the booking's day ranks them: free in the slot first, then those who cover the PIN code. Without a date, the plain list is used.
  let techs = [];
  if (ctx.can('assign_leads') || ctx.can('manage_technicians')) {
    try { techs = rankTechs((await rpc('crm_tech_board', { p_date: lead.preferred_date || null })).techs, lead); }
    catch (e) { try { techs = (await rpc('crm_mechanic_picker')).map((t) => ({ id: t.id, name: t.name, label: t.name + (t.area ? ' · ' + t.area : '') })); } catch (e2) { techs = []; } }
  }
  if (lead.mechanic_id && !techs.some((t) => t.id === lead.mechanic_id)) techs = [{ id: lead.mechanic_id, name: lead.mechanic_name || 'Current technician', label: lead.mechanic_name || 'Current technician' }, ...techs];
  const body = `${techs.length ? field('Technician', 'mechanic_id', { type: 'select', blank: 'Not assigned', value: lead.mechanic_id || '', options: techs.map((t) => [t.id, t.label]), hint: (lead.preferred_date ? 'Free in this slot and covering this PIN code come first. ' : 'Set the date to see who is free. ') + 'Send them the job on WhatsApp from the booking after saving.' }) : ''}
    ${field('Bike (brand and model)', 'bike_name', { value: lead.bike || '', max: 80 })}
    ${cat && Object.keys((cat.tiers || {}).mid || {}).length ? field('Engine size', 'engine_class', { type: 'select', blank: 'Keep the bike\'s engine size', options: ENGINES }) : ''}${cat ? field('Service', 'service_id', { type: 'select', blank: false, value: lead.service_id, options: cat.services.map((s) => [s.id, `${s.name} from ${rupee(s.price)}`]) }) + (cat.addons.length ? field('Add-ons', 'addons', { type: 'checks', value: lead.addons || [], options: cat.addons.map((a) => [a.id, `${a.name} · ${rupee(a.price)}`]) }) : '') : '<p class="small muted">The service of a confirmed booking is changed in the admin.</p>'}
    <div class="grid2">${field('Preferred date', 'preferred_date', { type: 'date', value: lead.preferred_date || '', half: true })}${field('Time slot', 'preferred_slot', { type: 'select', options: SLOTS, value: lead.preferred_slot, half: true })}
    ${field('PIN code', 'pincode', { inputmode: 'numeric', value: lead.pincode, half: true })}${field('Area', 'area', { value: lead.area, half: true })}</div>
    ${field('Address', 'address', { type: 'textarea', rows: 2, max: 200, value: lead.address })}${field('Requirements and notes', 'notes', { type: 'textarea', rows: 3, value: lead.notes })}`;
  modal({ title: lead.booking_id ? `Edit booking ${lead.booking_id}` : `Edit ${lead.name}`, intro: 'Changes show in the admin straight away and are written to the history.', body, submit: 'Save changes', wide: true,
    onSubmit: async (form, d, close) => {
      // Send only what the agent changed. The database checks every field it receives (a PIN must be in the service area, a date cannot be in the past),
      // so sending untouched blanks or an old date made a simple bike edit fail on leads that never had a PIN.
      const cur = { preferred_date: lead.preferred_date || '', preferred_slot: lead.preferred_slot || '', pincode: lead.pincode || '', area: lead.area || '', address: lead.address || '', notes: lead.notes || '' };
      const p = {};
      for (const k of Object.keys(cur)) { const v = String(d[k] ?? '').trim(); if (v !== String(cur[k]).trim() && !(k === 'pincode' && !v)) p[k] = d[k]; }
      const bikeNew = (d.bike_name || '').trim().replace(/\s+/g, ' ');
      if (bikeNew && bikeNew !== (lead.bike || '').trim()) { const i = bikeNew.indexOf(' '); p.brand = i < 0 ? bikeNew : bikeNew.slice(0, i); p.model = i < 0 ? null : bikeNew.slice(i + 1); }
      if (techs.length && (d.mechanic_id || '') !== (lead.mechanic_id || '')) p.mechanic_id = d.mechanic_id || '';
      if (cat) {
        const adds = (d.addons || []).slice().sort().join(','), had = (lead.addons || []).slice().sort().join(',');
        if (d.service_id !== lead.service_id || adds !== had || d.engine_class) { p.service_id = d.service_id; p.addons = d.addons || []; if (d.engine_class) p.engine_class = d.engine_class; }
      }
      if (!Object.keys(p).length) { close(); toast('Nothing changed.'); return; }
      // The lead's own clock moves on its own while the sheet is open (the WhatsApp chat check stamps the customer's last message every few seconds),
      // so take the current version just before saving instead of the one loaded when the sheet opened. Only the changed fields are sent.
      const fresh = await rpc('crm_lead', { p_id: lead.id });
      const r = await rpc('crm_update_booking', { p_id: lead.id, p: p, p_expected: fresh.lead.updated_at });
      close(); toast(r.changes.length ? 'Saved: ' + r.changes.join(', ') : 'Nothing changed.'); ctx.reload(); ctx.openLead(lead.id);
    } });
}
