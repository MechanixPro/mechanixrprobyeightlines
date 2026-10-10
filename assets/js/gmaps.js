/* Google Maps, used in two places: address search in the booking form and the Find us map on the Contact page.
   Nothing loads from Google until a key is set in config.js (googleMapsKey). Without a key the site works as before. */
(function () {
  'use strict';
  var C = window.MXP || {}, ready = null, token = null;
  var BOUNDS = { south: 12.78, north: 13.22, west: 77.38, east: 77.85 }; // Bengaluru

  function load() {
    if (!C.googleMapsKey) return Promise.reject(new Error('no key'));
    if (ready) return ready;
    ready = new Promise(function (resolve, reject) {
      if (window.google && window.google.maps && window.google.maps.importLibrary) return resolve();
      window.__mxpGmapsReady = resolve;
      var s = document.createElement('script'); s.async = true; s.onerror = function () { ready = null; reject(new Error('load failed')); };
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(C.googleMapsKey) + '&loading=async&v=weekly&callback=__mxpGmapsReady';
      document.head.appendChild(s);
    });
    return ready;
  }
  function places() { return load().then(function () { return window.google.maps.importLibrary('places'); }); }

  // Suggestions for what the customer typed: India only, inside Bengaluru. One session token per search, so Google bills one search, not one per key press.
  function suggest(text) {
    return places().then(function (lib) {
      if (!token) token = new lib.AutocompleteSessionToken();
      return lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input: text, sessionToken: token, includedRegionCodes: ['in'], locationRestriction: BOUNDS, language: 'en' });
    }).then(function (r) {
      return (r.suggestions || []).filter(function (x) { return x.placePrediction; }).slice(0, 5).map(function (x) {
        var p = x.placePrediction;
        return { main: p.mainText ? p.mainText.text : p.text.text, secondary: p.secondaryText ? p.secondaryText.text : '', prediction: p };
      });
    });
  }
  // The chosen suggestion -> a plain object (address, coordinates, PIN) that logic.js turns into form fields.
  function details(item) {
    var place = item.prediction.toPlace();
    return place.fetchFields({ fields: ['location', 'formattedAddress', 'addressComponents'] }).then(function () {
      token = null; // the search is over
      return {
        formattedAddress: place.formattedAddress || '',
        location: place.location ? { lat: place.location.lat(), lng: place.location.lng() } : null,
        addressComponents: (place.addressComponents || []).map(function (c) { return { longText: c.longText, types: c.types }; }),
      };
    });
  }
  window.MXP_GMAPS = { enabled: !!C.googleMapsKey, suggest: suggest, details: details };

  // Find us map: replaces the placeholder with Google's embedded map when a key is set. The directions link stays either way.
  function embeds() {
    if (!C.googleMapsKey) return;
    [].forEach.call(document.querySelectorAll('[data-gmap-embed]'), function (el) {
      var f = document.createElement('iframe');
      f.src = 'https://www.google.com/maps/embed/v1/place?key=' + encodeURIComponent(C.googleMapsKey) + '&zoom=16&q=' + encodeURIComponent(el.getAttribute('data-q') || '');
      f.title = el.getAttribute('data-title') || 'Map'; f.loading = 'lazy'; f.referrerPolicy = 'no-referrer-when-downgrade'; f.setAttribute('allowfullscreen', '');
      f.addEventListener('load', function () { el.classList.add('on'); });
      el.appendChild(f);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', embeds); else embeds();
})();
