# Mechanix Pro growth features: design

Date: 2026-10-07. Status: approved in chat, awaiting written-spec review.

## Goal

Reach more riders in Bengaluru through search, social media and referrals, and turn more visits into WhatsApp quote requests. Every request is also saved so the team can follow up. Keep the site static (plain HTML, CSS and JS, no build step for the site itself) and keep WhatsApp as the main way leads arrive.

## Non-goals

- A customer app, live mechanic tracking, loyalty points, or a content-heavy blog.
- Fake reviews, ratings or counts. The reviews block stays hidden until real reviews exist.
- A page for every model in every area. That is about 780 near-identical pages and risks being treated as thin content by Google.

## Constraints

- Prices stay consistent across `app.js` defaults, `build_pages.py`, the SQL seed, the FAQ and the JSON-LD.
- The CSP in `_headers` forbids inline scripts.
- No secrets in the repo. Public config only in `assets/js/config.js`.
- Booking must still reach WhatsApp if saving the lead fails.
- The four main pages stay the only main navigation.

## 1. Pages

The four main pages (Home, Book, Services, Help) stay. `scripts/build_pages.py` generates the rest from templates in `src/`, so none are edited by hand:

| Page | Count | Content |
|---|---|---|
| Model pages `/bike-service/<brand>-<model>/` | about 130, from `assets/js/bikes.js` | Model type (scooter, motorcycle, EV), engine class, starting price from the same price source as the site, typical service timing, common problems for that type, a book button that preselects the bike |
| Area pages `/bike-service-<area>/` | 6, existing | Unchanged, plus links to the most popular model pages |
| Fleet `/fleet/` | 1 | Delivery riders and small fleets: bulk quote request that opens WhatsApp |
| Societies `/societies/` | 1 | Apartment and office group bookings: group quote request that opens WhatsApp |
| Offers `/offers/<name>/` | one per campaign | Short landing page for an ad, carries its campaign tag into the lead |

Model page rules: a unique title and description per page, a canonical link, an AutoRepair JSON-LD block with the starting price, and an entry in `sitemap.xml`. Page body text must differ by model through its data (type, engine class, price), not by swapping the name only.

## 2. Languages

Kannada at `/kn/` and Hindi at `/hi/`, as separate generated copies of the four main pages, with `hreflang` links between versions. A client-side language button is rejected because it gives no search benefit.

Strings live in one file per language, `src/i18n/kn.json` and `src/i18n/hi.json`, with English as the source. Each string carries a `reviewed` flag. A page is generated in a language only when every string on it is marked reviewed, so unreviewed machine text is never published. The booking builder reads its labels from the same files.

## 3. Saving leads

Migration adds columns to `public.leads`: `km_band text`, `issues jsonb`, `note text`, `place text`, `contact_pref text`, `bike_type text`, `ref_code text`, `campaign text`. The `submit-lead` function validates each (known values only, lengths capped, note stripped of control characters) and stores them. The website already sends these fields. If the function returns an error or times out, the customer is sent to WhatsApp anyway. The admin panel shows the new fields on a lead and adds a report of leads by source, campaign and referrer.

## 4. Referrals and campaigns

A visit with `?ref=CODE` stores the code for the session. It is added to the WhatsApp message ("Referred by CODE") and to the saved lead as `ref_code`. UTM tags and the offer page name are saved as `campaign`. No reward logic in this phase: referrals are tracked, and rewards are handled by the team.

## 5. Trust

Real photos replace the illustrated placeholders through `scripts/set_photo.sh`. A reviews block is generated only when `src/reviews.json` has entries, each with a name, text, date and link to the source. An empty file means no block is shown.

## 6. Testing

- Unit tests (`npm test`): booking logic (30 exist), the generator (unique titles and descriptions, canonical and `hreflang` present, model page count matches the bike data, sitemap lists every page), the language gate (a page with an unreviewed string is not generated), and lead field validation.
- The existing browser booking test, run against `/book/` and a model page.
- Lighthouse mobile on the four main pages and one model page: performance 95 or higher, accessibility, best practices and SEO at 100.

## Build order

1. Lead saving and the admin view (migration, `submit-lead`, admin report).
2. Model pages and the links from area pages.
3. Referral and campaign tracking, then the fleet, societies and offer pages.
4. Kannada and Hindi, after translation review.

Each step is released on its own and leaves the site working.

## Open items

- A fluent Kannada and Hindi reader to review the translations before step 4.
- The real WhatsApp and call numbers in `config.js`, and a Supabase project, before step 1 can be tested against a live database.
- Real photos and real reviews, supplied by the business.
