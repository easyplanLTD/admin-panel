// supabase/functions/submit-booking/index.ts
//
// Public entry point for the "Book a Repair" form on easyrepair.co.uk. This
// is the ONLY way a booking gets created from the public website -- the
// website itself has no Supabase session at all, so this function uses the
// service-role key to do the actual insert after validating the input.
//
// It also runs the same engineer-assignment logic FixFlow's own "Reassign"
// modal already used (autoAssign() in src/App.jsx) -- ported here so a
// website booking gets assigned the same way a staff member's manual
// reassignment would, instead of a second, different algorithm nobody asked
// for. See that function if you ever need to change the ranking rules --
// keep both in sync.
//
// Deploy with:  supabase functions deploy submit-booking --no-verify-jwt
//
// The --no-verify-jwt flag matters: this function is called by anonymous
// website visitors with no Supabase JWT at all, so Supabase's platform-level
// JWT check (which runs before your code, ahead of anything below) must be
// switched off for this one function specifically. create-user does NOT use
// this flag, on purpose -- it still requires a real logged-in owner/staff
// session.

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const NOTIFY_FROM_EMAIL = Deno.env.get("NOTIFY_FROM_EMAIL") || "bookings@easyrepair.co.uk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Best-effort booking-received email to the customer. Uses the same Resend
// account and NOTIFY_FROM_EMAIL as notify-assignment/index.ts. A failure
// here must never block the booking response -- the row is already saved.
async function sendBookingReceivedEmail(to, booking) {
  if (!RESEND_API_KEY) return { skipped: true };

  const lines = [
    'Hi ' + escapeHtml(booking.name) + ',',
    'Thanks for booking with Easy Repair. We have received your request and will call you shortly to confirm your appointment.',
    'Appliance: ' + escapeHtml(booking.appliance) + (booking.brand ? ' (' + escapeHtml(booking.brand) + ')' : ''),
    'Issue: ' + escapeHtml(booking.issue || 'Not specified'),
    'Address: ' + escapeHtml(booking.address || booking.postcode),
    'Booking reference: ' + escapeHtml(String(booking.bookingId)),
    // Assigned engineer's direct number, when one was matched at booking time.
    // (If not, notify-assignment emails/texts it once an engineer is assigned.)
    booking.engineerPhone
      ? 'Your engineer: ' + escapeHtml(booking.engineerName || 'Easy Repair engineer') + ' - <a href="tel:' + escapeHtml(booking.engineerPhone) + '">' + escapeHtml(booking.engineerPhone) + '</a>'
      : null,
    // Small addition alongside the existing lines: lets the customer see
    // their own choice reflected back, same as the rest of this email
    // already confirms what they entered (appliance, address, etc).
    booking.protectionPlan
      ? 'You have also been set up with our Repair + Protection Plan, covering future callouts on this appliance.'
      : null,
    'The callout fee is a flat GBP ' + (booking.protectionPlan ? '79.99' : '99.99') + ', covering the engineer visit and diagnosis. Any parts needed will be quoted before work begins.',
    'Thanks, Easy Repair',
  ].filter(Boolean);
  const html = '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #111111; line-height: 1.6;"><p>' + lines.join('</p><p>') + '</p><img src="https://nqubqtsjkhfswlrtjzia.supabase.co/storage/v1/object/public/branding/easyrepair-logo-email.png" alt="EasyRepair" width="200" height="44" style="display:block;border:0;width:200px;height:44px;margin-top:20px;"></div>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: NOTIFY_FROM_EMAIL,
      to: to,
      subject: 'Booking received - Easy Repair',
      html: html,
    }),
  });

  if (!res.ok) return { error: await res.text() };
  return { sent: true };
}

// Internal alert to the Easy Repair team for every new online booking.
// Recipients come from the ADMIN_NOTIFY_EMAIL secret (comma-separated for
// several addresses), falling back to admin@easyrepair.co.uk.
const ADMIN_NOTIFY_EMAIL = Deno.env.get("ADMIN_NOTIFY_EMAIL") || "admin@easyrepair.co.uk";

async function sendAdminNewBookingEmail(b) {
  if (!RESEND_API_KEY) return { skipped: true };
  const to = ADMIN_NOTIFY_EMAIL.split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) return { skipped: true };

  const row = (label, value) => value
    ? '<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top;white-space:nowrap;"><b>' + label + '</b></td><td style="padding:4px 0;">' + value + '</td></tr>'
    : '';
  const esc = (v) => escapeHtml(v == null ? '' : String(v));
  const rows = [
    row('Reference', esc(b.bookingRef)),
    row('Customer', esc(b.name)),
    row('Phone', b.phone ? '<a href="tel:' + esc(b.phone) + '">' + esc(b.phone) + '</a>' : ''),
    row('Email', b.email ? '<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>' : ''),
    row('Address', esc([b.address, b.postcode].filter(Boolean).join(', '))),
    row('Appliance', esc(b.appliance) + (b.brand ? ' (' + esc(b.brand) + ')' : '')),
    row('Appliance age', esc(b.applianceAge)),
    row('Issue', esc(b.problem || 'Not specified')),
    row('Preferred visit date and time', esc(b.preferredCallTime)),
    row('Package', b.protectionPlan ? 'Repair + Protection Plan' : 'Repair only'),
    row('Engineer', b.engineerName
      ? esc(b.engineerName) + (b.engineerPhone ? ' - ' + esc(b.engineerPhone) : '') + ' (auto-assigned)'
      : '<span style="color:#b00020;"><b>Not assigned - needs manual assignment</b></span>'),
    row('Booked from', esc(b.sourceUrl)),
  ].join('');

  const html = '<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #111111; line-height: 1.5;">'
    + '<p><b>New online booking received.</b></p>'
    + '<table style="border-collapse:collapse;font-size:15px;">' + rows + '</table>'
    + '</div>';

  const subject = 'New booking ' + (b.bookingRef || '') + ' - ' + (b.appliance || 'Repair') + ', ' + (b.postcode || '') + (b.engineerName ? '' : ' (UNASSIGNED)');

  const payload: Record<string, unknown> = { from: NOTIFY_FROM_EMAIL, to, subject, html };
  if (b.email) payload.reply_to = b.email;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) return { error: await res.text() };
  return { sent: true };
}
// The "Approximate age" field on the website is a range ("1–3 years"), but
// FixFlow's existing job screens show a single number of years (see
// JobDetail/JobForm in src/App.jsx) -- rather than restructure that UI for
// one extra field, we store a representative number here and keep the
// original range only implicitly. Slight precision loss, same tradeoff staff
// already accept when they type a rough age in manually.
const AGE_RANGE_TO_YEARS = {
  "Less than 1 year": 0,
  "1–3 years": 2,
  "3–5 years": 4,
  "5–10 years": 7,
  "Over 10 years": 12,
};

// ─── onboarding completeness -- mirrors ENGINEER_ONBOARDING_STEPS in
// fixflow/src/App.jsx (the checklist behind FixFlow's Active / Onboarding /
// Archived tabs). Keep this list in sync with that one: an engineer who
// hasn't finished onboarding (e.g. hasn't set their own password, accepted
// Terms & Conditions, or uploaded insurance) shows under FixFlow's
// "Onboarding" tab and can't be picked there -- so a real customer booking
// from the public website must not be able to land on them either, even
// though `engineers.active`/`archived_at` alone wouldn't catch this (an
// onboarding engineer is neither inactive nor archived).
function isOnboardingComplete(eng) {
  return (
    eng.profile?.must_change_password === false &&
    !!eng.profile?.terms_accepted_at &&
    (eng.postcodes || []).length > 0 &&
    (eng.appliance_types || []).length > 0 &&
    !!eng.working_hours && Object.keys(eng.working_hours).length > 0 &&
    !!eng.id_document_path &&
    !!eng.insurance_document_path &&
    !!eng.insurance_expiry_date
  );
}

// ─── assignment algorithm -- ported from autoAssign() in fixflow/src/App.jsx ──
// Keep this in sync with that function. Differences from the client version:
// it takes engineers/existing-bookings straight from the database instead of
// from React state, since there's no live app state to read out here.
function pickEngineer(bookingInput, engineers, activeCounts) {
  const pc = (bookingInput.postcode || "").toUpperCase().trim();
  const pcAlpha = pc.replace(/[0-9\s]+$/, "");

  const eligible = engineers.filter((eng) => {
    // Two different "is this engineer off the roster" flags exist today:
    // `engineers.active` (checked here) and `profiles.archived_at` (set by
    // FixFlow's Archive action). A DB trigger is meant to keep them in sync,
    // but checking both here directly means a booking still can't land on
    // an archived engineer even if that sync ever lags or the trigger is
    // ever dropped/altered.
    if (!eng.active) return false;
    if (eng.profile?.archived_at) return false;
    if (!isOnboardingComplete(eng)) return false;
    const postcodes = eng.postcodes || [];
    const covers = postcodes.some((p) => {
      const up = String(p).toUpperCase();
      return pc === up || pc.startsWith(up) || pcAlpha === up;
    });
    if (!covers) return false;
    if (!(eng.appliance_types || []).includes(bookingInput.appliance)) return false;
    const excl = (eng.brand_exclusions || {})[bookingInput.appliance] || [];
    if (bookingInput.brand && excl.includes(bookingInput.brand)) return false;
    return true;
  });

  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    const totA = (a.stats_completed || 0) + (a.stats_ber || 0);
    const totB = (b.stats_completed || 0) + (b.stats_ber || 0);
    const rA = totA ? (a.stats_completed || 0) / totA : 0;
    const rB = totB ? (b.stats_completed || 0) / totB : 0;
    if (Math.abs(rA - rB) > 0.02) return rB - rA;
    const actA = activeCounts.get(a.id) || 0;
    const actB = activeCounts.get(b.id) || 0;
    return actA - actB;
  });

  return eligible[0];
}

// Whether the customer chose "Repair + Protection Plan" on the Options step
// of the booking form, vs. repair-only. The exact field/shape the live
// bookarepair2 form posts for this hasn't been confirmed yet (see the note
// left with this change), so this reads every reasonably-likely shape
// rather than betting on just one:
//   - a boolean/truthy flag under a few likely names
//   - a string option/plan value that mentions "protection"
// If none of these match what the form actually sends, this will just
// quietly evaluate to false (same as "repair only") -- it will NOT error
// the booking. If protection-plan bookings aren't showing up with the
// shield badge in FixFlow after this deploys, the field name below needs
// updating to match whatever the form's JS actually sends (check the
// Network tab on a real test submission), not the other way round.
function wantsProtectionPlanFrom(body) {
  const { protectionPlan, wantsProtectionPlan, plan, option, serviceOption, bookingOption } = body || {};
  if (protectionPlan || wantsProtectionPlan) return true;
  const candidates = [plan, option, serviceOption, bookingOption];
  return candidates.some((v) => typeof v === "string" && v.toLowerCase().includes("protection"));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const {
    name, phone, email, postcode, address,
    appliance, brand, applianceAge, problem, preferredCallTime,
      sourceUrl, referrerUrl, paymentTiming,
  } = body || {};
  // Test bookings from the website (form opened with ?erpay=test) are marked
  // is_test, only go to test engineers, and never message real contact details.
  const isTest = body?.test === true;

  if (!name || !phone || !postcode || !appliance) {
    return json({ error: "name, phone, postcode and appliance are required" }, 400);
  }

  // See wantsProtectionPlanFrom() above for why this checks several
  // possible field shapes instead of one.
  const protectionPlan = wantsProtectionPlanFrom(body);

  const { data: engineers, error: engErr } = await admin
    .from("engineers")
    .select("id, postcodes, appliance_types, brand_exclusions, active, stats_completed, stats_ber, working_hours, id_document_path, insurance_document_path, insurance_expiry_date, profile:profiles(archived_at, must_change_password, terms_accepted_at, name, phone, is_test)");
  if (engErr) return json({ error: "Could not look up engineers" }, 500);

  const { data: activeBookings, error: bookingsErr } = await admin
    .from("bookings")
    .select("engineer_id")
    .not("engineer_id", "is", null)
    .not("status", "in", '("Completed","Beyond Repair","Cancelled")');
  if (bookingsErr) return json({ error: "Could not check current workload" }, 500);

  const activeCounts = new Map();
  for (const b of activeBookings || []) {
    activeCounts.set(b.engineer_id, (activeCounts.get(b.engineer_id) || 0) + 1);
  }

  const bookingInput = { postcode, appliance, brand };
  // Real bookings never go to test engineers, and test bookings only go to them.
  const pool = (engineers || []).filter((e) => !!e.profile?.is_test === isTest);
  const match = pickEngineer(bookingInput, pool, activeCounts);

  const { data: inserted, error: insertErr } = await admin
    .from("bookings")
    .insert({
      customer: name,
      phone,
      email: email || null,
      address: address || null,
      postcode,
      appliance,
      brand: brand || null,
      appliance_age: applianceAge != null && AGE_RANGE_TO_YEARS[applianceAge] !== undefined
        ? AGE_RANGE_TO_YEARS[applianceAge] : null,
      appliance_age_label: applianceAge || null, // original range text as selected on the form, e.g. "1-3 years"
      issue: problem || null,
      preferred_call_time: preferredCallTime || null,
      source: "Website",
      source_url: sourceUrl || null,
      referrer_url: referrerUrl || null,
      // "Assigned" once an engineer is matched, "Booked" otherwise -- mirrors
      // doReassign() in fixflow/src/App.jsx, which sets the same status when
      // staff manually reassign a booking. Keeping these in sync matters:
      // Portal's engineer-facing views only recognise a booking as theirs to
      // work once it's past "Booked", and staff's status filter/board in
      // FixFlow expects "Assigned" to mean "has an engineer, not yet started".
      status: match ? "Assigned" : "Booked",
      engineer_id: match ? match.id : null,
      // Drives the Protection Plans page in FixFlow -- a DB trigger (see
      // 0006_service_plans.sql) creates the matching service_plans row
      // automatically the moment this insert lands, if true.
      wants_protection_plan: protectionPlan,
      // "before" = card saved on the form (charged after the repair),
      // "after" = customer chose to pay by link after the repair.
      payment_timing: paymentTiming === "before" || paymentTiming === "after" ? paymentTiming : null,
      is_test: isTest,
    })
    .select("id, booking_ref")
    .single();

  if (insertErr) return json({ error: "Could not save this booking, please call us instead" }, 500);

  // Best-effort confirmation email to the customer -- failure here must
  // never block the booking response, since the booking is already saved.
  if (email) {
    try {
      await sendBookingReceivedEmail(email, {
        name,
        appliance,
        brand,
        address,
        postcode,
        issue: problem,
        bookingId: inserted.booking_ref || ("#" + inserted.id),
        protectionPlan,
        engineerName: match?.profile?.name || null,
        engineerPhone: match?.profile?.phone || null,
      });
    } catch (e) {
      console.error("Failed to send booking confirmation email", e);
    }
  }

  // Best-effort new-booking alert to the Easy Repair admin inbox, so staff
  // hear about every online booking straight away. Same rule as above:
  // a failure here must never block the booking response.
  try {
    const adminRes = await sendAdminNewBookingEmail({
      name, phone, email, postcode, address, appliance, brand,
      applianceAge, problem, preferredCallTime, sourceUrl, protectionPlan,
      bookingRef: inserted.booking_ref || ("#" + inserted.id),
      engineerName: match?.profile?.name || null,
      engineerPhone: match?.profile?.phone || null,
    });
    if (adminRes?.error) console.error("Admin new-booking email failed", adminRes.error);
  } catch (e) {
    console.error("Failed to send admin new-booking email", e);
  }

  return json({
    id: inserted.id, // used by the form to save the customer's card (payments start_card_setup)
    bookingId: inserted.booking_ref || ("#" + inserted.id),
    assigned: !!match,
    protectionPlan,
    message: "Thanks -- we've got your booking and will call you shortly to confirm.",
  });
});
