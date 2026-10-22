-- Care Buddy desk, part 6: editing a mechanic must not reset the tools they were onboarded with.

create or replace function public.crm_mechanic_save(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare mid_in uuid := nullif(p ->> 'id', '')::uuid; ph text := regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9]', '', 'g'); sk text[]; pins text[]; langs text[]; x text; nid uuid; v_docs jsonb := '{}'::jsonb; v_tools jsonb := '{}'::jsonb;
begin
  perform public.crm_need_role(); perform public.crm_require('manage_mechanics');
  if length(ph) = 12 and ph like '91%' then ph := substr(ph, 3); end if;
  if ph !~ '^[6-9][0-9]{9}$' then raise exception 'Mobile must be a 10-digit number' using errcode = 'P0001'; end if;
  if char_length(coalesce(trim(p ->> 'name'), '')) < 2 or char_length(trim(p ->> 'name')) > 60 then raise exception 'Enter the mechanic name (2 to 60 letters)' using errcode = 'P0001'; end if;
  if public.crm_has_pii(p::text) then raise exception 'Remove Aadhaar, PAN or card numbers from the details' using errcode = 'P0001'; end if;
  sk := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p -> 'skills') = 'array' then p -> 'skills' else '[]'::jsonb end)), '{}');
  foreach x in array sk loop if x not in ('two-wheeler','scooter','royal-enfield','electric','tyre','battery','superbike') then raise exception 'Unknown skill: %', left(x, 20) using errcode = 'P0001'; end if; end loop;
  pins := coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(p -> 'pincodes') = 'array' then p -> 'pincodes' else '[]'::jsonb end)), '{}');
  foreach x in array pins loop if not public.crm_pin_ok(x) then raise exception 'PIN % is outside the service area', left(x, 10) using errcode = 'P0001'; end if; end loop;
  langs := coalesce(array(select left(jsonb_array_elements_text(case when jsonb_typeof(p -> 'languages') = 'array' then p -> 'languages' else '[]'::jsonb end), 20)), '{}');
  if p ->> 'shift' is not null and p ->> 'shift' not in ('morning','day','evening','full') then raise exception 'Unknown shift' using errcode = 'P0001'; end if;
  foreach x in array array['agreement','training','photo','id_seen','address_seen'] loop v_docs := jsonb_set(v_docs, array[x], to_jsonb(coalesce((p -> 'docs' ->> x)::boolean, false))); end loop;
  foreach x in array array['toolkit','puncture_kit','jump_starter','chain_tools','torque_wrench','scanner'] loop v_tools := jsonb_set(v_tools, array[x], to_jsonb(coalesce((p -> 'tools' ->> x)::boolean, false))); end loop;
  if exists (select 1 from public.mechanics m where m.phone = ph and m.id is distinct from mid_in) then raise exception 'A mechanic with this mobile already exists' using errcode = 'P0001'; end if;
  if mid_in is null then
    insert into public.mechanics (name, phone, area, active, onboarding_status, skills, tools, pincodes, shift, languages, garage_id, hub_id, specialties, experience_years, docs, city, notes)
    values (public.crm_clean_text(p ->> 'name', 60), ph, public.crm_clean_text(p ->> 'area', 80), false, 'applied', sk, v_tools, pins, p ->> 'shift', langs, nullif(p ->> 'garage_id', '')::uuid, nullif(p ->> 'hub_id', '')::int,
      public.crm_clean_text(p ->> 'specialties', 120), coalesce(nullif(p ->> 'experience_years', '')::int, 0), v_docs, 'Bengaluru', public.crm_clean_text(p ->> 'notes', 500)) returning mechanics.id into nid;
  else
    update public.mechanics set name = public.crm_clean_text(p ->> 'name', 60), phone = ph, area = public.crm_clean_text(p ->> 'area', 80), skills = sk, tools = case when p ? 'tools' then v_tools else mechanics.tools end, pincodes = pins, shift = p ->> 'shift', languages = langs,
      garage_id = nullif(p ->> 'garage_id', '')::uuid, hub_id = nullif(p ->> 'hub_id', '')::int, specialties = public.crm_clean_text(p ->> 'specialties', 120), experience_years = coalesce(nullif(p ->> 'experience_years', '')::int, experience_years),
      docs = v_docs, notes = public.crm_clean_text(p ->> 'notes', 500)
    where mechanics.id = mid_in returning mechanics.id into nid;
    if nid is null then raise exception 'mechanic not found' using errcode = 'P0002'; end if;
  end if;
  return nid;
end; $$;

revoke all on function public.crm_mechanic_save(jsonb) from public;
grant execute on function public.crm_mechanic_save(jsonb) to authenticated;
