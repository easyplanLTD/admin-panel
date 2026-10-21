-- 0021_visit_slots.sql (21 Oct 2026) -- applied live from the SQL Editor.
--
-- SPs book visits as a half-day slot (AM / PM) rather than an exact time.
-- scheduled_time is already text, so it takes "AM"/"PM" as-is; the return
-- visit time was a `time` column, so it becomes text too (existing values,
-- if any, kept as "HH:MM").
--
-- notified_schedule / notified_return_visit record which "date slot" the
-- customer was last told about by notify-assignment (e.g. "2026-10-22 AM"),
-- so a double save or a webhook retry never texts/emails them twice.
alter table public.bookings
  alter column return_visit_time type text using to_char(return_visit_time, 'HH24:MI');

alter table public.bookings
  add column if not exists notified_schedule text,
  add column if not exists notified_return_visit text;

comment on column public.bookings.scheduled_time is 'Visit slot: AM or PM (older rows may hold HH:MM).';
comment on column public.bookings.return_visit_time is 'Return visit slot: AM or PM (older rows may hold HH:MM).';
comment on column public.bookings.notified_schedule is 'Last "date slot" the customer was notified about for the visit (set by notify-assignment).';
comment on column public.bookings.notified_return_visit is 'Last "date slot" the customer was notified about for the return visit (set by notify-assignment).';
