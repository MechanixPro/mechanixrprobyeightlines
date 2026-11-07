// Import leads panel for the Admin Sales page (owner only): paste or pick a .csv, preview counts and the first rows, confirm, then one RPC call.
// Rules live in import-leads.js (shared with Crew). The HTML builders are pure (tests/import-panel.test.mjs); mount() wires the states.
import { parseCsv, validateRows, normPhone10, MAX_ROWS } from './import-leads.js';
import { skeleton, errorState } from './ds.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const MISSING_MSG = 'Import is not available yet. The database update has not been applied.';
export const isMissingRpc = (e) => { const m = String((e && (e.message || e.details || e)) || ''), c = String((e && e.code) || ''); return c === 'PGRST202' || c === '42883' || /could not find the function|does not exist|schema cache/i.test(m); };

// Set of 10-digit phones the Admin already holds (leads and customers).
export function phoneSet(...lists) { const s = new Set(); for (const l of lists) for (const r of (l || [])) { const p = normPhone10(r && r.phone); if (p) s.add(p); } return s; }

export function previewHtml(rows, res) {
  const nV = res.valid.length, nD = res.duplicates.length, nI = res.invalid.length;
  const reasons = [...res.invalid.map((x) => ({ ...x, kind: 'Invalid' })), ...res.duplicates.map((x) => ({ ...x, kind: 'Duplicate' }))].sort((a, b) => a.row - b.row);
  const first = res.valid.slice(0, 20).map((v) => `<tr><td>${esc(v.name)}</td><td class="ip-ph">${esc(v.phone)}</td><td>${esc(v.source || 'phone')}</td><td>Ready</td></tr>`);
  const bad = reasons.slice(0, Math.max(0, 20 - first.length)).map((x) => `<tr><td>Row ${esc(x.row)}</td><td colspan="3">${esc(x.kind)}: ${esc(x.reason)}</td></tr>`);
  const warn = (res.warnings || []).map((w) => `<p class="ip-warn" role="status">${esc(w)}</p>`).join('');
  const many = res.tooMany ? `<p class="ip-warn" role="alert">This file has more than ${MAX_ROWS} rows. Split it and import ${MAX_ROWS} or fewer at a time.</p>` : '';
  const table = (first.length + bad.length) ? `<div class="ip-scroll"><table class="ip-table"><thead><tr><th>Name</th><th>Phone</th><th>Source</th><th>Result</th></tr></thead><tbody>${first.join('')}${bad.join('')}</tbody></table></div><p class="small muted">Showing up to 20 rows.</p>` : '<p class="muted">No rows found. Check the first line has column names such as name and phone.</p>';
  const go = `<button class="btn btn-primary" type="button" data-ip="go"${nV && !res.tooMany ? '' : ' disabled'}>Import ${nV} lead${nV === 1 ? '' : 's'}</button>`;
  return `<div class="ip-counts"><span class="pill p-ok"><b>${nV}</b> valid</span><span class="pill"><b>${nD}</b> duplicates</span><span class="pill p-bad"><b>${nI}</b> invalid</span></div>${many}${warn}${table}<div class="ip-actions">${go}</div>`;
}

export function panelShellHtml() {
  return `<div class="card ip-card"><p class="muted small">Columns: name, phone, source, note. Up to ${MAX_ROWS} rows. Phones already on a lead or customer are skipped. Unknown sources are saved as phone. Sensitive columns are never imported.</p>
  <label class="label" for="ipText">Paste CSV</label><textarea id="ipText" class="ip-text" rows="6" placeholder="name,phone,source,note" spellcheck="false"></textarea>
  <div class="ip-actions"><label class="btn btn-ghost ip-file" for="ipFile">Choose .csv file</label><input id="ipFile" class="ip-file-in" type="file" accept=".csv,text/csv,text/plain" aria-label="Choose a CSV file"><button class="btn btn-primary" type="button" data-ip="preview">Preview</button></div>
  <div id="ipOut" aria-live="polite"></div></div>`;
}

export function createImportPanel({ rpc, canImport, phones, dialog, toast }) {
  let res = null;
  async function mount(root) {
    if (!root) return;
    if (!canImport()) { root.innerHTML = ''; return; }
    root.innerHTML = panelShellHtml();
    const out = root.querySelector('#ipOut'), ta = root.querySelector('#ipText');
    root.addEventListener('change', (e) => {
      if (e.target.id !== 'ipFile') return; const f = e.target.files && e.target.files[0]; if (!f) return;
      out.innerHTML = skeleton(1, 'Reading file');
      const fr = new FileReader(); fr.onload = () => { ta.value = String(fr.result || ''); out.innerHTML = ''; res = null; }; fr.onerror = () => { out.innerHTML = errorState({ title: 'The file could not be read.', retry: null }); };
      fr.readAsText(f);
    });
    root.addEventListener('input', (e) => { if (e.target.id === 'ipText') { res = null; out.innerHTML = ''; } });
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ip]'); if (!b) return;
      if (b.dataset.ip === 'preview') {
        if (!ta.value.trim()) { out.innerHTML = '<p class="muted" role="status">Paste a CSV or choose a file first.</p>'; return; }
        const rows = parseCsv(ta.value); res = validateRows(rows, phones()); out.innerHTML = previewHtml(rows, res);
      } else if (b.dataset.ip === 'go' && res && res.valid.length && !res.tooMany) confirm(out);
    });
  }
  function confirm(out) {
    const n = res.valid.length, rows = res.valid;
    dialog({ title: 'Import leads', intro: `Add <b>${n}</b> lead${n === 1 ? '' : 's'} to the sales queue? ${res.duplicates.length + res.invalid.length} row${res.duplicates.length + res.invalid.length === 1 ? ' is' : 's are'} left out.`, submit: `Import ${n} lead${n === 1 ? '' : 's'}`,
      onSubmit: async (form, { close, say }) => {
        try {
          const r = await rpc('crm_import_leads_csv', { p_rows: rows }), added = Number(r && r.added) || 0, skipped = Number(r && r.skipped) || 0;
          close(); res = null; out.innerHTML = `<p class="ip-done" role="status"><b>${added} added, ${skipped} skipped.</b></p>`; toast(`${added} added, ${skipped} skipped`);
        } catch (x) { say(isMissingRpc(x) ? MISSING_MSG : 'Import failed: ' + String((x && x.message) || x)); }
      } });
  }
  return { mount };
}
