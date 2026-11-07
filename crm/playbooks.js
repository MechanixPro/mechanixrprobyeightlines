// Playbooks: call scripts, SOP checklists and WhatsApp replies for the Crew desk. Static text, no database.
// Fee wording: the confirmation fee is Rs 49, 69 or 99, includes GST, and is adjusted in the final bill.
// No phone numbers, no real customer details. Use [Customer Name] style placeholders or {name} fields.

const FEE = '₹49, ₹69 or ₹99 (the amount depends on the vehicle)';
const FEE_LINE = `Ask for the confirmation fee of ${FEE}. It includes GST and is adjusted in the final bill.`;

export const PLAYBOOKS = [
  { id: 'call-new-enquiry', kind: 'script', title: 'New enquiry call', when: 'A new customer has asked for a service.', steps: [
    'Greet: "Hello [Customer Name], this is [Your Name] from Mechanix Pro. You asked about a bike service. Is this a good time?"',
    'Ask the vehicle: make, model and year.',
    'Ask the issue: what is wrong, or which service they want.',
    'Ask the area and the time that suits them (doorstep or pickup).',
    'Give the quote range for that service. Say the final price is shared after the mechanic checks the vehicle.',
    FEE_LINE,
    'Send the payment link on WhatsApp. Stay on the line until they say they got it.',
    'Close: say what happens next (booking ID after payment, then mechanic assignment). Note the call on the lead.',
  ] },
  { id: 'call-quote-followup', kind: 'script', title: 'Quote follow-up call', when: 'A quote was sent and there is no reply.', steps: [
    'Greet: "Hello [Customer Name], this is [Your Name] from Mechanix Pro. I am calling about the quote we sent for your [Service]."',
    'Ask if they saw it and if they have any questions.',
    'If price is the concern: explain the line items. Do not change the price without a supervisor.',
    'If they need time: ask when to call back and set the follow-up date.',
    'If they agree: confirm the date and time, then send the payment link.',
    'If they decline: ask the reason, thank them, mark the lead lost with that reason.',
  ] },
  { id: 'call-payment-reminder', kind: 'script', title: 'Payment reminder call', when: 'The payment link was sent and is not paid.', steps: [
    'Greet: "Hello [Customer Name], this is [Your Name] from Mechanix Pro. I am calling about your booking for [Service]."',
    'Say: the slot is held only after the confirmation fee is paid.',
    `Remind the fee: ${FEE}. It includes GST and is adjusted in the final bill.`,
    'Ask if the link opened. If not, resend it on WhatsApp.',
    'If the payment failed, ask them to retry once or use another UPI app.',
    'Do not ask for card numbers, UPI PIN or OTP on the call.',
    'Note the answer and set the next follow-up time.',
  ] },
  { id: 'call-breakdown-sos', kind: 'script', title: 'Breakdown or SOS call', when: 'The customer is stuck on the road.', steps: [
    'First ask: "Are you and everyone with you safe?" If not safe, tell them to move away from traffic and call the local emergency number.',
    'Ask them to switch on hazard lights and stand away from the road.',
    'Ask the exact location: landmark, road name, direction. Ask them to share a WhatsApp location pin.',
    'Ask the vehicle, the problem, and if it started or stopped suddenly.',
    'Give an ETA only after a mechanic is confirmed. If not confirmed yet, say you will call back in 10 minutes.',
    'Assign the nearest mechanic and send the customer the mechanic name and ETA.',
    'Call back at the ETA time to check if help has arrived.',
    'Log the case with location, issue and timings.',
  ] },
  { id: 'sop-handover-otp', kind: 'sop', title: 'Handover and OTP at the door', when: 'The mechanic reaches the customer.', steps: [
    'Mechanic greets the customer and shows the app or job link.',
    'Ask the customer for the door code (OTP) shown on their tracking page.',
    'Enter the code. Start the visit only after it is accepted.',
    'Walk around the vehicle with the customer. Note scratches and existing damage.',
    'Take photos of the vehicle, odometer and fuel or battery level.',
    'Note any belongings in the vehicle and tell the customer.',
    'On finish, show the work done and the parts changed.',
    'Take the customer sign-off or the finish code. Take photos of the finished vehicle.',
    'Never share the door code with anyone but the customer.',
  ] },
  { id: 'sop-assign-mechanic', kind: 'sop', title: 'Mechanic assignment', when: 'A paid booking is ready for dispatch.', steps: [
    'Check the booking is paid and has a booking ID.',
    'Check the area, vehicle type and time slot.',
    'Pick a mechanic who is on duty, near the area and free in that slot.',
    'Call or message the mechanic and get a yes.',
    'Assign in the desk. Check the status moved to assigned.',
    'Send the customer the mechanic name and the arrival time.',
    'If no mechanic can take it, tell the customer early and offer another slot.',
  ] },
  { id: 'sop-payment-invoice', kind: 'sop', title: 'Payment received and invoice', when: 'A payment shows as paid.', steps: [
    'Check the payment shows as paid in the desk and matches the booking.',
    'Check the booking ID has been created.',
    'Send the payment received message to the customer.',
    'Confirm the confirmation fee is shown as adjusted in the final bill.',
    'After the work, check the invoice lists each line item with GST shown separately.',
    'Send the invoice to the customer and mark the booking complete.',
    'For refunds or mismatches, pass to the admin. Do not promise a refund on the call.',
  ] },
  { id: 'sop-garage-estimate', kind: 'sop', title: 'Garage partner estimate approval', when: 'A garage partner sends an estimate for the customer.', steps: [
    'Open the estimate and check the vehicle and the issue match the booking.',
    'Check each line: part, labour and GST are separate and add up.',
    'Flag any line that looks high or unclear and ask the garage to explain.',
    'Send the estimate to the customer in simple words.',
    'Wait for the customer approval by phone or on the tracking page. Note who approved and when.',
    'Tell the garage to start only after the approval is recorded.',
    'If the garage finds extra work, repeat this checklist before the work.',
  ] },
  { id: 'reply-booking-received', kind: 'reply', title: 'Booking received', text: 'Hi {name}, we got your request for {service}. We will call you shortly to confirm the details. - Mechanix Pro' },
  { id: 'reply-quote-sent', kind: 'reply', title: 'Quote sent', text: 'Hi {name}, your quote for {service} is ready. The estimate is {amount}. The final bill is shared after the mechanic checks the vehicle. Reply here if you have questions.' },
  { id: 'reply-payment-link', kind: 'reply', title: 'Payment link', text: 'Hi {name}, to confirm your {service} booking for {time}, please pay the confirmation fee of {amount}. It includes GST and is adjusted in your final bill. Payment link: [Payment Link]' },
  { id: 'reply-payment-received', kind: 'reply', title: 'Payment received', text: 'Hi {name}, we received {amount}. Your {service} is confirmed for {time}. We will share the mechanic details before the visit.' },
  { id: 'reply-follow-up', kind: 'reply', title: 'Follow-up', text: 'Hi {name}, this is Mechanix Pro. We are checking on your {service} request. Would you like to go ahead? Tell us a time that suits you.' },
  { id: 'reply-reschedule', kind: 'reply', title: 'Reschedule', text: 'Hi {name}, we need to move your {service} visit. Can we do {time} instead? Please reply with a time that works for you.' },
  { id: 'reply-sorry-delay', kind: 'reply', title: 'Sorry for delay', text: 'Hi {name}, sorry for the delay with your {service}. We are working on it and will reach you by {time}. We will update you if that changes.' },
];

export const KINDS = [['script', 'Scripts'], ['sop', 'SOPs'], ['reply', 'Replies']];
export const byKind = (kind) => PLAYBOOKS.filter((p) => p.kind === kind);
export const findPlaybook = (id) => PLAYBOOKS.find((p) => p.id === id) || null;

export function searchPlaybooks(kind, q) {
  const s = String(q || '').trim().toLowerCase();
  return byKind(kind).filter((p) => !s || (p.title + ' ' + (p.when || '') + ' ' + (p.text || (p.steps || []).join(' '))).toLowerCase().includes(s));
}

// Fill {name} style placeholders. Unknown or empty ones stay visible as {name}.
export function fill(text, vars = {}) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && String(vars[k]).trim() !== '' ? String(vars[k]) : m));
}
export const placeholders = (text) => [...new Set([...String(text ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
