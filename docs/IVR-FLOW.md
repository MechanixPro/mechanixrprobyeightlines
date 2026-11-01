# IVR and WhatsApp flow

**Call number:** +91 79652 95649 (IVR). **WhatsApp:** +91 80423 03061, the AiSensy number. Customers see these two numbers and nothing else.
The IVR is set up in the telephony provider's dashboard (the provider that owns 79652 95649). This file is the script and routing to enter there. Nothing in the website code runs the IVR.

## Principles
- Open 24/7. The first menu option is always breakdown help, because a stranded rider cannot wait through a long menu.
- Every call ends with a WhatsApp message from the AiSensy number, so the customer has the link and the reference in writing.
- Quote first, pay after the customer says yes. The IVR never takes payment details. We never ask for a card number, PIN or OTP on a call.
- No prices are read out in the IVR (they change). The WhatsApp link shows the current price.
- Play a short notice: "This call may be recorded to improve our service."

## Call flow
| Step | Caller hears | Keypad | Goes to |
|---|---|---|---|
| Greeting | "Welcome to Mechanix Pro, your roadside first responders. This call may be recorded." | none | Main menu |
| Main menu | "For a breakdown or puncture, press 1. To book a bike service or a problem check, press 2. For your booking, payment or invoice, press 3. For car service or spare parts, press 4. For fleet, society or garage partnership, press 5. To speak to a Care Buddy, press 0." | 1 to 5, 0 | below |
| 1 Breakdown | "Stay safe. Move off the road and switch on your hazard lights. We are sending a WhatsApp message to share your location. Connecting you to our roadside team." | none | Ring group **Roadside** (duty Care Buddies), 25 seconds. No answer: second group, then voicemail "Leave your name and area, we call back within 10 minutes." Always send WhatsApp template **ivr_roadside** |
| 2 Service | "We are sending you a WhatsApp message to build your service and get a quote. Press 1 to talk to a Care Buddy now." | 1 | WhatsApp template **ivr_book** to the caller. If 1: ring group **Care Buddies** |
| 3 Booking | "Send us your booking reference on WhatsApp and we reply right away. Press 1 to talk to a Care Buddy." | 1 | WhatsApp template **ivr_track** (track link). If 1: ring group **Care Buddies** |
| 4 Car or parts | "Car service is handled by the same Mechanix Pro team, with parts from our partner Axlio. We are sending you a WhatsApp message." | none | WhatsApp template **ivr_car**, then ring group **Care Buddies** |
| 5 Business | "For fleets, societies and garages, press 1 for fleet and society, press 2 for garage partnership." | 1, 2 | 1: ring group **Fleet and society**. 2: ring group **Partners**. No answer: voicemail and WhatsApp template **ivr_business** |
| 0 | "Connecting you to a Care Buddy." | none | Ring group **Care Buddies** |
| No key or wrong key | "Sorry, I did not get that." Repeat the menu twice | any | After 2 repeats, ring **Care Buddies** |

## Rules to set in the provider
- **Hours:** 24/7 for option 1. For options 0, 2 to 5 use the same hours the Care Buddies work. Outside them, play "Our team will call you back" and send the WhatsApp template.
- **Missed or abandoned calls:** the caller gets a WhatsApp template **ivr_missed** within 1 minute ("Sorry we missed you. Reply here or tell us your bike and area and we will call back.") and a call-back task is created.
- **Caller ID:** pass the caller number to the WhatsApp message and to the desk, so the lead is created with the phone number filled in. Source: **ivr**.
- **Languages:** English first. Add Kannada (press 2) and Hindi (press 3) on the greeting only when the recordings exist.
- **Voicemail:** 60 seconds, then the call-back task with the caller number.

## WhatsApp flow on the AiSensy number (+91 80423 03061)
Rule-based, so every step is predictable. The AI replies that ran on the old Meta number are not part of this number.
1. **Welcome** (any first message): "Hi, this is Mechanix Pro. How can we help?" Buttons: **Book a service**, **Breakdown help**, **My booking**, **Talk to a person**.
2. **Book a service:** ask bike model, then area, then what it needs (regular service, something is wrong). Reply with the booking link and "Your exact quote comes next. Nothing starts until you say yes." Hand over to a Care Buddy.
3. **Breakdown help:** ask the caller to share the live location, then the problem (puncture, battery, will not start, other). Alert the Roadside group. Reply with "Help is on the way" and the next steps.
4. **My booking:** ask for the booking reference (for example MP-26-27-0001; older references also work), send the track link. Anything else goes to a Care Buddy.
5. **Talk to a person:** assign to the next free Care Buddy and say when to expect a reply.
6. **Out of hours or no reply in 5 minutes:** auto message "We have your details and will reply shortly" and notify the supervisor.
7. **After the job:** the rating request (campaign `mxp_desk_rating`).

## Message templates to create (AiSensy, utility)
| Template | Text |
|---|---|
| ivr_roadside | Hi, this is Mechanix Pro. Please share your live location here and tell us what happened to your bike. Our roadside team is on it. |
| ivr_book | Hi, thanks for calling Mechanix Pro. Build your service and get your quote here: https://mechanixpro.in/book/ . Nothing starts until you say yes. |
| ivr_track | Hi, track your Mechanix Pro booking here: https://mechanixpro.in/track/ . Send your booking reference if you need help. |
| ivr_car | Hi, thanks for calling Mechanix Pro. Tell us your car model, area and what it needs, and we will quote first. |
| ivr_business | Hi, thanks for calling Mechanix Pro. Please tell us your company or society name, how many vehicles, and the best time to call. |
| ivr_missed | Hi, sorry we missed your call to Mechanix Pro. Tell us your bike and area and we will call you back. |

## Test before going live
1. Call from a spare phone: check each key, the repeat on a wrong key, and the voicemail.
2. Check the WhatsApp message arrives within a minute from +91 80423 03061 for every option.
3. Place a call outside hours and confirm the call-back message.
4. Confirm the number on mechanixpro.in (header, footer, floating call button) shows +91 79652 95649.
