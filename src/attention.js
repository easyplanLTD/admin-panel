// "Needs attention" bookings.
//
// A booking needs attention while any switched-on trigger applies to it.
// Its status pill then glows and the dot pulses (see Badge in App.jsx), and
// the Bookings list shows those rows first, in the order they started
// pulsing (oldest trigger first). Everything clears by itself once the
// situation is dealt with -- except the manual flag, which staff switch off.
//
// Which triggers are on, plus a notes box for future ideas, live in
// public.attention_settings (Settings -> System -> Attention triggers,
// migration 0028_attention.sql).

// Order here = order shown in Settings and in a booking's attention panel.
export const ATTENTION_TRIGGERS = [
  { key: "declined",    label: "SP declined the job",              desc: "An SP declined it in the Portal and the decline hasn't been dismissed yet.", since: "When the SP declined" },
  { key: "dispute",     label: "Open dispute or problem",          desc: "A dispute or problem flag on the booking is open or under review.",          since: "When the flag was raised" },
  { key: "unassigned",  label: "No SP assigned",                   desc: "An active booking with no in-house or external SP on it.",                   since: "When the booking came in" },
  { key: "unscheduled", label: "Assigned but no visit date",       desc: "An SP is on the job but no visit date has been set.",                        since: "When the SP was assigned" },
  { key: "payment",     label: "Waiting for the customer to pay",  desc: "The SP has submitted the outcome and the customer hasn't paid yet.",         since: "When it started awaiting payment" },
  { key: "parts",       label: "Parts awaiting customer approval", desc: "Parts have been quoted and the customer hasn't approved them yet.",          since: "When the parts went for approval" },
  { key: "manual",      label: "Flagged by staff",                 desc: "Someone clicked \"Needs attention\" on the booking. Stays on until switched off.", since: "When it was flagged" },
];
export const ATTENTION_LABELS = Object.fromEntries(ATTENTION_TRIGGERS.map((t) => [t.key, t.label]));
export const DEFAULT_ATTENTION_TRIGGERS = Object.fromEntries(ATTENTION_TRIGGERS.map((t) => [t.key, true]));

const CLOSED = ["Completed", "Beyond Repair", "Cancelled"];
const PAID = ["paid", "processing", "refunded", "part_refunded"];

const ts = (v) => { const n = v ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : null; };
const earliest = (...vals) => { const n = vals.map(ts).filter((x) => x != null); return n.length ? Math.min(...n) : null; };

// job: mapped booking (App.jsx mapBookingRow). ctx: { declines: Map(bookingId -> [isoTimes]),
// flags: Map(bookingId -> [isoTimes]), triggers: {key: bool} }.
// Returns null, or { since: ms, reasons: [{key, label, at: ms}] } sorted oldest first.
export function attentionFor(job, ctx = {}) {
  if (!job || job.status === "Quote") return null;
  const on = { ...DEFAULT_ATTENTION_TRIGGERS, ...(ctx.triggers || {}) };
  const open = !CLOSED.includes(job.status);
  const fallback = ts(job.createdAt) ?? 0;
  const reasons = [];
  const add = (key, at) => { if (on[key]) reasons.push({ key, label: ATTENTION_LABELS[key], at: at ?? fallback }); };

  const dec = ctx.declines?.get?.(job.id);
  if (dec?.length) add("declined", earliest(...dec));

  const fl = ctx.flags?.get?.(job.id);
  if (fl?.length) add("dispute", earliest(...fl));

  const assigned = !!(job.engineerId || job.isExternal);
  if (open && !assigned) add("unassigned", ts(job.createdAt));
  if (open && assigned && !job.scheduledDate && !job.pendingOutcome) add("unscheduled", earliest(job.assignedAt) ?? ts(job.createdAt));

  if (open && job.pendingOutcome && !PAID.includes(job.paymentStatus)) add("payment", earliest(job.awaitingPaymentSince) ?? ts(job.createdAt));
  if (open && job.partsApprovalStatus === "pending") add("parts", earliest(job.partsRequestedAt) ?? ts(job.createdAt));

  if (job.attentionManual) add("manual", earliest(job.attentionManualAt) ?? ts(job.createdAt));

  if (!reasons.length) return null;
  reasons.sort((a, b) => a.at - b.at);
  return { since: reasons[0].at, reasons };
}

// Group rows of {booking_id, <timeField>} into Map(bookingId -> [times]).
export function groupTimes(rows = [], timeField) {
  const m = new Map();
  for (const r of rows) {
    if (!r?.booking_id) continue;
    if (!m.has(r.booking_id)) m.set(r.booking_id, []);
    m.get(r.booking_id).push(r[timeField]);
  }
  return m;
}

// Stable sort: attention rows first (oldest trigger first), then the rest in
// their existing order.
export function sortAttentionFirst(list, attOf) {
  return list
    .map((j, i) => ({ j, i, a: attOf(j) }))
    .sort((x, y) => {
      if (!!x.a !== !!y.a) return x.a ? -1 : 1;
      if (x.a && y.a && x.a.since !== y.a.since) return x.a.since - y.a.since;
      return x.i - y.i;
    })
    .map((x) => x.j);
}
