-- Desk action audit: the Technician lead (manage_technicians, no assign_leads) lost the technician board and the "job has no technician" alert.
-- 20261221000000 allowed manage_technicians in crm_tech_board and crm_unstaffed_jobs, then 20261225000000 re-created both with assign_leads only (the last definition wins).
-- The Crew app swallows that error on purpose (the board is optional), so for the Technician lead the board and the alert simply never appeared.
-- This file patches the CURRENT definitions again. Idempotent: running it twice changes nothing. Not applied anywhere by the build.
do $$ declare d text; n text; begin
  select pg_get_functiondef('public.crm_tech_board(date)'::regprocedure) into d;
  if position('manage_technicians' in d) = 0 then
    n := replace(d, 'perform public.crm_require(''assign_leads'');', 'if not (public.crm_can(''assign_leads'') or public.crm_can(''manage_technicians'')) then raise exception ''you do not have permission to do this'' using errcode = ''42501''; end if;');
    if n = d then raise exception 'crm_tech_board was not patched'; end if;
    execute n;
  end if;
  select pg_get_functiondef('public.crm_unstaffed_jobs()'::regprocedure) into d;
  if position('manage_technicians' in d) = 0 then
    n := replace(d, 'if not public.crm_can(''assign_leads'') then', 'if not (public.crm_can(''assign_leads'') or public.crm_can(''manage_technicians'')) then');
    if n = d then raise exception 'crm_unstaffed_jobs was not patched'; end if;
    execute n;
  end if;
end $$;
