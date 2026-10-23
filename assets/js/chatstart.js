/* Mechanix Pro chat starter: a short chat at the top of the home and ad pages. The customer taps their bike and what it needs, sees the
   real starting price, and WhatsApp opens with a ready message. Plain links work without this script (see the markup).
   Every line is true: quote first, nothing charged until approval, no made-up urgency or numbers. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else { root.MXP_CHAT = api; if (root.document) api.start(root); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var BIKES = [{ id: 'scooter', label: 'Scooter', say: 'scooter' }, { id: 'motorcycle', label: 'Motorcycle', say: 'motorcycle' },
    { id: 'enfield', label: 'Royal Enfield', say: 'Royal Enfield' }, { id: 'electric', label: 'Electric', say: 'electric scooter or bike' }];
  var NEEDS = [{ id: 'service', label: 'Regular service', say: 'a service' }, { id: 'problem', label: "Something's wrong", say: 'a problem check' },
    { id: 'sos', label: 'Breakdown right now', href: '/roadside/' }];
  var clean = function (v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n); };

  function buildMessage(o) {
    o = o || {};
    var need = NEEDS.filter(function (n) { return n.id === o.need && n.say; })[0] || NEEDS[0];
    var bike = BIKES.filter(function (b) { return b.id === o.bike || b.say === o.bike; })[0];
    var bikeText = bike ? bike.say : (clean(o.bike, 30) || 'bike');
    var campaign = clean(o.campaign, 40).replace(/[^a-z0-9-]/gi, '');
    return 'Hi Mechanix Pro, I need ' + need.say + ' for my ' + bikeText + ' in Bengaluru.\nBike model: \nArea: ' + (campaign ? '\n(campaign: ' + campaign + ')' : '') + '\n\nSent from mechanixpro.in';
  }
  function waUrl(num, text) { num = String(num || '').replace(/\D/g, ''); return /^\d{12}$/.test(num) ? 'https://wa.me/' + num + '?text=' + encodeURIComponent(text) : null; }
  function priceLine(prices, need) {
    prices = prices || {};
    var p = need === 'problem' ? prices.repair : prices.service;
    return (need === 'problem' ? 'A problem check starts at ' : 'Service starts from ') + (p || 'our price list') + ', GST included. You get your quote on WhatsApp first and pay only after you approve it.';
  }

  function start(win) {
    var doc = win.document, box = doc.getElementById('chat'); if (!box) return;
    var C = win.MXP || {}, log = box.querySelector('.chat-log'), opts = box.querySelector('.chat-opts'); if (!log || !opts) return;
    var calm = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var prices = { service: box.getAttribute('data-price-service'), repair: box.getAttribute('data-price-repair') };
    var campaign = box.getAttribute('data-campaign') || '';
    var track = function (n, p) { try { if (win.mxpTrack) win.mxpTrack(n, p || {}); } catch (e) {} };
    var state = { bike: null, need: null };
    box.classList.add('live');
    // JavaScript is running, so the plain fallback links in .chat-opts are replaced by the chat's own buttons.
    function bubble(text, who) { var b = doc.createElement('div'); b.className = 'bubble ' + who + (calm ? '' : ' pop'); b.textContent = text; log.appendChild(b); return b; }
    function setOptions(items, onPick) {
      opts.textContent = '';
      items.forEach(function (it, i) {
        var b = doc.createElement('button'); b.type = 'button'; b.className = 'ride-chip'; b.textContent = it.label;
        b.addEventListener('click', function () { onPick(it); }); opts.appendChild(b); if (i === 0) setTimeout(function () { b.focus({ preventScroll: true }); }, 0);
      });
    }
    function after(fn) { if (calm) fn(); else setTimeout(fn, 350); }
    function askBike() {
      setOptions(BIKES, function (b) { state.bike = b; track('chat_bike', { bike: b.id }); bubble(b.label, 'out'); after(askNeed); });
    }
    function askNeed() {
      bubble('Got it. What does it need?', 'in');
      setOptions(NEEDS, function (n) {
        track('chat_need', { need: n.id });
        if (n.href) { win.location.href = n.href; return; }
        state.need = n; bubble(n.label, 'out'); after(finish);
      });
    }
    function finish() {
      bubble(priceLine(prices, state.need.id), 'in');
      var url = waUrl(C.whatsapp, buildMessage({ bike: state.bike.id, need: state.need.id, campaign: campaign })) || '/book/';
      opts.textContent = '';
      var a = doc.createElement('a'); a.className = 'btn btn-wa chat-go'; a.href = url; a.textContent = 'Continue on WhatsApp'; a.rel = 'noopener';
      a.addEventListener('click', function () { track('whatsapp_click', { page: win.location.pathname, from: 'chat' }); });
      var back = doc.createElement('button'); back.type = 'button'; back.className = 'chat-reset'; back.textContent = 'Start over';
      back.addEventListener('click', function () { log.textContent = ''; bubble('Hi! I\'m the Mechanix Pro team. What do you ride?', 'in'); askBike(); });
      opts.appendChild(a); opts.appendChild(back); a.focus({ preventScroll: true });
    }
    log.textContent = ''; bubble('Hi! I\'m the Mechanix Pro team. What do you ride?', 'in'); askBike();
  }
  return { BIKES: BIKES, NEEDS: NEEDS, buildMessage: buildMessage, waUrl: waUrl, priceLine: priceLine, start: start };
});
