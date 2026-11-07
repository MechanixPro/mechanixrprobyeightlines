// Lead CSV import rules. Pure: no DOM, no network.
export const MAX_ROWS = 500;
const ALIAS = { name: 'name', customer: 'name', phone: 'phone', mobile: 'phone', contact: 'phone', source: 'source', note: 'note', notes: 'note', remarks: 'note' };
const SENSITIVE = ['aadhaar', 'aadhar', 'pan', 'account', 'card', 'dl', 'licence', 'license'];

function parseRecords(text) {
  const out = []; let row = [], f = '', q = false, any = false;
  const s = String(text == null ? '' : text).replace(/^﻿/, '');
  const push = () => { row.push(f); f = ''; };
  const end = () => { push(); if (row.some((c) => c.trim() !== '')) out.push(row); row = []; any = false; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') { q = true; any = true; }
    else if (c === ',') { push(); any = true; }
    else if (c === '\r') { if (s[i + 1] === '\n') i++; end(); }
    else if (c === '\n') end();
    else { f += c; any = true; }
  }
  if (any || f !== '' || row.length) end();
  return out;
}
const normHeader = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function parseCsv(text) {
  const recs = parseRecords(text);
  if (!recs.length) return [];
  const heads = recs[0].map(normHeader);
  const keys = heads.map((h) => ALIAS[h] || h);
  return recs.slice(1).map((r) => {
    const o = {};
    keys.forEach((k, i) => { if (k && !(k in o)) o[k] = (r[i] || '').trim(); });
    return o;
  });
}

export function normPhone10(raw) {
  let d = String(raw == null ? '' : raw).replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(d)) return null;
  d = d.replace(/^\+/, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

const isSensitive = (k) => String(k).split(' ').some((w) => SENSITIVE.includes(w)) || SENSITIVE.some((s) => s.length > 3 && String(k).includes(s));

export function validateRows(rows, existingPhones = new Set()) {
  const valid = [], invalid = [], duplicates = [], warnings = [], seen = new Set(), ignored = new Set();
  const list = Array.isArray(rows) ? rows : [];
  const tooMany = list.length > MAX_ROWS;
  list.forEach((r, i) => {
    const row = i + 2; // row 1 is the header
    for (const k of Object.keys(r || {})) if (isSensitive(k) && !ignored.has(k)) { ignored.add(k); warnings.push(`Ignored column "${k}" (sensitive data is never imported)`); }
    const phone = normPhone10(r && r.phone);
    if (!phone) { invalid.push({ row, reason: 'Invalid phone number' }); return; }
    const name = ((r.name || '').trim());
    if (name.length < 2) { invalid.push({ row, reason: 'Missing name' }); return; }
    if (existingPhones.has(phone)) { duplicates.push({ row, reason: 'Already a lead or customer' }); return; }
    if (seen.has(phone)) { duplicates.push({ row, reason: 'Phone repeated in this file' }); return; }
    seen.add(phone);
    valid.push({ name, phone, source: (r.source || '').trim(), note: (r.note || '').trim() });
  });
  return { valid, invalid, duplicates, warnings, tooMany };
}
