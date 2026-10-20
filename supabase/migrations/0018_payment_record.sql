-- 0018_payment_record.sql
--
-- Payment record shown in FixFlow and the Portal once a job is paid:
-- how it was paid, the card used, and whether it was a live or test payment
-- (so FixFlow's "View in Stripe" link opens the right part of the dashboard).
-- The Stripe payment ID itself is already stored (stripe_payment_intent_id).
-- Safe to run more than once.

alter table public.bookings
  add column if not exists paid_via text check (paid_via in ('saved_card', 'online')),
  add column if not exists card_brand text,
  add column if not exists card_last4 text,
  add column if not exists stripe_livemode boolean;

-- Only EasyRepair / the payments function set these (not engineers directly).
create or replace function public.bookings_stripe_account_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff_or_owner()
     and (new.stripe_charge_account_id, new.pending_outcome, new.awaiting_payment_since,
          new.paid_via, new.card_brand, new.card_last4, new.stripe_livemode)
         is distinct from
         (old.stripe_charge_account_id, old.pending_outcome, old.awaiting_payment_since,
          old.paid_via, old.card_brand, old.card_last4, old.stripe_livemode) then
    raise exception 'Only EasyRepair can change payment details on a booking';
  end if;
  return new;
end $$;
