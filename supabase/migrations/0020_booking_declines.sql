-- 0020_booking_declines.sql
--
-- One row every time an SP declines a booking through the Portal (written by
-- the decline-booking Edge Function with the service_role key). Powers:
--   * the "Declined by SP" alert on the admin Dashboard + sidebar badge
--   * an audit trail of who declined what, and where the job went next
-- Staff/owner can read and acknowledge (dismiss) rows; nobody else can see them.

create table if not exists public.booking_declines (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid not null references public.bookings(id) on delete cascade,
  engineer_id        uuid references public.engineers(id) on delete set null,
  engineer_name      text,
  reason             text,
  reassigned_to      uuid references public.engineers(id) on delete set null,
  reassigned_to_name text,
  declined_at        timestamptz not null default now(),
  acknowledged_at    timestamptz,
  acknowledged_by    uuid references auth.users(id) on delete set null
);

create index if not exists booking_declines_booking_idx on public.booking_declines (booking_id);
create index if not exists booking_declines_open_idx    on public.booking_declines (declined_at desc) where acknowledged_at is null;

alter table public.booking_declines enable row level security;

drop policy if exists "booking_declines: staff/owner can read"   on public.booking_declines;
drop policy if exists "booking_declines: staff/owner can update" on public.booking_declines;

create policy "booking_declines: staff/owner can read"
  on public.booking_declines for select
  using (public.is_staff_or_owner());

create policy "booking_declines: staff/owner can update"
  on public.booking_declines for update
  using (public.is_staff_or_owner())
  with check (public.is_staff_or_owner());

-- Live updates for the admin panel's alert/badge.
do $$
begin
  alter publication supabase_realtime add table public.booking_declines;
exception when duplicate_object then null;
end $$;
