# Showing Mechanix Pro bike services on axlio.in

**No API key is needed.** The service list is public and read-only, like the price list on mechanixpro.in. It holds no secret and no customer data, so there is nothing to hide, rotate or paste anywhere.

## The endpoint

`GET https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/public-services`

- Optional `?source=axlio` (default). It is added to every booking link as `campaign=axlio`, so Mechanix Pro can see the bookings that came from Axlio.
- Open to any website (CORS `*`), cached for 5 minutes, prices are live from the admin Prices tab.
- Names and descriptions are fixed and match the Mechanix Pro website.

### Response (shortened)

```json
{
  "brand": "Mechanix Pro", "city": "Bengaluru", "hours": "Open 24/7", "currency": "INR",
  "quote_policy": "A quote is sent on WhatsApp first. Work starts only after the customer approves it.",
  "contact": { "website": "https://mechanixpro.in", "whatsapp_url": "https://wa.me/918042303061", "call": "+918310621498" },
  "roadside_url": "https://mechanixpro.in/roadside/?campaign=axlio",
  "items": [
    { "id": "basic", "kind": "service", "name": "Basic service", "description": "...", "price_inr": 599,
      "price_150_to_250cc_inr": 799, "above_250cc_surcharge_inr": 300,
      "price_note": "Starting price, GST included, for bikes and scooters up to 149cc. 150 to 250cc has its own price; above 250cc add the surcharge to that price",
      "book_url": "https://mechanixpro.in/book/?service=basic&campaign=axlio" }
  ]
}
```

`kind` is `service` or `addon`. Always show `price_note` next to the price.

## A small example for the Axlio site

```html
<div id="mxp-bike-services"></div>
<script>
fetch('https://mejdxsbpyscujpvbwvmg.supabase.co/functions/v1/public-services?source=axlio')
  .then(function (r) { return r.json(); })
  .then(function (d) {
    var box = document.getElementById('mxp-bike-services');
    d.items.filter(function (i) { return i.kind === 'service'; }).forEach(function (i) {
      var a = document.createElement('a');
      a.href = i.book_url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = i.name + ' from ₹' + i.price_inr;   // use textContent, never innerHTML
      box.appendChild(a);
    });
  });
</script>
```

If Axlio's site has a strict content security policy, `https://mejdxsbpyscujpvbwvmg.supabase.co` must be allowed in `connect-src`.

## Rules for showing it

- Say it is a partner: "Bike service by Mechanix Pro, our partner". Mechanix Pro services bikes and scooters in Bengaluru, not cars.
- Show the prices as given (starting prices, GST included). Do not add discounts or claims that Mechanix Pro has not made.
- Link to the booking pages with `book_url`, so the customer gets a quote on WhatsApp first.

## If a keyed or private feed is needed later

For anything private (booking status, customer data, a webhook into Axlio) a separate key would be needed. It would be set as a Supabase secret in the owner's own terminal, never pasted into chat, email or this repository.
