/* Keeps the PIN code list up to date: the company adds, renames or pauses PIN codes in the admin panel, and this reads that list.
   The built-in list (pincodes.js) is used until it loads, or if it cannot be reached. */
(function () {
  'use strict';
  var C = window.MXP || {};
  if (!C.supabaseUrl || !C.supabaseAnonKey || !window.fetch) return;
  window.MXP_PINS = window.MXP_PINS || {}; window.MXP_PINS_OFF = window.MXP_PINS_OFF || {};
  fetch(C.supabaseUrl + '/rest/v1/service_pincodes?select=pin,name,active&limit=2000', { headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey } })
    .then(function (r) { return r.ok ? r.json() : []; })
    .then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) return;
      rows.forEach(function (r) {
        if (!/^\d{6}$/.test(String(r.pin))) return;
        if (r.active) { window.MXP_PINS[r.pin] = String(r.name || '').slice(0, 60); delete window.MXP_PINS_OFF[r.pin]; }
        else { delete window.MXP_PINS[r.pin]; window.MXP_PINS_OFF[r.pin] = true; }
      });
      document.dispatchEvent(new CustomEvent('mxp:pins'));
    }).catch(function () {});
})();
