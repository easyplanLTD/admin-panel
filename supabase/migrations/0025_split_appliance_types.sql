-- 0025: split appliance types to match the website booking form (30 Oct 2026).
-- Already run in the Supabase SQL editor; kept here as a record.
--
-- Old list: Washing Machine, Tumble Dryer, Dishwasher, Fridge/Freezer, Oven/Cooker, Hob, Microwave
-- New list: Washing Machine, Dishwasher, Tumble Dryer, Fridge/Freezer, Freezer, Microwave, Oven, Hob, Cooker
--
-- Engineers keep the same coverage: anyone who had "Oven/Cooker" now has
-- both "Oven" and "Cooker", and anyone who had "Fridge/Freezer" also gets
-- "Freezer" (the website used to file Freezer bookings under Fridge/Freezer).
-- Brand exclusions are copied across to the new keys the same way.
--
-- Old bookings stored as "Oven/Cooker" are left as they are (we can't tell
-- which it was); the matching code treats them as Oven or Cooker.

create or replace function pg_temp.split_types(t text[]) returns text[] language sql as $$
  select coalesce(array_agg(distinct v), '{}') from (
    select unnest(t) v
    union all select unnest(array['Oven','Cooker']) where 'Oven/Cooker' = any(t)
    union all select 'Freezer' where 'Fridge/Freezer' = any(t)
  ) s where v <> 'Oven/Cooker'
$$;

create or replace function pg_temp.split_excl(e jsonb) returns jsonb language sql as $$
  select case when e is null then e else
    (e - 'Oven/Cooker')
    || case when e ? 'Oven/Cooker' then jsonb_build_object('Oven', e->'Oven/Cooker', 'Cooker', e->'Oven/Cooker') else '{}'::jsonb end
    || case when e ? 'Fridge/Freezer' and not e ? 'Freezer' then jsonb_build_object('Freezer', e->'Fridge/Freezer') else '{}'::jsonb end
  end
$$;

update public.engineers
   set appliance_types = pg_temp.split_types(appliance_types),
       brand_exclusions = pg_temp.split_excl(brand_exclusions)
 where appliance_types && array['Oven/Cooker','Fridge/Freezer']
    or brand_exclusions ?| array['Oven/Cooker','Fridge/Freezer'];

update public.external_engineers
   set appliance_types = pg_temp.split_types(appliance_types),
       brand_exclusions = pg_temp.split_excl(brand_exclusions)
 where appliance_types && array['Oven/Cooker','Fridge/Freezer']
    or brand_exclusions ?| array['Oven/Cooker','Fridge/Freezer'];

update public.engineer_profiles
   set appliance_types = pg_temp.split_types(appliance_types),
       brand_exclusions = pg_temp.split_excl(brand_exclusions)
 where appliance_types && array['Oven/Cooker','Fridge/Freezer']
    or brand_exclusions ?| array['Oven/Cooker','Fridge/Freezer'];

-- The 30 Oct test booking was a cooker.
update public.bookings set appliance = 'Cooker' where booking_ref = 'ER-10078' and appliance = 'Oven/Cooker';
