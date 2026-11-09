/* Today Slots: Today is a choice only while a time window is still ahead. Same rule as supabase/functions/_shared/today-slots.ts (a test keeps them identical).
   A window can be booked today only if it starts at least 2 hours from now (India time); "As soon as possible" is for today only, 8 AM to 6 PM. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MXP_TODAY = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var SLOT_START = { morning: 9, afternoon: 12, evening: 16 }, LEAD_HOURS = 2, ASAP_FROM = 8, ASAP_UNTIL = 18;
  function todaySlots(now) {
    var ist = new Date(now + 330 * 60000), h = ist.getUTCHours() + ist.getUTCMinutes() / 60;
    var open = function (start) { return start >= h + LEAD_HOURS; };
    var s = { morning: open(SLOT_START.morning), afternoon: open(SLOT_START.afternoon), evening: open(SLOT_START.evening), asap: h >= ASAP_FROM && h < ASAP_UNTIL };
    s.any = s.morning || s.afternoon || s.evening || s.asap; return s;
  }
  function istToday(now) { return new Date(now + 330 * 60000).toISOString().slice(0, 10); }
  return { todaySlots: todaySlots, istToday: istToday };
});
