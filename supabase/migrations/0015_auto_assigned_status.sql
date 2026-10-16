-- 0015_auto_assigned_status.sql
--
-- Picking an SP on a "Booked" job now always makes it "Assigned", however it
-- was assigned (Reassign button, the booking's Edit form, website
-- auto-assign or the test generator). Removing the SP from an "Assigned" job
-- puts it back to "Booked".
--
-- Before this, the Edit form saved engineer_id but left status as "Booked",
-- so FixFlow showed "Booked" and the Portal showed the job as "unassigned".
--
-- Only reacts when the SP actually changes, so staff can still set a job back
-- to "Booked" by hand. Safe to run more than once.

create or replace function public.bookings_auto_assigned_status()
returns trigger language plpgsql as $$
declare
  has_sp boolean := new.engineer_id is not null or coalesce(new.is_external, false);
  sp_changed boolean;
begin
  if tg_op = 'INSERT' then
    sp_changed := true;
  else
    sp_changed := new.engineer_id is distinct from old.engineer_id
               or coalesce(new.is_external, false) is distinct from coalesce(old.is_external, false)
               or new.external_engineer_id is distinct from old.external_engineer_id;
  end if;

  if sp_changed then
    if has_sp and new.status = 'Booked' then
      new.status := 'Assigned';
    elsif not has_sp and new.status = 'Assigned' then
      new.status := 'Booked';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists bookings_auto_assigned_status on public.bookings;
create trigger bookings_auto_assigned_status
  before insert or update on public.bookings
  for each row execute function public.bookings_auto_assigned_status();

-- Fix jobs that were already assigned through the Edit form.
update public.bookings
   set status = 'Assigned'
 where status = 'Booked'
   and (engineer_id is not null or coalesce(is_external, false));
