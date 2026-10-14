-- 0010_payments.sql
--
-- Database support for the Stripe Connect payments build (see the
-- "EasyRepair Payments -- Stripe Connect Build Plan" doc and the Engineer
-- Partner Agreement Payments Addendum). Adds:
--
--   * payment_settings          one-row table of every admin-controlled
--                               payments setting (split, fees, plan prices,
--                               VAT, go-live switch)
--   * payment_overrides         per-engineer / per-plan split overrides
--   * fault_reasons             editable list for uncollectable jobs
--   * refund_reasons            editable list deciding commission on refunds
--   * flag_categories           editable list engineers pick from when
--                               flagging a problem or disputing a decision
--   * job_flags                 engineer problem / dispute flags + outcomes
--   * commission_recoveries     commission owed back by engineers
--   * plan_changes, plan_payments  protection plan history
--   * payment columns on bookings, engineers and service_plans
--   * guard triggers so engineers can't edit money / Stripe columns
--   * job-flag-photos storage bucket
--
-- Safe to re-run: everything uses IF NOT EXISTS / ON CONFLICT / DROP ... IF
-- EXISTS. Run once in Supabase Dashboard -> SQL Editor, same as earlier
-- migrations. Needs public.is_staff_or_owner() from 0001_identity.sql.
--
-- Nothing here moves money. Charging cards, payment links, Stripe onboarding
-- and refunds are done by Edge Functions added once the Stripe account is
-- set up; until payment_settings.payments_live is switched on, both apps
-- show those actions as "available when payments go live".
--
-- Applied to the live database on 2026-10-14.

-- ─── helpers ───────────────────────────────────────────────────────────────
create or replace function public.is_owner()
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'owner');
$$;

-- The engineers.id of the logged-in engineer (null for staff/owner).
create or replace function public.current_engineer_id()
returns uuid language sql security definer set search_path = public stable as $$
  select id from public.engineers where profile_id = auth.uid();
$$;

-- ─── payment_settings (single row) ────────────────────────────────────────
create table if not exists public.payment_settings (
  id                          int primary key default 1 check (id = 1),
  payments_live               boolean not null default false,
  -- callout fees and the split
  callout_protection_pence    int not null default 7999,
  callout_repair_only_pence   int not null default 9999,
  engineer_callout_share      numeric(6,2) not null default 62.51,
  engineer_parts_share        numeric(6,2) not null default 100,
  fee_bearer                  text not null default 'easyrepair'
                              check (fee_bearer in ('easyrepair','engineer','customer_price')),
  -- fees
  admin_fee_pence             int not null default 1000,   -- Pay after repair, unpaid on the day
  admin_fee_engineer_share    numeric(6,2) not null default 0,
  late_cancel_fee_pence       int not null default 2500,
  free_cancel_hours           int not null default 48,
  late_cancel_engineer_share  numeric(6,2) not null default 0,
  no_show_fee_pence           int not null default 2500,
  no_show_engineer_share      numeric(6,2) not null default 50,
  recovery_invoice_days       int not null default 30,
  -- protection plan pricing (pence; tiers = 1,2,3,4 appliances)
  plan_monthly_tiers          int[] not null default '{799,1299,1699,2000}',
  plan_monthly_extra_pence    int not null default 499,
  plan_annual_tiers           int[] not null default '{8629,14029,18349,21600}',
  plan_annual_extra_pence     int not null default 5389,
  plan_first_payment_days     int not null default 7,
  plan_term_months            int not null default 12,
  plan_cooling_off_days       int not null default 14,
  plan_cancel_fee_pence       int not null default 2500,
  plan_renewal_reminder_days  int not null default 30,
  -- VAT
  vat_registered              boolean not null default false,
  vat_rate                    numeric(5,2) not null default 20,
  vat_threshold_pence         bigint not null default 9000000,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.profiles(id)
);
insert into public.payment_settings (id) values (1) on conflict (id) do nothing;

alter table public.payment_settings enable row level security;
drop policy if exists "payment_settings: signed-in read" on public.payment_settings;
create policy "payment_settings: signed-in read" on public.payment_settings
  for select using (auth.uid() is not null);
drop policy if exists "payment_settings: owner update" on public.payment_settings;
create policy "payment_settings: owner update" on public.payment_settings
  for update using (public.is_owner()) with check (public.is_owner());

-- ─── payment_overrides (per engineer / per plan) ──────────────────────────
create table if not exists public.payment_overrides (
  id                      uuid primary key default gen_random_uuid(),
  engineer_id             uuid references public.engineers(id) on delete cascade,
  plan                    text check (plan in ('repair_protection','repair_only')),
  engineer_callout_share  numeric(6,2),
  engineer_parts_share    numeric(6,2),
  fee_bearer              text check (fee_bearer in ('easyrepair','engineer','customer_price')),
  reason                  text,
  active                  boolean not null default true,
  created_by              uuid references public.profiles(id),
  created_at              timestamptz not null default now(),
  check (engineer_id is not null or plan is not null)
);
alter table public.payment_overrides enable row level security;
drop policy if exists "payment_overrides: staff all" on public.payment_overrides;
create policy "payment_overrides: staff all" on public.payment_overrides
  for all using (public.is_staff_or_owner()) with check (public.is_staff_or_owner());
drop policy if exists "payment_overrides: engineer reads own and plan-wide" on public.payment_overrides;
create policy "payment_overrides: engineer reads own and plan-wide" on public.payment_overrides
  for select using (engineer_id = public.current_engineer_id() or engineer_id is null);

-- ─── editable reason lists ────────────────────────────────────────────────
create table if not exists public.fault_reasons (
  id                 uuid primary key default gen_random_uuid(),
  label              text not null,
  engineer_at_fault  boolean not null,
  active             boolean not null default true,
  sort_order         int not null default 0,
  created_by         uuid references public.profiles(id),
  created_at         timestamptz not null default now()
);
create table if not exists public.refund_reasons (
  id                  uuid primary key default gen_random_uuid(),
  label               text not null,
  commission_outcome  text not null check (commission_outcome in ('refund','keep')),
  active              boolean not null default true,
  sort_order          int not null default 0,
  created_by          uuid references public.profiles(id),
  created_at          timestamptz not null default now()
);
create table if not exists public.flag_categories (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  applies_to  text not null default 'both' check (applies_to in ('problem','dispute','both')),
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['fault_reasons','refund_reasons','flag_categories'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s: signed-in read" on public.%I', t, t);
    execute format('create policy "%s: signed-in read" on public.%I for select using (auth.uid() is not null)', t, t);
    execute format('drop policy if exists "%s: staff write" on public.%I', t, t);
    execute format('create policy "%s: staff write" on public.%I for all using (public.is_staff_or_owner()) with check (public.is_staff_or_owner())', t, t);
  end loop;
end $$;

-- Starting lists (only inserted when the table is empty, so edits made in
-- Settings are never overwritten by re-running this file).
insert into public.fault_reasons (label, engineer_at_fault, sort_order)
select * from (values
  ('Left a Pay after repair job without taking payment', true, 1),
  ('Charged parts the customer had not approved', true, 2),
  ('Job marked complete but not actually finished', true, 3),
  ('Didn''t record a no-show while at the property', true, 4),
  ('Customer refused to pay', false, 10),
  ('Customer can''t be reached', false, 11),
  ('Card failed and customer ignored the payment link', false, 12),
  ('Customer disputed the charge with their bank and won', false, 13)
) v(label, engineer_at_fault, sort_order)
where not exists (select 1 from public.fault_reasons);

insert into public.refund_reasons (label, commission_outcome, sort_order)
select * from (values
  ('Duplicate charge or system error', 'refund', 1),
  ('Wrong amount charged because of a booking or system error', 'refund', 2),
  ('Booking details from EasyRepair were wrong, so the job couldn''t be done', 'refund', 3),
  ('EasyRepair cancelled or rescheduled the job', 'refund', 4),
  ('Booking should not have been accepted (outside area or appliance not covered)', 'refund', 5),
  ('Repair was covered by the customer''s protection plan and charged in error', 'refund', 6),
  ('Fraudulent card payment, engineer followed the payment process', 'refund', 7),
  ('Goodwill refund for a complaint about EasyRepair''s own service', 'refund', 8),
  ('Job was a duplicate of one the engineer already had', 'refund', 9),
  ('Beyond economical repair, goodwill callout refund approved by EasyRepair', 'refund', 10),
  ('Poor workmanship, or the repair failed', 'keep', 20),
  ('Engineer arrived very late or missed the appointment', 'keep', 21),
  ('Complaint about the engineer''s conduct', 'keep', 22),
  ('Wrong parts ordered or fitted by the engineer', 'keep', 23),
  ('Engineer charged parts the customer had not approved', 'keep', 24),
  ('Job marked complete but not actually finished', 'keep', 25),
  ('Engineer gave a discount or refund on their own decision', 'keep', 26),
  ('Customer changed their mind after the work was done', 'keep', 27),
  ('Price dispute over parts the customer had approved', 'keep', 28),
  ('Damage to the customer''s property caused by the engineer', 'keep', 29)
) v(label, commission_outcome, sort_order)
where not exists (select 1 from public.refund_reasons);

insert into public.flag_categories (label, applies_to, sort_order)
select * from (values
  ('Customer won''t pay or payment failed', 'problem', 1),
  ('Customer asked for a refund', 'problem', 2),
  ('Customer complaint', 'problem', 3),
  ('Booking details were wrong', 'problem', 4),
  ('Safety or access issue at the property', 'problem', 5),
  ('Parts or pricing question', 'problem', 6),
  ('I disagree with the fault decision', 'dispute', 10),
  ('I disagree with the refund decision', 'dispute', 11),
  ('Commission recovered in error', 'dispute', 12),
  ('Other', 'both', 99)
) v(label, applies_to, sort_order)
where not exists (select 1 from public.flag_categories);

-- ─── bookings: payment columns ────────────────────────────────────────────
alter table public.bookings
  add column if not exists callout_fee               numeric(8,2),
  add column if not exists payment_timing            text check (payment_timing in ('before','after')),
  -- parts quoted by the engineer: [{id, description, price_pence}]
  add column if not exists parts_lines               jsonb not null default '[]'::jsonb,
  add column if not exists parts_total_pence         int not null default 0,
  add column if not exists parts_approval_status     text not null default 'none'
                             check (parts_approval_status in ('none','pending','approved','declined')),
  add column if not exists parts_approved_at         timestamptz,
  add column if not exists parts_approval_method     text,
  -- split: per-job override set by admin, and the terms fixed at assignment
  add column if not exists split_override            jsonb,
  add column if not exists terms_snapshot            jsonb,
  -- money once charged (pence)
  add column if not exists total_pence               int,
  add column if not exists commission_pence          int,
  add column if not exists engineer_share_pence      int,
  add column if not exists stripe_fee_pence          int,
  add column if not exists payment_status            text not null default 'not_charged'
                             check (payment_status in ('not_charged','processing','paid','outstanding','uncollectable','refunded','part_refunded','disputed')),
  add column if not exists paid_at                   timestamptz,
  add column if not exists payment_link_url          text,
  add column if not exists stripe_customer_id        text,
  add column if not exists stripe_payment_method_id  text,
  add column if not exists stripe_payment_intent_id  text,
  add column if not exists consent_text              text,
  add column if not exists consent_at                timestamptz,
  -- late-payment admin fee (Pay after repair)
  add column if not exists admin_fee_pence           int,
  add column if not exists admin_fee_applied_at      timestamptz,
  -- cancellations and no-shows
  add column if not exists cancelled_at              timestamptz,
  add column if not exists no_show                   boolean not null default false,
  add column if not exists no_show_at                timestamptz,
  add column if not exists cancellation_fee_type     text check (cancellation_fee_type in ('late_cancel','no_show')),
  add column if not exists cancellation_fee_pence    int,
  add column if not exists cancellation_fee_status   text not null default 'none'
                             check (cancellation_fee_status in ('none','pending','charged','waived','failed')),
  add column if not exists fee_engineer_share_pence  int,
  add column if not exists fee_transfer_id           text,
  -- uncollectable jobs and fault decisions
  add column if not exists uncollectable_at          timestamptz,
  add column if not exists fault                     text check (fault in ('engineer','not_engineer')),
  add column if not exists fault_reason_id           uuid references public.fault_reasons(id),
  add column if not exists fault_note                text,
  add column if not exists fault_set_by              uuid references public.profiles(id),
  -- refunds
  add column if not exists refund_reason_id          uuid references public.refund_reasons(id),
  add column if not exists refund_amount_pence       int,
  add column if not exists commission_refunded_pence int,
  add column if not exists refunded_at               timestamptz,
  add column if not exists refunded_by               uuid references public.profiles(id),
  add column if not exists refund_source             text check (refund_source in ('admin','engineer_dashboard'));

-- ─── engineers: Stripe Connect account ────────────────────────────────────
alter table public.engineers
  add column if not exists stripe_account_id        text,
  add column if not exists stripe_status            text not null default 'not_started'
                             check (stripe_status in ('not_started','incomplete','under_review','active','restricted')),
  add column if not exists stripe_charges_enabled   boolean not null default false,
  add column if not exists stripe_payouts_enabled   boolean not null default false,
  add column if not exists stripe_requirements_due  jsonb not null default '[]'::jsonb,
  add column if not exists stripe_updated_at        timestamptz;

-- ─── service_plans: billing ───────────────────────────────────────────────
alter table public.service_plans
  add column if not exists stripe_subscription_id    text,
  add column if not exists billing_interval          text not null default 'month' check (billing_interval in ('month','year')),
  add column if not exists pending_interval          text check (pending_interval in ('month','year')),
  add column if not exists appliance_count           int not null default 1 check (appliance_count >= 1),
  add column if not exists appliances                jsonb not null default '[]'::jsonb,
  add column if not exists price_pence               int,
  add column if not exists first_payment_at          timestamptz,
  add column if not exists agreement_start           timestamptz,
  add column if not exists agreement_end             timestamptz,
  add column if not exists cooling_off_ends_at       timestamptz,
  add column if not exists term_number               int not null default 1,
  add column if not exists next_renewal_at           timestamptz,
  add column if not exists renewal_reminder_sent_at  timestamptz,
  add column if not exists cancellation_fee_pence    int,
  add column if not exists cancellation_fee_charged  boolean not null default false,
  add column if not exists cancel_reason             text;

create table if not exists public.plan_changes (
  id                     uuid primary key default gen_random_uuid(),
  plan_id                uuid not null references public.service_plans(id) on delete cascade,
  summary                text not null,
  details                jsonb not null default '{}'::jsonb,
  changed_by             uuid references public.profiles(id),
  customer_confirmed_at  timestamptz,
  created_at             timestamptz not null default now()
);
create table if not exists public.plan_payments (
  id                 uuid primary key default gen_random_uuid(),
  plan_id            uuid not null references public.service_plans(id) on delete cascade,
  amount_pence       int not null,
  kind               text not null default 'subscription' check (kind in ('subscription','cancellation_fee','refund')),
  stripe_invoice_id  text,
  paid_at            timestamptz not null default now()
);
do $$
declare t text;
begin
  foreach t in array array['plan_changes','plan_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s: staff all" on public.%I', t, t);
    execute format('create policy "%s: staff all" on public.%I for all using (public.is_staff_or_owner()) with check (public.is_staff_or_owner())', t, t);
  end loop;
end $$;

-- ─── job_flags (Flag a problem / Dispute this decision) ───────────────────
create table if not exists public.job_flags (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings(id) on delete cascade,
  engineer_id  uuid references public.engineers(id) on delete set null,
  type         text not null default 'problem' check (type in ('problem','dispute','refund_review')),
  category_id  uuid references public.flag_categories(id),
  message      text not null default '',
  attachments  jsonb not null default '[]'::jsonb,   -- storage paths in job-flag-photos
  status       text not null default 'open' check (status in ('open','under_review','resolved')),
  outcome      text check (outcome in ('upheld','overturned','noted')),
  admin_note   text,
  resolved_by  uuid references public.profiles(id),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists job_flags_booking_idx on public.job_flags(booking_id);
create index if not exists job_flags_status_idx on public.job_flags(status);
alter table public.job_flags enable row level security;
drop policy if exists "job_flags: staff all" on public.job_flags;
create policy "job_flags: staff all" on public.job_flags
  for all using (public.is_staff_or_owner()) with check (public.is_staff_or_owner());
drop policy if exists "job_flags: engineer reads own" on public.job_flags;
create policy "job_flags: engineer reads own" on public.job_flags
  for select using (engineer_id = public.current_engineer_id());
drop policy if exists "job_flags: engineer raises own" on public.job_flags;
create policy "job_flags: engineer raises own" on public.job_flags
  for insert with check (
    engineer_id = public.current_engineer_id()
    and status = 'open' and outcome is null and type in ('problem','dispute')
    and exists (select 1 from public.bookings b where b.id = booking_id and b.engineer_id = public.current_engineer_id())
  );

-- ─── commission_recoveries ────────────────────────────────────────────────
create table if not exists public.commission_recoveries (
  id                       uuid primary key default gen_random_uuid(),
  booking_id               uuid not null references public.bookings(id) on delete cascade,
  engineer_id              uuid not null references public.engineers(id) on delete cascade,
  amount_pence             int not null check (amount_pence > 0),
  status                   text not null default 'pending'
                           check (status in ('pending','paused','recovered','invoiced','refunded','cancelled')),
  reason                   text,
  recovered_on_booking_id  uuid references public.bookings(id) on delete set null,
  invoiced_at              timestamptz,
  created_by               uuid references public.profiles(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists commission_recoveries_engineer_idx on public.commission_recoveries(engineer_id);
alter table public.commission_recoveries enable row level security;
drop policy if exists "commission_recoveries: staff all" on public.commission_recoveries;
create policy "commission_recoveries: staff all" on public.commission_recoveries
  for all using (public.is_staff_or_owner()) with check (public.is_staff_or_owner());
drop policy if exists "commission_recoveries: engineer reads own" on public.commission_recoveries;
create policy "commission_recoveries: engineer reads own" on public.commission_recoveries
  for select using (engineer_id = public.current_engineer_id());

-- ─── terms fixed at assignment ────────────────────────────────────────────
-- Works out the split in force for an engineer + plan right now:
-- global settings, then a plan-wide override, then an engineer override.
create or replace function public.current_payment_terms(p_engineer uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  s public.payment_settings;
  o record;
  res jsonb;
begin
  select * into s from public.payment_settings where id = 1;
  res := jsonb_build_object(
    'engineer_callout_share', s.engineer_callout_share,
    'engineer_parts_share',   s.engineer_parts_share,
    'fee_bearer',             s.fee_bearer,
    'callout_pence', case when p_plan = 'repair_protection' then s.callout_protection_pence else s.callout_repair_only_pence end,
    'fixed_at', now());
  for o in
    select * from public.payment_overrides
    where active and ((plan = p_plan and engineer_id is null) or (engineer_id = p_engineer and (plan is null or plan = p_plan)))
    order by (engineer_id is not null), (plan is not null), created_at
  loop
    if o.engineer_callout_share is not null then res := res || jsonb_build_object('engineer_callout_share', o.engineer_callout_share); end if;
    if o.engineer_parts_share   is not null then res := res || jsonb_build_object('engineer_parts_share',   o.engineer_parts_share);   end if;
    if o.fee_bearer             is not null then res := res || jsonb_build_object('fee_bearer',             o.fee_bearer);             end if;
  end loop;
  return res;
end $$;

create or replace function public.bookings_payment_before_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_staff boolean := public.is_staff_or_owner();
  is_service boolean := auth.uid() is null;           -- Edge Functions / SQL editor
begin
  -- Parts total always follows the lines.
  new.parts_total_pence := coalesce((
    select sum(greatest(coalesce((l->>'price_pence')::int, 0), 0))
    from jsonb_array_elements(coalesce(new.parts_lines, '[]'::jsonb)) l), 0);

  -- Fix the split when the job is (re)assigned to an engineer.
  if new.engineer_id is not null
     and (tg_op = 'INSERT' or new.engineer_id is distinct from old.engineer_id) then
    new.terms_snapshot := public.current_payment_terms(
      new.engineer_id,
      case when new.wants_protection_plan then 'repair_protection' else 'repair_only' end);
  end if;

  if tg_op = 'UPDATE' and not is_staff and not is_service then

    -- Money, Stripe and decision columns are EasyRepair / Stripe only.
    if (new.split_override, new.terms_snapshot, new.total_pence, new.commission_pence,
        new.engineer_share_pence, new.stripe_fee_pence, new.payment_status, new.paid_at,
        new.payment_link_url, new.stripe_customer_id, new.stripe_payment_method_id,
        new.stripe_payment_intent_id, new.consent_text, new.consent_at,
        new.admin_fee_pence, new.admin_fee_applied_at, new.cancellation_fee_type,
        new.cancellation_fee_pence, new.cancellation_fee_status, new.fee_engineer_share_pence,
        new.fee_transfer_id, new.uncollectable_at, new.fault, new.fault_reason_id, new.fault_note,
        new.fault_set_by, new.refund_reason_id, new.refund_amount_pence,
        new.commission_refunded_pence, new.refunded_at, new.refunded_by, new.refund_source,
        new.callout_fee, new.payment_timing)
       is distinct from
       (old.split_override, old.terms_snapshot, old.total_pence, old.commission_pence,
        old.engineer_share_pence, old.stripe_fee_pence, old.payment_status, old.paid_at,
        old.payment_link_url, old.stripe_customer_id, old.stripe_payment_method_id,
        old.stripe_payment_intent_id, old.consent_text, old.consent_at,
        old.admin_fee_pence, old.admin_fee_applied_at, old.cancellation_fee_type,
        old.cancellation_fee_pence, old.cancellation_fee_status, old.fee_engineer_share_pence,
        old.fee_transfer_id, old.uncollectable_at, old.fault, old.fault_reason_id, old.fault_note,
        old.fault_set_by, old.refund_reason_id, old.refund_amount_pence,
        old.commission_refunded_pence, old.refunded_at, old.refunded_by, old.refund_source,
        old.callout_fee, old.payment_timing) then
      raise exception 'Payment details on a booking can only be changed by EasyRepair.';
    end if;

    -- Engineers may edit parts lines; doing so sends them back for approval.
    -- Only the customer (via an Edge Function) or EasyRepair can approve.
    if new.parts_lines is distinct from old.parts_lines then
      new.parts_approval_status := case when jsonb_array_length(coalesce(new.parts_lines,'[]'::jsonb)) = 0 then 'none' else 'pending' end;
      new.parts_approved_at := null;
      new.parts_approval_method := null;
    else
      if new.parts_approval_status is distinct from old.parts_approval_status
         and new.parts_approval_status not in ('none','pending') then
        raise exception 'Only the customer or EasyRepair can approve parts.';
      end if;
      new.parts_approved_at := old.parts_approved_at;
      new.parts_approval_method := old.parts_approval_method;
    end if;

    -- "Customer not home": engineers can record it, not undo it.
    if old.no_show and not new.no_show then
      raise exception 'Only EasyRepair can undo a no-show.';
    end if;
    if new.no_show and not old.no_show then new.no_show_at := now(); end if;

    -- Can't mark complete with parts the customer hasn't approved.
    if new.status = 'Completed' and old.status is distinct from 'Completed'
       and new.parts_approval_status = 'pending' then
      raise exception 'The customer needs to approve the parts before this job can be completed.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_bookings_payment_before_write on public.bookings;
create trigger trg_bookings_payment_before_write
  before insert or update on public.bookings
  for each row execute function public.bookings_payment_before_write();

-- Engineers can't edit their own Stripe status.
create or replace function public.engineers_stripe_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_staff_or_owner()
     and (new.stripe_account_id, new.stripe_status, new.stripe_charges_enabled,
          new.stripe_payouts_enabled, new.stripe_requirements_due)
         is distinct from
         (old.stripe_account_id, old.stripe_status, old.stripe_charges_enabled,
          old.stripe_payouts_enabled, old.stripe_requirements_due) then
    raise exception 'Stripe account details are updated by Stripe, not from the Portal.';
  end if;
  return new;
end $$;
drop trigger if exists trg_engineers_stripe_guard on public.engineers;
create trigger trg_engineers_stripe_guard
  before update on public.engineers
  for each row execute function public.engineers_stripe_guard();

-- A dispute raised against a fault decision pauses any recovery for that job.
create or replace function public.job_flags_pause_recovery()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'dispute' then
    update public.commission_recoveries
       set status = 'paused', updated_at = now()
     where booking_id = new.booking_id and status = 'pending';
  end if;
  return new;
end $$;
drop trigger if exists trg_job_flags_pause_recovery on public.job_flags;
create trigger trg_job_flags_pause_recovery
  after insert on public.job_flags
  for each row execute function public.job_flags_pause_recovery();

-- ─── job-flag-photos storage bucket ───────────────────────────────────────
-- Files live under "<engineer's profile id>/<flag or booking id>/<file>".
insert into storage.buckets (id, name, public)
values ('job-flag-photos', 'job-flag-photos', false)
on conflict (id) do nothing;

drop policy if exists "job flag photos: engineer own folder" on storage.objects;
create policy "job flag photos: engineer own folder" on storage.objects for all
  using (bucket_id = 'job-flag-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'job-flag-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "job flag photos: staff all" on storage.objects;
create policy "job flag photos: staff all" on storage.objects for all
  using (bucket_id = 'job-flag-photos' and public.is_staff_or_owner())
  with check (bucket_id = 'job-flag-photos' and public.is_staff_or_owner());

-- ─── realtime for the Disputes queue (ignore the error if already added) ──
do $$ begin
  alter publication supabase_realtime add table public.job_flags;
exception when others then null; end $$;
