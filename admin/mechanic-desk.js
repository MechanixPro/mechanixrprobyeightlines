// The "Mechanic app" card, shared by Crew and the Admin: create a mechanic's private app access, show the link and PIN once, make a new link, reset the PIN,
// revoke or switch on access, and see Available/Busy and the last known location. ONE file: crm/mechanic-desk.js is the source and admin/mechanic-desk.js is an
// identical copy (scripts/sync_shared.sh). No business rules here: every action calls a crm_mechanic_* database function
// (supabase/migrations/20270103000000_mechanic_app.sql), which checks flow_can('manage_technicians') and refuses everyone else.
// The private link and PIN live only inside the one dialog that shows them. They go into no toast, no list, no page and no storage.
import { chip, errorState, skeleton } from './ds.js';
import { pinError, makePin, reasonError } from './garage-desk.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const cleanErr = (e) => String((e && e.message) || e || 'Something went wrong').replace(/^Error:\s*/, '');

/* ---------- pure rules ---------- */
/** Access of one mechanic from crm_mechanic_access_list rows: none, on, locked (clears itself) or revoked. */
export function mechAccessState(rows, now = Date.now()) {
  const list = [...(rows || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const a = list[0] || null;
  const last = list.map((x) => x.last_seen_at || x.last_login_at).filter(Boolean).sort().pop() || null;
  if (!a) return { key: 'none', label: 'No access', tone: '', access: null, last };
  if (!a.active || a.revoked_at) return { key: 'off', label: 'Revoked', tone: 'bad', access: a, last };
  if (a.locked_until && new Date(a.locked_until).getTime() > now) return { key: 'locked', label: 'Locked until ' + when(a.locked_until), tone: 'warn', access: a, last };
  return { key: 'on', label: 'Active', tone: 'good', access: a, last };
}
/** Available / Busy chip from the access row (mechanic availability). null when the mechanic has never said. */
export function availabilityChip(a) {
  const v = String((a && a.availability) || '').toLowerCase();
  if (v === 'available') return { label: 'Available', tone: 'good', at: a.availability_at || null };
  if (v === 'busy') return { label: 'Busy', tone: 'warn', at: a.availability_at || null };
  return null;
}
/** Only a Google Maps link is ever put in an href. */
export const safeMapUrl = (u) => (typeof u === 'string' && /^https:\/\/www\.google\.com\/maps\?q=-?[0-9.]+,-?[0-9.]+$/.test(u) ? u : null);
/** The wa.me link for a message that holds the private link and NEVER the PIN. phone is the mechanic's number (10 digits, or with 91). */
export function waUrl(phone, link) {
  const d = String(phone || '').replace(/\D/g, ''), n = d.length === 10 ? '91' + d : d.length === 12 && d.startsWith('91') ? d : '';
  const text = `Hello, this is your private Mechanix Pro mechanic app link. Open it on your phone and sign in with the PIN I will tell you on a call:\n${link}`;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/** deps: { rpc(name, args), toast(msg, bad), can(action), dialog(opts), copy?(text), open?(url), random?(n), now?(), reload?() } */
export function createMechanicDesk(deps) {
  const { rpc, toast } = deps;
  const visible = () => !!deps.can('manage_technicians');
  const now = () => (deps.now ? deps.now() : Date.now());
  const copy = deps.copy || (async (text) => { try { await globalThis.navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { toast('Copy failed. Select the text and copy it.', true); } });
  const openUrl = deps.open || ((u) => { try { globalThis.open(u, '_blank', 'noopener'); } catch (e) { toast('Could not open WhatsApp.', true); } });
  const S = { root: null, mechanic: null, rows: null, error: null };
  const need = () => { if (!visible()) throw new Error('You do not have permission to manage mechanic app access.'); };
  const after = async () => { if (S.root && S.root.isConnected !== false && S.mechanic) await mountCard(S.root, S.mechanic); };

  /** The link and PIN, once. Held only in this closure. */
  function secretDialog({ title, mechanic, link, pin }) {
    const secrets = { link, pin };
    const both = link && pin;
    const body = `<p class="flow-warn" role="alert"><b>Shown once.</b> This ${both ? 'link and PIN are' : link ? 'link is' : 'PIN is'} not stored anywhere readable. Copy ${both ? 'them' : 'it'} now. Closing this box loses ${both ? 'them' : 'it'}.</p>
      ${link ? `<label class="flow-label">Private link for ${esc(mechanic.name)}</label><p class="flow-box2" data-secret="link">${esc(link)}</p><div class="flow-row"><button class="flow-btn flow-primary" type="button" data-copy="link">Copy link</button><button class="flow-btn" type="button" data-wa="1">Send on WhatsApp</button></div>` : ''}
      ${pin ? `<label class="flow-label">PIN</label><p class="flow-code" data-secret="pin">${esc(pin)}</p><div class="flow-row"><button class="flow-btn flow-primary" type="button" data-copy="pin">Copy PIN</button></div>` : ''}
      <p class="flow-muted">Tell the PIN by phone, not in the same message as the link.</p>`;
    return deps.dialog({ title, intro: esc(mechanic.name), body, onOpen: (f) => {
      f.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(secrets[b.dataset.copy])));
      f.querySelectorAll('[data-wa]').forEach((b) => b.addEventListener('click', () => openUrl(waUrl(mechanic.phone, secrets.link))));
    } });
  }
  function confirmReason({ title, intro, submit, run }) {
    return deps.dialog({ title, intro: `${intro} <br><small>Write why. The server does not keep the reason yet, so note it somewhere you can find it.</small>`,
      body: '<label class="flow-label" for="mx-why">Reason (required)</label><input id="mx-why" name="reason" maxlength="120" autocomplete="off">', submit,
      onSubmit: async (f, d) => { const bad = reasonError(f.reason.value); if (bad) throw new Error(bad); await run(f.reason.value.trim(), d); } });
  }

  const actions = {
    create(m) {
      need(); const pin0 = makePin(deps.random);
      return deps.dialog({ title: 'Create mechanic app access', intro: `${esc(m.name)}. You will see the private link and the PIN once, right after this.`,
        body: `<label class="flow-label" for="mx-pin">PIN (4 to 6 digits)</label><input id="mx-pin" name="pin" inputmode="numeric" maxlength="6" value="${esc(pin0)}" autocomplete="off"><p class="flow-muted">A random PIN is filled in. Change it if you like.</p>`,
        submit: 'Create access', onSubmit: async (f, d) => {
          const pin = f.pin.value.trim(), bad = pinError(pin); if (bad) throw new Error(bad);
          const r = await rpc('crm_mechanic_access_create', { p_mechanic: m.id, p_pin: pin });
          d.close(); toast('Access created.'); secretDialog({ title: 'Private link and PIN', mechanic: m, link: r.link, pin }); await after();
        } });
    },
    pinReset(a, m) {
      need(); const pin0 = makePin(deps.random);
      return deps.dialog({ title: 'Reset the PIN', intro: `${esc(m.name)}. The mechanic is signed out at once and needs the new PIN. The link stays the same.`,
        body: `<label class="flow-label" for="mx-pin">New PIN (4 to 6 digits)</label><input id="mx-pin" name="pin" inputmode="numeric" maxlength="6" value="${esc(pin0)}" autocomplete="off">
          <label class="flow-label" for="mx-why">Reason (required)</label><input id="mx-why" name="reason" maxlength="120" autocomplete="off"><p class="flow-muted">The server does not keep the reason yet, so note it somewhere you can find it.</p>`,
        submit: 'Reset PIN', onSubmit: async (f, d) => {
          const pin = f.pin.value.trim(), bad = pinError(pin) || reasonError(f.reason.value); if (bad) throw new Error(bad);
          await rpc('crm_mechanic_pin_reset', { p_access: a.id, p_pin: pin });
          d.close(); toast('PIN reset.'); secretDialog({ title: 'New PIN', mechanic: m, pin }); await after();
        } });
    },
    newLink(a, m) {
      need();
      return confirmReason({ title: 'Make a new private link', intro: `${esc(m.name)}. The old link stops working at once and the mechanic is signed out. The PIN stays the same.`, submit: 'Make new link',
        run: async (reason, d) => { const r = await rpc('crm_mechanic_link_new', { p_access: a.id }); d.close(); toast('New link made.'); secretDialog({ title: 'New private link', mechanic: m, link: r.link }); await after(); } });
    },
    revoke(a, m) {
      need();
      return confirmReason({ title: 'Revoke access', intro: `${esc(m.name)} is signed out at once and cannot open the app until you switch it on again.`, submit: 'Revoke access',
        run: async (reason, d) => { await rpc('crm_mechanic_revoke', { p_access: a.id }); d.close(); toast('Access revoked.'); await after(); } });
    },
    enable(a, m) {
      need();
      return deps.dialog({ title: 'Switch access on again', intro: `${esc(m.name)} can open the app again with the same link and PIN.`, submit: 'Switch on',
        onSubmit: async (f, d) => { await rpc('crm_mechanic_enable', { p_access: a.id }); d.close(); toast('Access switched on.'); await after(); } });
    },
  };

  /* ---------- the card ---------- */
  function cardHtml(m, rows) {
    const ac = mechAccessState(rows, now()), a = ac.access, av = a ? availabilityChip(a) : null, map = a ? safeMapUrl(a.map_url) : null;
    const btn = (act, label, cls = '') => `<button class="flow-btn ${cls}" type="button" data-mx="${act}">${label}</button>`;
    const row = ac.key === 'none' ? [btn('create', 'Create access', 'flow-primary')] : ac.key === 'off' ? [btn('enable', 'Switch on', 'flow-primary')] : [btn('newLink', 'New link'), btn('pinReset', 'Reset PIN'), btn('revoke', 'Revoke', 'flow-ghost')];
    if (ac.key === 'locked') row.unshift(btn('enable', 'Switch on', 'flow-primary'));
    return `<section class="gd mx" aria-label="Mechanic app"><h4>Mechanic app</h4>
      <div>${chip(ac.label, ac.tone)} ${av ? chip(av.label, av.tone) : ''}</div>
      <div class="flow-muted">${ac.last ? 'Last seen ' + esc(when(ac.last)) : a ? 'Has not opened the app yet' : 'This mechanic has no private app access yet.'}${av && av.at ? ' · ' + esc(av.label) + ' since ' + esc(when(av.at)) : ''}</div>
      ${map ? `<div><a href="${esc(map)}" target="_blank" rel="noopener">Last known location</a>${a.last_loc_at ? ` <span class="flow-muted">(${esc(when(a.last_loc_at))})</span>` : ''}</div>` : a ? '<div class="flow-muted">No location shared yet.</div>' : ''}
      <div class="flow-row">${row.join('')}</div></section>`;
  }
  const bound = new WeakSet();
  function bind(root) {
    if (bound.has(root)) return; bound.add(root);
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-mx]'); if (!b || b.dataset.busy) return; b.dataset.busy = '1';
      const m = S.mechanic, a = mechAccessState(S.rows, now()).access;
      try {
        switch (b.dataset.mx) {
          case 'retry': await mountCard(root, m); break;
          case 'create': await actions.create(m); break;
          case 'newLink': await actions.newLink(a, m); break;
          case 'pinReset': await actions.pinReset(a, m); break;
          case 'revoke': await actions.revoke(a, m); break;
          case 'enable': await actions.enable(a, m); break;
          default: break;
        }
      } catch (x) { console.error('mechanic desk', b.dataset.mx, x); toast('That did not work: ' + cleanErr(x), true); } finally { delete b.dataset.busy; }
    });
  }
  /** Draw the card for mechanic m ({ id, name, phone }) into root. Someone without the permission gets no data call and no card. */
  async function mountCard(root, m) {
    S.root = root; S.mechanic = m; S.rows = null; bind(root);
    if (!visible()) { root.innerHTML = ''; return; }
    root.innerHTML = skeleton();
    try { S.rows = await rpc('crm_mechanic_access_list', { p_mechanic: m.id }); root.innerHTML = cardHtml(m, S.rows); }
    catch (x) { root.innerHTML = errorState({ title: 'Could not load the mechanic app card', detail: 'That did not work: ' + cleanErr(x), retry: { label: 'Retry', attr: 'data-mx="retry"' } }); }
  }
  /** Open the card in a dialog (Crew's mechanics list). */
  function openCard(m) {
    need();
    return deps.dialog({ title: 'Mechanic app', intro: esc(m.name), body: '<div data-mx-root></div>', onOpen: (f) => { const r = f.querySelector('[data-mx-root]'); if (r) mountCard(r, m); } });
  }
  return { visible, mountCard, openCard, cardHtml, actions, secretDialog, state: S };
}
