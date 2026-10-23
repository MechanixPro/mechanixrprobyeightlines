// AiSensy wants the sample text with each {{n}} replaced by a [Label] in square brackets.
// The WhatsApp templates and API campaigns the desk uses on the AiSensy number. Pure data, so a test can check the placeholders against what the code sends.
export type DeskTemplate = { campaign: string; name: string; label: string; category: 'UTILITY' | 'MARKETING'; text: string; sample: string; params: number };

export const DESK_TEMPLATES: DeskTemplate[] = [
  { campaign: 'mxp_desk_payment_link', name: 'mxp_desk_payment_link', label: 'Desk payment link', category: 'UTILITY',
    text: 'Hi {{1}}, here is your secure link to pay Rs {{2}} for Mechanix Pro booking {{3}}: {{4}}. Reply here if you need any help.',
    sample: 'Hi [Name], here is your secure link to pay Rs [Amount] for Mechanix Pro booking [Booking]: [Link]. Reply here if you need any help.', params: 4 },
  { campaign: 'mxp_desk_rating_link', name: 'mxp_desk_rating_link', label: 'Desk rating link', category: 'UTILITY',
    text: 'Hi {{1}}, thanks for choosing Mechanix Pro for booking {{2}}. How was the service? Rate it in 10 seconds: {{3}} Thank you for trusting us.',
    sample: 'Hi [Name], thanks for choosing Mechanix Pro for booking [Booking]. How was the service? Rate it in 10 seconds: [Link] Thank you for trusting us.', params: 3 },
  { campaign: 'mxp_desk_followup', name: 'mxp_desk_followup', label: 'Desk follow-up', category: 'MARKETING',
    text: 'Hi {{1}}, this is {{2}} from Mechanix Pro about your bike service enquiry. When would you like us to come to you?',
    sample: 'Hi [Name], this is [Agent] from Mechanix Pro about your bike service enquiry. When would you like us to come to you?', params: 2 },
  { campaign: 'mxp_quote_ready', name: 'mxp_quote_ready', label: 'Quote ready', category: 'UTILITY',
    text: 'Hi {{1}}, your Mechanix Pro quote for booking {{2}} is ready: Rs {{3}}, GST included. Nothing starts until you approve it. Reply YES to go ahead, or tell us what to change.',
    sample: 'Hi [Name], your Mechanix Pro quote for booking [Booking] is ready: Rs [Amount], GST included. Nothing starts until you approve it. Reply YES to go ahead, or tell us what to change.', params: 3 },
  { campaign: 'mxp_booking_confirmed', name: 'mxp_booking_confirmed', label: 'Booking confirmed', category: 'UTILITY',
    text: 'Hi {{1}}, your Mechanix Pro booking {{2}} is confirmed for {{3}}. Your mechanic {{4}} will come to {{5}}. Reply here if you need to change anything.',
    sample: 'Hi [Name], your Mechanix Pro booking [Booking] is confirmed for [When]. Your mechanic [Mechanic] will come to [Area]. Reply here if you need to change anything.', params: 5 },
  { campaign: 'mxp_service_done', name: 'mxp_service_done', label: 'Service done', category: 'UTILITY',
    text: 'Hi {{1}}, your bike service for booking {{2}} is done. Our 30-day service warranty has started, and your GST invoice is on its way. Reply here if anything feels off.',
    sample: 'Hi [Name], your bike service for booking [Booking] is done. Our 30-day service warranty has started, and your GST invoice is on its way. Reply here if anything feels off.', params: 2 },
];

/** Number of distinct {{n}} placeholders, and whether they run 1..n with no gaps (WhatsApp requires that). */
export function placeholders(text: string): { count: number; sequential: boolean } {
  const nums = [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  return { count: nums.length, sequential: nums.every((n, i) => n === i + 1) };
}
