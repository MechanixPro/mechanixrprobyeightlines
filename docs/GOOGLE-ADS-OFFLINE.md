# Tell Google Ads which clicks became real jobs

Every lead from a Google ad is saved with Google's click ID. When you mark the job **Completed** in the admin, we can tell Google that click turned into a customer. Over time Google then finds more people like your real customers, not just people who send a request.

## One-time setup in Google Ads
1. Goals, then Conversions, then **+ New conversion action**.
2. Choose **Import**, then **Other data sources or CRMs**, then **Track conversions from clicks**.
3. Name it exactly **Completed job**. Set the goal to **Purchase** (or **Other**), and the value to **Use different values for each conversion**.
4. Set the click-through window to **90 days**. Save it.
5. Set **Completed job** to **Secondary** for now, so it doesn't change bidding until you have a few of them. (Your **Lead** conversion stays the one the campaign optimises for.)

## Each time (weekly is enough)
1. Admin, then **Reports**, then **Download Google Ads upload file**.
2. Google Ads, then Goals, then Conversions, then **Uploads**, then **+**, then upload the file.
3. Google shows any rows it rejected. Common reasons: the click is older than **90 days**, or the conversion name does not match **Completed job** exactly.

## Notes
- Only jobs from a Google ad click are included. The admin page shows how many were left out and why.
- The value sent is the amount collected on the job (or the estimate if nothing is recorded yet).
- Uploading the same job twice is harmless. Google ignores duplicates.
- This sends Google a click ID, a time and an amount. It does **not** send names, phone numbers or emails.
