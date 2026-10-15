import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const ALLOWED_ROLES = {
portal: ["engineer"],
fixflow: ["owner", "staff"],
};

const REDIRECT_TO = {
portal: "https://portal.easyrepair.co.uk/",
fixflow: "https://admin.easyrepair.co.uk/",
};

const CORS_HEADERS = {
"Access-Control-Allow-Origin": "*",
"Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
"Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
return new Response(JSON.stringify(body), {
status,
headers: { "Content-Type": "application/json", ...CORS_HEADERS },
});
}

Deno.serve(async (req) => {
if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

let body;
try {
body = await req.json();
} catch {
return json({ error: "Invalid JSON body" }, 400);
}

const email = (body?.email || "").trim().toLowerCase();
const app = body?.app;

if (!email) return json({ error: "email is required" }, 400);
if (!ALLOWED_ROLES[app]) return json({ error: "app must be 'portal' or 'fixflow'" }, 400);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
auth: { autoRefreshToken: false, persistSession: false },
});

const { data: profile } = await admin
.from("profiles")
.select("role")
.eq("email", email)
.maybeSingle();

if (profile && ALLOWED_ROLES[app].includes(profile.role)) {
const { error } = await admin.auth.resetPasswordForEmail(email, {
redirectTo: REDIRECT_TO[app],
});
if (error) return json({ error: error.message }, 400);
}

return json({ ok: true });
});
