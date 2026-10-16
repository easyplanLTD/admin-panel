// supabase/functions/notify-assignment/index.ts
//
// Fired by a Supabase Database Webhook whenever a row in `bookings`
// changes. Sends the newly-assigned engineer an email (via Resend) and an
// SMS (via Twilio) about the job. This is the one place assignment
// notifications happen, regardless of which code path caused the
// assignment -- the website's auto-assign in submit-booking, or a staff
// member's manual reassignment in FixFlow's doReassign(). Keeping it in
// one place means neither of those call sites needs to know or care that
// notifications exist at all.
//
// SETUP (all one-time, done from the Supabase Dashboard -- no code changes
// needed after this):
//   1. Project Settings -> Edge Functions -> Secrets -- add:
//        RESEND_API_KEY          (same Resend account already verified for
//                                 auth emails; this function calls Resend's
//                                 HTTP API directly, not SMTP)
//        TWILIO_ACCOUNT_SID
//        TWILIO_AUTH_TOKEN
//        TWILIO_FROM_NUMBER      (the UK number you rent from Twilio, in
//                                 +44... format)
//        BOOKING_WEBHOOK_SECRET  (any random string -- must match the
//                                 header value set on the webhook in step 3)
//        NOTIFY_FROM_EMAIL       (optional -- which address the emails come
//                                 from; defaults to bookings@easyrepair.co.uk
//                                 below if not set)
//   2. Deploy this function with verify-JWT switched OFF, same as
//      submit-booking -- Database Webhooks call it with no user session at
//      all, so the platform-level JWT check has to be off. The
//      BOOKING_WEBHOOK_SECRET check below is what actually protects this
//      endpoint instead of JWT verification.
//   3. Database -> Webhooks -> create a webhook on the `bookings` table for
//      INSERT and UPDATE, pointing at this function's URL, with an HTTP
//      header `x-webhook-secret: <same value as BOOKING_WEBHOOK_SECRET>`.
//
// Deploy with:  supabase functions deploy notify-assignment --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER");
const WEBHOOK_SECRET = Deno.env.get("BOOKING_WEBHOOK_SECRET");
const NOTIFY_FROM_EMAIL = Deno.env.get("NOTIFY_FROM_EMAIL") || "bookings@easyrepair.co.uk";
// Test bookings (is_test) never text/email the made-up customer or engineer
// details on them -- everything goes to these instead, or is skipped if unset.
const TEST_NOTIFY_PHONE = Deno.env.get("TEST_NOTIFY_PHONE") || null;
const TEST_NOTIFY_EMAIL = Deno.env.get("TEST_NOTIFY_EMAIL") || null;

// Flat callout fee quoted to the customer in the "Request received" SMS
// below. Not stored anywhere in the DB (the `pricing` table is keyed by
// postcode/appliance/brand for the engineer-facing repair quote, which is
// a separate concern) -- update this constant if the flat fee ever changes.
const CALLOUT_FEE_LABEL_PROTECTION_PLAN = "£79.99 + parts";
const CALLOUT_FEE_LABEL_REPAIR_ONLY = "£99.99 + parts";

// Reverse of submit-booking's AGE_RANGE_TO_YEARS, so the SMS can show the
// customer-friendly range ("1-3 years") instead of the single representative
// number of years that actually gets stored on the booking row.
const AGE_YEARS_TO_LABEL = {
  0: "Less than 1 year",
  2: "1-3 years",
  4: "3-5 years",
  7: "5-10 years",
  12: "Over 10 years",
};

// Branding for the HTML email -- logo is hosted in a public Supabase
// Storage bucket ("branding") rather than pulled off the FixFlow/Portal
// deployments, so swapping the logo image is just a Storage upload with no
// site redeploy (and no GitHub push access) required.
const PORTAL_URL = "https://portal.easyrepair.co.uk";
const LOGO_URL = "https://nqubqtsjkhfswlrtjzia.supabase.co/storage/v1/object/public/branding/easyrepair-logo-email.png";

// Booking fields land here straight from the public website form (see
// submit-booking) or staff typing in FixFlow, so they're untrusted input as
// far as this function's concerned -- escape before interpolating into HTML
// to stop a stray "<" or "&" in an address/issue field from breaking the
// email or, worse, injecting markup into it.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// UK numbers come in however staff/engineers happened to type them
// ("07911 111222", "+44 7911 111222", "0044 7911 111222") -- Twilio needs
// strict E.164 ("+447911111222").
function toE164UK(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("0044")) return "+44" + digits.slice(4);
  if (digits.startsWith("44")) return "+" + digits;
  if (digits.startsWith("0")) return "+44" + digits.slice(1);
  return "+" + digits;
}

function bookingSummary(b) {
  const when = b.scheduled_date
    ? `${b.scheduled_date}${b.scheduled_time ? " " + b.scheduled_time : ""}`
    : "no time booked yet";
  const line = `${b.appliance}${b.brand ? " (" + b.brand + ")" : ""} for ${b.customer} at ${b.postcode}`;
  const ref = b.booking_ref || ("#" + b.id);
  return { when, line, ref };
}

async function sendEmail(to, engineerName, booking) {
  if (!to) return { skipped: "no email on file for this engineer" };
  if (!RESEND_API_KEY) return { skipped: "RESEND_API_KEY not set" };

  const { when, line, ref } = bookingSummary(booking);
  const greeting = engineerName || "there";
  const address = booking.address || "(no address on file)";
  const issue = booking.issue || "(not specified)";
  const priority = booking.priority || "Normal";

  // Plain-text fallback for clients that don't render HTML -- the portal
  // link is still clickable/tappable in these as a bare URL.
  const text = `Hi ${greeting},

You've been assigned a new booking:

${line}
Booking reference: ${ref}
Address: ${address}
Customer phone: ${booking.phone}
Issue: ${issue}
Scheduled: ${when}
Priority: ${priority}

Full details are in the Portal: ${PORTAL_URL}`;

  const html = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #111111; line-height: 1.5; max-width: 480px;">
  <p>Hi ${escapeHtml(greeting)},</p>
  <p>You've been assigned a new booking:</p>
  <p style="margin: 0 0 4px;"><strong>${escapeHtml(line)}</strong></p>
  <p style="margin: 0 0 4px;">Booking reference: ${escapeHtml(ref)}</p>
  <p style="margin: 0 0 4px;">Address: ${escapeHtml(address)}</p>
  <p style="margin: 0 0 4px;">Customer phone: ${escapeHtml(booking.phone)}</p>
  <p style="margin: 0 0 4px;">Issue: ${escapeHtml(issue)}</p>
  <p style="margin: 0 0 4px;">Scheduled: ${escapeHtml(when)}</p>
  <p style="margin: 0 0 16px;">Priority: ${escapeHtml(priority)}</p>
  <p style="margin: 0 0 24px;">Full details are in the <a href="${PORTAL_URL}" style="color: #1a73e8; font-weight: bold; text-decoration: none;">Portal</a>.</p>
  <img src="${LOGO_URL}" alt="EasyRepair" width="200" height="44" style="display:block;border:0;width:200px;height:44px;">
</div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NOTIFY_FROM_EMAIL,
      to,
      subject: `New job assigned: ${booking.customer} - ${booking.appliance}`,
      text,
      html,
    }),
  });

  if (!res.ok) return { error: await res.text() };
  return { sent: true };
}

async function sendSms(rawPhone, booking) {
  const to = toE164UK(rawPhone);
  if (!to) return { skipped: "no phone on file for this engineer" };
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { skipped: "Twilio secrets not set" };
  }

  const { when, line, ref } = bookingSummary(booking);
  const body = `Easy Repair: new job assigned - ${line} (Ref: ${ref}). Scheduled: ${when}. Please contact the customer ASAP to schedule the visit. Check the app for full details.`;
  const params = new URLSearchParams({ From: TWILIO_FROM_NUMBER, To: to, Body: body });

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );

  if (!res.ok) return { error: await res.text() };
  return { sent: true };
}
// Builds the "Request received" SMS sent straight to the customer when
// their booking row is first created. Kept separate from bookingSummary()
// above (which is written for the engineer-assignment email/SMS) because
// the customer message needs a different tone and a fuller field list.
function buildCustomerReceivedMessage(b, eng) {
  const ageLabel = b.appliance_age == null
    ? "Not specified"
    : (AGE_YEARS_TO_LABEL[b.appliance_age] || `${b.appliance_age} years`);
  const postcode = b.postcode || "";
  const addressLine = b.address || "";
  const address = postcode && !addressLine.toUpperCase().includes(postcode.toUpperCase())
    ? [addressLine, postcode].filter(Boolean).join(", ")
    : (addressLine || postcode || "Not specified");
    const ref = b.booking_ref || ("#" + b.id);
  return [
    "Request received!",
    "",
    "Thanks - the assigned engineer will call you shortly to confirm and discuss the appointment.",
    // Engineer contact, when one was already matched at booking time. If not,
    // the customer gets a separate "engineer assigned" SMS/email once one is.
    ...(eng && eng.phone
      ? ["", `Your engineer: ${eng.name || "Easy Repair engineer"}`, `Engineer phone: ${eng.phone}`]
      : []),
    "",
    `Booking reference: ${ref}`,
    `Appliance: ${b.appliance || "Not specified"}`,
    `Brand: ${b.brand || "Not specified"}`,
    `Age: ${ageLabel}`,
    `Issue: ${b.issue || "Not specified"}`,
    `Name: ${b.customer || "Not specified"}`,
    `Phone: ${b.phone || "Not specified"}`,
    `Email: ${b.email || "Not specified"}`,
    `Address: ${address}`,
    `Best time to call: ${b.preferred_call_time || "Not specified"}`,
    `Callout fee: ${b.wants_protection_plan ? CALLOUT_FEE_LABEL_PROTECTION_PLAN : CALLOUT_FEE_LABEL_REPAIR_ONLY}`,
    "",
    "What happens next? We'll call or text you on the number provided - usually within a few hours during business hours (Mon-Sat, 8am-7pm). Your appointment date will be confirmed then.",
  ].join("\n");
}
async function sendCustomerReceivedSms(rawPhone, booking, eng) {
  const to = toE164UK(rawPhone);
  if (!to) return { skipped: "no customer phone on this booking" };
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { skipped: "Twilio secrets not set" };
  }
  const body = buildCustomerReceivedMessage(booking, eng);
  const params = new URLSearchParams({ From: TWILIO_FROM_NUMBER, To: to, Body: body });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    }
  );
  if (!res.ok) return { error: await res.text() };
  return { sent: true };
}

// ─── engineer contact details for the CUSTOMER ─────────────────────────────
// Looks up the assigned engineer's name + phone (from their profile) so the
// customer can be given a direct number. Returns null if no engineer.
async function lookupEngineerContact(engineerId) {
  if (!engineerId) return null;
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await admin
      .from("engineers")
      .select("id, profile:profiles(name, phone)")
      .eq("id", engineerId)
      .single();
    if (!data || !data.profile) return null;
    return { name: data.profile.name || null, phone: data.profile.phone || null };
  } catch (e) {
    console.error("lookupEngineerContact failed", e);
    return null;
  }
}

// Sent to the CUSTOMER when an engineer is assigned (or reassigned) AFTER the
// booking was created -- i.e. when the "Request received" messages couldn't
// include the engineer yet. SMS always (if phone), email if we have one.
async function notifyCustomerOfEngineer(b, eng) {
  if (!eng || !eng.phone) return { skipped: "engineer has no phone on file" };
  const ref = b.booking_ref || ("#" + b.id);
  const engName = eng.name || "Your Easy Repair engineer";
  const result = { sms: null, email: null };

  // SMS
  const to = toE164UK(b.phone);
  if (!to) {
    result.sms = { skipped: "no customer phone on this booking" };
  } else if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    result.sms = { skipped: "Twilio secrets not set" };
  } else {
    const smsBody = [
      "Your Easy Repair engineer",
      "",
      `Booking reference: ${ref}`,
      `Engineer: ${engName}`,
      `Engineer phone: ${eng.phone}`,
      "",
      "They will call you shortly to arrange your appointment. You can also call them directly on the number above.",
    ].join("\n");
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: smsBody }),
        }
      );
      result.sms = res.ok ? { sent: true } : { error: await res.text() };
    } catch (e) {
      result.sms = { error: String(e) };
    }
  }

  // Email
  if (!b.email) {
    result.email = { skipped: "no customer email on this booking" };
  } else if (!RESEND_API_KEY) {
    result.email = { skipped: "RESEND_API_KEY not set" };
  } else {
    const text = [
      `Hi ${b.customer || "there"},`,
      "",
      "Your Easy Repair engineer has been assigned to your booking.",
      "",
      `Booking reference: ${ref}`,
      `Engineer: ${engName}`,
      `Engineer phone: ${eng.phone}`,
      "",
      "They will call you shortly to arrange your appointment. You can also call them directly on the number above.",
      "",
      "Thanks, Easy Repair",
    ].join("\n");
    const html = `<div style="font-family: Arial, sans-serif; font-size: 15px; color: #111; line-height: 1.5;">
  <img src="${LOGO_URL}" alt="EasyRepair" width="200" height="44" style="display:block;border:0;width:200px;height:44px;margin-bottom:16px;" />
  <p>Hi ${escapeHtml(b.customer || "there")},</p>
  <p>Your Easy Repair engineer has been assigned to your booking.</p>
  <p style="margin: 0 0 4px;">Booking reference: <strong>${escapeHtml(ref)}</strong></p>
  <p style="margin: 0 0 4px;">Engineer: <strong>${escapeHtml(engName)}</strong></p>
  <p style="margin: 0 0 16px;">Engineer phone: <strong><a href="tel:${escapeHtml(eng.phone)}">${escapeHtml(eng.phone)}</a></strong></p>
  <p>They will call you shortly to arrange your appointment. You can also call them directly on the number above.</p>
  <p>Thanks,<br/>Easy Repair</p>
</div>`;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: NOTIFY_FROM_EMAIL,
          to: b.email,
          subject: `Your engineer for booking ${ref} - Easy Repair`,
          html,
          text,
        }),
      });
      result.email = res.ok ? { sent: true } : { error: await res.text() };
    } catch (e) {
      result.email = { error: String(e) };
    }
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Only Supabase's own Database Webhook should ever be able to reach this
  // -- anyone else calling it could spam a real engineer's phone/inbox and
  // rack up your Twilio bill, since this function looks up real contact
  // details and sends real messages with nothing else gating it.
  if (!WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const record = payload?.record;
  if (!record) return json({ error: "No record in payload" }, 400);
  const isTest = record.is_test === true;
  if (isTest) {
    record.phone = TEST_NOTIFY_PHONE;
    record.email = TEST_NOTIFY_EMAIL;
  }

  // "Request received" SMS to the CUSTOMER -- fires once, right when the
  // booking row is first created (payload.type === "INSERT" only). This is
  // intentionally separate from the engineer-assignment logic below: the
  // customer should hear from us immediately on submission, whether or not
  // an engineer could be auto-assigned yet.
  const customerSms = payload?.type === "INSERT"
    ? await sendCustomerReceivedSms(record.phone, record, await lookupEngineerContact(record.engineer_id))
    : { skipped: "not an insert" };


  const engineerId = record.engineer_id;
  const previouslyNotifiedFor = record.notified_engineer_id;

  // Nothing to do if there's no engineer on this booking yet, or if we've
  // already sent a notification for this exact assignment -- covers
  // webhook retries, and the harmless extra invocation our own
  // notified_engineer_id update below triggers (that update is itself a
  // change to the row, so the webhook fires again; this check makes that
  // second call a fast, free no-op instead of a second text/email).
  if (!engineerId || engineerId === previouslyNotifiedFor) {
    return json({ skipped: true, reason: !engineerId ? "unassigned" : "already notified", customerSms });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Claim this assignment BEFORE sending. FixFlow can save a booking twice in
  // the same second (e.g. engineer + status), which fires this webhook twice;
  // both calls used to pass the check above and send duplicates. This update
  // only matches if nobody has claimed it yet, so exactly one call wins.
  const { data: claimed, error: claimErr } = await admin
    .from("bookings")
    .update({ notified_engineer_id: engineerId })
    .eq("id", record.id)
    .or(`notified_engineer_id.is.null,notified_engineer_id.neq.${engineerId}`)
    .select("id");
  if (claimErr) return json({ error: "Could not claim notification", detail: claimErr.message }, 500);
  if (!claimed || claimed.length === 0) {
    return json({ skipped: true, reason: "already notified (parallel call)", customerSms });
  }

  const { data: engRow, error: engErr } = await admin
    .from("engineers")
    .select("id, profile:profiles(name, phone, email)")
    .eq("id", engineerId)
    .single();
  if (engErr || !engRow) return json({ error: "Could not look up engineer" }, 500);

  const engineerName = engRow.profile?.name;
  const [emailResult, smsResult] = await Promise.all([
    sendEmail(isTest ? TEST_NOTIFY_EMAIL : engRow.profile?.email, engineerName, record),
    sendSms(isTest ? TEST_NOTIFY_PHONE : engRow.profile?.phone, record),
  ]);

  // Customer gets the engineer's name + number. On INSERT this is already in
  // the "Request received" SMS (and submit-booking's confirmation email), so
  // only send the follow-up for later assignments / reassignments.
  const customerEngineer = payload?.type === "INSERT"
    ? { skipped: "included in request-received messages" }
    : await notifyCustomerOfEngineer(record, { name: engineerName, phone: engRow.profile?.phone });

  // Mark this assignment as notified regardless of individual channel
  // success -- a bad phone number or a Resend hiccup shouldn't make this
  // retry-spam the engineer forever. Failures are still visible in this
  // function's own logs (Supabase Dashboard -> Edge Functions ->
  // notify-assignment -> Logs) for you to follow up on.
  // (notified_engineer_id was already set by the claim above.)

  return json({ engineerId, email: emailResult, sms: smsResult, customerSms, customerEngineer });
});
