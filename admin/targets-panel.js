// Sales targets panel for the Sales page: team table (today or this week) and, for the owner only, a form to set one person's targets.
// Counts only, never money, so supervisors can read it. The HTML builder is pure (tests/targets.test.mjs); mount() wires loading, empty and error states.
import { teamRows, parseTargetForm, METRICS } from './targets.js';
import { teamTableHtml } from './targets-view.js';
import { skeleton, errorState, emptyState } from './ds.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function targetsPanelHtml(progress, { period = 'day', canSet = false, pick = null } = {}) {
  const team = teamRows(progress, period);
  const picker = `<label class="mt-f"><span>Period</span><select id="tgPeriod" aria-label="Targets period"><option value="day"${period === 'day' ? ' selected' : ''}>Today</option><option value="week"${period === 'week' ? ' selected' : ''}>This week</option></select></label>`;
  const head = `<div class="tg-head"><h3>Sales targets</h3>${picker}</div>`;
  if (!team.length) return `<div class="card sp-card">${head}${emptyState({ title: 'No team members yet.', text: 'Add Crew members in Team, then set their targets here.' })}</div>`;
  const chosen = team.find((t) => t.id === pick) || null;
  const form = !canSet ? '' : `<form class="tg-form" id="tgForm" novalidate aria-label="Set targets">
    <label class="mt-f"><span>Person</span><select id="tgUser" name="user">${team.map((t) => `<option value="${esc(t.id)}"${chosen && chosen.id === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
    <label class="mt-f"><span>Applies to</span><select id="tgFor" name="period"><option value="day"${period === 'day' ? ' selected' : ''}>Every day</option><option value="week"${period === 'week' ? ' selected' : ''}>Every week</option></select></label>
    ${METRICS.map(([k, l]) => { const cur = (chosen || team[0]).rows.find((r) => r.key === k); return `<label class="mt-f"><span>${esc(l)}</span><input name="${k}" type="number" inputmode="numeric" min="0" max="1000" step="1" value="${cur && cur.target != null ? cur.target : ''}" aria-label="${esc(l)} target"></label>`; }).join('')}
    <button type="submit" class="btn primary" id="tgSave">Save targets</button><p class="err" id="tgErr" role="alert"></p></form>`;
  return `<div class="card sp-card">${head}<p class="muted small">Counts only. Days run 9 AM to 7 PM India time, Monday to Saturday. Behind means under 80% of the pace so far.</p>${teamTableHtml(team, canSet)}${form}</div>`;
}

export function createTargetsPanel({ rpc, canSet, toast }) {
  let period = 'day', progress = null, pick = null;
  async function mount(root) {
    if (!root) return;
    root.innerHTML = `<div class="card sp-card">${skeleton(2, 'Loading targets')}</div>`;
    try { progress = await rpc('crm_targets_progress'); draw(root); }
    catch (e) { root.innerHTML = `<div class="card sp-card">${errorState({ title: 'Targets could not load.', detail: String((e && e.message) || e) })}</div>`; root.querySelector('[data-retry]')?.addEventListener('click', () => mount(root)); }
  }
  function draw(root) {
    root.innerHTML = targetsPanelHtml(progress, { period, canSet: canSet(), pick });
    root.querySelector('#tgPeriod')?.addEventListener('change', (e) => { period = e.target.value === 'week' ? 'week' : 'day'; draw(root); });
    root.querySelector('#tgUser')?.addEventListener('change', (e) => { pick = e.target.value; draw(root); });
    root.querySelectorAll('[data-tg-set]').forEach((b) => b.addEventListener('click', () => { pick = b.dataset.tgSet; draw(root); root.querySelector('#tgForm')?.scrollIntoView({ block: 'center' }); }));
    const form = root.querySelector('#tgForm'); if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); const err = root.querySelector('#tgErr'), fd = new FormData(form);
      const v = parseTargetForm(Object.fromEntries(fd.entries())); if (!v.ok) { err.textContent = v.error; return; }
      err.textContent = ''; const btn = root.querySelector('#tgSave'); btn.disabled = true;
      try { await rpc('crm_targets_set', { p_user: fd.get('user'), p_period: fd.get('period'), p_calls: v.values.calls, p_quotes: v.values.quotes_sent, p_paid: v.values.paid_bookings }); pick = fd.get('user'); toast && toast('Targets saved.'); progress = await rpc('crm_targets_progress'); draw(root); }
      catch (x) { err.textContent = 'Could not save: ' + String((x && x.message) || x); btn.disabled = false; }
    });
  }
  return { mount };
}
