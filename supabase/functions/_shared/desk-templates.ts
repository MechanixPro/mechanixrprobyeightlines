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
  { campaign: 'mxp_quote_ready_v2', name: 'mxp_quote_ready_v2', label: 'Quote ready', category: 'UTILITY',
    text: 'Hi {{1}}, your Mechanix Pro quote for booking {{2}} is ready: Rs {{3}} excluding GST. GST is added on the final invoice. Nothing starts until you approve it. Reply YES to go ahead, or tell us what to change.',
    sample: 'Hi [Name], your Mechanix Pro quote for booking [Booking] is ready: Rs [Amount] excluding GST. GST is added on the final invoice. Nothing starts until you approve it. Reply YES to go ahead, or tell us what to change.', params: 3 },
  { campaign: 'mxp_booking_confirmed', name: 'mxp_booking_confirmed', label: 'Booking confirmed', category: 'UTILITY',
    text: 'Hi {{1}}, your Mechanix Pro booking {{2}} is confirmed for {{3}}. Your mechanic {{4}} will come to {{5}}. Reply here if you need to change anything.',
    sample: 'Hi [Name], your Mechanix Pro booking [Booking] is confirmed for [When]. Your mechanic [Mechanic] will come to [Area]. Reply here if you need to change anything.', params: 5 },
  { campaign: 'mxp_job_assigned', name: 'mxp_job_assigned', label: 'Job assigned (mechanic)', category: 'UTILITY',
    text: 'Hi {{1}}, new job for you: booking {{2}}, {{3}}, {{4}}, {{5}}. Open your job here: {{6}} Please reply OK when you have seen this.',
    sample: 'Hi [Mechanic], new job for you: booking [Booking], [Vehicle and service], [Area and PIN], [Slot]. Open your job here: [Link] Please reply OK when you have seen this.', params: 6 },
  { campaign: 'mxp_booking_unpaid', name: 'mxp_booking_unpaid', label: 'Booking not paid (reminder)', category: 'UTILITY',
    text: 'Hi {{1}}, you started booking a service for your {{2}} with Mechanix Pro. To hold your slot, pay the small confirmation fee of Rs {{3}}. It is adjusted in your final bill. Finish here: {{4}} Reply if you need any help.',
    sample: 'Hi [Name], you started booking a service for your [Vehicle] with Mechanix Pro. To hold your slot, pay the small confirmation fee of Rs [Amount]. It is adjusted in your final bill. Finish here: [Link] Reply if you need any help.', params: 4 },
  { campaign: 'mxp_service_done', name: 'mxp_service_done', label: 'Service done', category: 'UTILITY',
    text: 'Hi {{1}}, your bike service for booking {{2}} is done. Our 30-day service warranty has started, and your GST invoice is on its way. Reply here if anything feels off.',
    sample: 'Hi [Name], your bike service for booking [Booking] is done. Our 30-day service warranty has started, and your GST invoice is on its way. Reply here if anything feels off.', params: 2 },
  { campaign: 'mxp_warranty_card', name: 'mxp_warranty_card', label: 'Warranty card', category: 'UTILITY',
    text: 'Hi {{1}}, thank you. Your Mechanix Pro booking {{2}} is fully paid and your service warranty card is ready. It is valid until {{3}}. Open and verify it here: {{4}} Thank you for choosing Mechanix Pro.',
    sample: 'Hi [Name], thank you. Your Mechanix Pro booking [Booking] is fully paid and your service warranty card is ready. It is valid until [Date]. Open and verify it here: [Link] Thank you for choosing Mechanix Pro.', params: 4 },
  { campaign: 'mxp_ivr_roadside', name: 'mxp_ivr_roadside', label: 'Call: roadside', category: 'UTILITY',
    text: 'Hi, this is Mechanix Pro. Please share your live location here and tell us what happened to your bike. Our roadside team is on it.',
    sample: 'Hi, this is Mechanix Pro. Please share your live location here and tell us what happened to your bike. Our roadside team is on it.', params: 0 },
  { campaign: 'mxp_ivr_book', name: 'mxp_ivr_book', label: 'Call: book a service', category: 'UTILITY',
    text: 'Hi, thanks for calling Mechanix Pro. Build your service and get your quote here: https://mechanixpro.in/book/ . Nothing starts until you say yes.',
    sample: 'Hi, thanks for calling Mechanix Pro. Build your service and get your quote here: https://mechanixpro.in/book/ . Nothing starts until you say yes.', params: 0 },
  { campaign: 'mxp_ivr_track', name: 'mxp_ivr_track', label: 'Call: track a booking', category: 'UTILITY',
    text: 'Hi, track your Mechanix Pro booking here: https://mechanixpro.in/track/ . Send your booking reference if you need help.',
    sample: 'Hi, track your Mechanix Pro booking here: https://mechanixpro.in/track/ . Send your booking reference if you need help.', params: 0 },
  { campaign: 'mxp_ivr_car', name: 'mxp_ivr_car', label: 'Call: car service', category: 'UTILITY',
    text: 'Hi, thanks for calling Mechanix Pro. Tell us your car make and model, your area and what it needs, such as periodic service, brakes, jump start or towing. We confirm the price before any work.',
    sample: 'Hi, thanks for calling Mechanix Pro. Tell us your car make and model, your area and what it needs, such as periodic service, brakes, jump start or towing. We confirm the price before any work.', params: 0 },
  { campaign: 'mxp_ivr_business', name: 'mxp_ivr_business', label: 'Call: fleet, society or garage', category: 'UTILITY',
    text: 'Hi, thanks for calling Mechanix Pro. Please tell us your company or society name, how many vehicles, and the best time to call.',
    sample: 'Hi, thanks for calling Mechanix Pro. Please tell us your company or society name, how many vehicles, and the best time to call.', params: 0 },
  { campaign: 'mxp_ivr_missed', name: 'mxp_ivr_missed', label: 'Call: missed call', category: 'UTILITY',
    text: 'Hi, sorry we missed your call to Mechanix Pro. Tell us your bike and area and we will call you back.',
    sample: 'Hi, sorry we missed your call to Mechanix Pro. Tell us your bike and area and we will call you back.', params: 0 },
  { campaign: 'mxp_lead_ack', name: 'mxp_lead_ack', label: 'New lead acknowledgement', category: 'UTILITY',
    text: 'Hi {{1}}, thanks for contacting Mechanix Pro. We have your enquiry and a Care Buddy will reach you shortly. Quote first, pay after you say yes.',
    sample: 'Hi [Name], thanks for contacting Mechanix Pro. We have your enquiry and a Care Buddy will reach you shortly. Quote first, pay after you say yes.', params: 1 },
];

/** Number of distinct {{n}} placeholders, and whether they run 1..n with no gaps (WhatsApp requires that). */
export function placeholders(text: string): { count: number; sequential: boolean } {
  const nums = [...new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  return { count: nums.length, sequential: nums.every((n, i) => n === i + 1) };
}
