import { rpc, esc, modal, field } from '../ui.js';
import { nearestByPin } from '../crm-rules.js';

/** Find by PIN: the technicians who cover a PIN code, then the nearest by distance, and the nearest garages. Uses today's board for job counts. */
export function findByPin() {
  modal({ title: 'Find by PIN', intro: 'Type a 6-digit PIN code to see who covers it and who is nearest.', submit: 'Find',
    body: `${field('PIN code', 'pin', { inputmode: 'numeric', required: true, max: 6, placeholder: '560068' })}<div id="pinOut" aria-live="polite"></div>`,
    onSubmit: async (form, d) => {
      const out = form.querySelector('#pinOut');
      const [board, garages] = await Promise.all([rpc('crm_tech_board', { p_date: null }), rpc('crm_garage_picker').catch(() => [])]);
      const r = nearestByPin(d.pin, board.techs, garages, window.MXP_PIN_GEO || {});
      const dist = (km) => (km == null ? '' : ' · ' + km + ' km');
      out.innerHTML = `${r.pinKnown ? '' : '<p class="small muted">This PIN has no map point yet, so distances are not shown.</p>'}
        <h3>Technicians</h3>${r.techs.length ? `<ul class="timeline">${r.techs.map((t) => `<li><b>${esc(t.name)}</b>${t.area ? ' · ' + esc(t.area) : ''}${t.covers ? ' · <span class="goodtxt">covers ' + esc(d.pin) + '</span>' : ''}${dist(t.km)} · ${t.jobs ? t.jobs + (t.jobs === 1 ? ' job' : ' jobs') + ' today' : 'free today'}</li>`).join('')}</ul>` : '<p class="muted small">No live technicians yet.</p>'}
        <h3>Garages</h3>${r.garages.length ? `<ul class="timeline">${r.garages.map((g) => `<li><b>${esc(g.name)}</b> · ${esc(g.pincode)}${dist(g.km)}</li>`).join('')}</ul>` : '<p class="muted small">No garages near this PIN yet.</p>'}`;
    } });
}
