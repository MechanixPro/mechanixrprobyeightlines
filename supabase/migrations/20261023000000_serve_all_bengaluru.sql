-- We serve all of Bengaluru. Bookings keep the customer's PIN code, and what the AI tells customers about areas is updated.
alter table public.leads add column if not exists pincode text check (pincode is null or pincode ~ '^[0-9]{6}$');
create index if not exists leads_pincode_idx on public.leads (pincode) where pincode is not null;
update public.settings
   set value = jsonb_set(coalesce(value, '{}'::jsonb), '{areas}', to_jsonb('All of Bengaluru, every PIN code from 560001 to 560110. Popular: HSR Layout, Koramangala, BTM Layout, Bellandur, Sarjapur Road, Electronic City, Marathahalli, Whitefield, Indiranagar, Jayanagar, JP Nagar, Hebbal.'::text))
 where key = 'business_info';
