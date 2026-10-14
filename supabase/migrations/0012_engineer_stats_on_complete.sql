-- 0012_engineer_stats_on_complete.sql
--
-- Fix: an engineer marking their own job Completed (or Beyond Repair) from
-- the Portal failed with "You can only change your skills, coverage, working
-- hours and documents from the Portal...".
--
-- Why: bookings_sync_engineer_stats() bumps engineers.stats_completed /
-- stats_ber as the signed-in engineer, and engineers_self_service_guard()
-- (correctly) stops engineers changing those columns themselves.
--
-- Fix: the stats trigger runs as the database owner and raises a
-- transaction-local flag while it updates the counters; the guard lets that
-- one update through. Engineers still can't edit their own stats directly
-- (the flag can only be set from inside database functions).
-- Safe to run more than once.

create or replace function public.bookings_sync_engineer_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE') and (new.status is distinct from old.status) then
    perform set_config('app.engineer_stats_sync', 'on', true);
    if new.status = 'Completed' and new.engineer_id is not null then
      update engineers set stats_completed = stats_completed + 1 where id = new.engineer_id;
    elsif new.status = 'Beyond Repair' and new.engineer_id is not null then
      update engineers set stats_ber = stats_ber + 1 where id = new.engineer_id;
    end if;
    if old.status = 'Completed' and old.engineer_id is not null then
      update engineers set stats_completed = greatest(stats_completed - 1, 0) where id = old.engineer_id;
    elsif old.status = 'Beyond Repair' and old.engineer_id is not null then
      update engineers set stats_ber = greatest(stats_ber - 1, 0) where id = old.engineer_id;
    end if;
    perform set_config('app.engineer_stats_sync', 'off', true);
  end if;
  return new;
end $$;

-- Let only the stats counters through while that flag is on.
do $$
declare def text;
begin
  select pg_get_functiondef('public.engineers_self_service_guard'::regproc) into def;
  if position('app.engineer_stats_sync' in def) = 0 then
    def := regexp_replace(def, '\mbegin\M',
      E'begin\n  if current_setting(''app.engineer_stats_sync'', true) = ''on''\n     and (to_jsonb(new) - array[''stats_completed'',''stats_ber'']) = (to_jsonb(old) - array[''stats_completed'',''stats_ber'']) then\n    return new;\n  end if;', 'i');
    execute def;
  end if;
exception when undefined_function then
  raise notice 'engineers_self_service_guard() not found, nothing to change';
end $$;
