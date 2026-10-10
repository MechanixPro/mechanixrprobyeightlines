# Mechanix Pro ads playbook

Plan: run Google Search and Instagram/Facebook together. Split the monthly budget **60% Google Search, 40% Instagram**. Example for ₹15,000 a month: ₹9,000 Google (about ₹300 a day) and ₹6,000 Instagram (about ₹200 a day). Scale the same split up or down.

No ad platform can promise results. Treat the first month as a test: spend, watch **cost per request**, keep what works and pause what does not.

## 1. One-time setup (about an hour)

1. **Google Ads account** at ads.google.com. Create a conversion action "Lead", type Website, and copy the conversion ID and label (looks like `AW-1234567890/AbCdEfGh`).
2. **Google Analytics 4** (optional but useful): create a property and copy the measurement ID (`G-XXXXXXXXXX`).
3. **Meta Business account** and a Meta Pixel (Events Manager, Connect data sources, Web). Copy the Pixel ID (digits).
4. Send the three IDs to Claude, or paste them into `assets/js/config.js` as `googleAdsSendTo`, `gaId` and `metaPixelId`, then deploy. Nothing is tracked until these are set.
5. Check it works: open the site with `?utm_source=test`, send a test request, and look for the Lead event in Google Tag Assistant and Meta Events Manager.

What is shared with ad networks: page views, and the event "lead" (a request was sent). Never a name, number or email. The privacy policy says so.

## 2. Google Search (60%)

**Where the ads go:** `https://mechanixpro.in/offers/bike-service/` for service searches, `https://mechanixpro.in/roadside/` for breakdown searches. Add `?utm_source=google&utm_medium=cpc&utm_campaign=bike-service` (change the last word per campaign). The booking form saves it, so the admin Reports tab shows bookings per campaign.

**Settings:** Search network only (turn off Display and search partners at first). Location: Bengaluru, "people in or regularly in". Language: English and Kannada. Bidding: Maximise clicks with a small cap at first, then switch to Maximise conversions once you have about 15 requests. Ad schedule: 7 AM to 9 PM for service, all hours for roadside.

**Campaign A, doorstep service** (exact and phrase match):
- bike service at home bangalore
- doorstep bike service bangalore
- two wheeler service at home bengaluru
- scooter service at home bangalore
- bike servicing near me
- royal enfield service at home bangalore

**Campaign B, breakdown** (phrase match, run all day):
- bike puncture help bangalore
- bike breakdown help bangalore
- bike not starting help near me
- roadside assistance bike bangalore

**Negative keywords** (add to both): free, jobs, job, course, training, spare parts wholesale, second hand, used bike, for sale, rent, rental, insurance, mechanic job, diy, how to, youtube, pdf.

**Ad headlines** (30 characters or fewer, use the real price from the site):
- Bike Service At Your Door
- Quote First, Work After OK
- 30-Day Service Warranty
- OEM-Certified Parts
- Basic Service From ₹599
- Bengaluru Doorstep Service
- Bike Broken Down? Call Now (roadside)
- Puncture Help In Bengaluru (roadside)

**Descriptions** (90 characters or fewer):
- Certified mechanic at your home. Get a WhatsApp quote first. We start only after you say yes.
- Brakes, oil, chain, wash and more at your door. 30-day service warranty. Build it in a minute.

Do not use "cheapest", "best" or any discount you are not actually giving.

## 3. Instagram and Facebook (40%)

**Where the ads go:** WhatsApp or the landing pages. Use the objective **Leads** (or Engagement, Click to WhatsApp) once the Pixel is installed. Destination for offers: `https://mechanixpro.in/offers/<name>/?utm_source=instagram&utm_medium=paid&utm_campaign=<name>`.

**Creative:** start with your three existing posts (the Basic Bike Service ₹599 poster is the strongest). One short video of a real doorstep service is better than a poster, so film one when you can.

**Campaigns to run, one at a time:**
1. `monsoon-check`, during the rains.
2. `pre-trip-check`, before long weekends and holidays.
3. `ev-check`, aimed at electric scooter owners.

**Audience:** Bengaluru plus a 15 km radius around HSR Layout first, age 20 to 50, interests such as motorcycles, scooters, Royal Enfield, Honda, TVS, Bajaj, Ola Electric, Ather. Start broad and let Meta find people. Exclude people who already messaged you once you have a list.

**Copy examples:**
- "Your bike serviced at your door in Bengaluru. Basic service from ₹599. Quote first, work after your OK."
- "Monsoon coming? Get your brakes, tyres and battery checked at home."

## 4. Weekly check (15 minutes, every Monday)

Open the admin **Reports** tab and the ad dashboards.

| Number | How to read it |
|---|---|
| **Cost per request** = ad spend / requests sent | The number that matters. Decide your limit with the client (for example the profit on one service). |
| Requests per campaign (Reports, by campaign) | Which campaign actually brings bookings |
| Booked and completed jobs | A request is not a sale. Compare requests to completed jobs per campaign |
| Click-to-request rate | Low means the landing page or the offer is weak |

Rules of thumb: pause a keyword or ad with plenty of clicks and no requests; give a new ad about a week or at least 1,000 views before judging; change one thing at a time.

## 5. Before the ads go live

- [ ] WhatsApp number and call number in `config.js` are correct and answered during ad hours
- [ ] Someone replies to WhatsApp requests within minutes (slow replies waste ad money)
- [ ] Conversion tracking tested
- [ ] Budget agreed with the client, and a daily cap set in both ad accounts
