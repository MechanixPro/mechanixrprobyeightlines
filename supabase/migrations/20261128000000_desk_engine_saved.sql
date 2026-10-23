-- Desk: when an agent picks an engine size on an edit, keep it on the bike as well as in the price.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.crm_update_booking(uuid,jsonb,timestamptz)'::regprocedure);
  n := replace(d, 'total := public.crm_booking_price(svc, adds, coalesce(', 'if nullif(p ->> ''engine_class'', '''') in (''std'', ''mid'', ''big'') and l.bike_id is not null then update public.bikes set engine_class = p ->> ''engine_class'', big_bike = (p ->> ''engine_class'') = ''big'' where id = l.bike_id; end if; total := public.crm_booking_price(svc, adds, coalesce(');
  if n = d then raise exception 'crm_update_booking was not patched'; end if;
  execute n;
end $$;
