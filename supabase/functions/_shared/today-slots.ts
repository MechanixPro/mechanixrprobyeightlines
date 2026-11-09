// Today Slots: Today is a choice only while a time window is still ahead. Same rule as assets/js/today-slots.js (a test keeps them identical).
// A window can be booked today only if it starts at least 2 hours from now (India time); "As soon as possible" is for today only, 8 AM to 6 PM.
export const SLOT_START: Record<string, number> = { morning: 9, afternoon: 12, evening: 16 };
export const LEAD_HOURS = 2, ASAP_FROM = 8, ASAP_UNTIL = 18;

/** Which slots can still be booked today, at this moment (ms). */
export function todaySlots(now: number): { morning: boolean; afternoon: boolean; evening: boolean; asap: boolean; any: boolean } {
  const ist = new Date(now + 330 * 60_000), h = ist.getUTCHours() + ist.getUTCMinutes() / 60;
  const open = (start: number) => start >= h + LEAD_HOURS;
  const s = { morning: open(SLOT_START.morning), afternoon: open(SLOT_START.afternoon), evening: open(SLOT_START.evening), asap: h >= ASAP_FROM && h < ASAP_UNTIL };
  return { ...s, any: s.morning || s.afternoon || s.evening || s.asap };
}
/** Today's date in India, YYYY-MM-DD. */
export function istToday(now: number): string { return new Date(now + 330 * 60_000).toISOString().slice(0, 10); }
