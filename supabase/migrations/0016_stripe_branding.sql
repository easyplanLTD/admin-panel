-- 0016_stripe_branding.sql
--
-- Tracks which version of EasyRepair's Stripe branding (logo, icon, colours,
-- "EASYREPAIR" card statement prefix) has been applied to each engineer's
-- Stripe account. The payments function applies it the next time an account
-- is used and bumps this number. Safe to run more than once.

alter table public.engineers
  add column if not exists stripe_branding_version integer not null default 0;
