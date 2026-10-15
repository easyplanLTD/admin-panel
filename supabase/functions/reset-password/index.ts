// supabase/functions/reset-password/index.ts
//
// Lets an owner or staff member reset another live account password to a
// new temporary one, on the spot. For when the self-service Forgot Password
// email flow (Login uses supabase.auth.resetPasswordForEmail in App.jsx)
// is down, delayed, or the person just cannot get to that inbox right now.
//
// Why this has to be an Edge Function rather than something the browser
// does directly: setting another person password requires the
// service_role key (full admin rights), which must never be shipped to a
// browser. This function holds that key server-side, checks that whoever
// is calling it is already an owner or staff member, and then does the
// privileged work on their behalf. Same shape as create-user for that reason.
//
// The temp password is generated here (never chosen by staff, never logged)
// and returned once in the response. Staff relay it to the person directly
// by call or text. The account is forced through the same Set Your Own
// Password screen a brand-new temp-password account gets on first login,
// via profiles.must_change_password, so the temp password cannot linger
// as their real one.
//
// Deploy with:  supabase functions deploy reset-password
//
// Called from FixFlow like:
//   const result = await supabase.functions.invoke("reset-password", {
//     body: { userId: someProfileId }
//   });

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Browsers preflight cross-origin POSTs (FixFlow domain calling the
// supabase.co function domain) with an OPTIONS request before sending the
// real one. Without these headers the browser blocks the actual request
// before it ever reaches this function. Same reasoning as create-user.
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

// A temp password that is easy to read aloud or type over the phone.
// Avoids visually ambiguous characters (0/O, 1/l/I) while still clearing
// Supabase default 8 character minimum with a mix of case and digits.
function generateTempPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

// Pulls the bearer token out of the Authorization header without using a
// regular expression, since even one stray invisible character introduced
// during copy and paste into a regex literal is enough to break parsing of
// the whole file.
function extractBearerToken(authHeader) {
  const prefix = "bearer ";
  if (authHeader.toLowerCase().indexOf(prefix) === 0) {
    return authHeader.slice(prefix.length);
  }
  return authHeader;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const callerJwt = extractBearerToken(authHeader);
  if (!callerJwt) return json({ error: "Missing Authorization header" }, 401);

  // Service-role client: full admin rights, used only after we have
  // verified the caller below. Never returned to the client, never logged.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify the caller is who their JWT claims, then check their role.
  const { data: callerData, error: callerErr } = await admin.auth.getUser(callerJwt);
  if (callerErr || !callerData || !callerData.user) return json({ error: "Invalid session" }, 401);

  const { data: callerProfile, error: profileErr } = await admin
    .from("profiles")
    .select("role")
    .eq("id", callerData.user.id)
    .single();

  if (profileErr || !callerProfile || !["owner", "staff"].includes(callerProfile.role)) {
    return json({ error: "Only owner or staff accounts can reset another account password" }, 403);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const userId = body && body.userId;
  if (!userId) return json({ error: "userId is required" }, 400);

  const { data: targetProfile, error: targetErr } = await admin
    .from("profiles")
    .select("id, email, name, archived_at")
    .eq("id", userId)
    .single();

  if (targetErr || !targetProfile) return json({ error: "Account not found" }, 404);
  // Archived accounts cannot log in anyway (both apps sign them out or
  // block sign-in once archived_at is set), so resetting the password would
  // not let them back in and would just be confusing. Restore first.
  if (targetProfile.archived_at) {
    return json({ error: "That account is archived. Restore it first, then reset the password." }, 400);
  }

  const tempPassword = generateTempPassword();

  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
    password: tempPassword,
  });
  if (updateErr) return json({ error: updateErr.message }, 400);

  // Best effort: the password reset itself already succeeded above even if
  // this fails, so we still return the temp password, just with a warning
  // that they will not be automatically prompted to change it on next login.
  const { error: flagErr } = await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", userId);

  const result = {
    userId: userId,
    email: targetProfile.email,
    tempPassword: tempPassword,
    message: "Share this temporary password with them directly. They will be asked to set their own the moment they log in.",
  };
  if (flagErr) {
    result.warning = "Password was reset, but could not force a password-change prompt on next login: " + flagErr.message;
  }

  return json(result);
});
