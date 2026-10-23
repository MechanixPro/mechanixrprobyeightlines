import { rpc, esc, modal, field, toast, rupee, SLOTS, clean } from '../ui.js';

let catalog = null;
const getCatalog = async () => (catalog ||= await rpc('crm_booking_catalog'));
const SOURCES = [['phone', 'Phone call'], ['whatsapp', 'WhatsApp'], ['walk_in', 'Walk in'], ['instagram', 'Meta (Instagram)'], ['website', 'Website']];

/** Create a booking. It becomes the same lead the admin sees: customer, bike, service, add-ons, slot, address and quote. */
/** The package price for an engine class, from the catalog the database sends. 150 to 250cc use the second price; above 250cc adds the surcharge. */
export const ENGINES = [['std', 'Up to 149cc'], ['mid', '150 to 250cc'], ['big', 'Above 250cc (adds the surcharge)']];
export function packagePrice(cat, s, engine) {
  const tier = engine === 'mid' || engine === 'big' ? (cat.tiers || {})[s.id] : null;
  return (tier ?? s.price) + (engine === 'big' && ['basic', 'general', 'full'].includes(s.id) ? Number(cat.big_fee || 0) : 0);
}
export async function newBooking(ctx, pre = {}) {
  let cat; try { cat = await getCatalog(); } catch (e) { return toast(clean(e), true); }
  const today = new Date().toISOString().slice(0, 10);
  const body = `<div class="grid2">${field('Customer name', 'name', { required: true, value: pre.name, half: true })}${field('Mobile number', 'phone', { type: 'tel', inputmode: 'tel', required: true, value: pre.phone, placeholder: '10 digits', half: true })}
    ${field('PIN code', 'pincode', { inputmode: 'numeric', required: true, hint: 'Must be inside the Bengaluru service area.', half: true })}${field('Area', 'area', { half: true })}</div>
    ${field('Address', 'address', { type: 'textarea', rows: 2, max: 200 })}
    <div class="grid2">${field('Bike brand', 'brand', { half: true })}${field('Bike model', 'model', { half: true })}${field('Registration number', 'reg_no', { placeholder: 'KA01AB1234', half: true })}
    ${field('Where is the job?', 'job_place', { type: 'select', blank: false, options: [['doorstep', 'At the customer'], ['garage', 'At a garage']], half: true })}</div>
    ${Object.keys(cat.tiers || {}).length ? field('Engine size', 'engine_class', { type: 'select', blank: false, options: ENGINES, hint: 'Bikes of 150 to 250cc have their own package prices.' }) : ''}
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
      if (r.duplicate) { toast('This customer already has an open booking. Opening it.'); } else { toast(`Booking ${r.ref} created.` + (r.coupon_discount ? ` Coupon saved ${rupee(r.coupon_discount)}.` : '')); }
      ctx.reload(); ctx.openLead(r.id);
    } });
  return m;
}

/** Edit the parts of a booking an agent may change. The service of a confirmed booking is changed in the admin. */
export async function editBooking(ctx, lead) {
  const confirmed = ['paid', 'scheduled', 'completed'].includes(lead.status);
  let cat = null; if (!confirmed) { try { cat = await getCatalog(); } catch (e) { cat = null; } }
  const body = `${cat && Object.keys(cat.tiers || {}).length ? field('Engine size', 'engine_class', { type: 'select', blank: 'Keep the bike\'s engine size', options: ENGINES }) : ''}${cat ? field('Service', 'service_id', { type: 'select', blank: false, value: lead.service_id, options: cat.services.map((s) => [s.id, `${s.name} from ${rupee(s.price)}`]) }) + (cat.addons.length ? field('Add-ons', 'addons', { type: 'checks', value: lead.addons || [], options: cat.addons.map((a) => [a.id, `${a.name} · ${rupee(a.price)}`]) }) : '') : '<p class="small muted">The service of a confirmed booking is changed in the admin.</p>'}
    <div class="grid2">${field('Preferred date', 'preferred_date', { type: 'date', value: lead.preferred_date || '', half: true })}${field('Time slot', 'preferred_slot', { type: 'select', options: SLOTS, value: lead.preferred_slot, half: true })}
    ${field('PIN code', 'pincode', { inputmode: 'numeric', value: lead.pincode, half: true })}${field('Area', 'area', { value: lead.area, half: true })}</div>
    ${field('Address', 'address', { type: 'textarea', rows: 2, max: 200, value: lead.address })}${field('Requirements and notes', 'notes', { type: 'textarea', rows: 3, value: lead.notes })}`;
  modal({ title: `Edit booking ${lead.ref}`, intro: 'Changes show in the admin straight away and are written to the history.', body, submit: 'Save changes', wide: true,
    onSubmit: async (form, d, close) => {
      const p = { preferred_date: d.preferred_date, preferred_slot: d.preferred_slot, pincode: d.pincode, area: d.area, address: d.address, notes: d.notes };
      if (cat) { p.service_id = d.service_id; p.addons = d.addons || []; if (d.engine_class) p.engine_class = d.engine_class; }
      const r = await rpc('crm_update_booking', { p_id: lead.id, p: p, p_expected: lead.updated_at });
      close(); toast(r.changes.length ? 'Saved: ' + r.changes.join(', ') : 'Nothing changed.'); ctx.reload(); ctx.openLead(lead.id);
    } });
}
