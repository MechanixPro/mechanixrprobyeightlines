// Crew WhatsApp inbox (Cloud number +91 83106 21498): tabs Unread, Mine, Unassigned, Waiting on us, Closed; search; thread on the right (full screen on a phone).
// Mirrored for Admin only through wa-thread.js; this list is Crew-only. Polls every 15 s while the tab is visible.
import { esc, TABS, failText } from './wa-rules.js';
import { createWaThread, tabsHtml, listHtml, LOADING, errorBox } from './wa-thread.js';

export const inboxShell = () => `<div class="wa-wrap"><section class="wa-list-pane" aria-label="Conversations"><div id="waTabs"></div>
  <div class="wa-search"><input type="search" id="waQ" placeholder="Search name, phone, booking ID" aria-label="Search conversations" autocomplete="off"></div>
  <div id="waList" aria-live="polite">${LOADING}</div></section>
  <section class="wa-thread-pane" id="waThread" aria-label="Conversation"><div class="empty">Pick a conversation.</div></section></div>`;

/** deps: { sb, url, anonKey, rpc, toast, openLead } */
export function mountWaInbox(root, deps) {
  root.innerHTML = inboxShell();
  const S = { tab: 'unread', q: '', rows: [], counts: null, phone: null, timer: null, token: 0 };
  const $ = (s) => root.querySelector(s);
  const thread = createWaThread({ ...deps, onChange: () => refresh(true) });
  const showThread = (on) => root.querySelector('.wa-wrap').classList.toggle('thread-open', on);

  async function refresh(quiet) {
    const my = ++S.token;
    try {
      const d = await deps.rpc('crm_wa_inbox', { p_filter: S.tab, p_q: S.q || null, p_limit: 100 });
      if (my !== S.token || !root.isConnected) return;
      S.rows = d.rows || []; S.counts = d.counts || {};
      $('#waTabs').innerHTML = tabsHtml(S.counts, S.tab);
      $('#waList').innerHTML = listHtml(S.rows, S.phone) + (S.rows.length >= 100 ? '<p class="muted small">Showing the latest 100. Use search to find older chats.</p>' : '');
      const bb = document.querySelector('#inBadge'); if (bb && S.counts.unread != null) { bb.textContent = S.counts.unread; bb.hidden = !S.counts.unread; }
    } catch (e) { if (my !== S.token) return; if (quiet && S.rows.length) deps.toast(failText(e), true); else $('#waList').innerHTML = errorBox(e, 'reload'); }
  }
  root.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-wa-tab]'); if (t) { S.tab = t.dataset.waTab; $('#waList').innerHTML = LOADING; return refresh(); }
    if (ev.target.closest('[data-wa=reload]')) { $('#waList').innerHTML = LOADING; return refresh(); }
    const r = ev.target.closest('.wa-row'); if (r) { S.phone = r.dataset.phone; $('#waList').innerHTML = listHtml(S.rows, S.phone); showThread(true); thread.open($('#waThread'), S.phone); return; }
    if (ev.target.closest('[data-wa-back]')) { showThread(false); }
  });
  let st; $('#waQ').addEventListener('input', (e) => { clearTimeout(st); st = setTimeout(() => { S.q = e.target.value.trim(); refresh(); }, 300); });
  S.timer = setInterval(() => { if (!root.isConnected) { clearInterval(S.timer); thread.close(); return; } if (document.visibilityState === 'visible') refresh(true); }, 15000);
  refresh();
  return { refresh, destroy() { clearInterval(S.timer); thread.close(); } };
}
