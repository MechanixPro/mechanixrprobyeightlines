# SEO owner steps (dashboard work, not in the repo)

Everything here needs the owner's login. Nothing in this list was changed by the code. Do them in this order. Each step says how to check it worked.

## 1. Cloudflare: send www to the bare domain (301)

Goal: `https://www.mechanixpro.in/...` always lands on `https://mechanixpro.in/...` with a 301, so Google sees one site.

1. Cloudflare dashboard > pick `mechanixpro.in` > **Rules** > **Redirect Rules** > **Create rule**.
2. Rule name: `www to apex`.
3. Choose **Custom filter expression** and enter: `(http.host eq "www.mechanixpro.in")`.
4. Then: **Dynamic** redirect. Expression: `concat("https://mechanixpro.in", http.request.uri.path)`. Tick **Preserve query string**. Status code **301**.
5. Deploy.
6. DNS must have a proxied (orange cloud) record for `www` (any placeholder target, for example a CNAME to `mechanixpro.in`). Without a proxied record the rule never runs.
7. Check: `curl -sI https://www.mechanixpro.in/services/ | head -5` shows `301` and `location: https://mechanixpro.in/services/`.

## 2. Cloudflare: Browser Cache TTL "Respect Existing Headers"

Goal: the `Cache-Control` rules in `_headers` (revalidate for css, js, html, sitemap, robots, llms) are obeyed. Cloudflare's default can hold css and js in browsers for 4 hours.

1. **Caching** > **Configuration** > **Browser Cache TTL** > choose **Respect Existing Headers**.
2. Check: `curl -sI https://mechanixpro.in/assets/css/style.css | grep -i cache-control` shows `max-age=0, must-revalidate`.

## 3. Cloudflare: AI crawl control (training bots)

Policy today (robots.txt, unchanged): AI search and answer bots are allowed. Training bots blocked: GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot, Bytespider.

robots.txt is a request, not a lock. If you want it enforced and extended, do it in Cloudflare:

1. **Security** > **Bots** > **AI Crawl Control** (older dashboards: **AI Audit**). Review the crawler list and set **Block** for the training crawlers.
2. Names to add that are **not yet in robots.txt**: `meta-externalagent`, `cohere-ai`, `anthropic-ai`, `Diffbot`, `img2dataset`, `Timpibot`, `ImagesiftBot`, `omgili`. (`CCBot` and `Bytespider` are already in robots.txt; list them in Cloudflare too so they are enforced.)
3. If you also want them in robots.txt, add each as a `User-agent:` line in the "AI model training is not allowed" group and keep `Disallow: /`. This is a code change (`robots.txt`), so ask for it; it is a policy decision.
4. Do **not** block `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User`, `Googlebot` or `Bingbot`: those are how people find the site.

Google-Extended trade-off: blocking it stops Google using the site for Gemini model training and grounding. It does not change Google Search ranking or AI Overviews (those use Googlebot). Keeping it blocked is the safe default; allow it only if you want the content eligible for Gemini features and accept training use.

## 4. Google Search Console and Bing Webmaster Tools

Google Search Console:
1. Open search.google.com/search-console > **Add property** > **Domain** > `mechanixpro.in`. Copy the TXT record it shows.
2. Cloudflare > **DNS** > **Add record** > Type `TXT`, Name `@`, Content = the value Google gave. Back in Search Console press **Verify**.
3. **Sitemaps** > enter `sitemap.xml` > **Submit**. Status should read "Success" with about 246 URLs (the number changes as blog posts go live).
4. **URL Inspection** > test `https://mechanixpro.in/` > **Request indexing**. Repeat for `/services/` and `/help/`.
5. After a week check **Pages** for "Excluded" reasons and **Enhancements** for FAQ and breadcrumb warnings.

Bing Webmaster Tools:
1. bing.com/webmasters > sign in > **Import from Google Search Console** (easiest), or add the site and verify with a DNS TXT/CNAME record the same way.
2. **Sitemaps** > submit `https://mechanixpro.in/sitemap.xml`.
3. This also feeds Bing Copilot and ChatGPT search results that rely on Bing.

## 5. Google Business Profile: the "Write a review" link

1. Sign in at business.google.com with the account that owns the profile > select the business.
2. **Get more reviews** (or **Ask for reviews**) > **Copy link**. It looks like `https://g.page/r/XXXXXXXX/review`.
3. Send me the link. It goes in `assets/js/config.js` as `googleReviewUrl: '...'`. The tracking page shows "Share on Google" after a 4 or 5 star rating only when this is set.
4. Do not post or ask for fake reviews, and do not add review stars to the website until real Google reviews exist.

## 6. Check the business details match everywhere (NAP)

The site says: NOVA VENTURES (brand Mechanix Pro), Haralur Main Rd, 1st Sector, HSR Layout, Bengaluru, Karnataka 560102, phone +91 79652 95649, hello@mechanixpro.in.

1. Open the Google Business Profile and Justdial listing. Compare name, address, phone, website and categories letter by letter.
2. Fix the listing, not the website, unless the website is wrong. Tell me if the website is wrong.
3. Use the same phone number format everywhere.

## 7. Owner decision: "open requests 24/7" versus workshop hours

The site says requests are taken 24/7 and roadside help is "open 24/7". The structured data on the home page no longer carries opening hours, because the 24/7 value is not confirmed for the workshop. Please answer:

1. Are the **workshop** hours really 24/7? If not, give the real days and hours (for example Monday to Saturday 9 am to 8 pm).
2. Keep "requests 24/7" wording as it is, or change it to "requests answered 24/7" or a smaller claim?
3. When confirmed, I add `openingHoursSpecification` back with the real hours, and the Google Business Profile hours must say the same.

## 8. Still open from the audits (not done in batch 1)

- `/book/` and `/quote/` are still indexable. Decide whether they should be `noindex`.
- Rewrite of the model and area pages so each has unique content (batch 2).
- A third-party review source is needed before any `aggregateRating` can be added. None exists today, and none is shown.

## 9. After deploy: checklist (copy and run)

```sh
# 1. www redirects to the apex with a 301
curl -sI https://www.mechanixpro.in/ | egrep -i '^(HTTP|location)'
curl -sI "https://www.mechanixpro.in/services/?x=1" | egrep -i '^(HTTP|location)'

# 2. the apex answers 200 and html is revalidated
curl -sI https://mechanixpro.in/ | egrep -i '^(HTTP|cache-control|content-type)'

# 3. css and js are revalidated, the service worker is no-cache
curl -sI https://mechanixpro.in/assets/css/style.css | egrep -i '^(HTTP|cache-control)'
curl -sI https://mechanixpro.in/sw.js | egrep -i '^(HTTP|cache-control)'

# 4. robots, sitemap and llms.txt
curl -s https://mechanixpro.in/robots.txt | head -20
curl -sI https://mechanixpro.in/sitemap.xml | egrep -i '^(HTTP|cache-control|content-type)'
curl -s https://mechanixpro.in/sitemap.xml | grep -c '<loc>'
curl -s https://mechanixpro.in/llms.txt | head -12
curl -s https://mechanixpro.in/llms.txt | grep -ci 'pay after you say yes'     # expect 0

# 5. the old wording is gone from the live pages (expect 0 for each)
curl -s https://mechanixpro.in/ | grep -ci 'pay after you say yes'
curl -s https://mechanixpro.in/two-wheeler-service-at-home-bangalore/ | grep -ci 'pay after you say yes'

# 6. home title, structured data and security headers
curl -s https://mechanixpro.in/ | grep -o '<title>[^<]*</title>'
curl -s https://mechanixpro.in/ | grep -c 'application/ld+json'
curl -sI https://mechanixpro.in/ | egrep -i '^(content-security-policy|strict-transport-security)' | cut -c1-80

# 7. hero video is the smaller file (about 561 KB)
curl -sI https://mechanixpro.in/assets/video/hero-garage.mp4 | egrep -i '^(HTTP|content-length)'
```

Then in a browser: open the home page on a phone, switch between Bike and Car, and confirm the hero looks the same as before. Paste `https://mechanixpro.in/bike-service/honda-activa-6g/` into Google's Rich Results Test and check there are no errors.
