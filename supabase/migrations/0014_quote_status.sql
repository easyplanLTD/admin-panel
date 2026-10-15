-- 0014_quote_status.sql
--
-- Allow 'Quote' as a booking status again. FixFlow's Quotes page and the
-- generate-test-data function create bookings as 'Quote', but the live
-- bookings_status_check constraint no longer listed it, so "Generate one
-- batch of test jobs" failed with: violates check constraint "bookings_status_check".
-- Applied to the live database on 2026-10-15. Safe to run more than once.

alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('Quote','Booked','Assigned','Parts Awaited','In Progress','Completed','Beyond Repair','Cancelled'));
