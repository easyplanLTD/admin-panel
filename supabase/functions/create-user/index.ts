// supabase/functions/create-user/index.ts
//
// Creates a real login for a new owner, staff member, or engineer.
//
// Why this has to be an Edge Function rather than something the browser
// does directly: creating another person's auth account requires the
// service_role key (full admin rights), which must never be shipped to a
// browser. This function holds that key server-side, checks that whoever
// is calling it is already an owner/staff member, and then does the
// privileged work on their behalf.
//
// Deploy with:  supabase functions deploy create-user
//
// Called from FixFlow like:
//   const { data, error } = await supabase.functions.invoke('create-user', {
//     body: { name, email, phone, role, provisioning, password, engineer }
//   })

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Where an invited person lands to set their own password. Engineers go to
// the Portal; owner/staff go to FixFlow itself. Both apps detect the
// invite/recovery token in the URL at their root and show a "set your
// password" screen automatically — no dedicated route needed, so this can
// just be the plain domain (avoids any SPA-routing/404 concerns on static
// hosting). Update these if your real domains differ.
const REDIRECT_TO = {
  engineer: "https://portal.easyrepair.co.uk/",
  staff: "https://admin.easyrepair.co.uk/",
  owner: "https://admin.easyrepair.co.uk/",
};

// Browsers preflight cross-origin POSTs (FixFlow's domain calling the
// *.supabase.co function domain) with an OPTIONS request before sending the
// real one. Without these headers the browser blocks the actual request
// before it ever reaches this function — that's the "Failed to send a
// request to the Edge Function" error, not anything wrong with the logic
// below (it never even runs).
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const callerJwt = authHeader.replace(/^Bearer /i, "");
  if (!callerJwt) return json({ error: "Missing Authorization header" }, 401);

  // Service-role client: full admin rights, used only after we've verified
  // the caller below. Never returned to the client, never logged.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify the caller is who their JWT claims, then check their role.
  const { data: callerData, error: callerErr } = await admin.auth.getUser(callerJwt);
  if (callerErr || !callerData?.user) return json({ error: "Invalid session" }, 401);

  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", callerData.user.id)
    .single();

  if (profileErr || !callerProfile || !["owner", "staff"].includes(callerProfile.role)) {
    return json({ error: "Only owner/staff accounts can create users" }, 403);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { name, email, phone, role, provisioning, password, engineer } = body || {};

  if (!name || !email || !role) return json({ error: "name, email and role are required" }, 400);
  if (!["owner", "staff", "engineer"].includes(role)) return json({ error: "Invalid role" }, 400);
  if (!["invite", "password"].includes(provisioning)) return json({ error: "provisioning must be 'invite' or 'password'" }, 400);
  if (provisioning === "password" && (!password || password.length < 8)) {
    return json({ error: "password must be at least 8 characters" }, 400);
  }

  const userMetadata = { name, role, phone: phone || "" };
  let newUser;
  let emailSendFailed = false;

  if (provisioning === "invite") {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: userMetadata,
      redirectTo: REDIRECT_TO[role],
    });
    if (error) return json({ error: error.message }, 400);
    newUser = data.user;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });
    if (error) return json({ error: error.message }, 400);
    newUser = data.user;

    // They can already sign in with the temp password staff just set, but
    // both apps force a "set your own password" screen on that first
    // sign-in (see must_change_password below) -- this email just gives
    // them a second way in immediately, in case staff haven't relayed the
    // temp password yet. Supabase's own templated email, not a custom one,
    // so it's a link, not the temp password itself -- staff still need to
    // pass that along directly (text/call/etc).
    const { error: resetErr } = await admin.auth.resetPasswordForEmail(email, {
      redirectTo: REDIRECT_TO[role],
    });
    if (resetErr) emailSendFailed = true;
  }

  // The on_auth_user_created trigger has already inserted a matching
  // `profiles` row by the time the calls above return.

  if (provisioning === "password") {
    // Best-effort: if this fails, the account still works, it just won't be
    // forced through the "set your own password" screen on first login.
    await admin.from("profiles").update({ must_change_password: true }).eq("id", newUser.id);
  }

  if (role === "engineer") {
    const eng = engineer || {};
    const { error: engErr } = await admin.from("engineers").insert({
      profile_id: newUser.id,
      pay_rate: eng.payRate ?? 45,
      // SP type -- see 0005_engineer_types.sql. Defaults to 'appliance' to
      // match the column default if the caller doesn't send one.
      type: eng.type ?? "appliance",
      postcodes: eng.postcodes ?? [],
      appliance_types: eng.applianceTypes ?? [],
      brand_exclusions: eng.brandExclusions ?? {},
      self_service_enabled: eng.selfServiceEnabled ?? false,
    });
    if (engErr) {
      // Roll back the auth user so we don't leave an orphaned login with
      // no engineer profile behind it.
      await admin.auth.admin.deleteUser(newUser.id);
      return json({ error: `Created the login but failed to save engineer details: ${engErr.message}` }, 500);
    }
  }

  return json({
    userId: newUser.id,
    email: newUser.email,
    provisioning,
    message:
      provisioning === "invite"
        ? "Invite email sent — they'll set their own password."
        : emailSendFailed
        ? "Account created — share the password with them directly. (Couldn't send the login-link email, but the temp password still works.)"
        : "Account created — share the password with them directly. They've also been emailed a sign-in link, and will be asked to set their own password the first time they log in either way.",
  });
});
