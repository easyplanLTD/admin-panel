-- 0028_admin_fee_hourly.sql
--
-- The £10 late-payment admin fee now applies 24 hours after the job is
-- completed (bookings.awaiting_payment_since), not at the next morning's
-- daily run. This adds an hourly schedule that calls the payments function's
-- "admin_fees" action, so the fee lands within an hour of the 24-hour mark.
-- The 06:05 "payments-daily" schedule (0017) is unchanged and uses the same
-- 24-hour rule. Uses the same Vault secret as 0017. Safe to run more than once.
-- Run on 5 Nov 2026.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'payments-admin-fees-hourly') then
    perform cron.unschedule('payments-admin-fees-hourly');
  end if;
end $$;

select cron.schedule(
  'payments-admin-fees-hourly',
  '20 * * * *',
  $cron$
  select net.http_post(
    url := 'https://nqubqtsjkhfswlrtjzia.supabase.co/functions/v1/payments',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'admin_fees',
      'cronSecret', (select decrypted_secret from vault.decrypted_secrets where name = 'payments_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $cron$
);
