// crm/data-tools.js — pure helpers for the desk's date ranges, exports and file import (no DOM, no network), so Node can test them.

export const PRESETS = [['today', 'Today'], ['month', 'This month'], ['last_month', 'Last month'], ['d30', 'Last 30 days'], ['m3', 'Last 3 months'], ['custom', 'Custom dates']];
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const istParts = (now) => { const d = new Date(new Date(now).getTime() + 330 * 60_000); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; };
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** The From and To dates (India time, YYYY-MM-DD) of a quick range. 'custom' keeps what the person typed. */
export function presetRange(key, now = Date.now()) {
  const { y, m, d } = istParts(now), today = ymd(y, m, d);
  if (key === 'today') return { from: today, to: today };
  if (key === 'month') return { from: ymd(y, m, 1), to: today };
  if (key === 'last_month') { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return { from: ymd(py, pm, 1), to: addDays(ymd(y, m, 1), -1) }; }
  if (key === 'd30') return { from: addDays(today, -29), to: today };
  if (key === 'm3') { let pm = m - 2, py = y; if (pm < 1) { pm += 12; py -= 1; } return { from: ymd(py, pm, 1), to: today }; }
  return null;
}
/** Which quick range matches these dates, so the picker shows the right option after a reload. */
export function presetOf(from, to, now = Date.now()) {
  for (const [k] of PRESETS) { if (k === 'custom') continue; const r = presetRange(k, now); if (r && r.from === from && r.to === to) return k; }
  return from || to ? 'custom' : 'month';
}

/* ---------- CSV ---------- */
/** Parses CSV text (quotes, commas and line breaks inside quotes, BOM). Returns an array of rows of strings. */
export function parseCsv(text) {
  const s = String(text || '').replace(/^﻿/, ''); const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}
const HEAD = { name: /^(lead|customer|garage)?\s*name$|^name$|^customer$|^lead$/i, phone: /mobile|phone|contact|whatsapp|number/i, area: /^area|locality|location|city|place/i };
/** Turns parsed rows into {name, phone, area} using the header row (or the first three columns when there is none). */
export function toImportRows(table) {
  if (!table.length) return [];
  const head = table[0].map((h) => String(h).trim()), hasHead = head.some((h) => HEAD.phone.test(h) || HEAD.name.test(h));
  const idx = (k) => head.findIndex((h) => HEAD[k].test(h));
  let ni = 0, pi = 1, ai = 2;
  if (hasHead) { ni = idx('name'); pi = idx('phone'); ai = idx('area'); if (ni < 0) ni = head.findIndex((h, i) => i !== pi && i !== ai); }
  return table.slice(hasHead ? 1 : 0).map((r) => ({ name: String(r[ni] ?? '').trim(), phone: String(r[pi] ?? '').trim(), area: ai >= 0 ? String(r[ai] ?? '').trim() : '' }));
}

/* ---------- XLSX (a minimal workbook: one sheet, text and numbers, stored without compression) ---------- */
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const xmlEsc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const enc = new TextEncoder();
function zipStore(files) {
  const parts = [], central = []; let offset = 0;
  for (const [name, text] of files) {
    const nameB = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(lh.buffer), nameB, data);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nameB.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameB); offset += 30 + nameB.length + data.length;
  }
  const csize = central.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
/** A one-sheet .xlsx as bytes. columns: [[key or function, header], ...]. Values that look like plain numbers are stored as numbers, except phone-like text. */
export function makeXlsx(rows, columns, sheetName = 'Sheet1') {
  const val = (r, k) => (typeof k === 'function' ? k(r) : r[k]);
  const cell = (v, ci, ri, bold) => { const ref = colName(ci) + (ri + 1); if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`; return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`; };
  const grid = [columns.map(([, h]) => h), ...rows.map((r) => columns.map(([k]) => val(r, k)))];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${grid.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => cell(v, ci, ri, ri === 0)).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  return zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', wb],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['xl/styles.xml', styles],
    ['xl/worksheets/sheet1.xml', sheet],
  ]);
}

/** A print-ready summary page: title, the filters used, and a table. The browser's Print dialog saves it as a PDF. */
export function reportHtml({ title, subtitle = '', rows, columns, generatedBy = '', when = '' }) {
  const val = (r, k) => (typeof k === 'function' ? k(r) : r[k]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${xmlEsc(title)}</title><style>@page{size:A4 landscape;margin:12mm}body{font:11px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#14295A}h1{font-size:20px;margin:0 0 2px}p{margin:2px 0;color:#5b6785}table{border-collapse:collapse;width:100%;margin-top:10px}th{background:#14295A;color:#fff;text-align:left;padding:5px 7px;font-size:10px}td{padding:5px 7px;border-bottom:1px solid #dfe4ef;vertical-align:top}tr:nth-child(even) td{background:#f6f8fc}.f{margin-top:10px;font-size:9px}</style></head><body><h1>${xmlEsc(title)}</h1><p>${xmlEsc(subtitle)}</p><table><thead><tr>${columns.map(([, h]) => `<th>${xmlEsc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${columns.map(([k]) => `<td>${xmlEsc(val(r, k))}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="f">Mechanix Pro desk${generatedBy ? ' · ' + xmlEsc(generatedBy) : ''}${when ? ' · ' + xmlEsc(when) : ''} · ${rows.length} rows · Confidential</p></body></html>`;
}
