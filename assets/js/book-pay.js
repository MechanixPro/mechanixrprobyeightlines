/* /book/: book a doorstep service and pay a small confirmation fee (Rs 49 to Rs 99 by engine size). No inline script (CSP).
   1) the form is sent to our server (book-start), which saves the booking, works out the fee itself and opens one Razorpay order,
   2) Razorpay's payment window opens, 3) the result goes to verify-payment. The booking is confirmed only when the payment is verified.
   The amount shown here is a preview with the same rule; the server's amount is the one charged, and if it differs we ask before charging. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_BOOK = api; if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', function () { api.init(root); }); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FEE_MIN = 49, FEE_MAX = 99, UNKNOWN = 69, DEFAULTS = { confirm_std: 49, confirm_mid: 69, confirm_big: 99, confirm_car: 99 };
  var clamp = function (n) { n = Math.round(Number(n)); return !isFinite(n) || n <= 0 ? UNKNOWN : Math.min(FEE_MAX, Math.max(FEE_MIN, n)); };
  var RANK = { std: 0, mid: 1, big: 2 };
  /* Same rule as supabase/functions/_shared/confirm-fee.ts: a cc number in the model name wins, and a picked size can only raise it. */
  function engineFromModel(model) {
    var nums = (String(model || '').match(/\d{2,4}/g) || []).map(Number).filter(function (n) { return n >= 50 && n <= 2500; });
    if (!nums.length) return null; var cc = Math.max.apply(null, nums); return cc >= 251 ? 'big' : cc >= 150 ? 'mid' : 'std';
  }
  function engineFor(model, sent) {
    var a = engineFromModel(model), b = RANK.hasOwnProperty(sent) ? sent : null;
    if (a && b) return RANK[a] >= RANK[b] ? a : b; return a || b;
  }
  /* The home page card sends only ?vehicle= and ?pincode=. A valid Bengaluru PIN (560000 to 562999) prefills the PIN field; anything else is ignored. */
  function pinFromQuery(v) { v = String(v == null ? '' : v).replace(/\s/g, ''); return /^56[0-2][0-9]{3}$/.test(v) ? v : ''; }
  function feeFor(o, rows) {
    var price = function (id) { return clamp(rows && rows[id] != null ? rows[id] : DEFAULTS[id]); };
    if (o.vehicle === 'car') return { amount: price('confirm_car'), unknown: false };
    var e = engineFor(o.model, o.engine);
    return e ? { amount: price('confirm_' + e), unknown: false } : { amount: UNKNOWN, unknown: true };
  }
  function feeLine(vehicle, amount) { return 'Confirmation fee for your ' + (vehicle === 'car' ? 'car' : 'bike size') + ': ₹' + amount + '. Adjusted in your final bill.'; }


  /* The live "Your service" summary. Pure: the numbers come from the site's own price rows (build-time defaults from src/site.json in a hidden list,
     replaced by the live rows when they load) and from feeFor above. Nothing here is typed in as a price. */
  var SVC_NAME = { basic: 'Basic service', general: 'Standard service', full: 'Full service', repair: 'Repair or problem check' };
  var TIER_TXT = { std: 'Up to 149cc', mid: '150 to 250cc', big: '251cc and above' };
  var GST_NOTE = 'Excluding GST. GST at 18% is added on your final invoice.';
  var rupees = function (n) { return '₹' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); };
  function priceFor(serviceId, tier, prices) {
    if (!SVC_NAME[serviceId]) return null;
    var id = serviceId === 'repair' ? 'repair' : serviceId + (tier === 'mid' ? '250' : tier === 'big' ? '500' : '');
    var n = Number(prices && prices[id]); return isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  function summary(v, prices, rows) {
    var car = v.vehicle === 'car', model = String(car ? v.car_model : v.model || '').trim(), brand = car ? '' : String(v.brand || '').trim();
    var vehicle = car ? model : (brand && model.toLowerCase().indexOf(brand.toLowerCase()) !== 0 ? brand + ' ' : '') + model;
    var f = feeFor({ vehicle: v.vehicle, model: car ? '' : v.model, engine: v.engine_class }, rows), tier = car ? null : engineFor(v.model, v.engine_class);
    var service = car ? (v.car_need === 'problem' ? 'Problem check' : 'Service') : (SVC_NAME[v.service_id] || '');
    var priceNum = car ? null : priceFor(v.service_id, tier, prices), priceText = '', note = '';
    if (car) { priceText = 'Quoted before any work starts'; note = 'GST at 18% is added on your final invoice.'; }
    else if (priceNum) {
      priceText = (!tier && v.service_id !== 'repair' ? 'From ' : '') + rupees(priceNum);
      note = v.service_id === 'repair' ? 'Checkup and quote visit. Any repair is quoted before work starts. ' + GST_NOTE : GST_NOTE;
    }
    var engine = car ? '' : tier ? TIER_TXT[tier] : 'Not sure, we will check';
    return { vehicle: vehicle, engine: engine, service: service, priceNum: priceNum, priceText: priceText, gstNote: note, fee: f.amount, unknown: f.unknown,
      feeLine: 'Pay ' + rupees(f.amount) + ' now to lock your slot. It is adjusted in your final bill.' + (f.unknown ? ' Your engine size is not clear, so our team will check it.' : ''),
      ready: !!(vehicle.length >= 2 && (car || service)) };
  }
  /* What may be kept in sessionStorage so a customer who navigates away and back keeps their choices. Choices only: never a name, mobile number, email, address or PIN. */
  var CHOICE_KEYS = ['vehicle', 'brand', 'model', 'engine_class', 'service_id', 'car_model', 'car_need', 'preferred_date', 'preferred_slot'];
  function choicesForStorage(v, step) {
    var o = {}; CHOICE_KEYS.forEach(function (k) { if (v && v[k] != null && v[k] !== '') o[k] = String(v[k]).slice(0, 60); });
    o.step = step === 2 || step === 3 ? step : 1; return o;
  }

  var ERR = { phone: 'Enter a valid 10-digit mobile number.', email: 'Enter a valid email address. We send your confirmation and code there.', name: 'Enter your name.', house: 'Enter your house or flat number.', street: 'Enter your street or a landmark.', area: 'Enter your area.',
    pincode: 'Enter a Bengaluru PIN code (6 digits, like 560102).', model: 'Choose or type your model.', service_id: 'Choose what your bike needs.', car_model: 'Enter your car make and model.', preferred_date: 'Pick a day.', preferred_slot: 'Pick a time slot.' };
  /* Returns { field: message } for what is wrong. Step 1, 2 or 3 limits the check to that step; no step checks everything. */
  function problems(v, step) {
    var e = {}, car = v.vehicle === 'car';
    if (!step || step === 1) {
      if (car) { if (String(v.car_model || '').trim().length < 2) e.car_model = ERR.car_model; }
      else { if (String(v.model || '').trim().length < 2) e.model = ERR.model; if (['basic', 'general', 'full', 'repair'].indexOf(v.service_id) < 0) e.service_id = ERR.service_id; }
    }
    if (!step || step === 2) {
      if (String(v.house || '').trim().length < 2) e.house = ERR.house;
      if (String(v.street || '').trim().length < 3) e.street = ERR.street;
      if (String(v.area || '').trim().length < 2) e.area = ERR.area;
      if (!/^56[0-2]\d{3}$/.test(String(v.pincode || '').replace(/\s/g, ''))) e.pincode = ERR.pincode;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.preferred_date || '')) e.preferred_date = ERR.preferred_date;
      if (['morning', 'afternoon', 'evening', 'asap'].indexOf(v.preferred_slot) < 0) e.preferred_slot = ERR.preferred_slot;
    }
    if (!step || step === 3) {
      if (String(v.name || '').trim().length < 2) e.name = ERR.name;
      if (!/^[6-9]\d{9}$/.test(String(v.phone || '').replace(/\D/g, '').slice(-10))) e.phone = ERR.phone;
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(v.email || '').trim())) e.email = ERR.email;
    }
    return e;
  }
  /* The body sent to book-start. The fee is not in it: the server works it out. */
  function payload(v, key, utm) {
    var car = v.vehicle === 'car';
    return { client_key: key, vehicle: car ? 'car' : 'bike', brand: car ? '' : v.brand || '', model: car ? v.car_model : v.model, engine_class: car ? null : v.engine_class || null, service_id: car ? '' : v.service_id, car_need: car ? v.car_need : undefined, need_text: v.need_text || '',
      house: v.house, street: v.street, area: v.area, pincode: String(v.pincode || '').replace(/\s/g, ''), lat: v.lat || null, lng: v.lng || null, preferred_date: v.preferred_date, preferred_slot: v.preferred_slot,
      name: v.name, phone: String(v.phone || '').replace(/\D/g, '').slice(-10), email: String(v.email || '').trim(), consent_whatsapp: !!v.consent_whatsapp, utm: utm || {} };
  }
  var uuid = function () { try { return crypto.randomUUID(); } catch (e) { return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); } };

  function init(win) {
    var doc = win.document, C = win.MXP || {}, form = doc.getElementById('bkForm'); if (!form) return;
    var $ = function (s) { return form.querySelector(s); }, all = function (s) { return Array.prototype.slice.call(form.querySelectorAll(s)); };
    var KEY = 'mxp_book_v1', rows = {}, step = 1, busy = false, draft = {}, started = false;
    var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var store = { get: function () { try { return JSON.parse(win.localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }, set: function (o) { try { win.localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }, clear: function () { try { win.localStorage.removeItem(KEY); } catch (e) {} } };
    var val = function (n) { var el = form.elements[n]; if (!el) return ''; if (el.length && el[0] && el[0].type === 'radio') { var c = all('[name="' + n + '"]:checked')[0]; return c ? c.value : ''; } return el.type === 'checkbox' ? el.checked : el.value; };
    var values = function () { var o = {}; ['vehicle', 'brand', 'model', 'engine_class', 'service_id', 'car_model', 'car_need', 'need_text', 'house', 'street', 'area', 'pincode', 'lat', 'lng', 'preferred_date', 'preferred_slot', 'name', 'phone', 'email', 'consent_whatsapp'].forEach(function (n) { o[n] = val(n); }); return o; };
    var SAVE = ['vehicle', 'brand', 'model', 'engine_class', 'service_id', 'car_model', 'car_need', 'area', 'pincode', 'preferred_date', 'preferred_slot'];   // no name, phone, email, house, street or free text is kept in the browser (data minimisation)
    var PERSONAL = ['need_text', 'house', 'street', 'name', 'phone', 'email'];
    var SKEY = 'mxp_book_choices_v1';
    var sess = { get: function () { try { return JSON.parse(win.sessionStorage.getItem(SKEY) || '{}') || {}; } catch (e) { return {}; } }, set: function (o) { try { win.sessionStorage.setItem(SKEY, JSON.stringify(o)); } catch (e) {} }, clear: function () { try { win.sessionStorage.removeItem(SKEY); } catch (e) {} } };
    var prices = {}; Array.prototype.slice.call(doc.querySelectorAll('#bk-prices li')).forEach(function (li) { var n = Number(li.textContent); if (n > 0) prices[li.getAttribute('data-id')] = n; });
    var save = function () { var o = store.get(); PERSONAL.forEach(function (n) { delete o[n]; }); SAVE.forEach(function (n) { o[n] = val(n); }); o.step = step; o.key = o.key || uuid(); store.set(o); draft = o; sess.set(choicesForStorage(values(), step)); };

    /* brands, models */
    var BIKES = win.MXP_BIKES || {}, brandSel = $('#bk-brand'), dl = $('#bk-models');
    Object.keys(BIKES).forEach(function (b) { var o = doc.createElement('option'); o.value = b; o.textContent = b; brandSel.appendChild(o); });
    var fillModels = function () { dl.innerHTML = ''; (BIKES[brandSel.value] || []).forEach(function (m) { var o = doc.createElement('option'); o.value = m[0]; dl.appendChild(o); }); };
    var guessEngine = function () {
      var m = $('#bk-model').value, list = BIKES[brandSel.value] || [], hit = list.filter(function (x) { return x[0].toLowerCase() === m.trim().toLowerCase(); })[0];
      var L = win.MXP_LOGIC, g = engineFromModel(m) || (hit ? (L && L.engineGuess ? L.engineGuess(hit[0], hit[2]) : (hit[2] ? 'big' : 'std')) : null);
      if (g && hit || g && engineFromModel(m)) $('#bk-engine').value = g;
    };

    /* days */
    var days = $('#bk-days'), two = function (n) { return (n < 10 ? '0' : '') + n; };
    for (var i = 0; i < 7; i++) {
      var d = new Date(); d.setDate(d.getDate() + i); var iso = d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
      var lab = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short' }), sub = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      days.insertAdjacentHTML('beforeend', '<label class="bk-pick"><input type="radio" name="preferred_date" value="' + iso + '"><span>' + esc(lab) + '<small>' + esc(sub) + '</small></span></label>');
    }

    /* Today Slots: Today and each window show only while they are still ahead (the server checks the same rule). */
    var applyToday = function () {
      var T = win.MXP_TODAY; if (!T) return; var open = T.todaySlots(Date.now()), todayIso = T.istToday(Date.now());
      var dayIn = days.querySelector('input[value="' + todayIso + '"]'), todayLab = dayIn && dayIn.closest('label');
      if (dayIn && !open.any) { if (dayIn.checked) dayIn.checked = false; todayLab.hidden = true; } else if (todayLab) todayLab.hidden = false;
      var sel = doc.querySelector('input[name="preferred_date"]:checked'), isToday = sel && sel.value === todayIso;
      ['morning', 'afternoon', 'evening', 'asap'].forEach(function (k) {
        var r = doc.querySelector('input[name="preferred_slot"][value="' + k + '"]'), lab = r && r.closest('label'); if (!r) return;
        var off = k === 'asap' ? !isToday : (isToday && !open[k]);
        r.disabled = off; if (lab) lab.classList.toggle('bk-off', off); if (off && r.checked) r.checked = false;
      });
    };
    days.addEventListener('change', applyToday); applyToday();

    /* live "Your service" summary */
    var liveT = null, lastLive = '';
    var pickText = function (n) { var c = all('[name="' + n + '"]:checked')[0], sp = c && c.parentNode.querySelector('span'); return sp ? Array.prototype.slice.call(sp.childNodes).map(function (x) { return x.textContent.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join(', ') : ''; };
    var renderSummary = function () {
      var v = values(), m = summary(v, prices, rows), when = [pickText('preferred_date'), pickText('preferred_slot')].filter(Boolean).join(', ');
      var set1 = function (k, t) { var d = doc.querySelector('#bk-sum [data-row="' + k + '"] dd'), r = d && d.parentNode; if (!d) return; d.textContent = t || 'Not chosen yet'; d.className = t ? '' : 'bk-empty'; if (r) r.hidden = (k === 'engine' && v.vehicle === 'car'); };
      set1('vehicle', m.vehicle); set1('engine', m.engine); set1('service', m.service); set1('price', m.priceText); set1('when', when);
      var line = doc.getElementById('bk-sum-line'), parts = [m.vehicle, m.service, m.priceText && (m.priceNum ? m.priceText + ' + GST' : m.priceText)].filter(Boolean);
      var text = m.ready ? parts.join(' · ') : 'Choose your vehicle and service. Your summary builds here.';
      if (line) line.textContent = text; doc.getElementById('bk-sum-gst').textContent = m.ready ? m.gstNote : ''; doc.getElementById('bk-sum-fee').textContent = m.feeLine;
      var built = doc.getElementById('bk-built-t'); if (built) built.textContent = m.ready ? 'You chose ' + parts.join(', ') + (when ? ', ' + when : '') + '. ' + m.feeLine.replace(/ It is adjusted in your final bill\./, '') + ' Add your contact details to finish.' : 'Your service is ready. Add your contact details and pay the confirmation fee to lock your slot.';
      // a short, calm spoken update once the customer pauses (not one per keystroke)
      var say = m.ready ? 'Your service: ' + parts.join(', ') + '. ' + m.feeLine : '';
      if (win.clearTimeout) win.clearTimeout(liveT); liveT = win.setTimeout(function () { var lv = doc.getElementById('bk-sum-live'); if (lv && say !== lastLive) { lastLive = say; lv.textContent = say; } }, 900);
    };
    /* fee preview */
    var showFee = function () {
      var v = values(), car = v.vehicle === 'car', f = feeFor({ vehicle: v.vehicle, model: car ? '' : v.model, engine: v.engine_class }, rows);
      $('#bk-fee-amt').textContent = 'Pay ₹' + f.amount + ' to confirm'; $('#bk-fee-line').textContent = feeLine(v.vehicle, f.amount) + (f.unknown ? ' Your engine size is not clear, so our team will check it.' : '');
      $('#bk-pay').textContent = 'Pay ₹' + f.amount + ' to confirm'; renderSummary(); return f;
    };
    var trust = $('#bk-trust'), setVehicle = function () {
      var car = val('vehicle') === 'car'; form.setAttribute('data-veh', car ? 'car' : 'bike');
      all('[data-only]').forEach(function (el) { el.hidden = el.getAttribute('data-only') !== (car ? 'car' : 'bike'); });
      var extra = trust.querySelector('[data-bike-proof]'); if (extra) extra.remove();
      /* Two plain facts, for bikes only (the old service-count figures were assumed, so they are gone). */
      if (!car) trust.insertAdjacentHTML('beforeend', '<li data-bike-proof>Quote first. Nothing starts until you say yes.</li>');
      showFee();
    };

    /* steps */
    var show = function (n) {
      step = n; try { if (win.mxpTrack) win.mxpTrack('book_step', { step: n }); } catch (e) {}   // step reached; no personal details are sent
      all('[data-step]').forEach(function (f) { f.hidden = Number(f.getAttribute('data-step')) !== n; });
      Array.prototype.slice.call(doc.querySelectorAll('.bk-steps li')).forEach(function (li) { var s = Number(li.getAttribute('data-s')); li.className = s === n ? 'on' : s < n ? 'done' : ''; if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current'); });
      var pg = doc.getElementById('bk-prog'); if (pg) pg.textContent = 'Step ' + n + ' of 3: ' + ['Vehicle and service', 'Address and slot', 'Contact and pay'][n - 1]; renderSummary();
      var f = $('[data-step="' + n + '"]'); if (f) { var first = f.querySelector('input:not([type=hidden]):not([type=radio]),select'); if (first && n > 1) first.focus({ preventScroll: true }); if (started) f.scrollIntoView({ block: 'start', behavior: 'auto' }); } save();
    };
    var markErrors = function (e) {
      all('[data-err]').forEach(function (p) { p.textContent = e[p.getAttribute('data-err')] || ''; });
      all('.bad').forEach(function (x) { x.classList.remove('bad'); });
      var firstBad = null; Object.keys(e).forEach(function (k) { var el = form.elements[k === 'car_model' ? 'car_model' : k]; if (el && el.classList) { el.classList.add('bad'); el.setAttribute('aria-invalid', 'true'); if (!firstBad) firstBad = el; } });
      if (firstBad && firstBad.focus) firstBad.focus();
    };
    form.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-next]'); if (!b) return; ev.preventDefault(); var to = Number(b.getAttribute('data-next'));
      if (to > step) { var e = problems(values(), step); markErrors(e); if (Object.keys(e).length) return; } show(to);
    });
    form.addEventListener('input', function (ev) { if (ev.target.name === 'model' || ev.target.name === 'brand') guessEngine(); save(); showFee(); });
    form.addEventListener('change', function (ev) { if (ev.target.name === 'vehicle') setVehicle(); if (ev.target.name === 'brand') { fillModels(); } save(); showFee(); });

    var sumT = doc.getElementById('bk-sum-t'), sumBox = doc.getElementById('bk-sum');
    if (sumT) sumT.addEventListener('click', function () { var open = sumBox.classList.toggle('open'); sumT.setAttribute('aria-expanded', open ? 'true' : 'false'); sumT.textContent = open ? 'Hide' : 'Details'; });

    /* location (optional, only when the customer taps) */
    $('#bk-geo').addEventListener('click', function () {
      var m = $('#bk-geomsg'); if (!win.navigator.geolocation) { m.textContent = 'Your phone does not share its location here. Type the address instead.'; return; }
      m.textContent = 'Getting your location…';
      win.navigator.geolocation.getCurrentPosition(function (p) {
        var lat = p.coords.latitude, lng = p.coords.longitude;
        $('#bk-lat').value = lat.toFixed(5); $('#bk-lng').value = lng.toFixed(5);
        // Work out the PIN code and area from the pin on the map, using the site's own PIN outlines (no outside service).
        var geo = win.MXP_PIN_GEO || {}, names = win.MXP_PINS || {}, best = '', bestD = Infinity;
        Object.keys(geo).forEach(function (pin) {
          var g = geo[pin], inside = lat >= g[2] && lat <= g[3] && lng >= g[4] && lng <= g[5], d = Math.pow(lat - g[0], 2) + Math.pow(lng - g[1], 2);
          if (inside) d -= 1; // a box that contains the point wins over one that only has a close centre
          if (d < bestD) { bestD = d; best = pin; }
        });
        var pinEl = $('#bk-pin'), areaEl = $('#bk-area'), filled = [];
        if (best && bestD < 0.0016) { // within about 4 km of a PIN centre, or inside its box
          pinEl.value = best; filled.push('PIN code ' + best);
          if (names[best] && !String(areaEl.value || '').trim()) { areaEl.value = names[best]; filled.push('area ' + names[best]); }
          [pinEl, areaEl].forEach(function (el) { el.dispatchEvent(new win.Event('input', { bubbles: true })); });
          ['pincode', 'area'].forEach(function (k) { var e = form.querySelector('[data-err="' + k + '"]'); if (e) e.textContent = ''; });
        }
        m.textContent = (filled.length ? 'Location added and filled in ' + filled.join(' and ') + '. ' : 'Location added, but it is outside our PIN list, so type your PIN code and area. ') + 'Please check the address above.';
        m.appendChild(win.document.createTextNode(' ')); var a = win.document.createElement('a'); a.href = 'https://www.google.com/maps?q=' + lat.toFixed(5) + ',' + lng.toFixed(5); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'See it on the map'; m.appendChild(a);
        save(); showFee();
      }, function (err) { m.textContent = err && err.code === 1 ? 'Location is blocked for this site. Allow it in your browser settings, or type the address instead.' : 'Could not get your location. Type the address instead.'; }, { enableHighAccuracy: true, timeout: 12000 });
    });

    /* restore saved progress and the link's prefill */
    var q = new URLSearchParams(win.location.search), saved = store.get(), back = sess.get(); PERSONAL.forEach(function (n) { delete saved[n]; }); store.set(saved); draft = saved;   // drops any personal details an older version saved
    var set = function (n, v) { var el = form.elements[n]; if (!el || v == null || v === '') return; if (el.length && el[0] && el[0].type === 'radio') { all('[name="' + n + '"]').forEach(function (r) { r.checked = r.value === v; }); } else el.value = v; };
    CHOICE_KEYS.forEach(function (n) { set(n, back[n]); });   // choices from this tab's session (no personal details are in it)
    SAVE.forEach(function (n) { set(n, saved[n]); });
    if (q.get('vehicle') === 'car' || q.get('vehicle') === 'bike') set('vehicle', q.get('vehicle'));   // a link wins over a saved draft
    if (q.get('brand') && BIKES[q.get('brand')]) set('brand', q.get('brand')); fillModels();
    if (q.get('model')) set('model', q.get('model')); if (['basic', 'general', 'full', 'repair'].indexOf(q.get('service')) > -1) set('service_id', q.get('service')); (function () { var sid = q.get('service'), sel = win.document.getElementById('bk-service'), msg = win.document.getElementById('bk-chosen'); if (!sel || !msg || ['basic', 'general', 'full', 'repair'].indexOf(sid) < 0) return; var o = sel.querySelector('option[value="' + sid + '"]'); if (!o) return; msg.textContent = 'You chose ' + o.textContent + '. Change it below if you want a different one.'; msg.hidden = false; })(); if (q.get('area')) set('area', q.get('area'));
    var linkPin = pinFromQuery(q.get('pincode')), linked = !!(linkPin || q.get('vehicle') === 'car' || q.get('vehicle') === 'bike'); if (linkPin) set('pincode', linkPin);   // the home card: a link wins over a saved draft
    if (q.get('vehicle') === 'car') {   // a car link (from Mechu or an ad): the model goes to the car field, and service or problem to what the car needs
      set('car_model', String(q.get('model') || '').slice(0, 60));
      if (['service', 'problem'].indexOf(q.get('service')) > -1) set('car_need', q.get('service'));
    }
    if (!saved.model && q.get('model') && q.get('vehicle') !== 'car') guessEngine();
    setVehicle(); show(!linked && (saved.step || back.step) && (saved.step || back.step) < 3 ? (saved.step || back.step) : 1);   // a link from the home card starts at step 1 (vehicle, model and service); the PIN is already filled for step 2 started = true;

    /* live fee rows (public, active prices); the defaults above are used if this fails */
    if (C.supabaseUrl && C.supabaseAnonKey && win.fetch) {
      win.fetch(C.supabaseUrl.replace(/\/$/, '') + '/rest/v1/services?select=id,price&active=eq.true&id=in.(confirm_std,confirm_mid,confirm_big,confirm_car,basic,general,full,repair,basic250,general250,full250,basic500,general500,full500)', { headers: { apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey } })
        .then(function (r) { return r.ok ? r.json() : []; }).then(function (list) { (list || []).forEach(function (x) { rows[x.id] = x.price; if (/^confirm_/.test(x.id)) return; if (Number(x.price) > 0) prices[x.id] = Number(x.price); }); showFee(); }).catch(function () {});
    }

    /* pay */
    var call = function (fn, body, tries) {
      // One quiet retry when the network drops (common on phones): the server finds the same form again, so a retry never makes a second booking or order.
      return win.fetch(C.supabaseUrl + '/functions/v1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: C.supabaseAnonKey, Authorization: 'Bearer ' + C.supabaseAnonKey }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, ok: r.ok, d: d }; }); })
        .catch(function (err) { if ((tries || 0) >= 1) throw err; return new Promise(function (res) { win.setTimeout(res, 1500); }).then(function () { return call(fn, body, (tries || 0) + 1); }); });
    };
    var loadCheckout = function () { return new Promise(function (resolve, reject) { if (win.Razorpay) return resolve(); var s = doc.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = resolve; s.onerror = function () { reject(new Error('load')); }; doc.head.appendChild(s); }); };
    var msg = $('#bk-msg'), payBtn = $('#bk-pay');
    try { if (/Instagram|FBAN|FBAV|FB_IAB|MicroMessenger|Line\//i.test(win.navigator.userAgent || '')) { var hint = doc.createElement('p'); hint.className = 'tiny muted'; hint.id = 'bk-inapp'; hint.textContent = 'Payment not opening? Tap the three dots and choose "Open in browser", or message us on WhatsApp and we will send you a payment link.'; payBtn.parentNode.insertBefore(hint, payBtn); } } catch (e3) {}
    var free = function () { busy = false; payBtn.disabled = false; showFee(); };
    var done = function (d, email) {
      store.clear(); sess.clear(); form.hidden = true; var sm = doc.getElementById('bk-sum'); if (sm) sm.hidden = true; var pr = doc.getElementById('bk-prog'); if (pr) pr.hidden = true; var steps = doc.querySelector('.bk-steps'); if (steps) { steps.hidden = true; steps.style.display = 'none'; }   // the step list sits outside the form: the old $() lookup returned null and threw after a successful payment
      var box = doc.getElementById('bkDone'), T = win.MXP_THANKS, I = win.MXP_INSTALL;
      // Keep the private tracking link on this phone (token and booking ID only) so the home page and an installed app can show "Your booking".
      if (I && d.track_token) I.saveBooking(win, { t: d.track_token, id: d.booking_id });
      var o = { bookingId: d.booking_id, email: email, token: d.track_token, name: val('name'), whatsapp: !!val('consent_whatsapp') };
      if (T) T.render(box, win, o);
      else box.innerHTML = '<div class="card bk-card bk-done"><h2>Your slot is confirmed.</h2><p>' + (d.booking_id ? 'Booking ID <b>' + esc(d.booking_id) + '</b>. ' : '') + 'We sent your confirmation and your one-time code to <b>' + esc(email) + '</b>.</p>' + (d.track_token ? '<a class="btn btn-primary wide" href="/track/?t=' + esc(d.track_token) + '&paid=1">Track your booking</a>' : '') + '</div>';
    };
    var verify = function (resp, email) {
      msg.textContent = 'Confirming your payment…';
      call('verify-payment', { razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }).then(function (x) {
        if (x.ok && x.d.status === 'paid') done(x.d, email);
        else if (x.status === 202) { msg.textContent = x.d.message || 'Your payment is being confirmed. We will email you.'; }
        else { free(); msg.textContent = (x.d && x.d.error) || 'We could not confirm the payment. If money was taken, message us on WhatsApp.'; }
      }).catch(function () { free(); msg.textContent = 'No connection while confirming. If money was taken, we will still confirm your booking and email you. You can also message us on WhatsApp.'; });
    };
    form.addEventListener('submit', function (ev) {
      ev.preventDefault(); if (busy) return;
      var v = values(), e = problems(v); markErrors(e);
      if (Object.keys(e).length) { var bad = Object.keys(e)[0], s = /^(model|service_id|car_model)$/.test(bad) ? 1 : /^(name|phone|email)$/.test(bad) ? 3 : 2; msg.textContent = 'Please check the highlighted details.'; if (s !== step) show(s); return; }
      if (!C.supabaseUrl || !C.supabaseAnonKey) { msg.textContent = 'Online booking is not available right now. Message us on WhatsApp.'; return; }
      busy = true; payBtn.disabled = true; msg.textContent = 'Starting your payment…'; var shown = showFee(), s0 = store.get();
      try { if (win.mxpTrack) win.mxpTrack('begin_checkout', { currency: 'INR', value: typeof shown === 'number' ? shown : (shown && shown.fee) || undefined }); } catch (e) {}
      call('book-start', payload(v, s0.key || (save(), store.get().key), {})).then(function (x) {
        if (!x.ok) { free(); if (x.d && x.d.field) markErrors((function (o) { o[x.d.field] = x.d.error; return o; })({})); msg.textContent = (x.d && x.d.error) || 'Something went wrong. Please try again.'; return; }
        if (x.d.status === 'paid') { done(x.d, v.email); return; }
        if (Number(x.d.fee) !== shown.amount) { free(); $('#bk-fee-amt').textContent = 'Pay ₹' + x.d.fee + ' to confirm'; $('#bk-fee-line').textContent = x.d.fee_line || ''; msg.textContent = 'The confirmation fee for your vehicle is ₹' + x.d.fee + '. Tap pay again to continue.'; payBtn.textContent = 'Pay ₹' + x.d.fee + ' to confirm'; return; }
        return loadCheckout().then(function () {
          var o = x.d, rzp = new win.Razorpay({ key: o.key_id, amount: o.amount, currency: o.currency, order_id: o.order_id, name: 'Mechanix Pro', description: 'Confirmation fee, adjusted in your final bill',
            prefill: { name: v.name, email: v.email, contact: '+91' + String(v.phone).replace(/\D/g, '').slice(-10) }, theme: { color: '#F2801F' },
            handler: function (resp) { verify(resp, v.email); }, modal: { ondismiss: function () { free(); msg.textContent = 'Payment cancelled. Nothing was charged. Tap pay to try again.'; } } });
          rzp.on('payment.failed', function (r) { free(); msg.textContent = 'Payment failed' + (r && r.error && r.error.description ? ': ' + r.error.description : '') + '. You can try again.'; });
          msg.textContent = ''; rzp.open();
        }).catch(function () { free(); msg.textContent = 'Could not load the payment window. Check your connection and try again.'; });
      }).catch(function (err) { free(); try { win.console.error('book-start', err); if (win.mxpTrack) win.mxpTrack('book_error', { kind: String((err && err.name) || 'error').slice(0, 40) }); } catch (e2) {}   // no personal details are sent
        var net = err && err.name === 'TypeError' && /fetch|network|load failed/i.test(String(err.message || ''));
        msg.textContent = net ? 'No connection. Please check your internet and tap pay again.' : 'Something went wrong while starting your payment. Please tap pay again, or message us on WhatsApp.'; });
    });
  }
  return { summary: summary, priceFor: priceFor, choicesForStorage: choicesForStorage, CHOICE_KEYS: CHOICE_KEYS, GST_NOTE: GST_NOTE, init: init, pinFromQuery: pinFromQuery, feeFor: feeFor, feeLine: feeLine, engineFromModel: engineFromModel, problems: problems, payload: payload, clamp: clamp, FEE_MIN: FEE_MIN, FEE_MAX: FEE_MAX };
});
