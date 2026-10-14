-- 0011_payments_stripe.sql
--
-- Small additions the "payments" Edge Function needs on top of 0010_payments.sql.
-- Safe to run more than once.

-- Which engineer Stripe account a job's payment was taken on (needed for
-- refunds even if the job is later reassigned).
alter table public.bookings
  add column if not exists stripe_charge_account_id text;

-- Each Stripe webhook event is handled once.
create table if not exists public.stripe_events (
  id          text primary key,
  type        text not null,
  account     text,
  received_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;
drop policy if exists "stripe_events: staff read" on public.stripe_events;
create policy "stripe_events: staff read" on public.stripe_events
  for select using (public.is_staff_or_owner());

-- Engineers can't touch the new column either.
create or replace function public.bookings_stripe_account_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff_or_owner()
     and new.stripe_charge_account_id is distinct from old.stripe_charge_account_id then
    raise exception 'Only EasyRepair can change payment details on a booking';
  end if;
  return new;
end $$;
drop trigger if exists bookings_stripe_account_guard on public.bookings;
create trigger bookings_stripe_account_guard
  before update on public.bookings
  for each row execute function public.bookings_stripe_account_guard();

-- "Payment Taken before Mark Completed" (0008) stays as it is for cash/manual
-- jobs. Once payments are live, card jobs (card saved at booking) and
-- Pay after repair jobs can be completed first: completing them is what
-- triggers the charge or the payment link.
create or replace function public.booking_can_complete_unpaid(b public.bookings)
returns boolean language sql stable security definer set search_path = public as $$
  select (coalesce((select payments_live from public.payment_settings where id = 1), false)
          or coalesce(b.is_test, false))   -- test bookings, while trying it out with Stripe test keys
     and not coalesce(b.is_external, false)
     and (b.stripe_payment_method_id is not null or b.payment_timing = 'after');
$$;

-- Add that exception to the existing check from 0008 without rewriting it:
-- insert one line at the start of enforce_payment_before_complete()'s body.
-- Runs once (skips if the line is already there, or if the function doesn't exist).
do $$
declare def text;
begin
  select pg_get_functiondef('public.enforce_payment_before_complete'::regproc) into def;
  if position('booking_can_complete_unpaid' in def) = 0 then
    def := regexp_replace(def, '\mbegin\M',
      E'begin\n  if new.status = ''Completed'' and public.booking_can_complete_unpaid(new) then return new; end if;', 'i');
    execute def;
  end if;
exception when undefined_function then
  raise notice 'enforce_payment_before_complete() not found, nothing to change';
end $$;
