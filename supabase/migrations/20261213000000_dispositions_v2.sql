-- The disposition list the team asked for, with its sub options. Older options are switched off (not deleted), so old leads keep what they were marked with.
update public.crm_dispositions set active = false;
insert into public.crm_dispositions (disposition, sub_disposition, sort, active) values
  ('Interested','Will book later',10,true),('Interested','Price high',11,true),('Interested','No mechanic available',12,true),('Interested','Follow-up',13,true),
  ('Not interested','Price high',20,true),('Not interested','Was just checking',21,true),('Not interested','Service dislike',22,true),('Not interested','Not interested',23,true),
  ('RNR','Busy',30,true),('RNR','RNR',31,true),('RNR','Sw off',32,true),('RNR','Not reachable',33,true),
  ('Call backs','Requested call back',40,true)
on conflict (disposition, sub_disposition) do update set sort = excluded.sort, active = true;
