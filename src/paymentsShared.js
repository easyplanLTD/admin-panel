// paymentsShared.js -- money maths and booking-field mapping for the Stripe
// Connect payments build. The same file lives in both admin-panel and portal
// (keep them identical) so FixFlow and the Engineer Portal always show the
// same numbers for the same job.
//
// All money is handled in whole pence. Settings come from the single-row
// public.payment_settings table (see supabase/migrations/0010_payments.sql);
// DEFAULT_PAYMENT_SETTINGS mirrors that table's defaults so screens still
// render sensibly before the migration has been run.

export const DEFAULT_PAYMENT_SETTINGS = {
  payments_live: false,
  callout_protection_pence: 7999,
  callout_repair_only_pence: 9999,
  engineer_callout_share: 62.51,
  engineer_parts_share: 100,
  fee_bearer: "easyrepair",
  admin_fee_pence: 1000,
  admin_fee_engineer_share: 0,
  late_cancel_fee_pence: 2500,
  free_cancel_hours: 48,
  late_cancel_engineer_share: 0,
  no_show_fee_pence: 2500,
  no_show_engineer_share: 50,
  recovery_invoice_days: 30,
  plan_monthly_tiers: [799, 1299, 1699, 2000],
  plan_monthly_extra_pence: 499,
  plan_annual_tiers: [8629, 14029, 18349, 21600],
  plan_annual_extra_pence: 5389,
  plan_first_payment_days: 7,
  plan_term_months: 12,
  plan_cooling_off_days: 14,
  plan_cancel_fee_pence: 2500,
  plan_renewal_reminder_days: 30,
  vat_registered: false,
  vat_rate: 20,
  vat_threshold_pence: 9000000,
};

export const FEE_BEARER_LABELS = {
  easyrepair: "EasyRepair covers it",
  engineer: "Engineer covers it",
  customer_price: "Built into the customer's price",
};

export const PAYMENT_STATUS_LABELS = {
  not_charged: "Not charged yet",
  processing: "Processing",
  paid: "Paid",
  outstanding: "Payment outstanding",
  uncollectable: "Uncollectable",
  refunded: "Refunded",
  part_refunded: "Part refunded",
  disputed: "Disputed by customer",
};

export const PARTS_STATUS_LABELS = {
  none: "No parts",
  pending: "Awaiting customer approval",
  approved: "Approved by customer",
  declined: "Declined by customer",
};

export const STRIPE_STATUS_LABELS = {
  not_started: "Not set up",
  incomplete: "Setup not finished",
  under_review: "Stripe is checking details",
  active: "Active",
  restricted: "Stripe needs more information",
};

export const penceToGBP = (p) => `£${(Number(p || 0) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const poundsToPence = (v) => Math.round(Number(v || 0) * 100);
export const pctLabel = (n) => `${Number(n).toFixed(2).replace(/\.00$/, "")}%`;

// Rough UK card fee estimate (1.5% + 20p) -- only used to show the likely
// cost before a payment is taken. Once Stripe has charged a job, the real
// fee is stored on the booking (stripe_fee_pence) and shown instead.
export const estimateStripeFee = (totalPence) => (totalPence > 0 ? Math.round(totalPence * 0.015) + 20 : 0);

export function mergeSettings(row) {
  return { ...DEFAULT_PAYMENT_SETTINGS, ...(row || {}) };
}

// Which of the three payment routes a booking is on.
export function paymentRoute(job) {
  if (job?.wantsProtectionPlan) return "repair_protection";
  if (job?.paymentTiming === "after") return "pay_after";
  if (job?.paymentTiming === "before") return "add_card";
  return "unknown";
}
export const ROUTE_LABELS = {
  repair_protection: "Repair + protection",
  add_card: "Repair only · Add card now",
  pay_after: "Repair only · Pay after repair",
  unknown: "Payment route not chosen",
};
export const planKeyFor = (job) => (job?.wantsProtectionPlan ? "repair_protection" : "repair_only");

// Callout in pence: what was stored on the booking, else the current price.
export function calloutPenceFor(job, settings) {
  const s = mergeSettings(settings);
  const stored = job?.calloutFee;
  if (stored !== "" && stored != null && !isNaN(Number(stored))) return poundsToPence(stored);
  return job?.wantsProtectionPlan ? s.callout_protection_pence : s.callout_repair_only_pence;
}

// The split in force for a job. Order (later wins): global settings ->
// plan-wide override -> engineer override -> terms fixed at assignment ->
// per-job override set by EasyRepair. Mirrors current_payment_terms() in SQL.
export function termsForJob(job, settings, overrides = []) {
  const s = mergeSettings(settings);
  let t = { engineer_callout_share: Number(s.engineer_callout_share), engineer_parts_share: Number(s.engineer_parts_share), fee_bearer: s.fee_bearer, source: "Current settings" };
  const plan = planKeyFor(job);
  const relevant = (overrides || [])
    .filter((o) => o.active && ((o.plan === plan && !o.engineer_id) || (job?.engineerId && o.engineer_id === job.engineerId && (!o.plan || o.plan === plan))))
    .sort((a, b) => (a.engineer_id ? 1 : 0) - (b.engineer_id ? 1 : 0) || (a.plan ? 1 : 0) - (b.plan ? 1 : 0));
  for (const o of relevant) {
    if (o.engineer_callout_share != null) t.engineer_callout_share = Number(o.engineer_callout_share);
    if (o.engineer_parts_share != null) t.engineer_parts_share = Number(o.engineer_parts_share);
    if (o.fee_bearer) t.fee_bearer = o.fee_bearer;
    t.source = o.engineer_id ? "Engineer override" : "Plan override";
  }
  const snap = job?.termsSnapshot;
  if (snap && snap.engineer_callout_share != null) {
    t = { engineer_callout_share: Number(snap.engineer_callout_share), engineer_parts_share: Number(snap.engineer_parts_share ?? 100), fee_bearer: snap.fee_bearer || t.fee_bearer, source: "Fixed when assigned" };
  }
  const ov = job?.splitOverride;
  if (ov && (ov.engineer_callout_share != null || ov.engineer_parts_share != null || ov.fee_bearer)) {
    t = {
      engineer_callout_share: ov.engineer_callout_share != null ? Number(ov.engineer_callout_share) : t.engineer_callout_share,
      engineer_parts_share: ov.engineer_parts_share != null ? Number(ov.engineer_parts_share) : t.engineer_parts_share,
      fee_bearer: ov.fee_bearer || t.fee_bearer,
      source: "Set for this job",
    };
  }
  return t;
}

// The full money picture for one job. Parts only count once approved,
// unless includePending is set (used for "if the customer approves" views).
export function jobMoney(job, settings, overrides = [], { includePending = false } = {}) {
  const terms = termsForJob(job, settings, overrides);
  const callout = calloutPenceFor(job, settings);
  const partsAll = Number(job?.partsTotalPence || 0);
  const partsApproved = job?.partsApprovalStatus === "approved" || includePending ? partsAll : 0;
  const total = callout + partsApproved;
  const engineerCallout = Math.round((callout * terms.engineer_callout_share) / 100);
  const engineerParts = Math.round((partsApproved * terms.engineer_parts_share) / 100);
  const engineerGross = engineerCallout + engineerParts;
  const commission = total - engineerGross;
  const actualFee = job?.stripeFeePence != null ? Number(job.stripeFeePence) : null;
  const fee = actualFee != null ? actualFee : estimateStripeFee(total);
  const engineerPaysFee = terms.fee_bearer === "engineer";
  // Once Stripe has charged the job, its own numbers win.
  const charged = job?.commissionPence != null && job?.totalPence != null;
  return {
    terms,
    callout,
    partsAll,
    partsApproved,
    partsPending: job?.partsApprovalStatus === "pending" ? partsAll : 0,
    total: charged ? Number(job.totalPence) : total,
    engineerCallout,
    engineerParts,
    engineerGross: charged ? Number(job.engineerSharePence ?? engineerGross) : engineerGross,
    commission: charged ? Number(job.commissionPence) : commission,
    fee,
    feeIsEstimate: actualFee == null,
    engineerPaysFee,
    engineerNet: (charged ? Number(job.engineerSharePence ?? engineerGross) : engineerGross) - (engineerPaysFee ? fee : 0),
    easyRepairNet: (charged ? Number(job.commissionPence) : commission) - (engineerPaysFee ? 0 : fee),
    charged,
  };
}

// Protection plan price for a billing interval and number of appliances.
export function planPricePence(settings, interval, count) {
  const s = mergeSettings(settings);
  const tiers = (interval === "year" ? s.plan_annual_tiers : s.plan_monthly_tiers) || [];
  const extra = interval === "year" ? s.plan_annual_extra_pence : s.plan_monthly_extra_pence;
  const n = Math.max(1, Number(count) || 1);
  if (!tiers.length) return 0;
  if (n <= tiers.length) return Number(tiers[n - 1]);
  return Number(tiers[tiers.length - 1]) + (n - tiers.length) * Number(extra || 0);
}

// Fee for a cancellation or no-show, split between engineer and EasyRepair.
export function cancellationFee(settings, type) {
  const s = mergeSettings(settings);
  const total = type === "no_show" ? s.no_show_fee_pence : s.late_cancel_fee_pence;
  const share = type === "no_show" ? s.no_show_engineer_share : s.late_cancel_engineer_share;
  const engineer = Math.round((Number(total) * Number(share)) / 100);
  return { total: Number(total), engineer, easyRepair: Number(total) - engineer };
}

// What it costs a protection customer to cancel today.
export function planCancellationFee(plan, settings, now = new Date()) {
  const s = mergeSettings(settings);
  const t = now.getTime();
  const coolingEnd = plan?.coolingOffEndsAt ? new Date(plan.coolingOffEndsAt).getTime()
    : plan?.startedAt ? new Date(plan.startedAt).getTime() + s.plan_cooling_off_days * 864e5 : null;
  if (coolingEnd != null && t <= coolingEnd) return { fee: 0, why: "Within the cooling-off period" };
  const end = plan?.agreementEnd ? new Date(plan.agreementEnd).getTime() : null;
  if (end != null && t >= end) return { fee: 0, why: "At the end of the agreement term" };
  return { fee: Number(s.plan_cancel_fee_pence), why: "After cooling-off, before the term ends" };
}

// Booking row (snake_case from Supabase) -> payment fields used by both apps.
export function mapPaymentFields(row = {}) {
  return {
    calloutFee: row.callout_fee ?? null,
    paymentTiming: row.payment_timing || null,
    partsLines: Array.isArray(row.parts_lines) ? row.parts_lines : [],
    partsTotalPence: Number(row.parts_total_pence || 0),
    partsApprovalStatus: row.parts_approval_status || "none",
    partsApprovedAt: row.parts_approved_at || null,
    partsApprovalMethod: row.parts_approval_method || null,
    splitOverride: row.split_override || null,
    termsSnapshot: row.terms_snapshot || null,
    totalPence: row.total_pence ?? null,
    commissionPence: row.commission_pence ?? null,
    engineerSharePence: row.engineer_share_pence ?? null,
    stripeFeePence: row.stripe_fee_pence ?? null,
    paymentStatus: row.payment_status || "not_charged",
    paidAt: row.paid_at || null,
    paymentLinkUrl: row.payment_link_url || null,
    hasSavedCard: !!row.stripe_payment_method_id,
    adminFeePence: row.admin_fee_pence ?? null,
    adminFeeAppliedAt: row.admin_fee_applied_at || null,
    cancelledAt: row.cancelled_at || null,
    noShow: !!row.no_show,
    noShowAt: row.no_show_at || null,
    cancellationFeeType: row.cancellation_fee_type || null,
    cancellationFeePence: row.cancellation_fee_pence ?? null,
    cancellationFeeStatus: row.cancellation_fee_status || "none",
    feeEngineerSharePence: row.fee_engineer_share_pence ?? null,
    uncollectableAt: row.uncollectable_at || null,
    fault: row.fault || null,
    faultReasonId: row.fault_reason_id || null,
    faultNote: row.fault_note || "",
    refundReasonId: row.refund_reason_id || null,
    refundAmountPence: row.refund_amount_pence ?? null,
    commissionRefundedPence: row.commission_refunded_pence ?? null,
    refundedAt: row.refunded_at || null,
    refundSource: row.refund_source || null,
  };
}

// Jobs paid through Stripe (card saved at booking, Pay after repair, or
// already charged/linked) pay the engineer directly, so they're left out of
// the old "EasyRepair pays the SP a per-job rate" lists.
export const isStripeJob = (job) =>
  !!job && ((job.paymentStatus && job.paymentStatus !== "not_charged") || job.hasSavedCard || job.paymentTiming === "after");

// Short reference for a booking (falls back to the start of its UUID).
export const jobRef = (job) => job?.bookingRef || (job?.id ? `#${String(job.id).slice(0, 8)}` : "");
