// supabase/functions/clear-test-data/index.ts
//
// The "Clear all test data" button on Settings -> System -> Test. Removes
// everything the generate-test-data function has created for one generator:
//
//   type: "jobs" -- deletes every `bookings` row with is_test = true.
//   type: "sps"  -- deletes every auth user backing a `profiles` row with
//                   role='engineer' and is_test = true (the `profiles` and
//                   `engineers` rows cascade automatically via the
//                   "on delete cascade" foreign keys from 0001_identity.sql,
//                   same as the delete-user Edge Function relies on).
//
// Needs the service_role key for the same reason create-user/delete-user
// do -- deleting an auth user isn't possible with just an owner/staff
// session's own permissions.
//
// Deploy with:  supabase functions deploy clear-test-data
//
// Called from FixFlow like:
//   const { data, error } = await supabase.functions.invoke('clear-test-data', { body: { type } })

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
auth: { autoRefreshToken: false, persistSession: false },
});

const { data: callerData, error: callerErr } = await admin.auth.getUser(callerJwt);
if (callerErr || !callerData?.user) return json({ error: "Invalid session" }, 401);

const { data: callerProfile, error: profileErr } = await admin
.from("profiles").select("role").eq("id", callerData.user.id).single();
if (profileErr || !callerProfile || !["owner", "staff"].includes(callerProfile.role)) {
return json({ error: "Only owner/staff accounts can clear test data" }, 403);
}

let body;
try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
const { type } = body || {};
if (!["jobs", "sps"].includes(type)) return json({ error: "type must be 'jobs' or 'sps'" }, 400);

if (type === "jobs") {
const { data, error } = await admin.from("bookings").delete().eq("is_test", true).select("id");
if (error) return json({ error: error.message }, 500);
return json({ deleted: data.length });
}

const { data: testProfiles, error: findErr } = await admin
.from("profiles").select("id").eq("role", "engineer").eq("is_test", true);
if (findErr) return json({ error: findErr.message }, 500);

let deleted = 0;
const failures = [];
for (const p of testProfiles || []) {
const { error: delErr } = await admin.auth.admin.deleteUser(p.id);
if (delErr) failures.push({ id: p.id, error: delErr.message });
else deleted++;
}

return json({ deleted, ...(failures.length ? { failures } : {}) });
});