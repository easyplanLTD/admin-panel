-- 0019_stripe_dashboard_url.sql
--
-- FixFlow's "View in Stripe" link for a paid job. The payment lives on the
-- engineer's connected account, and the dashboard link has to include
-- EasyRepair's own Stripe account (it differs between the sandbox and live),
-- so the payments function builds the exact link when the payment completes.
-- Safe to run more than once.

alter table public.bookings
  add column if not exists stripe_dashboard_url text;

create or replace function public.bookings_stripe_account_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff_or_owner()
     and (new.stripe_charge_account_id, new.pending_outcome, new.awaiting_payment_since,
          new.paid_via, new.card_brand, new.card_last4, new.stripe_livemode, new.stripe_dashboard_url)
         is distinct from
         (old.stripe_charge_account_id, old.pending_outcome, old.awaiting_payment_since,
          old.paid_via, old.card_brand, old.card_last4, old.stripe_livemode, old.stripe_dashboard_url) then
    raise exception 'Only EasyRepair can change payment details on a booking';
  end if;
  return new;
end $$;

-- Test payments taken before this change were all in the "Easyplan LTD sandbox"
-- (platform account acct_1TrcuRQejHD9q3qt).
update public.bookings
   set stripe_dashboard_url = 'https://dashboard.stripe.com/acct_1TrcuRQejHD9q3qt/test/connect/accounts/'
                              || stripe_charge_account_id || '/payments/' || stripe_payment_intent_id
 where stripe_dashboard_url is null
   and stripe_payment_intent_id is not null
   and stripe_charge_account_id is not null
   and stripe_livemode is not true;
