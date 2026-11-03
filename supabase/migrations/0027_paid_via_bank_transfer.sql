-- 0027_paid_via_bank_transfer.sql (3 Nov 2026)
--
-- Lets a job be recorded as paid by bank transfer (outside Stripe), e.g. a
-- customer who couldn't use the payment link. FixFlow shows "Bank transfer"
-- in the job's payment record and hides the Stripe refund button.
-- Safe to run more than once.

alter table public.bookings drop constraint if exists bookings_paid_via_check;
alter table public.bookings
  add constraint bookings_paid_via_check check (paid_via in ('saved_card', 'online', 'bank_transfer'));
