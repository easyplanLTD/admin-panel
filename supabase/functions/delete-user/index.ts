// supabase/functions/delete-user/index.ts
//
// Permanently deletes an owner, staff, or engineer account -- the "Delete
// Forever" button in FixFlow's Archive tab (Engineers and Users pages).
//
// Why this has to be an Edge Function rather than something the browser
// does directly: actually removing someone's auth.users row requires the
// service_role key (full admin rights), which must never be shipped to a
// browser. This function holds that key server-side, checks that whoever
// is calling it is an owner, and then does the privileged delete on their
// behalf. Deleting the auth user cascades to delete their `profiles` row
// (and, for engineers, their `engineers` row too) via the "on delete
// cascade" foreign keys set up in 0001_identity.sql -- nothing else needs
// cleaning up here.
//
// Deploy with:  supabase functions deploy delete-user
//
// Called from FixFlow like:
//   const { data, error } = await supabase.functions.invoke('delete-user', {
//     body: { userId }
//   })

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Browsers preflight cross-origin POSTs with an OPTIONS request before
// sending the real one -- see the matching comment in create-user/index.ts.
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

                                          const { data: callerData, error: callerErr } = await admin.auth.getUser(callerJwt);
                                            if (callerErr || !callerData?.user) return json({ error: "Invalid session" }, 401);

                                              const { data: callerProfile, error: profileErr } = await admin
                                                  .from("profiles")
                                                      .select("role")
                                                          .eq("id", callerData.user.id)
                                                              .single();

                                                                // Only owners can permanently delete -- staff can still archive/restore
                                                                  // (that's a plain client-side update covered by existing RLS), but
                                                                    // destroying an account outright is kept to owners only.
                                                                      if (profileErr || !callerProfile || callerProfile.role !== "owner") {
                                                                          return json({ error: "Only owner accounts can permanently delete a user" }, 403);
                                                                            }

                                                                              let body;
                                                                                try {
                                                                                    body = await req.json();
                                                                                      } catch {
                                                                                          return json({ error: "Invalid JSON body" }, 400);
                                                                                            }

                                                                                              const { userId } = body || {};
                                                                                                if (!userId) return json({ error: "userId is required" }, 400);
                                                                                                  if (userId === callerData.user.id) return json({ error: "You can't delete your own account" }, 400);

                                                                                                    const { data: target, error: targetErr } = await admin
                                                                                                        .from("profiles")
                                                                                                            .select("id, name, email, archived_at")
                                                                                                                .eq("id", userId)
                                                                                                                    .single();
                                                                                                                      if (targetErr || !target) return json({ error: "Couldn't find that account" }, 404);

                                                                                                                        // Defence in depth behind the UI only ever offering this button from the
                                                                                                                          // Archive tab -- an account has to be archived first, so "Delete Forever"
                                                                                                                            // can never be someone's very first click.
                                                                                                                              if (!target.archived_at) {
                                                                                                                                  return json({ error: "Archive this account before permanently deleting it" }, 400);
                                                                                                                                    }

                                                                                                                                      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
                                                                                                                                        if (delErr) return json({ error: delErr.message }, 500);

                                                                                                                                          return json({ deleted: true, userId });
                                                                                                                                          });
                                                                                                                                          