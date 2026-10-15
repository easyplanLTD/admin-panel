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

  const { data: engineerRows } = await admin.from("engineers").select("*");
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

  return json({
    reassigned: !!replacement,
    newEngineerId: replacement?.id || null,
    message: replacement
      ? "Declined \u2014 automatically reassigned to another engineer."
      : "Declined \u2014 no eligible engineer was available, so it's back in the unassigned queue.",
  });
});
