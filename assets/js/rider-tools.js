/* Free rider tools on the home page: a service-due check and a "what is my bike telling me" guide.
   Everything runs in the browser and nothing is sent anywhere. The guidance is general, hedged on purpose, and always ends with "a mechanic checks the real cause and quotes first". */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_TOOLS = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Typical gaps. km 0 means time only (electric bikes have no oil to change).
  var GAPS = { scooter: { km: 3000, months: 4, name: 'scooter' }, commuter: { km: 4000, months: 4, name: 'commuter motorcycle' }, perf: { km: 5000, months: 6, name: 'performance or cruiser motorcycle' }, ev: { km: 0, months: 6, name: 'electric scooter or bike' } };
  function monthsBetween(from, to) { return (to.getTime() - from.getTime()) / (30.4375 * 86400000); }
  function addMonths(d, m) { var x = new Date(d.getTime()); x.setMonth(x.getMonth() + Math.floor(m)); x.setDate(x.getDate() + Math.round((m % 1) * 30)); return x; }
  /** Where a bike stands: { state: 'due'|'soon'|'ok', pct, dueDate, kmLeft, why } or null for input that makes no sense. */
  function dueStatus(type, lastIso, km, now) {
    var g = GAPS[type]; if (!g) return null;
    var last = new Date(lastIso + 'T12:00:00'); now = now || new Date();
    if (isNaN(last.getTime()) || last.getTime() > now.getTime() + 86400000) return null;
    var k = g.km ? Math.round(Number(km)) : 0; if (g.km && !(k >= 0 && k <= 60000)) return null;
    var t = monthsBetween(last, now) / g.months, d = g.km ? k / g.km : 0, pct = Math.max(t, d);
    var why = d >= t && g.km ? 'distance' : 'time';
    return { state: pct >= 1 ? 'due' : pct >= 0.75 ? 'soon' : 'ok', pct: Math.min(1.2, pct), dueDate: addMonths(last, g.months), kmLeft: g.km ? Math.max(0, g.km - k) : null, why: why, gap: g };
  }
  var SYMPTOMS = {
    start: { name: 'Hard to start', causes: 'Often a weak battery, a worn spark plug, a dirty air filter or old fuel.', step: 'Check the kill switch and fuel first.', service: 'repair' },
    pickup: { name: 'Low pickup or mileage', causes: 'Often a clogged air filter, old oil, a worn spark plug or low tyre pressure.', step: 'Check tyre pressure; a service usually brings it back.', service: 'general' },
    brake: { name: 'Weak or noisy brakes', causes: 'Often worn pads or shoes, low brake fluid or a glazed disc.', step: 'Ride slowly and keep distance. Please get this checked before long rides.', service: 'repair', road: true },
    chain: { name: 'Chain noise', causes: 'Often a dry or dirty chain, or one that is too loose or tight.', step: 'A clean and lube often fixes it. Do not ride with a very loose chain.', service: 'basic' },
    clutch: { name: 'Clutch hard or slipping', causes: 'Often a stretched cable, needs adjustment, or worn clutch plates.', step: 'A cable adjustment is quick. Slipping under load needs a closer look.', service: 'repair' },
    battery: { name: 'Battery or self-start', causes: 'Often an ageing battery, loose terminals or a charging problem.', step: 'A battery test shows if it will start tomorrow.', service: 'repair' },
    tyre: { name: 'Puncture or worn tyre', causes: 'A nail, a worn tread or low pressure.', step: 'Do not ride on a flat or very worn tyre. We can come to you.', service: 'repair', road: true },
    heat: { name: 'Engine heating', causes: 'Often old oil, a blocked air filter, a stuck brake or a cooling issue.', step: 'Stop and let it cool. Do not keep riding if it keeps heating.', service: 'repair', road: true },
    leak: { name: 'Oil leak', causes: 'Often a loose drain bolt, a worn seal or gasket.', step: 'Keep an eye on the oil level and avoid long rides until it is checked.', service: 'repair' }
  };
  function symptomPlan(keys) {
    var list = (keys || []).filter(function (k, i, a) { return SYMPTOMS[k] && a.indexOf(k) === i; }).slice(0, 3);
    return { items: list.map(function (k) { return { key: k, s: SYMPTOMS[k] }; }), road: list.some(function (k) { return SYMPTOMS[k].road; }), service: list.length ? (list.some(function (k) { return SYMPTOMS[k].service === 'repair'; }) ? 'repair' : list.some(function (k) { return SYMPTOMS[k].service === 'general'; }) ? 'general' : 'basic') : '', bookUrl: list.length ? '/book/?service=' + (list.some(function (k) { return SYMPTOMS[k].service === 'repair'; }) ? 'repair' : 'general') + '&issues=' + list.join(',') : '' };
  }

  /** An all-day calendar reminder for the due date, with a nudge two days before. */
  function reminderIcs(bikeName, dueDate, now) {
    var pad = function (n) { return String(n).padStart(2, '0'); }, ymd = function (d) { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()); };
    var next = new Date(dueDate.getTime()); next.setDate(next.getDate() + 1);
    var stamp = (now || new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    var esc = function (t) { return String(t).replace(/[\\;,]/g, function (c) { return '\\' + c; }).replace(/\n/g, '\\n'); };
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mechanix Pro//Reminder//EN', 'BEGIN:VEVENT', 'UID:' + ymd(dueDate) + '-service@mechanixpro.in', 'DTSTAMP:' + stamp,
      'DTSTART;VALUE=DATE:' + ymd(dueDate), 'DTEND;VALUE=DATE:' + ymd(next), 'SUMMARY:' + esc('Bike service due: ' + bikeName), 'DESCRIPTION:' + esc('Book a doorstep service at https://mechanixpro.in/book/ . A quote comes on WhatsApp first.'),
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Service due soon', 'TRIGGER:-P2D', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  }
  var PRE_NOTE = { tyre: 'tyres', brake: 'brakes', chain: 'chain', leak: 'oil or a leak', elec: 'lights or horn', battery: 'starting', fuel: 'fuel', gear: 'helmet or documents' };
  /** Pre-ride result: which ticks are missing, which of them a mechanic should look at, and a prefilled problem-check link. */
  function preRide(ticked) {
    var all = Object.keys(PRE_NOTE), miss = all.filter(function (k) { return (ticked || []).indexOf(k) === -1; });
    var mech = miss.filter(function (k) { return SYMPTOMS[k] || k === 'elec'; });
    var issue = { tyre: 'tyre', brake: 'brake', chain: 'chain', leak: 'leak', elec: 'elec', battery: 'battery' };
    var ids = mech.map(function (k) { return issue[k]; }).filter(Boolean).slice(0, 4);
    return { ready: miss.length === 0, missing: miss, mechanic: mech, safetyFirst: miss.indexOf('brake') > -1 || miss.indexOf('tyre') > -1, bookUrl: ids.length ? '/book/?service=repair&issues=' + ids.join(',') : '' };
  }

  function start(win) {
    var doc = win.document, $ = function (id) { return doc.getElementById(id); };
    var type = $('due-type'), date = $('due-date'), km = $('due-km'), out = $('due-out'); if (!type || !out) return;
    var fmt = function (d) { return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(d); };
    var el = function (tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
    var wa = function (text) { var num = String((win.MXP || {}).whatsapp || '').replace(/\D/g, ''); return /^\d{12}$/.test(num) ? 'https://wa.me/' + num + '?text=' + encodeURIComponent(text + '\n\nSent from mechanixpro.in') : '/book/'; };
    var iso = function (d) { return d.toISOString().slice(0, 10); };
    date.max = iso(new Date());
    function renderDue() {
      $('due-km-wrap').hidden = type.value === 'ev';
      out.textContent = '';
      if (!date.value) { out.appendChild(el('p', 'rt-hint', 'Pick the date of your last service to see where you stand.')); return; }
      var r = dueStatus(type.value, date.value, km.value || 0, new Date());
      if (!r) { out.appendChild(el('p', 'rt-hint', 'Check the date and the km. We need a past date and a number under 60,000.')); return; }
      var head = el('div', 'rt-state rt-' + r.state), title = r.state === 'due' ? 'Due now' : r.state === 'soon' ? 'Due soon' : 'On track';
      head.appendChild(el('b', '', title)); out.appendChild(head);
      var bar = el('div', 'rt-bar'); var fill = el('i'); fill.style.width = Math.round(Math.min(1, r.pct) * 100) + '%'; bar.appendChild(fill); out.appendChild(bar);
      var line = r.state === 'due' ? 'You are past the usual gap for a ' + r.gap.name + '. A service now keeps small things from becoming big ones.' : 'Usually due around ' + fmt(r.dueDate) + (r.kmLeft != null ? ' or in about ' + r.kmLeft.toLocaleString('en-IN') + ' km, whichever comes first.' : '.');
      out.appendChild(el('p', '', line));
      var row = el('div', 'rt-row'), a1 = el('a', 'btn btn-primary btn-sm', r.state === 'ok' ? 'Book ahead' : 'Book a service'); a1.href = '/book/?service=' + (r.state === 'due' ? 'general' : 'basic') + '&km=' + (r.state === 'due' ? 'gt6' : 'mid');
      var a2 = el('a', 'btn btn-wa btn-sm', 'Remind me on WhatsApp'); a2.href = wa('Hi Mechanix Pro, please remind me about my next service.\nBike: ' + r.gap.name + '\nLast service: ' + date.value + (r.gap.km ? '\nKm since then: ' + (km.value || 0) : '')); a2.rel = 'noopener';
      var a3 = el('a', 'btn btn-ghost btn-sm', 'Add to my calendar'); a3.download = 'mechanix-service-reminder.ics'; a3.href = '#';
      a3.addEventListener('click', function (e) { try { var blob = new win.Blob([reminderIcs(r.gap.name, r.dueDate, new Date())], { type: 'text/calendar' }); a3.href = win.URL.createObjectURL(blob); } catch (x) { e.preventDefault(); } });
      row.appendChild(a1); row.appendChild(a2); row.appendChild(a3); out.appendChild(row);
    }
    [type, date, km].forEach(function (n) { n.addEventListener('input', renderDue); n.addEventListener('change', renderDue); });
    // symptom guide
    var chips = [].slice.call(doc.querySelectorAll('#rt-sym [data-s]')), sout = $('sym-out'), picked = [];
    function renderSym() {
      sout.textContent = '';
      var plan = symptomPlan(picked);
      chips.forEach(function (c) { c.setAttribute('aria-pressed', picked.indexOf(c.getAttribute('data-s')) > -1 ? 'true' : 'false'); });
      if (!plan.items.length) { sout.appendChild(el('p', 'rt-hint', 'Pick up to three. We show the usual causes and what to do.')); return; }
      plan.items.forEach(function (it) { var b = el('div', 'rt-sym'); b.appendChild(el('b', '', it.s.name)); b.appendChild(el('p', '', it.s.causes)); b.appendChild(el('p', 'rt-step', it.s.step)); sout.appendChild(b); });
      var row = el('div', 'rt-row'), a1 = el('a', 'btn btn-primary btn-sm', 'Get a problem check'); a1.href = plan.bookUrl; row.appendChild(a1);
      if (plan.road) { var a2 = el('a', 'btn btn-sos btn-sm', 'Stuck on the road? Get help'); a2.href = '/roadside/'; row.appendChild(a2); }
      sout.appendChild(row);
    }
    chips.forEach(function (c) { c.addEventListener('click', function () { var k = c.getAttribute('data-s'), i = picked.indexOf(k); if (i > -1) picked.splice(i, 1); else if (picked.length < 3) picked.push(k); renderSym(); }); });
    // pre-ride checklist
    var pre = [].slice.call(doc.querySelectorAll('#pre-list [data-k]')), pout = $('pre-out');
    function renderPre() {
      if (!pout) return; pout.textContent = '';
      var ticked = pre.filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-k'); });
      if (!ticked.length) { pout.appendChild(el('p', 'rt-hint', 'Tick what looks good. We tell you what to get checked.')); return; }
      var r = preRide(ticked), head = el('div', 'rt-state ' + (r.ready ? 'rt-ok' : r.safetyFirst ? 'rt-due' : 'rt-soon'));
      head.appendChild(el('b', '', r.ready ? 'Good to ride' : r.safetyFirst ? 'Check brakes and tyres before you ride' : 'Almost there')); pout.appendChild(head);
      if (!r.ready) pout.appendChild(el('p', '', 'Still to check: ' + r.missing.map(function (k) { return PRE_NOTE[k]; }).join(', ') + '.'));
      else pout.appendChild(el('p', '', 'All eight look good. Ride safe.'));
      if (r.bookUrl) { var row = el('div', 'rt-row'), a = el('a', 'btn btn-primary btn-sm', 'Get it checked at your door'); a.href = r.bookUrl; row.appendChild(a); if (r.safetyFirst) { var s = el('a', 'btn btn-sos btn-sm', 'Stuck on the road? Get help'); s.href = '/roadside/'; row.appendChild(s); } pout.appendChild(row); }
    }
    pre.forEach(function (c) { c.addEventListener('change', renderPre); });
    renderDue();
  }
  return { start: start, dueStatus: dueStatus, symptomPlan: symptomPlan, reminderIcs: reminderIcs, preRide: preRide, GAPS: GAPS, SYMPTOMS: SYMPTOMS };
});
