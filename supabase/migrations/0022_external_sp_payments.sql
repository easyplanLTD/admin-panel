-- 0022_external_sp_payments.sql (27 Oct 2026)
--
-- One-off payment links for jobs done by an external SP (is_external, see
-- 0004 / 0007). There's no Stripe Connect split on these jobs:
--   * staff enter the call-out and parts amounts in FixFlow,
--   * the customer pays EasyRepair's own Stripe account through the usual
--     payment link (payments function, action "send_external_link"),
--   * EasyRepair pays the SP by bank transfer and records it here.
-- Safe to run more than once.

alter table public.bookings
  add column if not exists ext_callout_pence integer check (ext_callout_pence is null or ext_callout_pence >= 0),
  add column if not exists ext_parts_pence integer check (ext_parts_pence is null or ext_parts_pence >= 0),
  add column if not exists ext_parts_description text,
  add column if not exists sp_payout_pence integer check (sp_payout_pence is null or sp_payout_pence >= 0),
  add column if not exists sp_payout_status text check (sp_payout_status in ('owed', 'paid')),
  add column if not exists sp_paid_at timestamptz,
  add column if not exists sp_payout_ref text;

comment on column public.bookings.ext_callout_pence is 'External SP job: call-out fee charged to the customer (set in FixFlow).';
comment on column public.bookings.ext_parts_pence is 'External SP job: parts amount charged to the customer (set in FixFlow).';
comment on column public.bookings.ext_parts_description is 'External SP job: parts description shown on the customer''s checkout.';
comment on column public.bookings.sp_payout_pence is 'External SP job: amount EasyRepair owes the SP (paid by bank transfer).';
comment on column public.bookings.sp_payout_status is 'External SP job: owed / paid. Set to owed by the payments function when the customer pays.';
comment on column public.bookings.sp_paid_at is 'External SP job: when EasyRepair paid the SP.';
comment on column public.bookings.sp_payout_ref is 'External SP job: bank-transfer reference for the SP payment.';

-- Lists "SP payouts owed" quickly on the Payments page.
create index if not exists bookings_sp_payout_owed_idx on public.bookings (sp_payout_status) where sp_payout_status = 'owed';
