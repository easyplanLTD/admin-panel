// src/lib/supabaseClient.js
//
// One shared Supabase client for the whole app. Everything else
// (login, fetching jobs/leads, etc.) imports this rather than creating
// its own connection.
//
// Install first:
//   npm install @supabase/supabase-js
//
// Then create a .env file in your project root (never commit this):
//   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
//   VITE_SUPABASE_ANON_KEY=your-anon-public-key
//
// Both values come from Supabase dashboard → Project Settings → API.
// The "anon" key is safe to expose in front-end code — it only has the
// permissions your Row Level Security policies grant it. Never put the
// "service_role" key here; that one stays server-side only (Edge Functions).

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// detectSessionInUrl is off on purpose: Supabase's own auto-detection of invite/recovery
// tokens in the URL hash runs asynchronously and reliably wins the race against any check
// App.jsx does at render time, so the "set your password" screen never appeared for real
// invite links -- by the time we looked, supabase-js had already consumed and stripped the
// hash. We parse and consume it ourselves instead (see AUTH_HASH in App.jsx), synchronously,
// before anything else gets a chance to touch it.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { detectSessionInUrl: false },
  // Live updates: run the realtime heartbeat in a Web Worker so it keeps
  // ticking when the tab is in the background (Chrome throttles normal page
  // timers there, the heartbeat stalls, and the server drops the socket --
  // which is what made bookings stop appearing until a manual refresh).
  realtime: { worker: true, heartbeatIntervalMs: 15000 },
});
