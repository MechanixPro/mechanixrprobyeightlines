// admin/nav.js — how the admin pages are grouped (no DOM, no Supabase), so it can be tested in Node.
// Five sections instead of fifteen tabs: the daily work comes first and the rarely used pages sit under More.
export const GROUPS = [
  { id: 'today', label: 'Today', tabs: [['dash', 'Dashboard']] },
  { id: 'bookings', label: 'Bookings', tabs: [['leads', 'Bookings'], ['customers', 'Customers'], ['issues', 'Issues']] },
  { id: 'money', label: 'Money', tabs: [['invoices', 'Invoices'], ['reports', 'Reports'], ['coupons', 'Coupons'], ['prices', 'Prices']] },
  { id: 'team', label: 'Team and areas', tabs: [['mechanics', 'Mechanics'], ['pins', 'PIN codes']] },
  { id: 'more', label: 'More', tabs: [['offers', 'Offers'], ['waitlist', 'Waitlist'], ['homeimgs', 'Home images'], ['settings', 'Settings'], ['activity', 'Activity']] },
];
export const ALL_TABS = GROUPS.flatMap((g) => g.tabs.map((t) => t[0]));
export const groupOf = (tab) => (GROUPS.find((g) => g.tabs.some((t) => t[0] === tab)) || GROUPS[0]).id;
export const tabsOf = (group) => (GROUPS.find((g) => g.id === group) || GROUPS[0]).tabs;
export const firstTab = (group) => (GROUPS.find((g) => g.id === group) || GROUPS[0]).tabs[0][0];

// Small numbers on a section when something needs the client: new bookings, open issues, and payments being waited on.
export function navBadges({ leads = [], issues = [] } = {}) {
  const n = (rows, f) => rows.filter(f).length;
  return { today: 0, bookings: n(leads, (l) => l.status === 'new') + n(issues, (i) => i.status !== 'resolved'), money: n(leads, (l) => l.status === 'payment_sent'), team: 0, more: 0 };
}
