-- 0023_external_links_live.sql (28 Oct 2026)
--
-- Lets external SP payment links (0022) take real payments before the rest
-- of payments goes live. When this is on, and the payments function has the
-- STRIPE_LIVE_SECRET_KEY secret, external SP links on real (non-test)
-- bookings are charged on EasyRepair's LIVE Stripe account. Test bookings
-- keep using Stripe test mode. Everything else (engineer jobs, booking-form
-- cards, plans) still follows payments_live as before.
-- Switch it in FixFlow: Settings -> Payments -> VAT & go live.
-- Safe to run more than once.

alter table public.payment_settings
  add column if not exists external_links_live boolean not null default false;

comment on column public.payment_settings.external_links_live is
  'External SP one-off payment links use the live Stripe account (STRIPE_LIVE_SECRET_KEY) for real bookings, even while payments_live is off.';
