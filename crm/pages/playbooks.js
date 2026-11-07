import { esc, head, toast } from '../ui.js';
import { emptyState } from '../ds.js';
import { waUrl } from '../crm-rules.js';
import { KINDS, searchPlaybooks, findPlaybook, fill, placeholders } from '../playbooks.js';

// Playbooks: call scripts, SOP checklists and WhatsApp replies. Static text, nothing is saved. Ticks and typed fields stay on this screen only.
const st = { kind: 'script', q: '', open: null, ticks: {}, vars: { name: '', service: '', amount: '', time: '' }, phone: '' };
const FIELDS = [['name', 'Customer name'], ['service', 'Service'], ['amount', 'Amount'], ['time', 'Time']];

export async function copyText(text, nav = globalThis.navigator, doc = globalThis.document) {
  try { if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(text); return true; } } catch { /* fall through */ }
  try {
    const ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    doc.body.appendChild(ta); ta.select(); const ok = doc.execCommand('copy'); ta.remove(); return !!ok;
  } catch { return false; }
}

export async function render(root) { draw(root); }

function draw(root) {
  const open = st.open && findPlaybook(st.open);
  const tabs = KINDS.map(([k, t]) => `<button type="button" role="tab" class="pb-tab${k === st.kind ? ' on' : ''}" data-pb-tab="${k}" aria-selected="${k === st.kind}">${esc(t)}</button>`).join('');
  let main;
  if (open && open.kind === st.kind) main = detail(open);
  else {
    const list = searchPlaybooks(st.kind, st.q);
    main = `<input type="search" class="pb-search" id="pb-q" placeholder="Search" aria-label="Search playbooks" value="${esc(st.q)}" autocomplete="off">` +
      (list.length ? list.map((p) => `<button type="button" class="pb-card" data-pb-open="${esc(p.id)}"><b>${esc(p.title)}</b><span class="muted">${esc(p.when || p.text.slice(0, 90))}</span></button>`).join('') : emptyState({ title: 'Nothing matches that search.', text: 'Try a shorter word.' }));
  }
  root.innerHTML = head('Playbooks', 'Call scripts, checklists and WhatsApp replies. Ticks are not saved.') + `<div class="tabs pb-tabs" role="tablist">${tabs}</div><div class="pb-main">${main}</div>`;
  const q = root.querySelector('#pb-q');
  if (q) q.oninput = () => { st.q = q.value; const pos = q.selectionStart; draw(root); const n = root.querySelector('#pb-q'); n.focus(); n.setSelectionRange(pos, pos); };
  root.onclick = async (e) => {
    const t = e.target.closest('[data-pb-tab]'); if (t) { st.kind = t.dataset.pbTab; st.open = null; st.q = ''; return draw(root); }
    const o = e.target.closest('[data-pb-open]'); if (o) { st.open = o.dataset.pbOpen; return draw(root); }
    if (e.target.closest('[data-pb-back]')) { st.open = null; return draw(root); }
    if (e.target.closest('[data-pb-reset]')) { delete st.ticks[st.open]; return draw(root); }
    if (e.target.closest('[data-pb-copy]')) { const ok = await copyText(root.querySelector('#pb-text').value); return toast(ok ? 'Copied.' : 'Could not copy. Select the text and copy it.', !ok); }
  };
  root.onchange = (e) => { const c = e.target.closest('[data-pb-step]'); if (c) { const a = (st.ticks[st.open] ||= {}); a[c.dataset.pbStep] = c.checked; const n = Object.values(a).filter(Boolean).length, tot = findPlaybook(st.open).steps.length; const p = root.querySelector('.pb-progress'); if (p) p.textContent = `${n} of ${tot} done`; } };
  root.oninput = (e) => {
    const f = e.target.closest('[data-pb-var]');
    if (f) { st.vars[f.dataset.pbVar] = f.value; refreshReply(root); }
    else if (e.target.id === 'pb-phone') { st.phone = e.target.value; refreshReply(root); }
  };
  const stepsDone = open && open.steps ? Object.values(st.ticks[open.id] || {}).filter(Boolean).length : 0; void stepsDone;
}

function detail(p) {
  const back = '<button type="button" class="btn" data-pb-back>Back to list</button>';
  if (p.kind === 'reply') {
    const fields = FIELDS.map(([k, l]) => `<label class="pb-f">${esc(l)}<input type="text" data-pb-var="${k}" value="${esc(st.vars[k])}" autocomplete="off"></label>`).join('');
    return `<div class="pb-open"><div class="pb-bar">${back}</div><h2>${esc(p.title)}</h2><div class="pb-fields">${fields}</div>
      <label class="pb-f">Message (you can edit it)<textarea id="pb-text" rows="6" data-base="${esc(p.text)}">${esc(fill(p.text, st.vars))}</textarea></label>
      <label class="pb-f">Customer phone (optional, for WhatsApp)<input type="tel" id="pb-phone" inputmode="numeric" value="${esc(st.phone)}" autocomplete="off"></label>
      <div class="pb-act"><button type="button" class="btn primary" data-pb-copy>Copy</button><span id="pb-wa">${waLink(fill(p.text, st.vars))}</span></div>
      <p class="small muted" id="pb-left">${leftNote(fill(p.text, st.vars))}</p></div>`;
  }
  const t = st.ticks[p.id] || {}, n = p.steps.filter((_, i) => t[i]).length;
  return `<div class="pb-open"><div class="pb-bar">${back}<button type="button" class="btn" data-pb-reset>Clear ticks</button></div><h2>${esc(p.title)}</h2><p class="muted">${esc(p.when || '')}</p>
    <p class="pb-progress small" aria-live="polite">${n} of ${p.steps.length} done</p>
    <ol class="pb-steps">${p.steps.map((s, i) => `<li><label class="pb-step"><input type="checkbox" data-pb-step="${i}"${t[i] ? ' checked' : ''}><span>${esc(s)}</span></label></li>`).join('')}</ol></div>`;
}

const phoneOk = (v) => String(v).replace(/\D/g, '').length >= 10;
const waLink = (text) => (phoneOk(st.phone) ? `<a class="btn" id="pb-wa-link" target="_blank" rel="noopener" href="${esc(waUrl(st.phone, text))}">Open WhatsApp</a>` : '');
const leftNote = (text) => { const l = placeholders(text); return l.length ? 'Still to fill: ' + l.map((x) => '{' + esc(x) + '}').join(', ') : 'Ready to send.'; };

function refreshReply(root) {
  const ta = root.querySelector('#pb-text'); if (!ta) return;
  const text = fill(ta.dataset.base, st.vars);
  ta.value = text;
  root.querySelector('#pb-wa').innerHTML = waLink(text);
  root.querySelector('#pb-left').textContent = leftNote(text).replace(/&#39;/g, "'");
}
