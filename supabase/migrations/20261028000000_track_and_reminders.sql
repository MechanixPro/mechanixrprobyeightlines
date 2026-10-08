-- "Track my booking" lookups (a short log used only to limit guessing) and the service-due reminder.
create table if not exists public.track_attempts (
  id         bigserial primary key,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index if not exists track_attempts_ip_idx on public.track_attempts (ip_hash, created_at desc);
alter table public.track_attempts enable row level security; -- no policies: only the function (service role) can use it

-- When a booking was marked completed, and whether its service-due reminder email has gone out.
alter table public.leads
  add column if not exists completed_at timestamptz,
  add column if not exists reminder_sent_at timestamptz;
create or replace function public.stamp_completed() returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') then new.completed_at := coalesce(new.completed_at, now()); end if;
  return new;
end; $$;
drop trigger if exists leads_stamp_completed on public.leads;
create trigger leads_stamp_completed before insert or update on public.leads for each row execute function public.stamp_completed();
update public.leads set completed_at = updated_at where status = 'completed' and completed_at is null;
create index if not exists leads_reminder_idx on public.leads (completed_at) where reminder_opt_in and reminder_sent_at is null and status = 'completed';
