-- Offer emails carry a campaign key so that sending again (when there are more than 150 people) never emails the same person twice.
alter table public.email_log add column if not exists campaign text check (char_length(campaign) <= 60);
create index if not exists email_log_campaign_idx on public.email_log (campaign, to_email) where campaign is not null;
