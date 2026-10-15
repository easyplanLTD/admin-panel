-- 0013_take_payment.sql
--
-- Supports the Portal's "Take payment" screen. The engineer picks the
-- outcome (Repaired / BER) and how the customer pays; the booking shows as
-- "Awaiting payment" and completes by itself once the payment goes through.
-- Safe to run more than once.

alter table public.bookings
  add column if not exists pending_outcome text check (pending_outcome in ('Completed','Beyond Repair')),
  add column if not exists awaiting_payment_since timestamptz;

-- Only EasyRepair / the payments function set these (not engineers directly).
create or replace function public.bookings_stripe_account_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff_or_owner()
     and (new.stripe_charge_account_id, new.pending_outcome, new.awaiting_payment_since)
         is distinct from
         (old.stripe_charge_account_id, old.pending_outcome, old.awaiting_payment_since) then
    raise exception 'Only EasyRepair can change payment details on a booking';
  end if;
  return new;
end $$;
