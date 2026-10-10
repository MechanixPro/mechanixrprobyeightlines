# Google Maps setup

Used for two things, both off until a key is set:
- **Address search** in the booking form: the customer types their society or street, picks a suggestion, and the address, PIN, area and map pin fill in. It only suggests places inside Bengaluru.
- **Find us** map on the Contact page, plus a "Get directions" link that works even without a key.

## 1. Make the key (Google Cloud Console)

1. Open console.cloud.google.com, pick your project, and turn on **billing** (Google gives a monthly free credit, but billing must be on).
2. APIs & Services, Library, enable all three:
   - **Maps JavaScript API**
   - **Places API (New)** (the one named "(New)", not the old "Places API")
   - **Maps Embed API**
3. APIs & Services, Credentials, **Create credentials, API key**.

## 2. Restrict the key (important, the key is visible to every visitor)

On the key's page:
- **Application restrictions: HTTP referrers (web sites)**. Add these two:
  - `https://mechanixpro.in/*`
  - `https://www.mechanixpro.in/*`
- **API restrictions: Restrict key**, and tick only Maps JavaScript API, Places API (New) and Maps Embed API.

An unrestricted key can be copied and used by strangers on your bill.

## 3. Cap the spending

- Billing, **Budgets & alerts**: create a monthly budget (for example ₹1,000) with email alerts at 50%, 90% and 100%.
- APIs & Services, **Quotas**: set a daily limit on Places API (New) requests (for example 500 a day) so a bug or attack cannot run up a bill.
- The address search sends one request set per search, not one per key press, to keep cost low.

## 4. Turn it on

Paste the key into `assets/js/config.js`:

```js
googleMapsKey: 'AIza...your key...',
```

Then build and deploy the site (`sh scripts/build_site.sh`, then deploy). Or send the key to Claude and ask it to do this.

## 5. Check it

- Open `/book/`, go to the last step: a "Search your address" box appears. Type "HSR Layout" and pick a result. The address and PIN fill in.
- Open `/contact/`: the map shows the office. If it stays blank, open the browser console. A "RefererNotAllowedMapError" means the referrer list in step 2 is missing your address. "ApiNotActivatedMapError" means an API in step 1 is not enabled.
