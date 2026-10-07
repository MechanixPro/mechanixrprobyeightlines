-- Never leave empty-handed: call-back requests, plus automotive details (pick up and drop, registration, service reminder opt-in).
alter table public.leads
  add column if not exists request_type text not null default 'quote' check (request_type in ('quote','callback')),
  add column if not exists reg_no text check (reg_no ~ '^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$'),
  add column if not exists reminder_opt_in boolean not null default false;

alter table public.leads drop constraint if exists leads_place_check;
alter table public.leads add constraint leads_place_check check (place in ('home','road','unsure','pickup'));
