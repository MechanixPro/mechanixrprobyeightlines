# Service-due reminder emails

Customers who tick "Remind me when my next service is due" and gave an email get one reminder, 75 days after the booking is marked **Completed**. It is sent from no-reply@mechanixpro.in with an unsubscribe link, and never to anyone who unsubscribed.

The function `service-reminder` is deployed. Schedule it once a day. In Supabase, open **SQL editor** and run this with your project ref and the same `CRON_SECRET` you used for the follow-up job (pg_cron and pg_net must be enabled):

```sql
select cron.schedule('mxp-service-reminders', '30 4 * * *', $cron$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/service-reminder',
    headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'Content-Type', 'application/json'),
    body := '{}'::jsonb);
$cron$);
```

`30 4 * * *` is 10:00 AM India time. Change the number of days in `supabase/functions/_shared/service-due.ts` (`DUE_DAYS`).

# Reviews, mechanics and Instagram posts on the home page

Nothing is shown until it is real. Edit these files, then run `python3 scripts/build_pages.py` and deploy.

- `src/reviews.json`: `[{ "name": "…", "text": "…", "date": "2026-10-01", "url": "link to where it was posted" }]` (all four are required).
- `src/mechanics.json`: `[{ "name": "…", "years": 6, "speciality": "Scooters", "photo": "/assets/img/mechanics/ravi.webp", "alt": "Ravi, Mechanix Pro mechanic" }]` (name and years are required).
- `src/instagram.json`: add post or reel links to `posts`, for example `"https://www.instagram.com/p/ABCde12345/"`. The follow button always shows.
- `src/i18n/kn.json` and `hi.json`: a fluent reader checks each line and sets `reviewed` to `true`. The Kannada or Hindi home page is published only when every line is reviewed.
