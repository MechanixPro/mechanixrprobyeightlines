-- Desk: the bike on a lead can now be added or changed from "Edit booking".
-- Leads made by hand, from a call or from WhatsApp have no customer or bike record, so a bike edit used to be dropped without any error.
-- Now the first bike edit creates the customer (by mobile number) and the bike, and links both to the lead.
do $$ declare d text; n text; begin
  select pg_get_functiondef('public.crm_update_booking(uuid,jsonb,timestamptz)'::regprocedure) into d;
  n := replace(d, 'bid uuid;', 'bid uuid; cid uuid;');
  n := replace(n, 'elsif l.customer_id is not null then insert into public.bikes (customer_id, brand, model) values (l.customer_id, v_brand, v_model) returning id into bid; end if;',
    'elsif v_brand is not null or v_model is not null then if l.customer_id is null then insert into public.customers (phone, name) values (l.phone, l.name) on conflict (phone) do update set name = coalesce(public.customers.name, excluded.name) returning id into cid; update public.leads set customer_id = cid where id = p_id; else cid := l.customer_id; end if; insert into public.bikes (customer_id, brand, model) values (cid, v_brand, v_model) returning id into bid; end if;');
  if n = d or position('cid uuid;' in n) = 0 or position('on conflict (phone)' in n) = 0 then raise exception 'crm_update_booking was not patched'; end if;
  execute n;
end $$;
