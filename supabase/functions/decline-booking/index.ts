// supabase/functions/decline-booking/index.ts
//
// Called by Portal when an engineer declines a job that's currently assigned
// to them. Has to be an Edge Function (not a direct table update from the
// browser) because reassigning to a *different* engineer means writing an
// engineer_id that isn't the caller's own -- an engineer's RLS policy on
// `bookings` only lets them touch rows already assigned to them, and
// definitely doesn't let them read other engineers' coverage/skills/stats
// to pick a replacement. This function holds the service_role key
// server-side, checks the caller really is the engineer this booking is
// currently assigned to, then does the privileged reassignment work.
//
// Deploy with:  supabase functions deploy decline-booking
//
// Called from Portal like:
//   const { data, error } = await supabase.functions.invoke('decline-booking', {
//     body: { bookingId }
//   })

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const NOTIFY_FROM_EMAIL = Deno.env.get("NOTIFY_FROM_EMAIL") || "bookings@easyrepair.co.uk";
// Where "an SP declined a booking" alerts go. Comma-separate for several.
const DECLINE_ALERT_EMAIL = Deno.env.get("DECLINE_ALERT_EMAIL") || "admin@easyrepair.co.uk";
const ADMIN_URL = Deno.env.get("ADMIN_URL") || "https://admin.easyrepair.co.uk";

// The Portal calls this from another domain, so the browser first sends an
// OPTIONS "preflight" request; without these headers it blocks the real call
// ("Failed to send a request to the Edge Function").
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

// Mirrors autoAssign() in admin/src/App.jsx -- keep the two in sync if that
// scoring logic changes.
function pickReplacement(booking, engineers) {
  const pc = (booking.postcode || "").toUpperCase().trim();
  const pcAlpha = pc.replace(/[0-9\s]+$/, "");
  const declinedBy = booking.declined_by || [];

  const eligible = engineers.filter((eng) => {
    if (eng.active === false) return false;
    if (declinedBy.includes(eng.id)) return false;
    const covers = (eng.postcodes || []).some((p) => {
      const up = String(p).toUpperCase();
      return pc === up || pc.startsWith(up) || pcAlpha === up;
    });
    if (!covers) return false;
    if (!(eng.appliance_types || []).includes(booking.appliance)) return false;
    const excl = (eng.brand_exclusions || {})[booking.appliance] || [];
    if (booking.brand && excl.includes(booking.brand)) return false;
    return true;
  });

  if (!eligible.length) return null;

  return eligible.sort((a, b) => {
    const totA = (a.stats_completed || 0) + (a.stats_ber || 0);
    const totB = (b.stats_completed || 0) + (b.stats_ber || 0);
    const rA = totA ? a.stats_completed / totA : 0;
    const rB = totB ? b.stats_completed / totB : 0;
    if (Math.abs(rA - rB) > 0.02) return rB - rA;
    return (a.activeCount || 0) - (b.activeCount || 0);
  })[0];
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function engineerName(eng) {
  if (!eng) return null;
  return eng.profile?.name || eng.business_name || eng.name || null;
}

// Emails the office that an SP declined a job. Never throws -- a failed
// email must not undo or block the decline itself.
async function sendDeclineAlert(booking, declinerName, reason, replacementName) {
  if (!RESEND_API_KEY) return { skipped: "RESEND_API_KEY not set" };
  const to = DECLINE_ALERT_EMAIL.split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length) return { skipped: "no DECLINE_ALERT_EMAIL" };
  const ref = booking.booking_ref || `#${booking.id}`;
  const testTag = booking.is_test ? "[TEST] " : "";
  const outcome = replacementName
    ? `Automatically reassigned to ${replacementName}.`
    : "No eligible SP was available - the booking is now UNASSIGNED and needs an SP.";
  const when = booking.scheduled_date
    ? `${booking.scheduled_date}${booking.scheduled_time ? " " + booking.scheduled_time : ""}`
    : "Not scheduled";
  const rows = [
    ["Booking", ref],
    ["Declined by", declinerName || "Unknown SP"],
    ["Reason", reason || "None given"],
    ["Outcome", outcome],
    ["Customer", booking.customer],
    ["Appliance", [booking.appliance, booking.brand].filter(Boolean).join(" - ")],
    ["Issue", booking.issue],
    ["Postcode", booking.postcode],
    ["Scheduled", when],
  ];
  const text = `${testTag}An SP has declined booking ${ref}.\n\n` +
    rows.map(([k, v]) => `${k}: ${v || "-"}`).join("\n") +
    `\n\nOpen the admin panel: ${ADMIN_URL}`;
  const html = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #111111; line-height: 1.5;">
<p style="margin: 0 0 12px;">${esc(testTag)}An SP has <strong>declined</strong> booking <strong>${esc(ref)}</strong>.</p>
<p style="margin: 0 0 16px; padding: 10px 12px; border-radius: 6px; background: ${replacementName ? "#eef7ee" : "#fdecea"}; color: ${replacementName ? "#1e5e1e" : "#a12622"}; font-weight: bold;">${esc(outcome)}</p>
<table style="border-collapse: collapse; font-size: 14px;">
${rows.map(([k, v]) => `<tr><td style="padding: 4px 16px 4px 0; color: #666666; vertical-align: top;">${esc(k)}</td><td style="padding: 4px 0;">${esc(v || "-")}</td></tr>`).join("\n")}
</table>
<p style="margin: 20px 0 0;"><a href="${esc(ADMIN_URL)}" style="color: #1a73e8; font-weight: bold; text-decoration: none;">Open the admin panel</a></p>
</div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: NOTIFY_FROM_EMAIL,
        to,
        subject: `${testTag}SP declined ${ref}: ${booking.customer || ""} - ${booking.appliance || ""}${replacementName ? "" : " (now unassigned)"}`,
        text,
        html,
      }),
    });
    if (!res.ok) return { error: await res.text() };
    return { sent: true };
  } catch (e) {
    return { error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const callerJwt = authHeader.replace(/^Bearer /i, "");
  if (!callerJwt) return json({ error: "Missing Authorization header" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: callerData, error: callerErr } = await admin.auth.getUser(callerJwt);
  if (callerErr || !callerData?.user) return json({ error: "Invalid session" }, 401);

  const { data: callerEngineer, error: engLookupErr } = await admin
    .from("engineers")
    .select("id")
    .eq("profile_id", callerData.user.id)
    .single();
  if (engLookupErr || !callerEngineer) {
    return json({ error: "Only engineer accounts can decline bookings" }, 403);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { bookingId } = body || {};
  // Optional free-text reason from the Portal (not sent yet, but recorded if it is).
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) || null : null;
  if (!bookingId) return json({ error: "bookingId is required" }, 400);

  const { data: booking, error: bookingErr } = await admin
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();
  if (bookingErr || !booking) return json({ error: "Booking not found" }, 404);

  if (booking.engineer_id !== callerEngineer.id) {
    return json({ error: "This booking isn't assigned to you" }, 403);
  }

  const { data: settingRow } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "decline_window_minutes")
    .single();
  const windowMinutes = Number(settingRow?.value) || 30;

  if (!booking.assigned_at || Date.now() - new Date(booking.assigned_at).getTime() > windowMinutes * 60000) {
    return json({ error: "The decline window for this booking has passed." }, 400);
  }

  const declinedBy = Array.from(new Set([...(booking.declined_by || []), callerEngineer.id]));

  const { data: engineerRows } = await admin.from("engineers").select("*, profile:profiles(name)");
  const { data: activeJobs } = await admin
    .from("bookings")
    .select("engineer_id,status")
    .not("status", "in", '("Completed","Beyond Repair","Cancelled")');
  const activeCounts = {};
  (activeJobs || []).forEach((j) => {
    if (j.engineer_id) activeCounts[j.engineer_id] = (activeCounts[j.engineer_id] || 0) + 1;
  });
  const candidates = (engineerRows || []).map((e) => ({ ...e, activeCount: activeCounts[e.id] || 0 }));

  const replacement = pickReplacement({ ...booking, declined_by: declinedBy }, candidates);

  const patch = replacement
    ? { engineer_id: replacement.id, status: "Assigned", declined_by: declinedBy }
    : { engineer_id: null, status: "Booked", declined_by: declinedBy };

  const { error: updateErr } = await admin.from("bookings").update(patch).eq("id", bookingId);
  if (updateErr) return json({ error: updateErr.message }, 500);

  // Tell the office. Both steps are best-effort: the decline has already
  // happened, so a logging/email failure is reported in the logs only.
  const declinerName = engineerName((engineerRows || []).find((e) => e.id === callerEngineer.id));
  const replacementName = replacement ? engineerName(replacement) || "another SP" : null;
  const { error: logErr } = await admin.from("booking_declines").insert({
    booking_id: bookingId,
    engineer_id: callerEngineer.id,
    engineer_name: declinerName,
    reason,
    reassigned_to: replacement?.id || null,
    reassigned_to_name: replacementName,
  });
  if (logErr) console.error("booking_declines insert failed:", logErr.message);
  const alert = await sendDeclineAlert(booking, declinerName, reason, replacementName);
  if (!alert.sent) console.error("decline alert email not sent:", JSON.stringify(alert));

  return json({
    reassigned: !!replacement,
    newEngineerId: replacement?.id || null,
    message: replacement
      ? "Declined \u2014 automatically reassigned to another engineer."
      : "Declined \u2014 no eligible engineer was available, so it's back in the unassigned queue.",
  });
});
