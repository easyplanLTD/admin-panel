-- 0017_payments_daily_cron.sql
--
-- Runs the payments function's "daily" action every morning at 06:05 UTC
-- (07:05 in summer, 06:05 in winter, UK time):
--   * adds the £10 admin fee to "pay after the repair" jobs still unpaid from
--     a previous day, and re-sends their payment link
--   * sends Protection Plan renewal reminders and renews plans that are due
--   * marks commission recoveries older than 30 days as invoiced
-- The function does nothing while payments_live is off.
--
-- Security: a random secret is created inside the database (Vault). The
-- schedule sends it, and the function asks the database to check it, so the
-- secret never needs to be copied anywhere. Safe to run more than once.

-- 1. The secret (created once).
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'payments_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payments_cron_secret',
      'Lets the payments-daily schedule run the payments function''s daily action');
  end if;
end $$;

-- 2. Only the payments function (service role) can check it.
create or replace function public.payments_cron_secret_ok(p text)
returns boolean language sql security definer set search_path = '' as $$
  select coalesce(
    (select decrypted_secret = p from vault.decrypted_secrets where name = 'payments_cron_secret'),
    false);
$$;
revoke all on function public.payments_cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.payments_cron_secret_ok(text) to service_role;

-- 3. The schedule.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'payments-daily') then
    perform cron.unschedule('payments-daily');
  end if;
end $$;
select cron.schedule(
  'payments-daily',
  '5 6 * * *',
  $cron$
  select net.http_post(
    url := 'https://nqubqtsjkhfswlrtjzia.supabase.co/functions/v1/payments',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'action', 'daily',
      'cronSecret', (select decrypted_secret from vault.decrypted_secrets where name = 'payments_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $cron$
);
