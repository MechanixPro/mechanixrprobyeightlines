-- Simple commission per job: doorstep or in garage, an optional percentage for this job only, and a manual correction in rupees with a reason.
alter table public.leads add column if not exists job_place text not null default 'doorstep' check (job_place in ('doorstep','garage'));
alter table public.leads add column if not exists commission_pct integer check (commission_pct between 0 and 100);
alter table public.leads add column if not exists commission_adjust numeric(12,2) not null default 0 check (commission_adjust between -100000 and 100000);
alter table public.leads add column if not exists commission_note text check (char_length(commission_note) <= 200);

-- Default mechanic share for doorstep jobs (when a mechanic has no rate of their own) and for in-garage jobs. Editable in Settings.
insert into public.settings (key, value) values ('doorstep_pct', '30'::jsonb), ('garage_pct', '30'::jsonb) on conflict (key) do nothing;
