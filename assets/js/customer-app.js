/* Mechanix Pro customer app (/customer/). Pick the bike, see the service packages with their prices, tap Book Package, and the booking page opens already filled.
   No login yet: the bike and PIN code are kept on this phone only. The last booking shows under My bookings. No inline script or style needed. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_CUSTOMER = api; if (root.document) root.document.addEventListener('DOMContentLoaded', function () { api.start(root); }); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VEH = 'mxp_ca_veh', PIN = 'mxp_ca_pin';
  var PACKS = [
    { id: 'basic', name: 'Basic service', note: '15 checkpoints: oil level, air filter, spark plug, brakes, chain, tyres, battery and lights.' },
    { id: 'general', name: 'Standard service', note: '24 checkpoints with filters, clutch, fork and a fuller check.' },
    { id: 'full', name: 'Full service', note: '28 checkpoints with an engine oil change, a road test and a foam wash.' },
    { id: 'repair', name: 'Repair or problem check', note: 'We find the cause and send you a quote first. Work starts only after you approve it.' }
  ];
  /* Extra services, as OkBike lists them. A price shows only where the Prices tab has one (the add-ons); the rest are quoted after a check, as the website already says. */
  var ADDON_IDS = ['wash', 'chain', 'brake', 'tyre', 'battery'];
  var CHECKED = [
    ['Engine oil change and filter', 'Oil and filter fitted. The quote shows the oil and parts you choose.'],
    ['Brake shoe or disc pad replacement', 'Pads or shoes checked and replaced if needed. The part is shown on the quote.'],
    ['Carburettor or throttle body cleaning', 'Cleaned and tuned for a smoother idle and better pickup.'],
    ['Clutch, gear and cable work', 'We check the cause and quote it before any work.'],
    ['Suspension and steering', 'Fork, shock and bearing check with a quote.'],
    ['Electrical and starting problems', 'Battery, starter, wiring and lights checked, then quoted.']
  ];
  var BADGES = ['₹5,000 Mechanix Shield', 'Free pickup and drop', 'Item-wise quote first', 'Redo Promise', 'Genuine parts promise', 'Handover only with your code'];
  var pinOk = function (v) { return /^[0-9]{6}$/.test(String(v || '')); };
  function bookUrl(veh, serviceId, pin) {
    var q = ['vehicle=bike'];
    if (veh && veh.brand) q.push('brand=' + encodeURIComponent(veh.brand));
    if (veh && veh.model) q.push('model=' + encodeURIComponent(veh.model));
    q.push('service=' + encodeURIComponent(serviceId));
    if (pinOk(pin)) q.push('pincode=' + pin);
    return '/book/?' + q.join('&');
  }
  function flat(bikes) { var out = []; Object.keys(bikes || {}).forEach(function (b) { bikes[b].forEach(function (m) { out.push({ brand: b, model: m[0], type: m[1], big: m[2] }); }); }); return out; }
  function search(list, q, max) {
    var t = String(q || '').toLowerCase().replace(/\s+/g, ' ').trim(); if (t.length < 2) return [];
    var parts = t.split(' ');
    return list.filter(function (v) { var s = (v.brand + ' ' + v.model).toLowerCase(); return parts.every(function (p) { return s.indexOf(p) > -1; }); }).slice(0, max || 8);
  }
  function priceOf(items, id) { var it = (items || []).filter(function (x) { return x.id === id; })[0]; return it && Number(it.price_inr) > 0 ? Number(it.price_inr) : null; }
  function start(win) {
    var d = win.document, main = d.getElementById('caMain'), pinIn = d.getElementById('caPin'), S = { tab: 'home', veh: null, items: null, bad: false, hits: [], q: '' };
    var all = flat(win.MXP_BIKES), ls = { get: function (k) { try { return win.localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { win.localStorage.setItem(k, v); } catch (e) {} } };
    try { S.veh = JSON.parse(ls.get(VEH) || 'null'); } catch (e) { S.veh = null; }
    var pin = ls.get(PIN) || ''; if (pinOk(pin)) pinIn.value = pin;
    pinIn.addEventListener('input', function () { pin = pinIn.value.replace(/\D/g, '').slice(0, 6); pinIn.value = pin; if (pinOk(pin) || !pin) ls.set(PIN, pin); if (S.tab === 'home') render(); });
    function el(tag, props, kids) { var n = d.createElement(tag); Object.keys(props || {}).forEach(function (k) { if (k === 'text') n.textContent = props[k]; else if (k === 'onclick') n.addEventListener('click', props[k]); else if (props[k] != null) n.setAttribute(k, props[k]); }); (kids || []).forEach(function (c) { if (c) n.appendChild(c); }); return n; }
    function pick(v) { S.veh = v; S.hits = []; S.q = ''; ls.set(VEH, JSON.stringify(v)); render(); }
    function home() {
      var out = [];
      var box = el('div', { class: 'ca-search' }), inp = el('input', { type: 'search', id: 'caVeh', placeholder: 'Type your bike or scooter (Activa, Pulsar, Splendor)', 'aria-label': 'Search your bike or scooter', autocomplete: 'off' });
      var res = el('ul', { class: 'ca-list', id: 'caHits' });
      function paint() { res.textContent = ''; S.hits.forEach(function (v) { var li = el('li'); li.appendChild(el('a', { href: '#', text: v.brand + ' ' + v.model, onclick: function (e) { e.preventDefault(); pick(v); } })); res.appendChild(li); }); var q = inp.value.trim(); if (q.length >= 2) { var li2 = el('li'); li2.appendChild(el('a', { href: '#', text: 'Use "' + q + '" (my bike is not listed)', onclick: function (e) { e.preventDefault(); pick({ brand: '', model: q.slice(0, 60), type: 'm', big: 0 }); } })); res.appendChild(li2); } }
      inp.value = S.q; S.hits = search(all, S.q, 6); paint();
      inp.addEventListener('input', function () { S.q = inp.value; S.hits = search(all, inp.value, 6); paint(); });
      box.appendChild(inp); out.push(box); out.push(res);
      if (!S.veh) { out.push(el('p', { class: 'ca-hints', text: 'Choose your vehicle to see the packages and prices for it.' })); }
      else {
        out.push(el('div', { class: 'ca-card ca-veh' }, [el('div', {}, [el('small', { text: 'Service for vehicle' }), el('b', { text: [S.veh.brand, S.veh.model].filter(Boolean).join(' ') })]), el('button', { class: 'ca-btn ghost', type: 'button', text: 'Change', onclick: function () { S.veh = null; ls.set(VEH, 'null'); render(); } })]));
      }
      out.push(el('h2', { text: 'Packages and pricing' }));
      PACKS.forEach(function (p) {
        var price = priceOf(S.items, p.id), big = S.veh && S.veh.big;
        out.push(el('article', { class: 'ca-card ca-pkg' }, [
          el('div', { class: 'row' }, [el('h3', { text: p.name }), el('span', { class: 'ca-price', text: price ? 'From ₹' + price : (S.items || S.bad ? 'Quoted first' : '…') })]),
          el('p', { text: p.note + (price ? ' Price excludes GST.' : '') + (price && big ? ' Bigger engines have their own price, shown when you book.' : '') }),
          el('div', { class: 'foot' }, [el('span', { class: 'ca-ok', text: 'Free pickup and drop in our area' }), el('a', { class: 'ca-btn', href: bookUrl(S.veh, p.id, pin), text: 'Book package' })])]));
      });
      var adds = (S.items || []).filter(function (x) { return ADDON_IDS.indexOf(x.id) > -1 && Number(x.price_inr) > 0; });
      if (adds.length) {
        out.push(el('h2', { text: 'Add to your service' }));
        adds.forEach(function (x) { out.push(el('article', { class: 'ca-card ca-pkg' }, [el('div', { class: 'row' }, [el('h3', { text: x.name }), el('span', { class: 'ca-price', text: '₹' + Number(x.price_inr) })]), el('p', { text: x.description + ' Price excludes GST. Add it when you book.' })])); });
      }
      out.push(el('h2', { text: 'Quoted after a check' }));
      CHECKED.forEach(function (c) { out.push(el('article', { class: 'ca-card ca-pkg' }, [el('div', { class: 'row' }, [el('h3', { text: c[0] }), el('span', { class: 'ca-ok', text: 'Quote first' })]), el('p', { text: c[1] }), el('div', { class: 'foot' }, [el('span', { class: 'ca-muted', text: 'No work starts until you approve the quote.' }), el('a', { class: 'ca-btn ghost', href: bookUrl(S.veh, 'repair', pin), text: 'Get a quote' })])])); });
      out.push(el('article', { class: 'ca-card ca-pkg' }, [el('div', { class: 'row' }, [el('h3', { text: 'Breakdown or puncture on the road' }), el('span', { class: 'ca-ok', text: 'Roadside' })]), el('p', { text: 'A mechanic comes to you. The visit charge is shown before the visit.' }), el('div', { class: 'foot' }, [el('span', {}), el('a', { class: 'ca-btn ghost', href: '/roadside/', text: 'Get roadside help' })])]));
      out.push(el('h2', { text: 'Why Mechanix Pro' }));
      out.push(el('div', { class: 'ca-badges' }, BADGES.map(function (b) { return el('span', { text: b }); })));
      out.push(el('p', { class: 'ca-hints', text: ' ' }));
      out.push(el('p', { class: 'ca-hints', text: 'Prices are starting prices. We send an item-wise quote on WhatsApp first, and work starts only after you approve it.' }));
      return out;
    }
    function bookings() {
      var L = win.MXP_INSTALL && win.MXP_INSTALL.lastBooking ? win.MXP_INSTALL.lastBooking(win, 60) : null, out = [el('h2', { text: 'My bookings' })];
      if (L) out.push(el('div', { class: 'ca-card' }, [el('b', { text: L.id ? 'Booking ' + L.id : 'Your last booking' }), el('p', { class: 'ca-muted', text: 'See the status, your handover code, photos, the quote and the bill.' }), el('a', { class: 'ca-btn', href: '/track/?t=' + L.t, text: 'Track this booking' })]));
      else out.push(el('div', { class: 'ca-card' }, [el('p', { class: 'ca-muted', text: 'No booking on this phone yet. Pick a package on Home to book. If you already booked, open the tracking link we sent you once, and it will show here.' }), el('a', { class: 'ca-btn ghost', href: '/track/', text: 'Find a booking by ID' })]));
      return out;
    }
    function profile() {
      var C = win.MXP || {}, wa = 'https://wa.me/' + (C.whatsapp || '918042303061') + '?text=' + encodeURIComponent('Hi Mechanix Pro, I need help.');
      var out = [el('h2', { text: 'Help and account' })], ul = el('ul', { class: 'ca-list' });
      [['Chat with us on WhatsApp', wa], ['Roadside help', '/roadside/'], ['Services and prices', '/services/'], ['Rate card', '/rate-card/'], ['Warranty', '/warranty/'], ['How it works', '/help/'], ['Terms and privacy', '/privacy/']].forEach(function (x) { var li = el('li'); li.appendChild(el('a', { href: x[1], text: x[0] })); ul.appendChild(li); });
      out.push(ul);
      var inst = el('div', { class: 'ca-card' }, [el('b', { text: 'Add Mechanix Pro to your home screen' }), el('p', { class: 'ca-muted', id: 'caInst', text: 'Open the browser menu and choose Install app or Add to Home screen.' })]); out.push(inst);
      return out;
    }
    function render() {
      main.textContent = ''; (S.tab === 'home' ? home() : S.tab === 'bookings' ? bookings() : profile()).forEach(function (n) { main.appendChild(n); });
      Array.prototype.forEach.call(d.querySelectorAll('.ca-nav button'), function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === S.tab); });
      var fxKey = S.tab + ':' + (S.items && S.items.length ? 1 : 0); if (S.fxKey !== fxKey) { S.fxKey = fxKey; if (win.MXP_FX) win.MXP_FX.play(win, 'cards', main); }
      if (S.tab === 'home' && S.hits.length) { var h = d.getElementById('caVeh'); if (h) h.focus(); }
    }
    Array.prototype.forEach.call(d.querySelectorAll('.ca-nav button'), function (b) { b.addEventListener('click', function () { S.tab = b.getAttribute('data-tab'); render(); win.scrollTo(0, 0); }); });
    render();
    try { win.fetch((win.MXP || {}).supabaseUrl + '/functions/v1/public-services').then(function (r) { return r.json(); }).then(function (j) { S.items = (j && j.items) || []; if (S.tab === 'home') render(); }).catch(function () { S.bad = true; if (S.tab === 'home') render(); }); } catch (e) { S.bad = true; }
  }
  return { bookUrl: bookUrl, flat: flat, search: search, priceOf: priceOf, PACKS: PACKS, start: start };
});
