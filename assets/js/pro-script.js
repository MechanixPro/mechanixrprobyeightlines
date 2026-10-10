/* Mechanix Pro — what "Pro", the helper character, says. Pure functions (no DOM), used by pro.js in the browser and by tests/ in Node.
   Every line is a true statement about the service. No AI, no made-up urgency, discounts or numbers. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_PRO = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var BRANDS = ['Honda', 'TVS', 'Bajaj', 'Royal Enfield'];
  var SHORT = { 'Royal Enfield': 'Enfield' };
  var clean = function (v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n); };
  var rupee = function (n) { return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN'); };

  // The first thing Pro says on a page, or null when Pro should stay out of the way.
  function greet(path) {
    path = String(path || '/');
    if (path === '/') return { state: 'wave', text: 'Hi, I\'m Pro. Which bike do you ride?', chips: BRANDS.map(function (b) { return { label: SHORT[b] || b, href: '/book/?brand=' + encodeURIComponent(b) }; }) };
    if (path.indexOf('/roadside') === 0) return { state: 'think', text: 'Stuck right now? Send your live location on WhatsApp and we send the nearest mechanic.', chips: [{ label: 'Send my location', wa: true, text: 'Hi Mechanix Pro, my bike has broken down. I am sharing my live location now.' }] };
    if (path.indexOf('/services') === 0) return { state: 'wave', text: 'Not sure what your bike needs? Build your service and see the price in a minute.', chips: [{ label: 'Build my service', href: '/book/' }] };
    if (path.indexOf('/offers/') === 0) return { state: 'wave', text: 'Want this done at your door? Build it in under a minute. You get a quote first.', chips: [{ label: 'Build my service', href: '/book/' }] };
    if (path.indexOf('/bike-service') === 0) return { state: 'wave', text: 'A Mechanix Pro mechanic can come to you. Build your service and see the price.', chips: [{ label: 'Build my service', href: '/book/' }] };
    return null;
  }

  // What Pro says as the visitor builds their service. kind: bike | service | pin | final | idle.
  function react(kind, d) {
    d = d || {};
    if (kind === 'bike') {
      var nick = clean(d.nick, 24), model = clean(d.model, 40);
      if (nick) return { state: 'nod', text: 'Nice, ' + nick + '! Now pick what it needs.' };
      if (model) return { state: 'nod', text: model + ', good choice. Now tell us what it needs.' };
    }
    if (kind === 'service' && d.name) return { state: 'nod', text: clean(d.name, 40) + ': from ' + rupee(d.price) + ', GST included. Your exact quote comes on WhatsApp.' };
    if (kind === 'pin') {
      if (d.served) return { state: 'cheer', text: 'Good news, we serve ' + (clean(d.name, 40) || 'your area') + '.' };
      return { state: 'think', text: 'We reach all of Bengaluru. Outside it? Send it anyway and we will tell you when we do.' };
    }
    if (kind === 'final') return { state: 'cheer', text: 'Almost done. Send it on WhatsApp: you get a quote first, and nothing starts until you say yes.' };
    if (kind === 'idle') return { state: 'think', text: 'Stuck on something? Message us on WhatsApp and we will help.', chips: [{ label: 'Chat on WhatsApp', wa: true, text: 'Hi Mechanix Pro, I need help with my booking.' }] };
    return null;
  }
  return { greet: greet, react: react, BRANDS: BRANDS };
});
