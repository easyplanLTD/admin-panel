-- 0029: per-job switch to waive the late-payment admin fee.
-- Applied live in the SQL editor on 15 Nov 2026.
-- The hourly admin fee run (0028) skips bookings where this is true;
-- staff set it from the late fee switch in FixFlow (payments action remove_admin_fee).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS admin_fee_waived boolean NOT NULL DEFAULT false;
