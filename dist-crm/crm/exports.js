// Export buttons (CSV, Excel, PDF) for a table. Every export is written to the audit log first; the file is only handed over if that succeeds.
import { rpc, toCsv, downloadFile, toast, clean } from './ui.js';
import { makeXlsx, reportHtml } from './data-tools.js';

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const exportButtons = (id = 'exp') => `<span class="exp" role="group" aria-label="Export"><button class="btn ghost" type="button" data-exp="csv" data-for="${id}">CSV</button><button class="btn ghost" type="button" data-exp="xlsx" data-for="${id}">Excel</button><button class="btn ghost" type="button" data-exp="pdf" data-for="${id}">PDF</button></span>`;

/** Wires every [data-exp] button inside root. get() returns { name, what, rows, columns, subtitle, filters, by }. */
export function bindExports(root, get, id = 'exp') {
  root.querySelectorAll(`[data-exp][data-for="${id}"]`).forEach((b) => b.addEventListener('click', async () => {
    const fmt = b.dataset.exp, g = get(); if (!g.rows.length) return toast('There is nothing to export.', true);
    b.disabled = true;
    try {
      await rpc('crm_log_export', { p_what: g.what, p_format: fmt, p_rows: g.rows.length, p_filters: g.filters || {} });
      const base = `${g.name}-${today()}`;
      if (fmt === 'csv') downloadFile(base + '.csv', toCsv(g.rows, g.columns));
      else if (fmt === 'xlsx') downloadFile(base + '.xlsx', makeXlsx(g.rows, g.columns, g.what), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      else {
        const url = URL.createObjectURL(new Blob([reportHtml({ title: g.title || g.what, subtitle: g.subtitle || '', rows: g.rows, columns: g.columns, generatedBy: g.by || '', when: new Date().toLocaleString('en-IN') })], { type: 'text/html' }));
        const w = window.open(url, '_blank'); if (!w) toast('Allow pop-ups for this site to save the PDF.', true); else w.addEventListener('load', () => w.print());
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      toast(fmt === 'pdf' ? 'Choose "Save as PDF" in the print window.' : 'Export ready.');
    } catch (e) { toast(clean(e), true); } finally { b.disabled = false; }
  }));
}
