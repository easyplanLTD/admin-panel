-- 0024: fuel type + installation type on bookings, Gas Safe flag on engineers.
-- Run in the Supabase SQL editor on 30 Oct 2026.
--
-- bookings.fuel_type          'Gas' | 'Electric' | 'Induction' | 'Dual fuel' | 'Not sure' | null
--                             Asked on the website form for Oven, Hob and Cooker only.
-- bookings.installation_type  'Built-in' | 'Freestanding' | 'Not sure' | null
--                             Asked for every appliance except Hob (Hob is saved as 'Built-in').
-- engineers.gas_safe          Set by office staff only. Bookings whose fuel_type is
--                             Gas, Dual fuel or Not sure are only auto-assigned to
--                             engineers with gas_safe = true (submit-booking,
--                             decline-booking, and FixFlow's autoAssign()).
-- engineers.gas_safe_number   Optional Gas Safe register number, for the office's records.

alter table public.bookings
  add column if not exists fuel_type text,
  add column if not exists installation_type text;

alter table public.engineers
  add column if not exists gas_safe boolean not null default false,
  add column if not exists gas_safe_number text;

-- Engineers can update their own skills/coverage from the Portal, but they
-- must not be able to mark themselves as Gas Safe registered.
create or replace function public.engineers_gas_safe_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff_or_owner()
     and (new.gas_safe, new.gas_safe_number) is distinct from (old.gas_safe, old.gas_safe_number) then
    raise exception 'Gas Safe registration can only be changed by the Easy Repair office.';
  end if;
  return new;
end $$;
drop trigger if exists trg_engineers_gas_safe_guard on public.engineers;
create trigger trg_engineers_gas_safe_guard
  before update on public.engineers
  for each row execute function public.engineers_gas_safe_guard();
