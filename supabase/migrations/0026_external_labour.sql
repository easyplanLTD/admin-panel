-- 0026_external_labour.sql (3 Nov 2026)
--
-- External SP jobs: a separate "additional labour" amount, for when the SP
-- charges labour on top of the call-out (e.g. a longer repair). Set in
-- FixFlow next to the call-out and parts, shown as its own line on the
-- customer's checkout, and charged even on a beyond-repair job (the work was
-- still done). Safe to run more than once.

alter table public.bookings
  add column if not exists ext_labour_pence integer check (ext_labour_pence is null or ext_labour_pence >= 0),
  add column if not exists ext_labour_description text;

comment on column public.bookings.ext_labour_pence is 'External SP job: additional labour charged to the customer on top of the call-out (set in FixFlow).';
comment on column public.bookings.ext_labour_description is 'External SP job: labour description shown on the customer''s checkout.';
