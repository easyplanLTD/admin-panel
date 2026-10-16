// supabase/functions/payments/index.ts
//
// Everything that moves money for EasyRepair, in one Edge Function so it can
// be pasted into the Supabase dashboard editor as a single file.
//
//   POST {action, ...}            actions called from FixFlow, the Portal and
//                                 the website booking form (see ACTIONS below)
//   POST with Stripe-Signature    Stripe webhooks (platform + connected accounts)
//   GET  ?pay=<booking>&t=<sig>   customer payment link -> redirects to Stripe Checkout
//
// Model (see the Build Plan):
//   * Engineers have Stripe connected accounts (controller: fees paid by the
//     account, losses covered by Stripe, Stripe-hosted onboarding, no Stripe
//     dashboard -- engineers use embedded components in the Portal).
//   * Customer cards are saved on EasyRepair's platform account at booking
//     and cloned onto the engineer's account to charge the job as a DIRECT
//     charge. EasyRepair's commission is the application fee.
//   * When EasyRepair covers Stripe's fee, the real fee is handed back to the
//     engineer by refunding that much of the application fee once the
//     payment succeeds, so the engineer receives exactly their share.
//   * Protection plans, late-cancellation and no-show fees are EasyRepair's
//     own charges on the platform account (no-show: engineer's share is
//     transferred to them).
//
// Deploy: Supabase dashboard -> Edge Functions -> Deploy a new function ->
// name "payments", paste this file, and turn OFF "Verify JWT" (payment links
// and Stripe webhooks arrive without a Supabase login; every action below
// checks the caller itself).
//
// Secrets (Edge Functions -> Secrets):
//   STRIPE_SECRET_KEY                 sk_test_... while testing, sk_live_... when live
//   STRIPE_WEBHOOK_SECRET             whsec_... for the "Your account" endpoint
//   STRIPE_CONNECT_WEBHOOK_SECRET     whsec_... for the "Connected accounts" endpoint
//   SITE_URL        (optional)        defaults to https://easyrepair.co.uk
//   PORTAL_URL      (optional)        where engineers return after Stripe onboarding
//   RESEND_API_KEY + NOTIFY_FROM_EMAIL (or EMAIL_FROM)      customer emails (same as notify-assignment)
//   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM_NUMBER   customer texts (same as notify-assignment)
//   TEST_NOTIFY_PHONE / TEST_NOTIFY_EMAIL (optional) where test bookings' texts/emails go
//   CRON_SECRET     (optional)        lets a scheduler call the "daily" action

import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import QRCode from "npm:qrcode@1.5.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SITE_URL = (Deno.env.get("SITE_URL") || "https://easyrepair.co.uk").replace(/\/$/, "");
const PORTAL_URL = (Deno.env.get("PORTAL_URL") || "").replace(/\/$/, "");
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/payments`;
const TEST_MODE = STRIPE_KEY.startsWith("sk_test_") || STRIPE_KEY.startsWith("rk_test_");

const stripe = new Stripe(STRIPE_KEY, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const PLAN_PRODUCT_ID = "easyrepair_protection_plan";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors } });
const text = (msg: string, status = 200) =>
  new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...cors } });

class UserError extends Error {
  status: number;
  constructor(msg: string, status = 400) { super(msg); this.status = status; }
}
const fail = (msg: string, status = 400): never => { throw new UserError(msg, status); };

// ---------------------------------------------------------------- money maths
// Mirrors paymentsShared.js (termsForJob / jobMoney) so the server charges
// exactly what FixFlow and the Portal show. Keep the two in step.

const DEFAULTS: Record<string, any> = {
  payments_live: false, callout_protection_pence: 7999, callout_repair_only_pence: 9999,
  engineer_callout_share: 62.51, engineer_parts_share: 100, fee_bearer: "easyrepair",
  admin_fee_pence: 1000, admin_fee_engineer_share: 0, late_cancel_fee_pence: 2500, free_cancel_hours: 48,
  late_cancel_engineer_share: 0, no_show_fee_pence: 2500, no_show_engineer_share: 50, recovery_invoice_days: 30,
  plan_monthly_tiers: [799, 1299, 1699, 2000], plan_monthly_extra_pence: 499,
  plan_annual_tiers: [8629, 14029, 18349, 21600], plan_annual_extra_pence: 5389,
  plan_first_payment_days: 7, plan_term_months: 12, plan_cooling_off_days: 14,
  plan_cancel_fee_pence: 2500, plan_renewal_reminder_days: 30,
};

export const estimateStripeFee = (total: number) => (total > 0 ? Math.round(total * 0.015) + 20 : 0);
const planKey = (b: any) => (b.wants_protection_plan ? "repair_protection" : "repair_only");

export function calloutPence(b: any, s: any) {
  const stored = b.callout_fee;
  if (stored !== "" && stored != null && !isNaN(Number(stored))) return Math.round(Number(stored) * 100);
  return b.wants_protection_plan ? Number(s.callout_protection_pence) : Number(s.callout_repair_only_pence);
}

export function termsFor(b: any, s: any, overrides: any[] = []) {
  let t: any = { engineer_callout_share: Number(s.engineer_callout_share), engineer_parts_share: Number(s.engineer_parts_share), fee_bearer: s.fee_bearer };
  const plan = planKey(b);
  const relevant = overrides
    .filter((o) => o.active && ((o.plan === plan && !o.engineer_id) || (b.engineer_id && o.engineer_id === b.engineer_id && (!o.plan || o.plan === plan))))
    .sort((a, c) => (a.engineer_id ? 1 : 0) - (c.engineer_id ? 1 : 0) || (a.plan ? 1 : 0) - (c.plan ? 1 : 0));
  for (const o of relevant) {
    if (o.engineer_callout_share != null) t.engineer_callout_share = Number(o.engineer_callout_share);
    if (o.engineer_parts_share != null) t.engineer_parts_share = Number(o.engineer_parts_share);
    if (o.fee_bearer) t.fee_bearer = o.fee_bearer;
  }
  const snap = b.terms_snapshot;
  if (snap && snap.engineer_callout_share != null) {
    t = { engineer_callout_share: Number(snap.engineer_callout_share), engineer_parts_share: Number(snap.engineer_parts_share ?? 100), fee_bearer: snap.fee_bearer || t.fee_bearer };
  }
  const ov = b.split_override;
  if (ov && (ov.engineer_callout_share != null || ov.engineer_parts_share != null || ov.fee_bearer)) {
    t = {
      engineer_callout_share: ov.engineer_callout_share != null ? Number(ov.engineer_callout_share) : t.engineer_callout_share,
      engineer_parts_share: ov.engineer_parts_share != null ? Number(ov.engineer_parts_share) : t.engineer_parts_share,
      fee_bearer: ov.fee_bearer || t.fee_bearer,
    };
  }
  return t;
}

// What to charge for a job right now: callout + approved parts + admin fee.
export function jobCharge(b: any, s: any, overrides: any[] = []) {
  const terms = termsFor(b, s, overrides);
  const callout = calloutPence(b, s);
  // Beyond economical repair: the customer pays the callout only.
  const parts = b.pending_outcome === "Beyond Repair" ? 0
    : b.parts_approval_status === "approved" ? Number(b.parts_total_pence || 0) : 0;
  const engineerGross = Math.round((callout * terms.engineer_callout_share) / 100) + Math.round((parts * terms.engineer_parts_share) / 100);
  const adminFee = b.admin_fee_applied_at ? Number(b.admin_fee_pence || 0) : 0;
  const adminFeeEngineer = Math.round((adminFee * Number(s.admin_fee_engineer_share || 0)) / 100);
  const total = callout + parts + adminFee;
  const engineerShare = engineerGross + adminFeeEngineer;
  return { terms, callout, parts, adminFee, total, engineerShare, commission: total - engineerShare };
}

export function planPrice(s: any, interval: string, count: number) {
  const tiers: number[] = (interval === "year" ? s.plan_annual_tiers : s.plan_monthly_tiers) || [];
  const extra = Number(interval === "year" ? s.plan_annual_extra_pence : s.plan_monthly_extra_pence) || 0;
  const n = Math.max(1, Number(count) || 1);
  if (!tiers.length) return 0;
  return n <= tiers.length ? Number(tiers[n - 1]) : Number(tiers[tiers.length - 1]) + (n - tiers.length) * extra;
}

const gbp = (p: number) => `£${(Number(p || 0) / 100).toFixed(2)}`;
const addMonths = (d: Date, m: number) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 864e5);
const ref = (b: any) => b.booking_ref || `#${String(b.id).slice(0, 8)}`;

// ------------------------------------------------------------- data helpers

async function settings() {
  const { data } = await db.from("payment_settings").select("*").eq("id", 1).maybeSingle();
  return { ...DEFAULTS, ...(data || {}) };
}
async function overrides() {
  const { data } = await db.from("payment_overrides").select("*").eq("active", true);
  return data || [];
}
async function booking(id: string) {
  if (!id) fail("bookingId is required");
  const { data, error } = await db.from("bookings").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) fail("Booking not found", 404);
  return data;
}
async function engineer(id: string | null) {
  if (!id) return null;
  const { data } = await db.from("engineers").select("*, profile:profiles(name,email,phone)").eq("id", id).maybeSingle();
  return data;
}
async function updateBooking(id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("bookings").update(patch).eq("id", id);
  if (error) throw error;
}

// HMAC signature for public links (payment and parts approval), so a link
// only works for the booking it was made for.
async function sign(value: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE_ROLE_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}
async function verify(value: string, sig: string | null) {
  if (!sig) return false;
  const good = await sign(value);
  if (good.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < good.length; i++) diff |= good.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
const payUrl = async (id: string) => `${FUNCTION_URL}?pay=${id}&t=${await sign(`pay:${id}`)}`;
const partsUrl = async (id: string) => `${SITE_URL}/approve-parts/?b=${id}&t=${await sign(`parts:${id}`)}`;

// ------------------------------------------------------------ notifications
// Both optional: without the secrets the link is still saved on the booking
// and shown in the Portal and FixFlow, it just isn't sent automatically.

// Uses the same secrets as notify-assignment / submit-booking.
let lastSendError = "";
// Test bookings never contact the made-up customer details on them. Messages go
// to TEST_NOTIFY_PHONE / TEST_NOTIFY_EMAIL instead (your own), or are skipped.
const TEST_PHONE = Deno.env.get("TEST_NOTIFY_PHONE") || "";
const TEST_EMAIL = Deno.env.get("TEST_NOTIFY_EMAIL") || "";
function contactFor(b: any) {
  if (b?.is_test) return { email: TEST_EMAIL, phone: TEST_PHONE };
  return { email: b?.email || "", phone: b?.phone || "" };
}
function isFakeContact(v: string) {
  const t = String(v || "").toLowerCase().replace(/[^\da-z@.+]/g, "");
  return t.endsWith(".internal") || /^(\+44|0044|0)7700900\d{3}$/.test(t);
}
function esc(t: string) {
  return String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as any)[ch]);
}
function emailHtml(body: string) {
  // Turn the first link in the message into a button; keep the rest as text.
  const link = body.match(/https?:\/\/\S+/)?.[0] || "";
  const text = esc(link ? body.replace(link, "").replace(/\s*here:\s*$/i, ".").trim() : body).replace(/\n/g, "<br>");
  const button = link
    ? `<p style="margin:24px 0"><a href="${esc(link)}" style="background:#0b5cff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">Open secure link</a></p><p style="font-size:12px;color:#666">Or copy this link: ${esc(link)}</p>`
    : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px">${text}${button}<p style="font-size:12px;color:#666;margin-top:28px">EasyRepair &middot; easyrepair.co.uk</p></div>`;
}
async function sendEmail(to: string, subject: string, body: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM") || Deno.env.get("NOTIFY_FROM_EMAIL") || "bookings@mail.easyrepair.co.uk";
  if (!key) { lastSendError = "Emails aren't set up (RESEND_API_KEY is missing)."; return false; }
  if (!to) { lastSendError = "There's no email address on this booking (for test bookings, set TEST_NOTIFY_EMAIL)."; return false; }
  if (isFakeContact(to)) { lastSendError = "That's a made-up test email address, so nothing was sent."; return false; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: from.includes("<") ? from : `EasyRepair <${from}>`, to, subject, text: body, html: emailHtml(body) }),
  });
  if (!r.ok) {
    const j: any = await r.json().catch(() => ({}));
    lastSendError = `The email couldn't be sent: ${j.message || r.status}`;
    console.error("resend", r.status, JSON.stringify(j));
  }
  return r.ok;
}
async function sendSms(to: string, body: string) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID"), tok = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER") || Deno.env.get("TWILIO_FROM") || Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!sid || !tok || !from) { lastSendError = "Texts aren't set up (Twilio secrets are missing)."; return false; }
  if (isFakeContact(to)) { lastSendError = "That's a made-up test number, so nothing was sent."; return false; }
  let num = String(to || "").replace(/[^\d+]/g, "");
  if (num.startsWith("00")) num = "+" + num.slice(2);
  else if (num.startsWith("0")) num = "+44" + num.slice(1);
  else if (num && !num.startsWith("+")) num = "+" + num;
  if (num.length < 10) { lastSendError = "There's no valid mobile number on this booking (for test bookings, set TEST_NOTIFY_PHONE)."; return false; }
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${sid}:${tok}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: num, From: from, Body: body }),
  });
  if (!r.ok) {
    const j: any = await r.json().catch(() => ({}));
    lastSendError = `The text couldn't be sent: ${j.message || r.status}`;
    console.error("twilio", r.status, JSON.stringify(j));
  }
  return r.ok;
}
async function notifyCustomer(b: any, subject: string, body: string) {
  const [email, sms] = await Promise.all([
    sendEmail(contactFor(b).email, subject, body).catch(() => false),
    sendSms(contactFor(b).phone, body).catch(() => false),
  ]);
  return { email, sms };
}

// ------------------------------------------------------------------- callers

type Caller = { userId: string | null; role: string | null; engineerId: string | null; service: boolean };

async function caller(req: Request, body: any): Promise<Caller> {
  const cron = Deno.env.get("CRON_SECRET");
  if (cron && body?.cronSecret === cron) return { userId: null, role: "service", engineerId: null, service: true };
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer /i, "");
  if (jwt === SERVICE_ROLE_KEY) return { userId: null, role: "service", engineerId: null, service: true };
  if (!jwt) return { userId: null, role: null, engineerId: null, service: false };
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return { userId: null, role: null, engineerId: null, service: false };
  const { data: prof } = await db.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
  const { data: eng } = await db.from("engineers").select("id").eq("profile_id", data.user.id).maybeSingle();
  return { userId: data.user.id, role: prof?.role || null, engineerId: eng?.id || null, service: false };
}
const isStaff = (c: Caller) => c.service || c.role === "owner" || c.role === "staff";
function requireStaff(c: Caller) { if (!isStaff(c)) fail("Only EasyRepair staff can do this", 403); }
function requireStaffOrJobEngineer(c: Caller, b: any) {
  if (isStaff(c)) return;
  if (c.engineerId && c.engineerId === b.engineer_id) return;
  fail("You can only do this for your own jobs", 403);
}
// Money only moves when payments are switched on -- or, while using Stripe
// TEST keys, for staff and for bookings marked as test bookings, so the
// whole flow can be tried without switching the Portal over for everyone.
function requireLive(s: any, c: Caller, b?: any) {
  if (s.payments_live) return;
  if (TEST_MODE && (isStaff(c) || b?.is_test)) return;
  fail("Payments aren't live yet. Turn them on in Settings → Payments → VAT & go live.");
}

// ---------------------------------------------------------------- engineers

// Engineer accounts are created with Stripe's Accounts v2 API (new Connect
// platforms can't create v1 accounts). Everything else -- charges,
// application fees, refunds, account sessions, transfers -- uses the normal
// v1 API with the same acct_ id, which Stripe supports for v2 accounts.
const V2_VERSION = "2026-09-30.endive";
async function stripeV2(path: string, body?: unknown, idempotencyKey?: string) {
  const r = await fetch(`https://api.stripe.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      "Stripe-Version": V2_VERSION,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new UserError(`Stripe: ${out?.error?.message || r.statusText}`, 502);
  return out;
}

async function onboardingLink(c: Caller, body: any) {
  const engId = isStaff(c) && body.engineerId ? body.engineerId : c.engineerId;
  if (!engId) fail("No engineer account found for this login", 403);
  const eng = await engineer(engId);
  if (!eng) fail("Engineer not found", 404);
  let accountId = eng.stripe_account_id;
  if (!accountId) {
    const acct = await stripeV2("/v2/core/accounts", {
      contact_email: eng.profile?.email || undefined,
      display_name: eng.business_name || eng.profile?.name || undefined,
      dashboard: "none",
      identity: { country: "gb" },
      configuration: {
        merchant: {
          mcc: "7629", // electrical and small appliance repair
          capabilities: { card_payments: { requested: true } },
          support: { url: SITE_URL },
        },
        // Lets EasyRepair transfer the engineer's share of no-show fees.
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
      },
      defaults: {
        currency: "gbp",
        locales: ["en-GB"],
        responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
      },
      metadata: { engineer_id: eng.id },
      include: ["configuration.merchant", "requirements"],
    }, `acct-v2-${eng.id}`);
    accountId = acct.id;
    const { error } = await db.from("engineers").update({ stripe_account_id: accountId, stripe_status: "incomplete", stripe_updated_at: new Date().toISOString() }).eq("id", eng.id);
    if (error) throw error;
  } else {
    await refreshAccountById(accountId);
  }
  const back = (body.returnUrl || PORTAL_URL || SITE_URL).replace(/\/$/, "");
  const link = await stripeV2("/v2/core/account_links", {
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        refresh_url: `${back}/?stripe=refresh`,
        return_url: `${back}/?stripe=done`,
      },
    },
  });
  return { url: link.url };
}

// Reads the account through the v1 API (works for v2 accounts) and updates
// the engineer's Stripe status. Called when they come back from onboarding
// and before charging, so nothing depends on webhooks arriving.
async function refreshAccountById(accountId: string) {
  const acct = await stripe.accounts.retrieve(accountId);
  await syncAccount(acct);
  return acct;
}
async function refreshAccount(c: Caller, body: any) {
  const engId = isStaff(c) && body.engineerId ? body.engineerId : c.engineerId;
  const eng = await engineer(engId);
  if (!eng?.stripe_account_id) return { status: "not_started" };
  const acct = await refreshAccountById(eng.stripe_account_id);
  return { chargesEnabled: !!acct.charges_enabled, payoutsEnabled: !!acct.payouts_enabled };
}

// For the Portal's embedded payouts panel (Stripe Connect embedded components).
async function accountSession(c: Caller, body: any) {
  const engId = isStaff(c) && body.engineerId ? body.engineerId : c.engineerId;
  const eng = await engineer(engId);
  if (!eng?.stripe_account_id) fail("Set up Stripe first");
  const sess = await stripe.accountSessions.create({
    account: eng.stripe_account_id,
    components: {
      account_onboarding: { enabled: true },
      notification_banner: { enabled: true },
      payouts: { enabled: true, features: { instant_payouts: false, standard_payouts: true, edit_payout_schedule: true, external_account_collection: true } },
      payments: { enabled: true, features: { refund_management: false, dispute_management: true, capture_payments: false } },
      account_management: { enabled: true, features: { external_account_collection: true } },
    },
  });
  return { clientSecret: sess.client_secret };
}

async function syncAccount(acct: Stripe.Account) {
  const due = [...(acct.requirements?.currently_due || []), ...(acct.requirements?.past_due || [])];
  let status = "incomplete";
  if (acct.charges_enabled && acct.payouts_enabled) status = due.length ? "restricted" : "active";
  else if (acct.details_submitted) status = acct.requirements?.disabled_reason ? (acct.requirements.disabled_reason.includes("review") ? "under_review" : "restricted") : "under_review";
  await db.from("engineers").update({
    stripe_status: status,
    stripe_charges_enabled: !!acct.charges_enabled,
    stripe_payouts_enabled: !!acct.payouts_enabled,
    stripe_requirements_due: due,
    stripe_updated_at: new Date().toISOString(),
  }).eq("stripe_account_id", acct.id);
}

// ------------------------------------------------------- saving the card
// Called by the website booking form straight after submit-booking. Returns
// a SetupIntent client secret for Stripe's card form; the webhook stores the
// card on the booking once the customer has confirmed it.

async function startCardSetup(_c: Caller, body: any) {
  const b = await booking(body.bookingId);
  if ((b.email || "").trim().toLowerCase() !== String(body.email || "").trim().toLowerCase()) fail("Booking not found", 404);
  if (Date.now() - new Date(b.created_at).getTime() > 6 * 3600e3) fail("This booking is too old to add a card here. Please call us.");
  if (b.stripe_payment_method_id) fail("A card is already saved for this booking.");
  let customerId = b.stripe_customer_id;
  if (!customerId) {
    const cust = await stripe.customers.create({
      name: b.customer || undefined, email: b.email || undefined, phone: b.phone || undefined,
      metadata: { booking_id: b.id },
    }, { idempotencyKey: `cust-${b.id}` });
    customerId = cust.id;
  }
  const si = await stripe.setupIntents.create({
    customer: customerId,
    usage: "off_session",
    payment_method_types: ["card"],
    metadata: { booking_id: b.id },
  });
  const patch: Record<string, unknown> = { stripe_customer_id: customerId };
  if (body.consentText) { patch.consent_text = String(body.consentText).slice(0, 4000); patch.consent_at = new Date().toISOString(); }
  if (body.paymentTiming === "before" || body.paymentTiming === "after") patch.payment_timing = body.paymentTiming;
  await updateBooking(b.id, patch);
  return { clientSecret: si.client_secret };
}

// --------------------------------------------------------- charging a job

function checkChargeable(b: any) {
  if (b.status !== "Completed" && !b.pending_outcome) fail("The job needs to be marked completed first.");
  if (["paid", "processing", "refunded", "part_refunded"].includes(b.payment_status)) fail("This job has already been paid.");
  if (b.parts_approval_status === "pending" && b.pending_outcome !== "Beyond Repair") fail("The customer hasn't approved the parts yet.");
}
async function engineerAccount(b: any) {
  if (b.is_external) fail("This job went to an external engineer, so it can't be paid through Stripe.");
  const eng = await engineer(b.engineer_id);
  if (!eng?.stripe_account_id) fail("The engineer hasn't set up Stripe yet.");
  if (!eng.stripe_charges_enabled) {
    const acct = await refreshAccountById(eng.stripe_account_id);
    if (!acct.charges_enabled) fail("The engineer's Stripe account can't take payments yet.");
    eng.stripe_charges_enabled = true;
  }
  return eng;
}

// Pending commission the engineer owes from earlier jobs, taken from this
// job's payout (whole recoveries only, and never more than their share).
async function recoveriesFor(engineerId: string, room: number, excludeBooking: string) {
  const { data } = await db.from("commission_recoveries").select("*").eq("engineer_id", engineerId).eq("status", "pending").neq("booking_id", excludeBooking).order("created_at");
  const picked: any[] = [];
  let sum = 0;
  for (const r of data || []) {
    if (sum + r.amount_pence <= room) { picked.push(r); sum += r.amount_pence; }
  }
  return { ids: picked.map((r) => r.id), sum };
}

async function chargeJob(c: Caller, body: any) {
  const s = await settings();
  const b = await booking(body.bookingId);
  requireStaffOrJobEngineer(c, b);
  requireLive(s, c, b);
  checkChargeable(b);
  if (!b.stripe_payment_method_id || !b.stripe_customer_id) fail("No card is saved for this booking. Send a payment link instead.");
  const eng = await engineerAccount(b);
  const m = jobCharge(b, s, await overrides());
  if (m.total <= 0) fail("Nothing to charge.");
  const rec = await recoveriesFor(eng.id, Math.max(0, m.engineerShare - estimateStripeFee(m.total)), b.id);
  const appFee = m.commission + rec.sum;
  const metadata = {
    booking_id: b.id, kind: "job", fee_bearer: m.terms.fee_bearer,
    commission_pence: String(m.commission), engineer_share_pence: String(m.engineerShare),
    recovery_ids: rec.ids.join(","), recovery_pence: String(rec.sum),
  };
  await updateBooking(b.id, { payment_status: "processing", stripe_charge_account_id: eng.stripe_account_id, total_pence: m.total, commission_pence: m.commission, engineer_share_pence: m.engineerShare });
  try {
    const pm = await stripe.paymentMethods.create({ customer: b.stripe_customer_id, payment_method: b.stripe_payment_method_id }, { stripeAccount: eng.stripe_account_id });
    const pi = await stripe.paymentIntents.create({
      amount: m.total, currency: "gbp", payment_method: pm.id, confirm: true, off_session: true,
      application_fee_amount: appFee,
      description: `EasyRepair job ${ref(b)} — ${b.appliance || "appliance repair"}`,
      receipt_email: b.email || undefined,
      metadata,
    }, { stripeAccount: eng.stripe_account_id, idempotencyKey: `job-${b.id}-${m.total}-${Math.floor(Date.now() / 60000)}` });
    await updateBooking(b.id, { stripe_payment_intent_id: pi.id });
    if (pi.status === "succeeded") await markJobPaid(pi, eng.stripe_account_id);
    return { ok: true, status: pi.status, amountPence: m.total };
  } catch (e: any) {
    // Card declined or needs the customer: fall back to a payment link
    // (or, from the Take payment screen, let the engineer pick another way).
    const reason = e?.raw?.message || e?.message || "The card was declined";
    await updateBooking(b.id, { payment_status: "outstanding" });
    if (body.noFallback) return { ok: false, reason };
    const link = await sendPaymentLinkFor(b, `We couldn't take payment from your saved card (${reason}).`);
    return { ok: false, fallback: "payment_link", reason, ...link };
  }
}

// ─── Take payment (Portal) ───────────────────────────────────────────────
// The engineer picks the outcome (Repaired / BER) and how the customer pays.
// The job completes by itself once the money is in (see markJobPaid); until
// then it shows as "Awaiting payment".
//   method: "card"  -> charge the card saved at booking
//           "sms" | "email" -> send the payment link that way
//           "qr"    -> return a QR code of the payment link for the customer to scan
//           "phone" -> return the link to open on the engineer's phone for the customer
async function takePayment(c: Caller, body: any) {
  const s = await settings();
  let b = await booking(body.bookingId);
  requireStaffOrJobEngineer(c, b);
  requireLive(s, c, b);
  const outcome = body.outcome === "Beyond Repair" ? "Beyond Repair" : body.outcome === "Completed" ? "Completed" : fail("Choose Repaired or BER.");
  if (["Completed", "Beyond Repair", "Cancelled"].includes(b.status)) fail("This job is already closed.");
  if (["paid", "processing", "refunded", "part_refunded"].includes(b.payment_status)) fail("This job has already been paid.");
  if (outcome === "Completed" && b.parts_approval_status === "pending") fail("The customer needs to approve the parts first.");
  await engineerAccount(b);
  await updateBooking(b.id, { pending_outcome: outcome, awaiting_payment_since: b.awaiting_payment_since || new Date().toISOString() });
  b = { ...b, pending_outcome: outcome };
  const m = jobCharge(b, s, await overrides());
  const method = String(body.method || "");

  if (method === "card") {
    if (!b.stripe_payment_method_id) fail("There's no card saved for this customer. Use a payment link, QR code or phone payment.");
    const r: any = await chargeJob(c, { bookingId: b.id, noFallback: true });
    return { ...r, totalPence: m.total };
  }

  const url = await payUrl(b.id);
  await updateBooking(b.id, { payment_link_url: url, payment_status: "outstanding" });
  if (method === "sms" || method === "email") {
    const msg = `EasyRepair: thank you, your ${b.appliance || "appliance"} job (${ref(b)}) is done. Please pay ${gbp(m.total)} securely here: ${url}`;
    const ok = method === "sms"
      ? await sendSms(contactFor(b).phone, msg).catch(() => false)
      : await sendEmail(contactFor(b).email, `Payment for your EasyRepair job ${ref(b)}`, msg).catch(() => false);
    if (!ok) return { url, totalPence: m.total, sent: false, error: `${lastSendError || (method === "sms" ? "The text couldn't be sent." : "The email couldn't be sent.")} Use the QR code or phone payment instead.` };
    return { url, totalPence: m.total, sent: true };
  }
  if (method === "qr") {
    const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 240, errorCorrectionLevel: "M" });
    return { url, svg, totalPence: m.total };
  }
  if (method === "phone") return { url, totalPence: m.total };
  fail("Choose how the customer will pay.");
}

async function sendPaymentLinkFor(b: any, lead = "") {
  const url = await payUrl(b.id);
  await updateBooking(b.id, { payment_link_url: url, payment_status: ["not_charged", "processing"].includes(b.payment_status) ? "outstanding" : b.payment_status });
  const s = await settings();
  const m = jobCharge(b, s, await overrides());
  const msg = `${lead ? lead + " " : ""}EasyRepair: your repair (${ref(b)}) is complete. Please pay ${gbp(m.total)} here: ${url}`;
  const sent = await notifyCustomer(b, `Payment for your EasyRepair job ${ref(b)}`, msg);
  return { url, sent };
}

async function sendPaymentLink(c: Caller, body: any) {
  const s = await settings();
  const b = await booking(body.bookingId);
  requireStaffOrJobEngineer(c, b);
  requireLive(s, c, b);
  checkChargeable(b);
  await engineerAccount(b);
  return await sendPaymentLinkFor(b);
}

async function applyAdminFee(c: Caller, body: any) {
  requireStaff(c);
  const s = await settings();
  const b = await booking(body.bookingId);
  requireLive(s, c, b);
  if (b.admin_fee_applied_at) fail("The admin fee has already been added.");
  if (b.payment_timing !== "after") fail("The admin fee only applies to Pay after repair bookings.");
  if (b.payment_status === "paid") fail("This job has already been paid.");
  await updateBooking(b.id, { admin_fee_pence: s.admin_fee_pence, admin_fee_applied_at: new Date().toISOString() });
  return await sendPaymentLinkFor({ ...b, admin_fee_pence: s.admin_fee_pence, admin_fee_applied_at: new Date().toISOString() },
    `As payment wasn't made on the day, a ${gbp(s.admin_fee_pence)} admin fee has been added.`);
}

// Called by the Portal (or FixFlow) as soon as a job is marked completed.
async function jobCompleted(c: Caller, body: any) {
  const s = await settings();
  const b = await booking(body.bookingId);
  requireStaffOrJobEngineer(c, b);
  if (!s.payments_live && !(TEST_MODE && (isStaff(c) || b.is_test))) return { skipped: "payments not live" };
  if (b.status !== "Completed") fail("The job isn't marked completed.");
  const out: Record<string, unknown> = {};
  if (b.wants_protection_plan && b.stripe_payment_method_id) {
    try { out.plan = await startPlanForBooking(b, s); } catch (e: any) { out.planError = e.message; }
  }
  if (["paid", "processing"].includes(b.payment_status)) return { ...out, job: "already paid" };
  if (b.parts_approval_status === "pending") return { ...out, job: "waiting for parts approval" };
  out.job = b.stripe_payment_method_id ? await chargeJob(c, body) : await sendPaymentLink(c, body);
  return out;
}

// ------------------------------------------------------------ parts approval

async function sendPartsApproval(c: Caller, body: any) {
  const s = await settings();
  const b = await booking(body.bookingId);
  requireStaffOrJobEngineer(c, b);
  requireLive(s, c, b);
  if (b.parts_approval_status !== "pending") fail("There are no parts waiting for approval.");
  const url = await partsUrl(b.id);
  const lines = (b.parts_lines || []).map((l: any) => `- ${l.description || "Part"}: ${gbp(l.price_pence)}`).join("\n");
  const sent = await notifyCustomer(b, `Please approve the parts for your repair ${ref(b)}`,
    `EasyRepair: your engineer needs these parts for your repair (${ref(b)}):\n${lines}\nParts total ${gbp(b.parts_total_pence)}. Approve or decline here: ${url}`);
  return { url, sent };
}

// Public: used by the approval page on the website.
async function partsQuote(_c: Caller, body: any) {
  if (!(await verify(`parts:${body.bookingId}`, body.t))) fail("This link isn't valid", 403);
  const b = await booking(body.bookingId);
  const s = await settings();
  const callout = calloutPence(b, s);
  return {
    ref: ref(b), appliance: b.appliance, status: b.parts_approval_status,
    lines: (b.parts_lines || []).map((l: any) => ({ description: l.description, price_pence: l.price_pence })),
    partsTotalPence: b.parts_total_pence, calloutPence: callout, totalIfApprovedPence: callout + Number(b.parts_total_pence || 0),
  };
}
async function partsRespond(_c: Caller, body: any) {
  if (!(await verify(`parts:${body.bookingId}`, body.t))) fail("This link isn't valid", 403);
  const b = await booking(body.bookingId);
  if (b.parts_approval_status !== "pending") return { status: b.parts_approval_status };
  const approve = body.decision === "approve";
  await updateBooking(b.id, {
    parts_approval_status: approve ? "approved" : "declined",
    parts_approved_at: new Date().toISOString(),
    parts_approval_method: approve ? "Approved by customer online" : "Declined by customer online",
  });
  return { status: approve ? "approved" : "declined" };
}

// ------------------------------------------------- cancellation / no-show fees

async function chargeCancellationFee(c: Caller, body: any) {
  requireStaff(c);
  const s = await settings();
  const b = await booking(body.bookingId);
  requireLive(s, c, b);
  if (b.cancellation_fee_status !== "pending") fail("There's no fee waiting to be charged.");
  if (!b.stripe_payment_method_id || !b.stripe_customer_id) fail("No card is saved for this booking, so the fee can't be charged automatically.");
  const total = Number(b.cancellation_fee_pence || 0);
  const engShare = Number(b.fee_engineer_share_pence || 0);
  const label = b.cancellation_fee_type === "no_show" ? "No-show fee" : "Late cancellation fee";
  try {
    const pi = await stripe.paymentIntents.create({
      amount: total, currency: "gbp", customer: b.stripe_customer_id, payment_method: b.stripe_payment_method_id,
      confirm: true, off_session: true, description: `${label} — EasyRepair job ${ref(b)}`,
      receipt_email: b.email || undefined,
      metadata: { booking_id: b.id, kind: "cancellation_fee" },
      expand: ["latest_charge"],
    }, { idempotencyKey: `fee-${b.id}-${total}` });
    if (pi.status !== "succeeded") fail(`The card needs the customer to confirm the payment (${pi.status}).`);
    let transferId: string | null = null;
    if (engShare > 0) {
      const eng = await engineer(b.engineer_id);
      if (eng?.stripe_account_id) {
        const charge = pi.latest_charge as Stripe.Charge;
        const tr = await stripe.transfers.create({
          amount: engShare, currency: "gbp", destination: eng.stripe_account_id,
          source_transaction: charge?.id, description: `${label} share — job ${ref(b)}`,
          metadata: { booking_id: b.id, kind: "cancellation_fee_share" },
        }, { idempotencyKey: `fee-share-${b.id}` });
        transferId = tr.id;
      }
    }
    await updateBooking(b.id, { cancellation_fee_status: "charged", fee_transfer_id: transferId });
    return { ok: true, transferred: !!transferId };
  } catch (e: any) {
    if (e instanceof UserError) throw e;
    await updateBooking(b.id, { cancellation_fee_status: "failed" });
    fail(`The fee couldn't be charged: ${e?.raw?.message || e.message}`);
  }
}

// --------------------------------------------------------------------- refunds

async function refund(c: Caller, body: any) {
  requireStaff(c);
  const s = await settings();
  const b = await booking(body.bookingId);
  requireLive(s, c, b);
  if (!b.stripe_payment_intent_id || !b.stripe_charge_account_id) fail("This job wasn't paid through Stripe, so record the refund instead.");
  const total = Number(b.total_pence || 0);
  const amount = Math.round(Number(body.amountPence));
  const already = Number(b.refund_amount_pence || 0);
  if (!(amount > 0) || amount + already > total) fail(`Refund must be between £0.01 and ${gbp(total - already)}.`);
  const refundCommission = !!body.refundCommission;
  await stripe.refunds.create({
    payment_intent: b.stripe_payment_intent_id, amount,
    refund_application_fee: refundCommission,
    metadata: { booking_id: b.id, refund_reason_id: body.refundReasonId || "", by: "easyrepair" },
  }, { stripeAccount: b.stripe_charge_account_id, idempotencyKey: `refund-${b.id}-${already}-${amount}` });
  const commissionBack = refundCommission ? Math.round(Number(b.commission_pence || 0) * Math.min(1, amount / Math.max(total, 1))) : 0;
  await updateBooking(b.id, {
    refund_reason_id: body.refundReasonId || null,
    refund_amount_pence: already + amount,
    commission_refunded_pence: Number(b.commission_refunded_pence || 0) + commissionBack,
    refunded_at: new Date().toISOString(), refunded_by: c.userId, refund_source: "admin",
    payment_status: already + amount >= total ? "refunded" : "part_refunded",
  });
  return { ok: true };
}

// ------------------------------------------------------------- protection plans

async function planProduct() {
  try { return (await stripe.products.retrieve(PLAN_PRODUCT_ID)).id; }
  catch {
    const p = await stripe.products.create({ id: PLAN_PRODUCT_ID, name: "EasyRepair Protection Plan", description: "12-month appliance protection service contract" });
    return p.id;
  }
}
const priceData = (product: string, amount: number, interval: "month" | "year") =>
  ({ currency: "gbp", product, unit_amount: amount, recurring: { interval } });

async function startPlanForBooking(b: any, s: any) {
  const { data: plan } = await db.from("service_plans").select("*").eq("booking_id", b.id).maybeSingle();
  if (!plan) return "no plan row for this booking";
  if (plan.stripe_subscription_id) return "already started";
  if (plan.status && plan.status !== "active") return `plan is ${plan.status}`;
  const interval = (plan.billing_interval || "month") as "month" | "year";
  const price = plan.price_pence ?? planPrice(s, interval, plan.appliance_count || 1);
  const now = new Date();
  const first = addDays(now, Number(s.plan_first_payment_days || 7));
  const sub = await stripe.subscriptions.create({
    customer: b.stripe_customer_id,
    default_payment_method: b.stripe_payment_method_id,
    items: [{ price_data: priceData(await planProduct(), price, interval) }],
    trial_end: Math.floor(first.getTime() / 1000),
    off_session: true,
    description: `EasyRepair Protection Plan (job ${ref(b)})`,
    metadata: { plan_id: plan.id, booking_id: b.id },
  }, { idempotencyKey: `plan-${plan.id}` });
  const start = plan.agreement_start ? new Date(plan.agreement_start) : now;
  const end = plan.agreement_end ? new Date(plan.agreement_end) : addMonths(start, Number(s.plan_term_months || 12));
  const { error } = await db.from("service_plans").update({
    stripe_subscription_id: sub.id, price_pence: price, first_payment_at: first.toISOString(),
    agreement_start: start.toISOString(), agreement_end: end.toISOString(),
    cooling_off_ends_at: plan.cooling_off_ends_at || addDays(start, Number(s.plan_cooling_off_days || 14)).toISOString(),
    next_renewal_at: end.toISOString(),
  }).eq("id", plan.id);
  if (error) throw error;
  return { subscriptionId: sub.id, firstPaymentAt: first.toISOString(), pricePence: price };
}

async function getPlan(id: string) {
  const { data } = await db.from("service_plans").select("*").eq("id", id).maybeSingle();
  if (!data) fail("Plan not found", 404);
  return data;
}

async function updatePlan(c: Caller, body: any) {
  requireStaff(c);
  const s = await settings();
  requireLive(s, c);
  const plan = await getPlan(body.planId);
  if (!plan.stripe_subscription_id) return { skipped: "no subscription yet" };
  if (body.when === "renewal") return { skipped: "applies at renewal" };
  const interval = (body.interval || plan.billing_interval || "month") as "month" | "year";
  const count = body.appliance_count ?? plan.appliance_count ?? 1;
  const amount = body.price_pence ?? planPrice(s, interval, count);
  const sub = await stripe.subscriptions.retrieve(plan.stripe_subscription_id);
  await stripe.subscriptions.update(sub.id, {
    items: [{ id: sub.items.data[0].id, price_data: priceData(await planProduct(), amount, interval) }],
    proration_behavior: "none",
    metadata: { ...sub.metadata, appliance_count: String(count) },
  });
  return { ok: true };
}

async function cancelPlan(c: Caller, body: any) {
  requireStaff(c);
  const s = await settings();
  requireLive(s, c);
  const plan = await getPlan(body.planId);
  if (plan.stripe_subscription_id) {
    try { await stripe.subscriptions.cancel(plan.stripe_subscription_id); }
    catch (e: any) { if (e?.code !== "resource_missing") throw e; }
  }
  const fee = Math.round(Number(body.fee_pence || 0));
  if (fee <= 0) return { ok: true };
  const { data: b } = await db.from("bookings").select("*").eq("id", plan.booking_id).maybeSingle();
  if (!b?.stripe_payment_method_id) return { ok: true, warning: "No saved card, so the cancellation fee wasn't charged." };
  try {
    const pi = await stripe.paymentIntents.create({
      amount: fee, currency: "gbp", customer: b.stripe_customer_id, payment_method: b.stripe_payment_method_id,
      confirm: true, off_session: true, description: "EasyRepair Protection Plan cancellation fee",
      receipt_email: b.email || undefined, metadata: { plan_id: plan.id, kind: "plan_cancellation_fee" },
    }, { idempotencyKey: `plan-cancel-${plan.id}` });
    if (pi.status === "succeeded") {
      await db.from("plan_payments").insert({ plan_id: plan.id, amount_pence: fee, kind: "cancellation_fee", stripe_invoice_id: pi.id });
      await db.from("service_plans").update({ cancellation_fee_charged: true }).eq("id", plan.id);
    }
    return { ok: true, feeStatus: pi.status };
  } catch (e: any) {
    await db.from("plan_changes").insert({ plan_id: plan.id, summary: `Cancellation fee of ${gbp(fee)} couldn't be charged: ${e?.raw?.message || e.message}`, changed_by: c.userId });
    return { ok: true, warning: "The plan was cancelled but the fee couldn't be charged." };
  }
}

// --------------------------------------------------------------- daily jobs
// Run once a day (Supabase cron or any scheduler POSTing
// {"action":"daily","cronSecret":"..."}):
//   * Pay after repair jobs unpaid at the end of the completion day: add the admin fee and resend the link
//   * Protection plan renewal reminders, and rolling plans into their next 12-month term
//   * Commission recoveries still pending after N days: marked "invoiced" for staff to chase

async function daily(c: Caller) {
  requireStaff(c);
  const s = await settings();
  const out: Record<string, number> = { adminFees: 0, reminders: 0, renewed: 0, invoiced: 0 };
  if (!s.payments_live) return { skipped: "payments not live" };
  const today = new Date().toISOString().slice(0, 10);

  const { data: unpaid } = await db.from("bookings").select("*")
    .eq("payment_timing", "after").eq("payment_status", "outstanding")
    .is("admin_fee_applied_at", null).lt("awaiting_payment_since", `${today}T00:00:00Z`);
  for (const b of unpaid || []) {
    try { await applyAdminFee(c, { bookingId: b.id }); out.adminFees++; } catch (_) { /* keep going */ }
  }

  const now = new Date();
  const remindBy = addDays(now, Number(s.plan_renewal_reminder_days || 30)).toISOString();
  const { data: due } = await db.from("service_plans").select("*").eq("status", "active")
    .not("stripe_subscription_id", "is", null).lte("next_renewal_at", remindBy).is("renewal_reminder_sent_at", null);
  for (const p of due || []) {
    const interval = p.pending_interval || p.billing_interval || "month";
    const price = planPrice(s, interval, p.appliance_count || 1);
    const end = new Date(p.next_renewal_at).toLocaleDateString("en-GB");
    await notifyCustomer(p, "Your EasyRepair Protection Plan renews soon",
      `EasyRepair: your Protection Plan renews for another 12 months on ${end} at ${gbp(price)} per ${interval}. ` +
      `If you don't want it to renew, contact us before then. Cancelling during a term costs ${gbp(s.plan_cancel_fee_pence)}.`);
    await db.from("service_plans").update({ renewal_reminder_sent_at: now.toISOString() }).eq("id", p.id);
    out.reminders++;
  }

  const { data: ending } = await db.from("service_plans").select("*").eq("status", "active")
    .not("stripe_subscription_id", "is", null).lte("next_renewal_at", now.toISOString());
  for (const p of ending || []) {
    const start = new Date(p.next_renewal_at);
    const end = addMonths(start, Number(s.plan_term_months || 12));
    const patch: Record<string, unknown> = {
      term_number: (p.term_number || 1) + 1, agreement_start: start.toISOString(), agreement_end: end.toISOString(),
      next_renewal_at: end.toISOString(), renewal_reminder_sent_at: null,
    };
    if (p.pending_interval && p.pending_interval !== p.billing_interval) {
      const price = planPrice(s, p.pending_interval, p.appliance_count || 1);
      const sub = await stripe.subscriptions.retrieve(p.stripe_subscription_id);
      await stripe.subscriptions.update(sub.id, { items: [{ id: sub.items.data[0].id, price_data: priceData(await planProduct(), price, p.pending_interval) }], proration_behavior: "none" });
      Object.assign(patch, { billing_interval: p.pending_interval, pending_interval: null, price_pence: price });
    }
    await db.from("service_plans").update(patch).eq("id", p.id);
    await db.from("plan_changes").insert({ plan_id: p.id, summary: `Renewed for term ${patch.term_number} (to ${end.toLocaleDateString("en-GB")})` });
    out.renewed++;
  }

  const cutoff = addDays(now, -Number(s.recovery_invoice_days || 30)).toISOString();
  const { data: old } = await db.from("commission_recoveries").select("id").eq("status", "pending").lt("created_at", cutoff);
  for (const r of old || []) {
    await db.from("commission_recoveries").update({ status: "invoiced", invoiced_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", r.id);
    out.invoiced++;
  }
  return out;
}

// ------------------------------------------------------------------ webhooks

async function markJobPaid(pi: Stripe.PaymentIntent, account: string) {
  const bookingId = pi.metadata?.booking_id;
  if (!bookingId) return;
  const { data: b } = await db.from("bookings").select("*").eq("id", bookingId).maybeSingle();
  if (!b || b.payment_status === "paid" && b.stripe_fee_pence != null) return;

  // Actual Stripe fee for this charge (paid from the engineer's account).
  const charge = await stripe.charges.retrieve(pi.latest_charge as string, { expand: ["balance_transaction"] }, { stripeAccount: account });
  const bt = charge.balance_transaction as Stripe.BalanceTransaction | null;
  const fee = bt?.fee ?? estimateStripeFee(pi.amount);

  // EasyRepair covers the fee unless this job's terms say the engineer does:
  // hand the fee back by refunding that much of the application fee.
  const feeBearer = pi.metadata?.fee_bearer || "easyrepair";
  const appFeeId = typeof charge.application_fee === "string" ? charge.application_fee : charge.application_fee?.id;
  if (feeBearer !== "engineer" && appFeeId && fee > 0) {
    const appFee = await stripe.applicationFees.retrieve(appFeeId);
    const give = Math.min(fee, appFee.amount - appFee.amount_refunded);
    if (give > 0) await stripe.applicationFees.createRefund(appFeeId, { amount: give, metadata: { reason: "EasyRepair covers the Stripe fee", booking_id: bookingId } }, { idempotencyKey: `feeback-${appFeeId}` });
  }

  const ids = (pi.metadata?.recovery_ids || "").split(",").filter(Boolean);
  if (ids.length) {
    await db.from("commission_recoveries").update({ status: "recovered", recovered_on_booking_id: bookingId, updated_at: new Date().toISOString() }).in("id", ids).eq("status", "pending");
  }
  await updateBooking(bookingId, {
    payment_status: "paid", paid_at: new Date((pi.created || Date.now() / 1000) * 1000).toISOString(),
    stripe_payment_intent_id: pi.id, stripe_charge_account_id: account, stripe_fee_pence: fee,
    total_pence: pi.amount,
    commission_pence: pi.metadata?.commission_pence ? Number(pi.metadata.commission_pence) : b.commission_pence,
    engineer_share_pence: pi.metadata?.engineer_share_pence ? Number(pi.metadata.engineer_share_pence) : b.engineer_share_pence,
    payment_taken: true, payment_taken_at: new Date().toISOString(),
    uncollectable_at: null,
    // Paid from the Take payment screen: the job completes now, with the outcome the engineer picked.
    ...(b.pending_outcome && !["Completed", "Beyond Repair", "Cancelled"].includes(b.status)
      ? { status: b.pending_outcome, completed_date: new Date().toISOString().slice(0, 10) } : {}),
  });
}

async function handleEvent(ev: Stripe.Event) {
  // Each event once.
  const { error: dup } = await db.from("stripe_events").insert({ id: ev.id, type: ev.type, account: ev.account || null });
  if (dup) { if (dup.code === "23505") return; throw dup; }

  const account = ev.account || null;
  const o: any = ev.data.object;
  switch (ev.type) {
    case "account.updated":
      await syncAccount(o);
      break;

    case "setup_intent.succeeded": {
      const bookingId = o.metadata?.booking_id;
      if (bookingId && o.payment_method) {
        await updateBooking(bookingId, { stripe_customer_id: o.customer, stripe_payment_method_id: o.payment_method });
        await stripe.customers.update(o.customer, { invoice_settings: { default_payment_method: o.payment_method } });
      }
      break;
    }

    case "payment_intent.succeeded":
      if (account && o.metadata?.kind === "job") await markJobPaid(o, account);
      break;

    case "payment_intent.payment_failed":
      if (account && o.metadata?.booking_id && o.metadata?.kind === "job") {
        await db.from("bookings").update({ payment_status: "outstanding" }).eq("id", o.metadata.booking_id).eq("payment_status", "processing");
      }
      break;

    case "checkout.session.expired":
      break;

    case "charge.refunded":
      // Records refunds made outside FixFlow (e.g. by Stripe support). Refunds
      // made from FixFlow are recorded by the refund action itself.
      if (account && o.payment_intent) {
        const { data: b } = await db.from("bookings").select("id,total_pence,refund_amount_pence").eq("stripe_payment_intent_id", o.payment_intent).maybeSingle();
        if (b && Number(b.refund_amount_pence || 0) < o.amount_refunded) {
          await new Promise((r) => setTimeout(r, 5000)); // give the refund action time to record its own
          const { data: again } = await db.from("bookings").select("refund_amount_pence").eq("id", b.id).maybeSingle();
          if (Number(again?.refund_amount_pence || 0) < o.amount_refunded) {
            await updateBooking(b.id, {
              refund_amount_pence: o.amount_refunded, refunded_at: new Date().toISOString(), refund_source: "engineer_dashboard",
              payment_status: o.amount_refunded >= (b.total_pence || o.amount) ? "refunded" : "part_refunded",
            });
          }
        }
      }
      break;

    case "charge.dispute.created":
      if (account) {
        await db.from("bookings").update({ payment_status: "disputed" }).eq("stripe_payment_intent_id", o.payment_intent);
      }
      break;

    case "invoice.paid": {
      const subId = o.subscription || o.parent?.subscription_details?.subscription;
      if (subId && o.amount_paid > 0) {
        const { data: p } = await db.from("service_plans").select("id").eq("stripe_subscription_id", subId).maybeSingle();
        if (p) {
          const { data: seen } = await db.from("plan_payments").select("id").eq("stripe_invoice_id", o.id).maybeSingle();
          if (!seen) await db.from("plan_payments").insert({ plan_id: p.id, amount_pence: o.amount_paid, kind: "subscription", stripe_invoice_id: o.id, paid_at: new Date(o.created * 1000).toISOString() });
        }
      }
      break;
    }

    case "invoice.payment_failed": {
      const subId = o.subscription || o.parent?.subscription_details?.subscription;
      const { data: p } = subId ? await db.from("service_plans").select("id").eq("stripe_subscription_id", subId).maybeSingle() : { data: null };
      if (p) await db.from("plan_changes").insert({ plan_id: p.id, summary: `Plan payment of ${gbp(o.amount_due)} failed — Stripe will retry` });
      break;
    }

    case "customer.subscription.deleted":
      await db.from("service_plans").update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("stripe_subscription_id", o.id).neq("status", "cancelled");
      break;
  }
}

async function webhook(req: Request) {
  const sig = req.headers.get("Stripe-Signature")!;
  const raw = await req.text();
  const secrets = [Deno.env.get("STRIPE_WEBHOOK_SECRET"), Deno.env.get("STRIPE_CONNECT_WEBHOOK_SECRET")].filter(Boolean) as string[];
  let ev: Stripe.Event | null = null;
  for (const sec of secrets) {
    try { ev = await stripe.webhooks.constructEventAsync(raw, sig, sec, undefined, cryptoProvider); break; } catch (_) { /* try next */ }
  }
  if (!ev) return text("Bad signature", 400);
  try { await handleEvent(ev); }
  catch (e: any) {
    // Let Stripe retry: forget we saw it.
    await db.from("stripe_events").delete().eq("id", ev.id);
    console.error("webhook", ev.type, e);
    return text("Error", 500);
  }
  return json({ received: true });
}

// ------------------------------------------------------- customer pay link

async function payPage(url: URL) {
  const id = url.searchParams.get("pay") || "";
  if (!(await verify(`pay:${id}`, url.searchParams.get("t")))) return text("This payment link isn't valid. Please contact EasyRepair.", 403);
  const { data: b } = await db.from("bookings").select("*").eq("id", id).maybeSingle();
  if (!b) return text("Booking not found. Please contact EasyRepair.", 404);
  if (["paid", "refunded", "part_refunded"].includes(b.payment_status)) return Response.redirect(`${SITE_URL}/?payment=already-paid`, 303);
  if (b.parts_approval_status === "pending" && b.pending_outcome !== "Beyond Repair") return text("Your engineer has quoted parts that need your approval first. Please use the approval link we sent you, or call EasyRepair.", 409);
  const eng = await engineer(b.engineer_id);
  if (eng?.stripe_account_id && !eng.stripe_charges_enabled) eng.stripe_charges_enabled = !!(await refreshAccountById(eng.stripe_account_id)).charges_enabled;
  if (!eng?.stripe_account_id || !eng.stripe_charges_enabled) return text("Payment isn't available for this job yet. Please contact EasyRepair.", 409);
  const s = await settings();
  const m = jobCharge(b, s, await overrides());
  const rec = await recoveriesFor(eng.id, Math.max(0, m.engineerShare - estimateStripeFee(m.total)), b.id);
  const items: any[] = [{ quantity: 1, price_data: { currency: "gbp", unit_amount: m.callout, product_data: { name: `Callout and labour — ${b.appliance || "appliance"} repair (${ref(b)})` } } }];
  if (m.parts > 0) items.push({ quantity: 1, price_data: { currency: "gbp", unit_amount: m.parts, product_data: { name: "Parts (approved)" } } });
  if (m.adminFee > 0) items.push({ quantity: 1, price_data: { currency: "gbp", unit_amount: m.adminFee, product_data: { name: "Late payment admin fee" } } });
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: items,
    customer_email: b.email || undefined,
    payment_intent_data: {
      application_fee_amount: m.commission + rec.sum,
      description: `EasyRepair job ${ref(b)}`,
      metadata: {
        booking_id: b.id, kind: "job", fee_bearer: m.terms.fee_bearer,
        commission_pence: String(m.commission), engineer_share_pence: String(m.engineerShare),
        recovery_ids: rec.ids.join(","), recovery_pence: String(rec.sum),
      },
    },
    success_url: `${SITE_URL}/?payment=success`,
    cancel_url: `${SITE_URL}/?payment=cancelled`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }, { stripeAccount: eng.stripe_account_id });
  await updateBooking(b.id, { stripe_charge_account_id: eng.stripe_account_id, total_pence: m.total, commission_pence: m.commission, engineer_share_pence: m.engineerShare });
  return Response.redirect(session.url!, 303);
}

// Testing only: puts Stripe's test Visa card on a test booking, as if the
// customer had saved it on the booking form. Refused with live keys.
async function testAttachCard(c: Caller, body: any) {
  requireStaff(c);
  if (!TEST_MODE) fail("Only available with Stripe test keys.");
  const b = await booking(body.bookingId);
  if (!b.is_test) fail("Only for test bookings.");
  let customerId = b.stripe_customer_id;
  if (!customerId) customerId = (await stripe.customers.create({ name: b.customer || "Test customer", email: b.email || undefined, metadata: { booking_id: b.id } })).id;
  const pm = await stripe.paymentMethods.attach(body.testCard || "pm_card_visa", { customer: customerId });
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });
  await updateBooking(b.id, { stripe_customer_id: customerId, stripe_payment_method_id: pm.id, payment_timing: b.wants_protection_plan ? b.payment_timing : (b.payment_timing || "before") });
  return { ok: true, paymentMethod: pm.id };
}

// ---------------------------------------------------------------- router

const ACTIONS: Record<string, (c: Caller, body: any) => Promise<unknown>> = {
  onboarding_link: onboardingLink,
  account_session: accountSession,
  refresh_account: refreshAccount,
  start_card_setup: startCardSetup,       // public (booking form)
  job_completed: jobCompleted,
  take_payment: takePayment,
  charge_job: chargeJob,
  send_payment_link: sendPaymentLink,
  apply_admin_fee: applyAdminFee,
  send_parts_approval: sendPartsApproval,
  parts_quote: partsQuote,                // public (approval page)
  parts_respond: partsRespond,            // public (approval page)
  charge_cancellation_fee: chargeCancellationFee,
  refund,
  update_plan: updatePlan,
  cancel_plan: cancelPlan,
  daily: (c) => daily(c),
  test_attach_card: testAttachCard,
};
const PUBLIC = new Set(["start_card_setup", "parts_quote", "parts_respond"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!STRIPE_KEY) return json({ error: "STRIPE_SECRET_KEY isn't set" }, 500);
  const url = new URL(req.url);
  try {
    if (req.method === "GET" && url.searchParams.has("pay")) return await payPage(url);
    if (req.method !== "POST") return text("Not found", 404);
    if (req.headers.get("Stripe-Signature")) return await webhook(req);

    const body = await req.json().catch(() => ({}));
    const fn = ACTIONS[body.action];
    if (!fn) return json({ error: `Unknown action: ${body.action}` }, 400);
    const c = await caller(req, body);
    if (!PUBLIC.has(body.action) && !c.userId && !c.service) return json({ error: "Please sign in again" }, 401);
    return json((await fn(c, body)) ?? { ok: true });
  } catch (e: any) {
    if (e instanceof UserError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: e?.raw?.message || e?.message || "Something went wrong" }, 500);
  }
});
