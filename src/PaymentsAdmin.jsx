// PaymentsAdmin.jsx -- FixFlow screens for the Stripe Connect payments build.
//
//   PaymentsSettings      Settings -> Payments (split, fees, plan prices,
//                         overrides, reason lists, VAT, go-live switch)
//   JobPaymentPanel       payment section inside a job's detail view
//   DisputesView          "Disputes & problems" queue of engineer flags
//   CustomerPaymentsPanel customer payments, recoveries and VAT tracker
//                         (top of the Payments page)
//   PlanBillingPanel      billing section inside a protection plan's detail
//   useOpenFlagsCount     open-flag count for the sidebar badge
//
// Shared look (C, Btn, Modal, ...) is imported from App.jsx. Those imports
// are only used inside components, never at module load, so the
// App.jsx <-> PaymentsAdmin.jsx import cycle is safe.
//
// Anything that moves money through Stripe (charging, payment links,
// refunds, transfers) calls the `payments` Edge Function, and is shown as
// "available when payments go live" until payment_settings.payments_live is
// switched on in Settings -> Payments -> Go live.

import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "./lib/supabaseClient";
import { C, Btn, Modal, Fl, inp, ta, fmtDateTime } from "./App";
import {
  mergeSettings, jobMoney, penceToGBP, poundsToPence, pctLabel, planPricePence, cancellationFee,
  planCancellationFee, paymentRoute, ROUTE_LABELS, PAYMENT_STATUS_LABELS, PARTS_STATUS_LABELS,
  FEE_BEARER_LABELS, STRIPE_STATUS_LABELS, jobRef,
  PAID_VIA_LABELS, cardLabel, stripePaymentUrl, spPayFor, spPayLabel,
} from "./paymentsShared";

// ─── data hooks ─────────────────────────────────────────────────────────────
export function usePaymentSettings() {
  const [row, setRow] = useState(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const { data, error } = await supabase.from("payment_settings").select("*").eq("id", 1).maybeSingle();
    if (error) setError(error.message); else { setError(""); setRow(data); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { settings: mergeSettings(row), loaded: !!row, error, reload };
}

function useTable(table, { order = "sort_order", filter } = {}) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    let q = supabase.from(table).select("*");
    if (filter) q = filter(q);
    if (order) q = q.order(order, { ascending: true });
    const { data, error } = await q;
    if (error) setError(error.message); else { setError(""); setRows(data || []); }
  }, [table, order, filter]);
  useEffect(() => { reload(); }, [reload]);
  return { rows, error, reload };
}

// Calls the payments Edge Function (added when Stripe goes live).
async function callPayments(action, body) {
  const { data, error } = await supabase.functions.invoke("payments", { body: { action, ...body } });
  if (error) {
    // Show the function's own message (e.g. Stripe's reason) rather than "non-2xx status code".
    let msg = error.message || "Payment request failed.";
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch (_) { /* keep generic message */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export function useOpenFlagsCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { count, error } = await supabase.from("job_flags").select("id", { count: "exact", head: true }).neq("status", "resolved");
      if (alive && !error) setN(count || 0);
    };
    load();
    const ch = supabase.channel("job-flags-count").on("postgres_changes", { event: "*", schema: "public", table: "job_flags" }, load).subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, []);
  return n;
}

// ─── small building blocks ──────────────────────────────────────────────────
const box = () => ({ background: "#1E2530", borderRadius: 9, padding: 12, marginBottom: 12 });
const label = () => ({ fontSize: 10, color: C.light, fontWeight: 700, textTransform: "uppercase", marginBottom: 6, letterSpacing: .3 });
const Pill = ({ children, color, bg }) => (
  <span style={{ background: bg || "rgba(255,255,255,0.07)", color: color || C.mid, padding: "2px 9px", borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>
);
const statusColor = (s) => ({
  paid: [C.success, C.successLight], outstanding: [C.warn, C.warnLight], uncollectable: [C.danger, C.dangerLight],
  refunded: [C.purple, C.purpleLight], part_refunded: [C.purple, C.purpleLight], disputed: [C.danger, C.dangerLight],
  processing: [C.blue, C.blueLight],
}[s] || [C.mid, "rgba(255,255,255,0.07)"]);
const PayStatusPill = ({ status }) => { const [c, b] = statusColor(status); return <Pill color={c} bg={b}>{PAYMENT_STATUS_LABELS[status] || status}</Pill>; };
const Row = ({ k, v, strong, color }) => (
  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
    <span style={{ color: C.mid }}>{k}</span><span style={{ fontWeight: strong ? 800 : 600, color: color || C.text }}>{v}</span>
  </div>
);
const ErrorLine = ({ msg }) => msg ? <div style={{ color: C.danger, fontSize: 12, marginTop: 8 }}>{msg}</div> : null;
const NotLiveNote = () => (
  <div style={{ fontSize: 11, color: C.warn, marginTop: 6 }}>Available when payments go live (Settings → Payments → Go live).</div>
);
const moneyInput = (v, set) => <input type="number" step="0.01" style={inp} value={v} onChange={(e) => set(e.target.value)} />;

// ═══════════════════════════════════════════════════════════════════════════
//  SETTINGS -> PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════
const PAY_TABS = [
  { key: "split", label: "Split & fees" },
  { key: "plans", label: "Protection plans" },
  { key: "overrides", label: "Overrides" },
  { key: "reasons", label: "Reason lists" },
  { key: "vat", label: "VAT & go live" },
];

export function PaymentsSettings({ engineers = [] }) {
  const { settings, loaded, error, reload } = usePaymentSettings();
  const [tab, setTab] = useState("split");
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {PAY_TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            border: "none", borderRadius: 7, padding: "6px 13px", fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
            background: tab === t.key ? "rgba(212,255,60,0.12)" : "rgba(255,255,255,0.05)", color: tab === t.key ? C.primary : C.mid,
          }}>{t.label}</button>
        ))}
      </div>
      {error && <div style={{ ...box(), color: C.danger, fontSize: 13 }}>Couldn't load payment settings: {error}. Has supabase/migrations/0010_payments.sql been run?</div>}
      {!loaded && !error && <div style={{ color: C.light, fontSize: 13 }}>Loading…</div>}
      {loaded && tab === "split" && <SplitFeesForm settings={settings} onSaved={reload} />}
      {loaded && tab === "plans" && <PlanPricesForm settings={settings} onSaved={reload} />}
      {loaded && tab === "overrides" && <OverridesManager engineers={engineers} settings={settings} />}
      {tab === "reasons" && <ReasonLists />}
      {loaded && tab === "vat" && <VatGoLiveForm settings={settings} onSaved={reload} />}
    </div>
  );
}

function useSettingsForm(settings, fields, onSaved) {
  const toForm = () => Object.fromEntries(fields.map(([k, type]) => [k, type === "pence" ? (Number(settings[k]) / 100).toFixed(2) : settings[k]]));
  const [form, setForm] = useState(toForm);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { setForm(toForm()); }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async (extra = {}) => {
    setBusy(true); setErr(""); setMsg("");
    const patch = { ...extra, updated_at: new Date().toISOString() };
    for (const [k, type] of fields) {
      const v = form[k];
      patch[k] = type === "pence" ? poundsToPence(v) : type === "num" ? Number(v) : type === "bool" ? !!v : v;
    }
    const { data: u } = await supabase.auth.getUser();
    if (u?.user?.id) patch.updated_by = u.user.id;
    const { error } = await supabase.from("payment_settings").update(patch).eq("id", 1);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    setMsg("Saved. New jobs use these settings from now on; jobs already assigned keep the terms fixed when they were assigned.");
    await onSaved();
    return true;
  };
  return { form, set, save, busy, msg, err };
}

const SPLIT_FIELDS = [
  ["callout_protection_pence", "pence"], ["callout_repair_only_pence", "pence"],
  ["engineer_callout_share", "num"], ["engineer_parts_share", "num"], ["fee_bearer", "text"],
  ["admin_fee_pence", "pence"], ["admin_fee_engineer_share", "num"],
  ["late_cancel_fee_pence", "pence"], ["free_cancel_hours", "num"], ["late_cancel_engineer_share", "num"],
  ["no_show_fee_pence", "pence"], ["no_show_engineer_share", "num"], ["recovery_invoice_days", "num"],
];

function SplitFeesForm({ settings, onSaved }) {
  const { form, set, save, busy, msg, err } = useSettingsForm(settings, SPLIT_FIELDS, onSaved);
  const exP = jobMoney({ wantsProtectionPlan: true }, { ...settings, callout_protection_pence: poundsToPence(form.callout_protection_pence), engineer_callout_share: Number(form.engineer_callout_share), fee_bearer: form.fee_bearer });
  const exR = jobMoney({ wantsProtectionPlan: false }, { ...settings, callout_repair_only_pence: poundsToPence(form.callout_repair_only_pence), engineer_callout_share: Number(form.engineer_callout_share), fee_bearer: form.fee_bearer });
  const ns = cancellationFee({ no_show_fee_pence: poundsToPence(form.no_show_fee_pence), no_show_engineer_share: Number(form.no_show_engineer_share) }, "no_show");
  const lc = cancellationFee({ late_cancel_fee_pence: poundsToPence(form.late_cancel_fee_pence), late_cancel_engineer_share: Number(form.late_cancel_engineer_share) }, "late_cancel");
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 };
  return (
    <div>
      <div style={box()}>
        <div style={label()}>Callout fees and the split</div>
        <div style={grid}>
          <Fl label="Repair + protection callout (£)">{moneyInput(form.callout_protection_pence, (v) => set("callout_protection_pence", v))}</Fl>
          <Fl label="Repair only callout (£)">{moneyInput(form.callout_repair_only_pence, (v) => set("callout_repair_only_pence", v))}</Fl>
          <Fl label="Engineer share of callout (%)"><input type="number" step="0.01" style={inp} value={form.engineer_callout_share} onChange={(e) => set("engineer_callout_share", e.target.value)} /></Fl>
          <Fl label="Engineer share of parts (%)"><input type="number" step="0.01" style={inp} value={form.engineer_parts_share} onChange={(e) => set("engineer_parts_share", e.target.value)} /></Fl>
          <Fl label="Stripe card fees">
            <select style={inp} value={form.fee_bearer} onChange={(e) => set("fee_bearer", e.target.value)}>
              {Object.entries(FEE_BEARER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Fl>
        </div>
        <div style={{ fontSize: 12, color: C.mid, display: "flex", gap: 18, flexWrap: "wrap", marginTop: 4 }}>
          <span>Repair + protection: engineer <b style={{ color: C.primary }}>{penceToGBP(exP.engineerGross)}</b> · EasyRepair <b style={{ color: C.purple }}>{penceToGBP(exP.commission)}</b></span>
          <span>Repair only: engineer <b style={{ color: C.primary }}>{penceToGBP(exR.engineerGross)}</b> · EasyRepair <b style={{ color: C.purple }}>{penceToGBP(exR.commission)}</b></span>
        </div>
        {form.fee_bearer === "customer_price" && <div style={{ fontSize: 11, color: C.warn, marginTop: 8 }}>Build the fee into the callout prices above. UK rules ban adding a separate card fee for consumers, so it is never shown as a surcharge.</div>}
      </div>

      <div style={box()}>
        <div style={label()}>Fees</div>
        <div style={grid}>
          <Fl label="Late-payment admin fee (£)">{moneyInput(form.admin_fee_pence, (v) => set("admin_fee_pence", v))}</Fl>
          <Fl label="Admin fee: engineer share (%)"><input type="number" style={inp} value={form.admin_fee_engineer_share} onChange={(e) => set("admin_fee_engineer_share", e.target.value)} /></Fl>
          <Fl label="Late cancellation fee (£)">{moneyInput(form.late_cancel_fee_pence, (v) => set("late_cancel_fee_pence", v))}</Fl>
          <Fl label="Free cancellation up to (hours before)"><input type="number" style={inp} value={form.free_cancel_hours} onChange={(e) => set("free_cancel_hours", e.target.value)} /></Fl>
          <Fl label="Late cancellation: engineer share (%)"><input type="number" style={inp} value={form.late_cancel_engineer_share} onChange={(e) => set("late_cancel_engineer_share", e.target.value)} /></Fl>
          <Fl label="No-show fee (£)">{moneyInput(form.no_show_fee_pence, (v) => set("no_show_fee_pence", v))}</Fl>
          <Fl label="No-show: engineer share (%)"><input type="number" style={inp} value={form.no_show_engineer_share} onChange={(e) => set("no_show_engineer_share", e.target.value)} /></Fl>
          <Fl label="Invoice unrecovered commission after (days)"><input type="number" style={inp} value={form.recovery_invoice_days} onChange={(e) => set("recovery_invoice_days", e.target.value)} /></Fl>
        </div>
        <div style={{ fontSize: 12, color: C.mid, display: "flex", gap: 18, flexWrap: "wrap", marginTop: 4 }}>
          <span>No-show: engineer {penceToGBP(ns.engineer)} · EasyRepair {penceToGBP(ns.easyRepair)}</span>
          <span>Late cancellation: engineer {penceToGBP(lc.engineer)} · EasyRepair {penceToGBP(lc.easyRepair)}</span>
        </div>
      </div>
      <Btn onClick={() => save()}>{busy ? "Saving…" : "Save split & fees"}</Btn>
      {msg && <div style={{ color: C.success, fontSize: 12, marginTop: 8 }}>{msg}</div>}
      <ErrorLine msg={err} />
    </div>
  );
}

function PlanPricesForm({ settings, onSaved }) {
  const fields = [["plan_monthly_extra_pence", "pence"], ["plan_annual_extra_pence", "pence"], ["plan_first_payment_days", "num"], ["plan_term_months", "num"], ["plan_cooling_off_days", "num"], ["plan_cancel_fee_pence", "pence"], ["plan_renewal_reminder_days", "num"]];
  const { form, set, save, busy, msg, err } = useSettingsForm(settings, fields, onSaved);
  const [monthly, setMonthly] = useState(() => settings.plan_monthly_tiers.map((p) => (p / 100).toFixed(2)));
  const [annual, setAnnual] = useState(() => settings.plan_annual_tiers.map((p) => (p / 100).toFixed(2)));
  useEffect(() => { setMonthly(settings.plan_monthly_tiers.map((p) => (p / 100).toFixed(2))); setAnnual(settings.plan_annual_tiers.map((p) => (p / 100).toFixed(2))); }, [settings]);
  const setTier = (arr, setArr, i, v) => setArr(arr.map((x, j) => (j === i ? v : x)));
  const onSave = () => save({ plan_monthly_tiers: monthly.map(poundsToPence), plan_annual_tiers: annual.map(poundsToPence) });
  const th = { fontSize: 11, color: C.light, fontWeight: 700, textAlign: "left", padding: "6px 4px" };
  return (
    <div>
      <div style={box()}>
        <div style={label()}>Prices by number of appliances</div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Appliances</th><th style={th}>Monthly (£)</th><th style={th}>Annual (£)</th><th style={th}>Annual saving</th></tr></thead>
          <tbody>
            {monthly.map((m, i) => (
              <tr key={i}>
                <td style={{ padding: 4, fontSize: 13, fontWeight: 700 }}>{i + 1}</td>
                <td style={{ padding: 4 }}><input type="number" step="0.01" style={inp} value={m} onChange={(e) => setTier(monthly, setMonthly, i, e.target.value)} /></td>
                <td style={{ padding: 4 }}><input type="number" step="0.01" style={inp} value={annual[i] ?? ""} onChange={(e) => setTier(annual, setAnnual, i, e.target.value)} /></td>
                <td style={{ padding: 4, fontSize: 12, color: C.mid }}>{Number(m) > 0 ? pctLabel(100 - (Number(annual[i]) / (Number(m) * 12)) * 100) : "—"}</td>
              </tr>
            ))}
            <tr>
              <td style={{ padding: 4, fontSize: 13, fontWeight: 700 }}>Each extra</td>
              <td style={{ padding: 4 }}>{moneyInput(form.plan_monthly_extra_pence, (v) => set("plan_monthly_extra_pence", v))}</td>
              <td style={{ padding: 4 }}>{moneyInput(form.plan_annual_extra_pence, (v) => set("plan_annual_extra_pence", v))}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Btn variant="ghost" sm onClick={() => { setMonthly([...monthly, monthly[monthly.length - 1] || "0"]); setAnnual([...annual, annual[annual.length - 1] || "0"]); }}>+ Add tier</Btn>
          {monthly.length > 1 && <Btn variant="ghost" sm onClick={() => { setMonthly(monthly.slice(0, -1)); setAnnual(annual.slice(0, -1)); }}>Remove last tier</Btn>}
        </div>
      </div>
      <div style={box()}>
        <div style={label()}>Agreement terms</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
          <Fl label="First payment (days after job complete)"><input type="number" style={inp} value={form.plan_first_payment_days} onChange={(e) => set("plan_first_payment_days", e.target.value)} /></Fl>
          <Fl label="Agreement term (months)"><input type="number" style={inp} value={form.plan_term_months} onChange={(e) => set("plan_term_months", e.target.value)} /></Fl>
          <Fl label="Cooling-off period (days)"><input type="number" style={inp} value={form.plan_cooling_off_days} onChange={(e) => set("plan_cooling_off_days", e.target.value)} /></Fl>
          <Fl label="Cancellation fee after cooling-off (£)">{moneyInput(form.plan_cancel_fee_pence, (v) => set("plan_cancel_fee_pence", v))}</Fl>
          <Fl label="Renewal reminder (days before)"><input type="number" style={inp} value={form.plan_renewal_reminder_days} onChange={(e) => set("plan_renewal_reminder_days", e.target.value)} /></Fl>
        </div>
        <div style={{ fontSize: 12, color: C.mid }}>Plans renew automatically for another term at the end of each term.</div>
      </div>
      <Btn onClick={onSave}>{busy ? "Saving…" : "Save plan prices & terms"}</Btn>
      {msg && <div style={{ color: C.success, fontSize: 12, marginTop: 8 }}>{msg}</div>}
      <ErrorLine msg={err} />
    </div>
  );
}

function OverridesManager({ engineers, settings }) {
  const { rows, error, reload } = useTable("payment_overrides", { order: "created_at" });
  const [edit, setEdit] = useState(null);
  const engName = (id) => engineers.find((e) => e.id === id)?.name || "Unknown engineer";
  const toggle = async (o) => { await supabase.from("payment_overrides").update({ active: !o.active }).eq("id", o.id); reload(); };
  return (
    <div>
      <div style={{ fontSize: 13, color: C.mid, marginBottom: 12, lineHeight: 1.5 }}>
        Give an engineer or a plan different terms from the default ({pctLabel(settings.engineer_callout_share)} of callout, {pctLabel(settings.engineer_parts_share)} of parts, {FEE_BEARER_LABELS[settings.fee_bearer].toLowerCase()}).
        Terms are fixed on each job when it is assigned. To change a single job, use the payment section on that job.
      </div>
      <ErrorLine msg={error} />
      <div style={{ background: C.card, borderRadius: 13, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 12 }}>
        {rows.length === 0 && <div style={{ padding: 14, color: C.light, fontSize: 13 }}>No overrides. Everyone is on the default terms.</div>}
        {rows.map((o) => (
          <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${C.border}`, opacity: o.active ? 1 : 0.5 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{o.engineer_id ? engName(o.engineer_id) : "All engineers"}{o.plan ? ` · ${o.plan === "repair_protection" ? "Repair + protection" : "Repair only"} jobs` : ""}</div>
              <div style={{ fontSize: 12, color: C.mid }}>
                {[o.engineer_callout_share != null && `Callout ${pctLabel(o.engineer_callout_share)}`, o.engineer_parts_share != null && `Parts ${pctLabel(o.engineer_parts_share)}`, o.fee_bearer && FEE_BEARER_LABELS[o.fee_bearer]].filter(Boolean).join(" · ")}
                {o.reason ? ` — ${o.reason}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Btn variant="ghost" sm onClick={() => setEdit(o)}>Edit</Btn>
              <Btn variant={o.active ? "danger" : "success"} sm onClick={() => toggle(o)}>{o.active ? "Turn off" : "Turn on"}</Btn>
            </div>
          </div>
        ))}
      </div>
      <Btn onClick={() => setEdit({})}>+ Add override</Btn>
      {edit && <OverrideModal initial={edit} engineers={engineers} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function OverrideModal({ initial, engineers, onClose, onSaved }) {
  const [f, setF] = useState({
    engineer_id: initial.engineer_id || "", plan: initial.plan || "",
    engineer_callout_share: initial.engineer_callout_share ?? "", engineer_parts_share: initial.engineer_parts_share ?? "",
    fee_bearer: initial.fee_bearer || "", reason: initial.reason || "",
  });
  const [err, setErr] = useState("");
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.engineer_id && !f.plan) { setErr("Choose an engineer, a plan, or both."); return; }
    const row = {
      engineer_id: f.engineer_id || null, plan: f.plan || null,
      engineer_callout_share: f.engineer_callout_share === "" ? null : Number(f.engineer_callout_share),
      engineer_parts_share: f.engineer_parts_share === "" ? null : Number(f.engineer_parts_share),
      fee_bearer: f.fee_bearer || null, reason: f.reason || null,
    };
    const { data: u } = await supabase.auth.getUser();
    const q = initial.id ? supabase.from("payment_overrides").update(row).eq("id", initial.id)
      : supabase.from("payment_overrides").insert({ ...row, created_by: u?.user?.id || null });
    const { error } = await q;
    if (error) setErr(error.message); else onSaved();
  };
  return (
    <Modal title={initial.id ? "Edit override" : "Add override"} onClose={onClose}>
      <Fl label="Engineer"><select style={inp} value={f.engineer_id} onChange={(e) => set("engineer_id", e.target.value)}><option value="">All engineers</option>{engineers.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></Fl>
      <Fl label="Plan"><select style={inp} value={f.plan} onChange={(e) => set("plan", e.target.value)}><option value="">Both plans</option><option value="repair_protection">Repair + protection</option><option value="repair_only">Repair only</option></select></Fl>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Fl label="Engineer share of callout (%) — blank = default"><input type="number" step="0.01" style={inp} value={f.engineer_callout_share} onChange={(e) => set("engineer_callout_share", e.target.value)} /></Fl>
        <Fl label="Engineer share of parts (%) — blank = default"><input type="number" step="0.01" style={inp} value={f.engineer_parts_share} onChange={(e) => set("engineer_parts_share", e.target.value)} /></Fl>
      </div>
      <Fl label="Stripe card fees"><select style={inp} value={f.fee_bearer} onChange={(e) => set("fee_bearer", e.target.value)}><option value="">Default</option>{Object.entries(FEE_BEARER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Fl>
      <Fl label="Reason"><input style={inp} value={f.reason} onChange={(e) => set("reason", e.target.value)} placeholder="e.g. Pilot terms" /></Fl>
      <ErrorLine msg={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}><Btn onClick={save}>Save</Btn><Btn variant="ghost" onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

// Fault reasons, refund reasons and flag categories share one editor.
const REASON_LISTS = [
  { table: "fault_reasons", title: "Fault reasons", help: "Picked when a job is marked uncollectable. Engineer-at-fault reasons recover EasyRepair's commission from the engineer.", tag: "engineer_at_fault", tagOptions: [[true, "Engineer at fault"], [false, "Not the engineer's fault"]] },
  { table: "refund_reasons", title: "Refund reasons", help: "Picked when a customer is refunded. Decides whether EasyRepair gives back its commission (in proportion on partial refunds).", tag: "commission_outcome", tagOptions: [["refund", "Refund commission"], ["keep", "Keep commission"]] },
  { table: "flag_categories", title: "Flag categories", help: "What engineers choose from when they flag a problem or dispute a decision in the Portal.", tag: "applies_to", tagOptions: [["problem", "Flag a problem"], ["dispute", "Dispute a decision"], ["both", "Both"]] },
];

function ReasonLists() {
  const [which, setWhich] = useState("fault_reasons");
  const cfg = REASON_LISTS.find((r) => r.table === which);
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {REASON_LISTS.map((r) => <Btn key={r.table} variant={which === r.table ? "primary" : "ghost"} sm onClick={() => setWhich(r.table)}>{r.title}</Btn>)}
      </div>
      <ReasonListManager key={cfg.table} {...cfg} />
    </div>
  );
}

export function ReasonListManager({ table, title, help, tag, tagOptions }) {
  const { rows, error, reload } = useTable(table);
  const [showArchived, setShowArchived] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newTag, setNewTag] = useState(String(tagOptions[0][0]));
  const [editing, setEditing] = useState(null); // {id, label}
  const [err, setErr] = useState("");
  const parseTag = (v) => (v === "true" ? true : v === "false" ? false : v);
  const tagLabel = (v) => tagOptions.find(([k]) => String(k) === String(v))?.[1] || String(v);
  const visible = rows.filter((r) => showArchived || r.active);
  const add = async () => {
    if (!newLabel.trim()) return;
    const { data: u } = await supabase.auth.getUser();
    const max = rows.reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
    const { error } = await supabase.from(table).insert({ label: newLabel.trim(), [tag]: parseTag(newTag), sort_order: max + 1, created_by: u?.user?.id || null });
    if (error) setErr(error.message); else { setNewLabel(""); setErr(""); reload(); }
  };
  const update = async (id, patch) => { const { error } = await supabase.from(table).update(patch).eq("id", id); if (error) setErr(error.message); else reload(); };
  const move = async (i, dir) => {
    const list = rows.filter((r) => r.active);
    const a = list[i], b = list[i + dir];
    if (!a || !b) return;
    await supabase.from(table).update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from(table).update({ sort_order: a.sort_order === b.sort_order ? a.sort_order + dir : a.sort_order }).eq("id", b.id);
    reload();
  };
  return (
    <div>
      <div style={{ fontSize: 13, color: C.mid, marginBottom: 10 }}>{help} Removing a reason hides it from the dropdown; past jobs keep it.</div>
      <ErrorLine msg={error || err} />
      <div style={{ background: C.card, borderRadius: 13, border: `1px solid ${C.border}`, overflow: "hidden", marginBottom: 12 }}>
        {visible.length === 0 && <div style={{ padding: 14, color: C.light, fontSize: 13 }}>No {title.toLowerCase()} yet.</div>}
        {visible.map((r) => {
          const activeIndex = rows.filter((x) => x.active).findIndex((x) => x.id === r.id);
          return (
            <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${C.border}`, opacity: r.active ? 1 : 0.5 }}>
              {r.active && <div style={{ display: "flex", flexDirection: "column" }}>
                <button onClick={() => move(activeIndex, -1)} style={{ background: "none", border: "none", color: C.mid, cursor: "pointer", fontSize: 10, padding: 0 }} title="Move up">▲</button>
                <button onClick={() => move(activeIndex, 1)} style={{ background: "none", border: "none", color: C.mid, cursor: "pointer", fontSize: 10, padding: 0 }} title="Move down">▼</button>
              </div>}
              <div style={{ flex: 1 }}>
                {editing?.id === r.id
                  ? <input style={inp} value={editing.label} autoFocus onChange={(e) => setEditing({ ...editing, label: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { update(r.id, { label: editing.label.trim() }); setEditing(null); } }} />
                  : <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>}
              </div>
              <select style={{ ...inp, width: 190 }} value={String(r[tag])} onChange={(e) => update(r.id, { [tag]: parseTag(e.target.value) })}>
                {tagOptions.map(([k, v]) => <option key={String(k)} value={String(k)}>{v}</option>)}
              </select>
              {editing?.id === r.id
                ? <Btn sm onClick={() => { update(r.id, { label: editing.label.trim() }); setEditing(null); }}>Save</Btn>
                : <Btn variant="ghost" sm onClick={() => setEditing({ id: r.id, label: r.label })}>Rename</Btn>}
              <Btn variant={r.active ? "danger" : "success"} sm onClick={() => update(r.id, { active: !r.active })}>{r.active ? "Remove" : "Restore"}</Btn>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input style={{ ...inp, flex: 1, minWidth: 220 }} placeholder={`New ${title.toLowerCase().replace(/s$/, "")}…`} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <select style={{ ...inp, width: 190 }} value={newTag} onChange={(e) => setNewTag(e.target.value)}>{tagOptions.map(([k, v]) => <option key={String(k)} value={String(k)}>{v}</option>)}</select>
        <Btn onClick={add}>Add</Btn>
        <label style={{ fontSize: 12, color: C.mid, display: "flex", gap: 5, alignItems: "center" }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show removed</label>
      </div>
      <div style={{ fontSize: 11, color: C.light, marginTop: 6 }}>Currently {rows.filter((r) => r.active).length} in use · tags: {tagOptions.map(([k]) => `${tagLabel(k)} ${rows.filter((r) => r.active && String(r[tag]) === String(k)).length}`).join(" · ")}</div>
    </div>
  );
}

function VatGoLiveForm({ settings, onSaved }) {
  const fields = [["vat_registered", "bool"], ["vat_rate", "num"], ["vat_threshold_pence", "pence"], ["payments_live", "bool"]];
  const { form, set, save, busy, msg, err } = useSettingsForm(settings, fields, onSaved);
  return (
    <div>
      <div style={box()}>
        <div style={label()}>VAT</div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 10 }}>
          <input type="checkbox" checked={!!form.vat_registered} onChange={(e) => set("vat_registered", e.target.checked)} /> EasyRepair is VAT registered (adds VAT to commission and plan prices)
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
          <Fl label="VAT rate (%)"><input type="number" style={inp} value={form.vat_rate} onChange={(e) => set("vat_rate", e.target.value)} /></Fl>
          <Fl label="Registration threshold (£)">{moneyInput(form.vat_threshold_pence, (v) => set("vat_threshold_pence", v))}</Fl>
        </div>
        <div style={{ fontSize: 12, color: C.mid }}>Your rolling 12-month turnover against this threshold is shown on Bookings → Payments. Check the current threshold with your accountant.</div>
      </div>
      <div style={{ ...box(), border: `1px solid ${form.payments_live ? C.success : C.warn}55` }}>
        <div style={label()}>Go live</div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={!!form.payments_live} onChange={(e) => set("payments_live", e.target.checked)} /> Payments are live (switches on charging, payment links, refunds and engineer Stripe setup)
        </label>
        <div style={{ fontSize: 12, color: C.warn, marginTop: 8 }}>Only switch this on once the Stripe account, Connect and the payments Edge Function are set up and tested in test mode.</div>
      </div>
      <Btn onClick={() => save()}>{busy ? "Saving…" : "Save"}</Btn>
      {msg && <div style={{ color: C.success, fontSize: 12, marginTop: 8 }}>{msg}</div>}
      <ErrorLine msg={err} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  JOB PAYMENT PANEL (inside JobDetail)
// ═══════════════════════════════════════════════════════════════════════════
// ─── Job status quick actions (FixFlow booking view) ─────────────────────────
// Lets the office do what an engineer does from the Portal: record that the
// customer has paid (cash / outside Stripe) and mark the job completed.
// Card jobs and Pay after repair jobs can be completed straight away when
// payments are live (or on test bookings); completing them then charges the
// saved card or sends the payment link, exactly as the Portal does.
const CLOSED = ["Completed", "Beyond Repair", "Cancelled"];
export function JobStatusActions({ job, onChanged }) {
  const { settings } = usePaymentSettings();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null); // { kind: "ok" | "err", text }
  const live = !!settings.payments_live || !!job.isTest;
  const autoPay = live && !job.isExternal && (job.hasSavedCard || job.paymentTiming === "after");
  const closed = CLOSED.includes(job.status);

  const togglePaid = async () => {
    if (busy) return;
    setBusy("paid"); setMsg(null);
    const on = !job.paymentTaken;
    const { error } = await supabase.from("bookings").update({ payment_taken: on, payment_taken_at: on ? new Date().toISOString() : null }).eq("id", job.id);
    setBusy("");
    if (error) setMsg({ kind: "err", text: error.message }); else await onChanged?.();
  };

  const complete = async () => {
    if (busy) return;
    setMsg(null);
    if (job.partsApprovalStatus === "pending") { setMsg({ kind: "err", text: "The customer hasn't approved the parts yet. Approve or decline them in Customer payment first." }); return; }
    if (!job.paymentTaken && !autoPay) { setMsg({ kind: "err", text: "Record the payment first (Payment taken), or use a card / Pay after repair booking once payments are live." }); return; }
    setBusy("complete");
    const { error } = await supabase.from("bookings").update({ status: "Completed", completed_date: new Date().toISOString().slice(0, 10) }).eq("id", job.id);
    if (error) { setBusy(""); setMsg({ kind: "err", text: error.message }); return; }
    if (autoPay) {
      try {
        const res = await callPayments("job_completed", { bookingId: job.id });
        const r = res?.job;
        if (r && typeof r === "object" && r.ok === false) setMsg({ kind: "err", text: `Completed. The card was declined (${r.reason}), so a payment link was created instead.` });
        else if (r && typeof r === "object" && r.url) setMsg({ kind: "ok", text: "Completed. A payment link was created for the customer." });
        else if (r && typeof r === "object" && r.ok) setMsg({ kind: "ok", text: "Completed and the saved card was charged." });
        else if (r === "waiting for parts approval") setMsg({ kind: "ok", text: "Completed. The card will be charged once the parts are approved." });
        else setMsg({ kind: "ok", text: "Completed." });
      } catch (e) { setMsg({ kind: "err", text: `Completed, but payment didn't start: ${e.message}` }); }
    } else setMsg({ kind: "ok", text: "Completed." });
    setBusy("");
    await onChanged?.();
  };

  return (
    <div style={{ ...box(), border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: .4, marginBottom: 10 }}>Job status</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <Btn sm variant={job.paymentTaken ? "success" : "ghost"} disabled={!!busy} onClick={togglePaid}>{job.paymentTaken ? "✓ Payment taken" : "Payment taken"}</Btn>
        {!closed && <Btn sm disabled={!!busy} onClick={complete}>{busy === "complete" ? "Completing…" : "Mark completed"}</Btn>}
        {closed && <Pill>{job.status}</Pill>}
        {autoPay && !closed && <span style={{ fontSize: 12, color: C.mid }}>{job.hasSavedCard ? "Completing charges the saved card." : "Completing creates the customer's payment link."}</span>}
      </div>
      {!autoPay && !closed && <div style={{ fontSize: 12, color: C.light, marginTop: 8 }}>{job.isExternal
        ? "External SP job: send the customer a payment link below. The job closes by itself once they pay. Use \"Payment taken\" only if they paid another way."
        : "Use \"Payment taken\" only when the customer paid outside Stripe."}</div>}
      {msg && <div style={{ fontSize: 13, marginTop: 8, color: msg.kind === "err" ? C.danger : C.success }}>{msg.text}</div>}
    </div>
  );
}

export function JobPaymentPanel({ job, engineers = [], isOwner, onChanged }) {
  const { settings, loaded } = usePaymentSettings();
  const { rows: overrides } = useTable("payment_overrides", { order: "created_at" });
  const { rows: faultReasons } = useTable("fault_reasons");
  const { rows: refundReasons } = useTable("refund_reasons");
  const flagsFilter = useCallback((q) => q.eq("booking_id", job.id), [job.id]);
  const { rows: flags } = useTable("job_flags", { order: "created_at", filter: flagsFilter });
  const recFilter = useCallback((q) => q.eq("booking_id", job.id), [job.id]);
  const { rows: recoveries, reload: reloadRec } = useTable("commission_recoveries", { order: "created_at", filter: recFilter });
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  if (!loaded) return null;
  // External SP jobs: one-off payment link to EasyRepair's account, SP paid by bank transfer.
  if (job.isExternal) return <ExternalJobPaymentPanel job={job} settings={settings} onChanged={onChanged} />;

  // Test bookings can use Stripe (test keys) before payments go live for everyone.
  const live = settings.payments_live || !!job.isTest;
  const route = paymentRoute(job);
  const m = jobMoney(job, settings, overrides);
  const mIfApproved = jobMoney(job, settings, overrides, { includePending: true });
  const eng = engineers.find((e) => e.id === job.engineerId);
  const faultReason = faultReasons.find((r) => r.id === job.faultReasonId);
  const refundReason = refundReasons.find((r) => r.id === job.refundReasonId);

  const patch = async (p, what) => {
    setBusy(what); setErr("");
    const { error } = await supabase.from("bookings").update(p).eq("id", job.id);
    setBusy("");
    if (error) { setErr(error.message); return false; }
    await onChanged?.();
    return true;
  };
  const viaStripe = async (action, body, what) => {
    setBusy(what); setErr("");
    try { await callPayments(action, { bookingId: job.id, ...body }); await onChanged?.(); }
    catch (e) { setErr(e.message); }
    setBusy("");
  };

  const fee = job.cancellationFeeType ? { total: job.cancellationFeePence, engineer: job.feeEngineerSharePence } : null;

  return (
    <div style={{ ...box(), border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: .4 }}>Customer payment</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Pill color={route === "unknown" ? C.light : C.blue} bg={route === "unknown" ? undefined : C.blueLight}>{ROUTE_LABELS[route]}</Pill>
          <PayStatusPill status={job.paymentStatus} />
          {!live && <Pill color={C.warn} bg={C.warnLight}>Payments not live</Pill>}
        </div>
      </div>

      {/* money */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 14 }}>
        <div>
          <Row k="Callout" v={penceToGBP(m.callout)} />
          <Row k={`Parts${job.partsApprovalStatus === "pending" ? " (awaiting approval)" : ""}`} v={job.partsApprovalStatus === "pending" ? `${penceToGBP(m.partsAll)} pending` : penceToGBP(m.partsApproved)} />
          <Row k={m.charged ? "Charged" : "Total to charge"} v={penceToGBP(m.total)} strong />
          {job.adminFeePence != null && <Row k="Late-payment admin fee" v={penceToGBP(job.adminFeePence)} />}
        </div>
        <div>
          <Row k={`Engineer (${pctLabel(m.terms.engineer_callout_share)} callout, ${pctLabel(m.terms.engineer_parts_share)} parts)`} v={penceToGBP(m.engineerNet)} color={C.primary} strong />
          <Row k="EasyRepair commission" v={penceToGBP(m.commission)} color={C.purple} />
          <Row k={`Stripe fee${m.feeIsEstimate ? " (estimate)" : ""} · ${m.engineerPaysFee ? "engineer pays" : "EasyRepair pays"}`} v={penceToGBP(m.fee)} />
          <Row k="EasyRepair keeps" v={penceToGBP(m.easyRepairNet)} color={C.purple} strong />
        </div>
      </div>
      <div style={{ fontSize: 11, color: C.light, marginTop: 6 }}>
        Terms: {m.terms.source}{job.splitOverride?.reason ? ` — ${job.splitOverride.reason}` : ""}.
        {job.partsApprovalStatus === "pending" && ` If the customer approves the parts: total ${penceToGBP(mIfApproved.total)}, engineer ${penceToGBP(mIfApproved.engineerNet)}.`}
        {job.paidAt && ` Paid ${fmtDateTime(job.paidAt)}.`}
      </div>

      <PaymentRecordBox job={job} />
      <PaymentLinkBox job={job} />

      {/* parts */}
      {(job.partsLines?.length > 0 || job.partsApprovalStatus !== "none") && (
        <div style={{ marginTop: 12 }}>
          <div style={label()}>Parts quoted by the engineer · {PARTS_STATUS_LABELS[job.partsApprovalStatus]}{job.partsApprovedAt ? ` ${fmtDateTime(job.partsApprovedAt)}${job.partsApprovalMethod ? ` (${job.partsApprovalMethod})` : ""}` : ""}</div>
          {job.partsLines.map((l, i) => <Row key={l.id || i} k={l.description || "Part"} v={penceToGBP(l.price_pence)} />)}
          {job.partsApprovalStatus === "pending" && (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <Btn variant="success" sm onClick={() => patch({ parts_approval_status: "approved", parts_approved_at: new Date().toISOString(), parts_approval_method: "Confirmed with EasyRepair by phone" }, "parts")}>Customer approved (by phone)</Btn>
              <Btn variant="danger" sm onClick={() => patch({ parts_approval_status: "declined", parts_approved_at: new Date().toISOString(), parts_approval_method: "Declined to EasyRepair by phone" }, "parts")}>Customer declined</Btn>
              <Btn variant="ghost" sm disabled={!live} onClick={() => live && viaStripe("send_parts_approval", {}, "parts")}>Resend approval link</Btn>
            </div>
          )}
        </div>
      )}

      {/* cancellation / no-show */}
      {(job.noShow || job.cancellationFeeType || job.status === "Cancelled") && (
        <div style={{ marginTop: 12 }}>
          <div style={label()}>Cancellation and no-show</div>
          {job.noShow && <div style={{ fontSize: 13, color: C.warn, marginBottom: 6 }}>Engineer recorded "Customer not home"{job.noShowAt ? ` at ${fmtDateTime(job.noShowAt)}` : ""}.</div>}
          {fee && <Row k={`${job.cancellationFeeType === "no_show" ? "No-show" : "Late cancellation"} fee · ${job.cancellationFeeStatus}`} v={`${penceToGBP(fee.total)} (engineer ${penceToGBP(fee.engineer || 0)})`} />}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {!job.cancellationFeeType && <>
              <Btn variant="ghost" sm onClick={() => { const f = cancellationFee(settings, "no_show"); patch({ cancellation_fee_type: "no_show", cancellation_fee_pence: f.total, fee_engineer_share_pence: f.engineer, cancellation_fee_status: "pending" }, "fee"); }}>Apply no-show fee ({penceToGBP(settings.no_show_fee_pence)})</Btn>
              <Btn variant="ghost" sm onClick={() => { const f = cancellationFee(settings, "late_cancel"); patch({ cancellation_fee_type: "late_cancel", cancellation_fee_pence: f.total, fee_engineer_share_pence: f.engineer, cancellation_fee_status: "pending", cancelled_at: job.cancelledAt || new Date().toISOString() }, "fee"); }}>Apply late cancellation fee ({penceToGBP(settings.late_cancel_fee_pence)})</Btn>
            </>}
            {job.cancellationFeeStatus === "pending" && <>
              <Btn sm onClick={() => live && viaStripe("charge_cancellation_fee", {}, "fee")}>Charge fee</Btn>
              <Btn variant="danger" sm onClick={() => patch({ cancellation_fee_status: "waived" }, "fee")}>Waive fee</Btn>
            </>}
            {isOwner && job.noShow && <Btn variant="ghost" sm onClick={() => patch({ no_show: false, no_show_at: null }, "fee")}>Undo no-show</Btn>}
          </div>
          {job.cancellationFeeStatus === "pending" && !live && <NotLiveNote />}
        </div>
      )}

      {/* uncollectable / refund */}
      {job.uncollectableAt && (
        <div style={{ marginTop: 12, ...box(), background: C.dangerLight }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.danger }}>Uncollectable since {fmtDateTime(job.uncollectableAt)}</div>
          <div style={{ fontSize: 12, color: C.text, marginTop: 4 }}>{job.fault === "engineer" ? "Engineer at fault" : "Not the engineer's fault"}{faultReason ? `: ${faultReason.label}` : ""}{job.faultNote ? ` — ${job.faultNote}` : ""}</div>
        </div>
      )}
      {recoveries.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={label()}>Commission recovery</div>
          {recoveries.map((r) => <Row key={r.id} k={`${r.status || "pending"}${r.reason ? ` · ${r.reason}` : ""}`} v={penceToGBP(r.amount_pence)} />)}
        </div>
      )}
      {job.refundedAt && (
        <div style={{ marginTop: 12 }}>
          <div style={label()}>Refund</div>
          <Row k={`Refunded ${fmtDateTime(job.refundedAt)}${refundReason ? ` · ${refundReason.label}` : ""}`} v={penceToGBP(job.refundAmountPence)} />
          <Row k="Commission returned to engineer" v={penceToGBP(job.commissionRefundedPence || 0)} />
        </div>
      )}

      {/* flags on this job */}
      {flags.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={label()}>Engineer flags on this job</div>
          {flags.map((f) => <Row key={f.id} k={`${f.type === "dispute" ? "Dispute" : "Problem"} · ${fmtDateTime(f.created_at)}`} v={f.status === "resolved" ? `Resolved (${f.outcome})` : f.status.replace("_", " ")} />)}
        </div>
      )}

      {/* actions */}
      <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
        {["not_charged", "outstanding"].includes(job.paymentStatus) && job.status === "Completed" && (
          <Btn sm onClick={() => live && viaStripe(job.hasSavedCard ? "charge_job" : "send_payment_link", {}, "charge")}>{job.hasSavedCard ? "Charge saved card" : "Send payment link"}</Btn>
        )}
        {job.paymentStatus === "outstanding" && job.paymentTiming === "after" && !job.adminFeeAppliedAt && (
          <Btn variant="ghost" sm onClick={() => live && viaStripe("apply_admin_fee", {}, "charge")}>Add £{(settings.admin_fee_pence / 100).toFixed(2)} admin fee &amp; resend link</Btn>
        )}
        {["outstanding", "not_charged", "disputed"].includes(job.paymentStatus) && job.status === "Completed" && !job.uncollectableAt && (
          <Btn variant="danger" sm onClick={() => setModal("uncollectable")}>Mark uncollectable</Btn>
        )}
        {job.uncollectableAt && <Btn variant="success" sm onClick={() => setModal("paidLate")}>Customer paid after all</Btn>}
        {["paid", "part_refunded"].includes(job.paymentStatus) && <Btn variant="ghost" sm onClick={() => setModal("refund")}>Refund…</Btn>}
        {isOwner && <Btn variant="ghost" sm onClick={() => setModal("split")}>Change split for this job</Btn>}
        {job.isTest && !job.hasSavedCard && <Btn variant="ghost" sm onClick={() => viaStripe("test_attach_card", {}, "charge")}>Add Stripe test card</Btn>}
        {eng && <Pill>{eng.name}: Stripe {STRIPE_STATUS_LABELS[eng.stripeStatus || "not_started"]}</Pill>}
      </div>
      {!live && <NotLiveNote />}
      {busy && <div style={{ fontSize: 12, color: C.mid, marginTop: 6 }}>Working…</div>}
      <ErrorLine msg={err} />

      {modal === "uncollectable" && <UncollectableModal job={job} money={m} reasons={faultReasons.filter((r) => r.active)} onClose={() => setModal(null)} onDone={async () => { setModal(null); await reloadRec(); await onChanged?.(); }} />}
      {modal === "paidLate" && <PaidLateModal job={job} recoveries={recoveries} onClose={() => setModal(null)} onDone={async () => { setModal(null); await reloadRec(); await onChanged?.(); }} />}
      {modal === "refund" && <RefundModal job={job} money={m} reasons={refundReasons.filter((r) => r.active)} live={live} onClose={() => setModal(null)} onDone={async () => { setModal(null); await onChanged?.(); }} />}
      {modal === "split" && <JobSplitModal job={job} terms={m.terms} onClose={() => setModal(null)} onDone={async () => { setModal(null); await onChanged?.(); }} />}
    </div>
  );
}

// Payment record (once Stripe has confirmed the payment).
function PaymentRecordBox({ job }) {
  if (!job.stripePaymentIntentId || !["paid", "refunded", "part_refunded"].includes(job.paymentStatus)) return null;
  return (
    <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}` }}>
      <div style={label()}>Payment record</div>
      <Row k="Paid" v={job.paidAt ? fmtDateTime(job.paidAt) : "—"} />
      <Row k="How" v={[PAID_VIA_LABELS[job.paidVia] || "Stripe", cardLabel(job)].filter(Boolean).join(" · ")} />
      <Row k="Stripe reference" v={<span style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all" }}>{job.stripePaymentIntentId}</span>} />
      {job.stripeLivemode === false || job.stripeLivemode == null ? <div style={{ fontSize: 11, color: C.light, marginTop: 2 }}>Test payment (Stripe sandbox)</div> : null}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <Btn variant="ghost" sm onClick={() => navigator.clipboard?.writeText(job.stripePaymentIntentId)}>Copy reference</Btn>
        {stripePaymentUrl(job) && <Btn variant="ghost" sm onClick={() => window.open(stripePaymentUrl(job), "_blank", "noopener")}>View in Stripe</Btn>}
      </div>
    </div>
  );
}

// Customer's payment link (Pay after repair, a declined card, or an external SP job).
function PaymentLinkBox({ job }) {
  if (!job.paymentLinkUrl || ["paid", "refunded", "part_refunded"].includes(job.paymentStatus)) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={label()}>Customer's payment link</div>
      <div style={{ fontSize: 12, color: C.mid, wordBreak: "break-all", marginBottom: 6 }}>{job.paymentLinkUrl}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Btn variant="ghost" sm onClick={() => navigator.clipboard?.writeText(job.paymentLinkUrl)}>Copy link</Btn>
        <Btn variant="ghost" sm onClick={() => window.open(job.paymentLinkUrl, "_blank", "noopener")}>Open link</Btn>
      </div>
    </div>
  );
}

// ─── External SP job: one-off payment link ─────────────────────────────────
// Staff enter the call-out and parts amounts and what the SP is owed, then
// send the customer a link to pay EasyRepair's own Stripe account (no Connect
// split). Once paid, the SP payout shows as owed until it's marked paid here.
const SEND_OPTIONS = [["both", "Text and email"], ["sms", "Text only"], ["email", "Email only"], ["none", "Just create the link (I'll send it)"]];
const toPounds = (p) => (p == null ? "" : (Number(p) / 100).toFixed(2));

function ExternalJobPaymentPanel({ job, settings, onChanged }) {
  const { rows: refundReasons } = useTable("refund_reasons");
  const paid = ["paid", "refunded", "part_refunded"].includes(job.paymentStatus);
  const closed = CLOSED.includes(job.status);
  const live = !!settings.payments_live || !!job.isTest;
  const [f, setF] = useState({
    callout: toPounds(job.extCalloutPence), parts: toPounds(job.extPartsPence),
    partsDescription: job.extPartsDescription || "", payout: toPounds(job.spPayoutPence),
    outcome: job.pendingOutcome === "Beyond Repair" ? "Beyond Repair" : "Completed", method: "both",
  });
  const [payRef, setPayRef] = useState(job.spPayoutRef || "");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [modal, setModal] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const calloutP = poundsToPence(f.callout || 0), partsP = poundsToPence(f.parts || 0), payoutP = poundsToPence(f.payout || 0);
  const draftTotal = calloutP + partsP;
  const m = jobMoney(job, settings);
  const hasAmounts = job.extCalloutPence != null;
  const sp = [job.externalName, job.externalCompany].filter(Boolean).join(" · ") || "External SP";

  const send = async () => {
    setErr(""); setMsg("");
    if (f.callout === "") { setErr("Enter the call-out fee."); return; }
    if (draftTotal < 50) { setErr("The total must be at least £0.50."); return; }
    if (payoutP > draftTotal) { setErr("The SP payout can't be more than the customer pays."); return; }
    setBusy("send");
    try {
      const r = await callPayments("send_external_link", {
        bookingId: job.id, calloutPence: calloutP, partsPence: partsP, partsDescription: f.partsDescription,
        spPayoutPence: payoutP, outcome: f.outcome, method: f.method,
      });
      if (r?.url) navigator.clipboard?.writeText(r.url).catch?.(() => {});
      const s = r?.sent;
      if (r?.error) setErr(r.error);
      else if (!s) setMsg(`Link created for ${penceToGBP(r.totalPence)} and copied to the clipboard.`);
      else {
        const parts = [s.sms === true && "texted", s.email === true && "emailed"].filter(Boolean).join(" and ");
        const failed = [s.sms === false && "text", s.email === false && "email"].filter(Boolean).join(" and ");
        setMsg(`Link for ${penceToGBP(r.totalPence)} ${parts} to the customer${failed ? ` (the ${failed} failed)` : ""}. It's also copied to the clipboard.`);
      }
      await onChanged?.();
    } catch (e) { setErr(e.message); }
    setBusy("");
  };
  const adminFee = async () => {
    setBusy("fee"); setErr(""); setMsg("");
    try { await callPayments("apply_admin_fee", { bookingId: job.id }); setMsg("Admin fee added and the link resent."); await onChanged?.(); }
    catch (e) { setErr(e.message); }
    setBusy("");
  };
  const patch = async (p) => {
    setBusy("payout"); setErr("");
    const { error } = await supabase.from("bookings").update(p).eq("id", job.id);
    setBusy("");
    if (error) setErr(error.message); else await onChanged?.();
  };

  return (
    <div style={{ ...box(), border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.text, textTransform: "uppercase", letterSpacing: .4 }}>Customer payment · External SP</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Pill color={C.blue} bg={C.blueLight}>Paid to EasyRepair</Pill>
          <PayStatusPill status={job.paymentStatus} />
          {!live && <Pill color={C.warn} bg={C.warnLight}>Payments not live</Pill>}
        </div>
      </div>
      <div style={{ fontSize: 12, color: C.mid, marginBottom: 10 }}>{sp} isn't on Stripe, so the customer pays EasyRepair and you pay the SP by bank transfer.</div>

      {/* amounts + send */}
      {!paid && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            <Fl label="Call-out fee (£)">{moneyInput(f.callout, set("callout"))}</Fl>
            <Fl label="Parts (£)">{moneyInput(f.parts, set("parts"))}</Fl>
            <Fl label="Owed to the SP (£)">{moneyInput(f.payout, set("payout"))}</Fl>
          </div>
          <Fl label="Parts description (shown on the customer's checkout, optional)"><input style={inp} value={f.partsDescription} maxLength={200} onChange={(e) => set("partsDescription")(e.target.value)} placeholder="e.g. Drain pump" /></Fl>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
            {!closed && <Fl label="When paid, close the job as"><select style={inp} value={f.outcome} onChange={(e) => set("outcome")(e.target.value)}><option value="Completed">Repaired (Completed)</option><option value="Beyond Repair">Beyond repair</option></select></Fl>}
            <Fl label="Send the link by"><select style={inp} value={f.method} onChange={(e) => set("method")(e.target.value)}>{SEND_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Fl>
          </div>
          <div style={{ fontSize: 13, color: C.mid, margin: "4px 0 10px" }}>
            Customer pays <b style={{ color: C.text }}>{penceToGBP(draftTotal)}</b>
            {f.outcome === "Beyond Repair" && partsP > 0 && !closed ? " (parts aren't charged on a beyond-repair job)" : ""}
            {" · "}SP {penceToGBP(payoutP)} · Stripe fee about {penceToGBP(draftTotal > 0 ? Math.round(draftTotal * 0.015) + 20 : 0)} · EasyRepair keeps about <b style={{ color: C.purple }}>{penceToGBP(draftTotal - payoutP - (draftTotal > 0 ? Math.round(draftTotal * 0.015) + 20 : 0))}</b>
          </div>
          <Btn sm disabled={!!busy || !live} onClick={send}>{busy === "send" ? "Sending…" : hasAmounts ? "Update amounts & resend link" : "Generate & send payment link"}</Btn>
          {!live && <NotLiveNote />}
        </div>
      )}

      {/* money once set */}
      {hasAmounts && (
        <div style={{ marginTop: 12 }}>
          <Row k="Call-out" v={penceToGBP(m.callout)} />
          <Row k={`Parts${job.extPartsDescription ? ` · ${job.extPartsDescription}` : ""}`} v={penceToGBP(m.partsApproved)} />
          {m.adminFee > 0 && <Row k="Late-payment admin fee" v={penceToGBP(m.adminFee)} />}
          <Row k={paid ? "Customer paid" : "Customer to pay"} v={penceToGBP(m.total)} strong />
          <Row k="Owed to the SP (bank transfer)" v={penceToGBP(m.engineerNet)} color={C.primary} strong />
          <Row k={`Stripe fee${m.feeIsEstimate ? " (estimate)" : ""} · EasyRepair pays`} v={penceToGBP(m.fee)} />
          <Row k="EasyRepair keeps" v={penceToGBP(m.easyRepairNet)} color={C.purple} strong />
        </div>
      )}

      <PaymentRecordBox job={job} />
      <PaymentLinkBox job={job} />

      {/* SP payout */}
      {paid && Number(job.spPayoutPence || 0) > 0 && (
        <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: job.spPayoutStatus === "paid" ? C.successLight : C.warnLight, border: `1px solid ${C.border}` }}>
          <div style={label()}>SP payout · {sp}</div>
          {job.spPayoutStatus === "paid" ? (
            <>
              <div style={{ fontSize: 13, color: C.success, fontWeight: 700 }}>{penceToGBP(job.spPayoutPence)} paid {job.spPaidAt ? fmtDateTime(job.spPaidAt) : ""}{job.spPayoutRef ? ` · ref ${job.spPayoutRef}` : ""}</div>
              <Btn variant="ghost" sm style={{ marginTop: 8 }} disabled={!!busy} onClick={() => patch({ sp_payout_status: "owed", sp_paid_at: null })}>Undo</Btn>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: C.warn, fontWeight: 700, marginBottom: 8 }}>{penceToGBP(job.spPayoutPence)} owed to the SP</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input style={{ ...inp, maxWidth: 240 }} value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Bank transfer reference (optional)" />
                <Btn variant="success" sm disabled={!!busy} onClick={() => patch({ sp_payout_status: "paid", sp_paid_at: new Date().toISOString(), sp_payout_ref: payRef.trim() || null })}>Mark SP paid</Btn>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
        {job.paymentStatus === "outstanding" && hasAmounts && !job.adminFeeAppliedAt && (
          <Btn variant="ghost" sm disabled={!!busy || !live} onClick={adminFee}>Add £{(settings.admin_fee_pence / 100).toFixed(2)} admin fee &amp; resend link</Btn>
        )}
        {["paid", "part_refunded"].includes(job.paymentStatus) && <Btn variant="ghost" sm onClick={() => setModal("refund")}>Refund…</Btn>}
      </div>
      {msg && <div style={{ fontSize: 13, color: C.success, marginTop: 8 }}>{msg}</div>}
      <ErrorLine msg={err} />
      {modal === "refund" && <RefundModal job={job} money={m} reasons={refundReasons.filter((r) => r.active)} live={live} onClose={() => setModal(null)} onDone={async () => { setModal(null); await onChanged?.(); }} />}
    </div>
  );
}

function UncollectableModal({ job, money, reasons, onClose, onDone }) {
  const [reasonId, setReasonId] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState((money.commission / 100).toFixed(2));
  const [err, setErr] = useState("");
  const reason = reasons.find((r) => r.id === reasonId);
  const save = async () => {
    if (!reason) { setErr("Choose a reason."); return; }
    const { data: u } = await supabase.auth.getUser();
    const uid = u?.user?.id || null;
    const { error } = await supabase.from("bookings").update({
      uncollectable_at: new Date().toISOString(), payment_status: "uncollectable",
      fault: reason.engineer_at_fault ? "engineer" : "not_engineer", fault_reason_id: reason.id, fault_note: note || null, fault_set_by: uid,
    }).eq("id", job.id);
    if (error) { setErr(error.message); return; }
    if (reason.engineer_at_fault && job.engineerId && poundsToPence(amount) > 0) {
      const { error: e2 } = await supabase.from("commission_recoveries").insert({ booking_id: job.id, engineer_id: job.engineerId, amount_pence: poundsToPence(amount), reason: reason.label, created_by: uid });
      if (e2) { setErr(e2.message); return; }
    }
    onDone();
  };
  return (
    <Modal title={`Mark ${jobRef(job)} uncollectable`} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.mid, marginBottom: 12 }}>The engineer always loses their own share. If the engineer was at fault, they also repay EasyRepair's commission, recovered from their next paid job(s).</div>
      <Fl label="Reason"><select style={inp} value={reasonId} onChange={(e) => setReasonId(e.target.value)}><option value="">Choose…</option>{reasons.map((r) => <option key={r.id} value={r.id}>{r.engineer_at_fault ? "Engineer at fault: " : "Not engineer's fault: "}{r.label}</option>)}</select></Fl>
      {reason?.engineer_at_fault && <Fl label="Commission to recover from the engineer (£)">{moneyInput(amount, setAmount)}</Fl>}
      <Fl label="Note (shown to the engineer)"><textarea style={ta} value={note} onChange={(e) => setNote(e.target.value)} /></Fl>
      <ErrorLine msg={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}><Btn variant="danger" onClick={save}>Mark uncollectable</Btn><Btn variant="ghost" onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

function PaidLateModal({ job, recoveries, onClose, onDone }) {
  const [err, setErr] = useState("");
  const save = async () => {
    const { error } = await supabase.from("bookings").update({ payment_status: "paid", paid_at: new Date().toISOString(), uncollectable_at: null }).eq("id", job.id);
    if (error) { setErr(error.message); return; }
    for (const r of recoveries) {
      if (["pending", "paused"].includes(r.status)) await supabase.from("commission_recoveries").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", r.id);
      if (["recovered", "invoiced"].includes(r.status)) await supabase.from("commission_recoveries").update({ status: "refunded", updated_at: new Date().toISOString() }).eq("id", r.id);
    }
    onDone();
  };
  return (
    <Modal title="Customer paid after all" onClose={onClose}>
      <div style={{ fontSize: 13, color: C.mid }}>This marks the job paid. Any commission recovery still waiting is cancelled, and any commission already recovered from the engineer is marked to be returned to them.</div>
      <ErrorLine msg={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}><Btn variant="success" onClick={save}>Mark paid</Btn><Btn variant="ghost" onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

function RefundModal({ job, money, reasons, live, onClose, onDone }) {
  const [reasonId, setReasonId] = useState("");
  const [amount, setAmount] = useState((money.total / 100).toFixed(2));
  const [alreadyDone, setAlreadyDone] = useState(!live);
  const [err, setErr] = useState("");
  const reason = reasons.find((r) => r.id === reasonId);
  const refundP = poundsToPence(amount);
  const commissionBack = !money.external && reason?.commission_outcome === "refund" ? Math.round(money.commission * Math.min(1, refundP / Math.max(money.total, 1))) : 0;
  const save = async () => {
    if (!reason) { setErr("Choose a reason."); return; }
    if (refundP <= 0 || refundP > money.total) { setErr(`Enter an amount between £0.01 and ${penceToGBP(money.total)}.`); return; }
    const { data: u } = await supabase.auth.getUser();
    if (!alreadyDone) {
      try { await callPayments("refund", { bookingId: job.id, amountPence: refundP, refundReasonId: reason.id, refundCommission: reason.commission_outcome === "refund" }); onDone(); }
      catch (e) { setErr(e.message); }
      return;
    }
    const { error } = await supabase.from("bookings").update({
      refund_reason_id: reason.id, refund_amount_pence: refundP, commission_refunded_pence: commissionBack,
      refunded_at: new Date().toISOString(), refunded_by: u?.user?.id || null, refund_source: "admin",
      payment_status: refundP >= money.total ? "refunded" : "part_refunded",
    }).eq("id", job.id);
    if (error) setErr(error.message); else onDone();
  };
  return (
    <Modal title={`Refund ${jobRef(job)}`} onClose={onClose}>
      <Fl label="Reason"><select style={inp} value={reasonId} onChange={(e) => setReasonId(e.target.value)}><option value="">Choose…</option>{reasons.map((r) => <option key={r.id} value={r.id}>{r.commission_outcome === "refund" ? "Refund commission: " : "Keep commission: "}{r.label}</option>)}</select></Fl>
      <Fl label={`Amount to refund (£, up to ${penceToGBP(money.total)})`}>{moneyInput(amount, setAmount)}</Fl>
      {reason && money.external && <div style={{ fontSize: 13, color: C.mid, marginBottom: 10 }}>External SP job: the whole refund comes from EasyRepair's Stripe balance. Recover any share from the SP yourself if needed.</div>}
      {reason && !money.external && <div style={{ fontSize: 13, color: C.mid, marginBottom: 10 }}>EasyRepair commission returned: <b style={{ color: C.text }}>{penceToGBP(commissionBack)}</b> of {penceToGBP(money.commission)}. The rest of the refund comes from the engineer's Stripe balance.</div>}
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.mid }}>
        <input type="checkbox" checked={alreadyDone} disabled={!live} onChange={(e) => setAlreadyDone(e.target.checked)} /> Just record it: the refund was already made in Stripe{!live ? " (payments aren't live yet)" : ""}
      </label>
      <ErrorLine msg={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}><Btn onClick={save}>{alreadyDone ? "Record refund" : "Refund customer"}</Btn><Btn variant="ghost" onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

function JobSplitModal({ job, terms, onClose, onDone }) {
  const [f, setF] = useState({ engineer_callout_share: terms.engineer_callout_share, engineer_parts_share: terms.engineer_parts_share, fee_bearer: terms.fee_bearer, reason: job.splitOverride?.reason || "" });
  const [err, setErr] = useState("");
  const save = async (clear) => {
    if (!clear && !f.reason.trim()) { setErr("Add a reason so the change is logged."); return; }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("bookings").update({
      split_override: clear ? null : { engineer_callout_share: Number(f.engineer_callout_share), engineer_parts_share: Number(f.engineer_parts_share), fee_bearer: f.fee_bearer, reason: f.reason.trim(), set_by: u?.user?.id || null, set_at: new Date().toISOString() },
    }).eq("id", job.id);
    if (error) setErr(error.message); else onDone();
  };
  return (
    <Modal title={`Split for ${jobRef(job)}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.mid, marginBottom: 12 }}>Applies to this job only. The engineer sees the new amount in the Portal.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Fl label="Engineer share of callout (%)"><input type="number" step="0.01" style={inp} value={f.engineer_callout_share} onChange={(e) => setF({ ...f, engineer_callout_share: e.target.value })} /></Fl>
        <Fl label="Engineer share of parts (%)"><input type="number" step="0.01" style={inp} value={f.engineer_parts_share} onChange={(e) => setF({ ...f, engineer_parts_share: e.target.value })} /></Fl>
      </div>
      <Fl label="Stripe card fees"><select style={inp} value={f.fee_bearer} onChange={(e) => setF({ ...f, fee_bearer: e.target.value })}>{Object.entries(FEE_BEARER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Fl>
      <Fl label="Reason"><input style={inp} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Fl>
      <ErrorLine msg={err} />
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <Btn onClick={() => save(false)}>Save</Btn>
        {job.splitOverride && <Btn variant="ghost" onClick={() => save(true)}>Remove override</Btn>}
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  DISPUTES & PROBLEMS QUEUE
// ═══════════════════════════════════════════════════════════════════════════
export function DisputesView({ jobs = [], engineers = [], onOpenJob }) {
  const [tab, setTab] = useState("open");
  const { rows: flags, error, reload } = useTable("job_flags", { order: "created_at" });
  const { rows: categories } = useTable("flag_categories");
  const [sel, setSel] = useState(null);
  useEffect(() => {
    const ch = supabase.channel("job-flags-queue").on("postgres_changes", { event: "*", schema: "public", table: "job_flags" }, reload).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [reload]);
  const list = flags.filter((f) => (tab === "open" ? f.status === "open" : tab === "review" ? f.status === "under_review" : f.status === "resolved")).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  const count = (s) => flags.filter((f) => f.status === s).length;
  const jobOf = (f) => jobs.find((j) => j.id === f.booking_id);
  const engOf = (f) => engineers.find((e) => e.id === f.engineer_id);
  const catOf = (f) => categories.find((c) => c.id === f.category_id);
  return (
    <div>
      <h1 style={{ margin: "0 0 6px", fontSize: 19, fontWeight: 900, color: C.text }}>Disputes &amp; problems</h1>
      <div style={{ fontSize: 13, color: C.mid, marginBottom: 14 }}>Problems and disputes flagged by engineers in the Portal. Engineers see the outcome and your note in the Portal.</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[["open", `Open (${count("open")})`], ["review", `Under review (${count("under_review")})`], ["resolved", `Resolved (${count("resolved")})`]].map(([k, l]) => (
          <Btn key={k} variant={tab === k ? "primary" : "ghost"} sm onClick={() => setTab(k)}>{l}</Btn>
        ))}
      </div>
      <ErrorLine msg={error} />
      <div style={{ background: C.card, borderRadius: 13, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        {list.length === 0 && <div style={{ padding: 16, color: C.light, fontSize: 13 }}>Nothing here.</div>}
        {list.map((f) => {
          const j = jobOf(f); const e = engOf(f); const c = catOf(f);
          return (
            <div key={f.id} onClick={() => setSel(f)} style={{ padding: "11px 16px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <Pill color={f.type === "dispute" ? C.danger : C.warn} bg={f.type === "dispute" ? C.dangerLight : C.warnLight}>{f.type === "dispute" ? "Dispute" : f.type === "refund_review" ? "Refund to review" : "Problem"}</Pill>
                  <span style={{ fontWeight: 800, fontSize: 13 }}>{j ? `${jobRef(j)} ${j.customer}` : "Booking"}</span>
                  <span style={{ fontSize: 12, color: C.mid }}>· {e?.name || "Engineer"} · {c?.label || "No category"}</span>
                </div>
                <div style={{ fontSize: 12, color: C.light, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 560 }}>{f.message}</div>
              </div>
              <div style={{ fontSize: 11, color: C.light, whiteSpace: "nowrap" }}>{fmtDateTime(f.created_at)}{f.outcome ? ` · ${f.outcome}` : ""}</div>
            </div>
          );
        })}
      </div>
      {sel && <FlagDetailModal flag={sel} job={jobOf(sel)} engineer={engOf(sel)} category={catOf(sel)} onOpenJob={onOpenJob} onClose={() => setSel(null)} onDone={() => { setSel(null); reload(); }} />}
    </div>
  );
}

function FlagDetailModal({ flag, job, engineer, category, onOpenJob, onClose, onDone }) {
  const [outcome, setOutcome] = useState(flag.type === "dispute" ? "upheld" : "noted");
  const [note, setNote] = useState(flag.admin_note || "");
  const [photos, setPhotos] = useState([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      const out = [];
      for (const path of flag.attachments || []) {
        const { data } = await supabase.storage.from("job-flag-photos").createSignedUrl(path, 3600);
        if (data?.signedUrl) out.push(data.signedUrl);
      }
      if (alive) setPhotos(out);
    })();
    return () => { alive = false; };
  }, [flag]);
  const markReview = async () => { await supabase.from("job_flags").update({ status: "under_review" }).eq("id", flag.id); onDone(); };
  const resolve = async () => {
    if (!note.trim()) { setErr("Add a note for the engineer explaining the outcome."); return; }
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("job_flags").update({ status: "resolved", outcome, admin_note: note.trim(), resolved_by: u?.user?.id || null, resolved_at: new Date().toISOString() }).eq("id", flag.id);
    if (error) { setErr(error.message); return; }
    if (flag.type === "dispute") {
      const { data: recs } = await supabase.from("commission_recoveries").select("*").eq("booking_id", flag.booking_id);
      const now = new Date().toISOString();
      for (const r of recs || []) {
        if (outcome === "overturned") {
          if (["pending", "paused"].includes(r.status)) await supabase.from("commission_recoveries").update({ status: "cancelled", updated_at: now }).eq("id", r.id);
          if (["recovered", "invoiced"].includes(r.status)) await supabase.from("commission_recoveries").update({ status: "refunded", updated_at: now }).eq("id", r.id);
        } else if (r.status === "paused") {
          await supabase.from("commission_recoveries").update({ status: "pending", updated_at: now }).eq("id", r.id);
        }
      }
      if (outcome === "overturned" && job?.fault === "engineer") {
        await supabase.from("bookings").update({ fault: "not_engineer", fault_note: `Overturned on dispute: ${note.trim()}` }).eq("id", flag.booking_id);
      }
    }
    onDone();
  };
  return (
    <Modal title={`${flag.type === "dispute" ? "Dispute" : "Problem"} — ${job ? jobRef(job) : "booking"}`} onClose={onClose}>
      <div style={box()}>
        <div style={label()}>From {engineer?.name || "engineer"} · {fmtDateTime(flag.created_at)} · {category?.label || "No category"}</div>
        <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{flag.message || <span style={{ color: C.light }}>No message.</span>}</div>
        {photos.length > 0 && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>{photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Attachment" style={{ width: 90, height: 90, objectFit: "cover", borderRadius: 7 }} /></a>)}</div>}
      </div>
      {job && <Btn variant="ghost" sm onClick={() => { onClose(); onOpenJob?.(job); }}>Open job {jobRef(job)} →</Btn>}
      {flag.status === "resolved" ? (
        <div style={{ ...box(), marginTop: 12 }}>
          <div style={label()}>Outcome: {flag.outcome} · {fmtDateTime(flag.resolved_at)}</div>
          <div style={{ fontSize: 13 }}>{flag.admin_note}</div>
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <Fl label="Outcome">
            <select style={inp} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {flag.type === "dispute"
                ? <><option value="upheld">Upheld — the decision stands</option><option value="overturned">Overturned — reverse the decision and return any commission recovered</option></>
                : <option value="noted">Dealt with</option>}
            </select>
          </Fl>
          <Fl label="Note to the engineer"><textarea style={ta} value={note} onChange={(e) => setNote(e.target.value)} /></Fl>
          <ErrorLine msg={err} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Btn onClick={resolve}>Resolve</Btn>
            {flag.status === "open" && <Btn variant="ghost" onClick={markReview}>Mark under review</Btn>}
            <Btn variant="ghost" onClick={onClose}>Close</Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  CUSTOMER PAYMENTS, RECOVERIES AND VAT (top of the Payments page)
// ═══════════════════════════════════════════════════════════════════════════
export function CustomerPaymentsPanel({ jobs = [], engineers = [], onOpenJob }) {
  const { settings, loaded } = usePaymentSettings();
  const { rows: overrides } = useTable("payment_overrides", { order: "created_at" });
  const { rows: recoveries, reload: reloadRec } = useTable("commission_recoveries", { order: "created_at" });
  const { rows: planPayments } = useTable("plan_payments", { order: "paid_at" });
  const [tab, setTab] = useState("outstanding");
  if (!loaded) return null;

  const since = Date.now() - 365 * 864e5;
  const in12 = (d) => d && new Date(d).getTime() >= since;
  const paid12All = jobs.filter((j) => ["paid", "part_refunded", "refunded"].includes(j.paymentStatus) && in12(j.paidAt));
  // External SP jobs are paid to EasyRepair, so the whole amount is turnover (admin fee included).
  const isExtPaid = (j) => j.isExternal && j.extCalloutPence != null;
  const paid12 = paid12All.filter((j) => !isExtPaid(j));
  const external12 = paid12All.filter(isExtPaid).reduce((s, j) => s + Number(j.totalPence || 0) - Number(j.refundAmountPence || 0), 0);
  const commission12 = paid12.reduce((s, j) => s + jobMoney(j, settings, overrides).commission - Number(j.commissionRefundedPence || 0), 0);
  const adminFees12 = jobs.filter((j) => !isExtPaid(j) && in12(j.adminFeeAppliedAt) && j.paymentStatus === "paid").reduce((s, j) => s + Math.round(Number(j.adminFeePence || 0) * (100 - Number(settings.admin_fee_engineer_share)) / 100), 0);
  const cancelFees12 = jobs.filter((j) => j.cancellationFeeStatus === "charged" && in12(j.cancelledAt || j.noShowAt || j.createdAt)).reduce((s, j) => s + Number(j.cancellationFeePence || 0) - Number(j.feeEngineerSharePence || 0), 0);
  const plans12 = planPayments.filter((p) => in12(p.paid_at)).reduce((s, p) => s + Number(p.amount_pence || 0), 0);
  const turnover = commission12 + adminFees12 + cancelFees12 + plans12 + external12;
  const spOwed = jobs.filter((j) => spPayFor(j)?.state === "owed");
  const threshold = Number(settings.vat_threshold_pence) || 1;
  const pct = Math.min(100, (turnover / threshold) * 100);

  const outstanding = jobs.filter((j) => j.paymentStatus === "outstanding" || (j.status === "Completed" && j.paymentStatus === "not_charged" && settings.payments_live));
  const uncollectable = jobs.filter((j) => j.paymentStatus === "uncollectable");
  const fees = jobs.filter((j) => j.cancellationFeeStatus === "pending");
  const openRec = recoveries.filter((r) => ["pending", "paused", "invoiced"].includes(r.status));
  const jobById = (id) => jobs.find((j) => j.id === id);
  const engName = (id) => engineers.find((e) => e.id === id)?.name || "Engineer";

  const tile = (l, v, sub, color) => (
    <div style={{ background: C.card, borderRadius: 11, padding: "12px 14px", borderLeft: `3px solid ${color}`, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: C.mid, fontWeight: 700 }}>{l}</div>
      <div style={{ fontSize: 19, fontWeight: 900, color }}>{v}</div>
      {sub && <div style={{ fontSize: 11, color: C.light }}>{sub}</div>}
    </div>
  );
  const jobLine = (j, right) => (
    <div key={j.id} onClick={() => onOpenJob?.(j)} style={{ padding: "9px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", gap: 10 }}>
      <div style={{ fontSize: 13 }}><b>{jobRef(j)} {j.customer}</b><span style={{ color: C.light, fontSize: 11 }}> · {j.isExternal ? `External SP · ${j.externalName || "SP"}` : `${ROUTE_LABELS[paymentRoute(j)]} · ${engName(j.engineerId)}`}</span></div>
      <div style={{ fontSize: 13, fontWeight: 800 }}>{right}</div>
    </div>
  );
  const setRec = async (r, status) => { await supabase.from("commission_recoveries").update({ status, updated_at: new Date().toISOString(), ...(status === "invoiced" ? { invoiced_at: new Date().toISOString() } : {}) }).eq("id", r.id); reloadRec(); };

  return (
    <div style={{ marginBottom: 22 }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 900, color: C.text }}>Customer payments {!settings.payments_live && <span style={{ fontSize: 11, color: C.warn, fontWeight: 700, marginLeft: 6 }}>Payments not live yet</span>}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginBottom: 12 }}>
        {tile("Outstanding", outstanding.length, "completed, not yet paid", C.warn)}
        {tile("Uncollectable", uncollectable.length, "written off or recovering", C.danger)}
        {tile("Fees to collect", fees.length, "cancellation / no-show", C.blue)}
        {tile("Commission to recover", penceToGBP(openRec.reduce((s, r) => s + r.amount_pence, 0)), `${openRec.length} open`, C.purple)}
        {tile("SP payouts owed", penceToGBP(spOwed.reduce((s, j) => s + spPayFor(j).amount, 0)), `${spOwed.length} external SP job${spOwed.length === 1 ? "" : "s"} · see SP payments below`, C.primary)}
      </div>

      <div style={{ background: C.card, borderRadius: 11, padding: 14, marginBottom: 12, border: `1px solid ${pct >= 90 ? C.danger : C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6, gap: 10, flexWrap: "wrap" }}>
          <b>VAT turnover, last 12 months{settings.vat_registered ? " (VAT registered)" : ""}</b>
          <span style={{ color: C.mid }}>{penceToGBP(turnover)} of {penceToGBP(threshold)} threshold · {pct.toFixed(0)}%</span>
        </div>
        <div style={{ height: 8, background: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: pct >= 90 ? C.danger : pct >= 75 ? C.warn : C.primary }} />
        </div>
        <div style={{ fontSize: 11, color: C.light, marginTop: 6 }}>EasyRepair's own income: commission {penceToGBP(commission12)} · protection plans {penceToGBP(plans12)} · admin fees {penceToGBP(adminFees12)} · cancellation fees {penceToGBP(cancelFees12)} · external SP jobs (full amount, as EasyRepair is the seller) {penceToGBP(external12)}. Stripe Connect engineers' shares aren't counted.</div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {[["outstanding", `Outstanding (${outstanding.length})`], ["uncollectable", `Uncollectable (${uncollectable.length})`], ["fees", `Fees (${fees.length})`], ["recoveries", `Recoveries (${openRec.length})`]].map(([k, l]) => <Btn key={k} sm variant={tab === k ? "primary" : "ghost"} onClick={() => setTab(k)}>{l}</Btn>)}
      </div>
      <div style={{ background: C.card, borderRadius: 11, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        {tab === "outstanding" && (outstanding.length ? outstanding.map((j) => jobLine(j, penceToGBP(jobMoney(j, settings, overrides).total))) : <div style={{ padding: 14, color: C.light, fontSize: 13 }}>Nothing outstanding.</div>)}
        {tab === "uncollectable" && (uncollectable.length ? uncollectable.map((j) => jobLine(j, j.fault === "engineer" ? "Engineer at fault" : "Written off")) : <div style={{ padding: 14, color: C.light, fontSize: 13 }}>No uncollectable jobs.</div>)}
        {tab === "fees" && (fees.length ? fees.map((j) => jobLine(j, `${j.cancellationFeeType === "no_show" ? "No-show" : "Late cancel"} ${penceToGBP(j.cancellationFeePence)}`)) : <div style={{ padding: 14, color: C.light, fontSize: 13 }}>No fees waiting.</div>)}
        {tab === "recoveries" && (openRec.length ? openRec.map((r) => {
          const j = jobById(r.booking_id);
          const overdue = (Date.now() - new Date(r.created_at).getTime()) / 864e5 >= Number(settings.recovery_invoice_days);
          return (
            <div key={r.id} style={{ padding: "9px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}><b>{engName(r.engineer_id)}</b> · {j ? jobRef(j) : "job"} · {r.reason || ""} <span style={{ color: r.status === "paused" ? C.warn : C.light, fontSize: 11 }}>· {r.status}{r.status === "paused" ? " (engineer disputed)" : ""}{overdue && r.status === "pending" ? " · due for invoice" : ""}</span></div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <b>{penceToGBP(r.amount_pence)}</b>
                {r.status === "pending" && <Btn sm variant="ghost" onClick={() => setRec(r, "invoiced")}>Mark invoiced</Btn>}
                {r.status !== "paused" && <Btn sm variant="success" onClick={() => setRec(r, "recovered")}>Mark recovered</Btn>}
                <Btn sm variant="danger" onClick={() => setRec(r, "cancelled")}>Cancel</Btn>
              </div>
            </div>
          );
        }) : <div style={{ padding: 14, color: C.light, fontSize: 13 }}>No commission to recover.</div>)}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SP PAYMENTS (Payments page) -- one row per SP; click to see what they're
//  owed and everything they've been paid. In-house SPs are paid through
//  Stripe Connect automatically; only external SPs are ever owed (bank transfer).
// ═══════════════════════════════════════════════════════════════════════════
export function SpPaymentsPanel({ jobs = [], engineers = [], externalSps = [], isOwner, onOpenJob, onChanged }) {
  const [open, setOpen] = useState(null);
  const payees = useMemo(() => {
    const withPay = (list) => list.map((j) => ({ j, p: spPayFor(j) })).filter((x) => x.p);
    const out = engineers.map((e) => ({
      key: `eng-${e.id}`, external: false, name: e.name || "SP", sub: e.businessName || e.phone || "",
      items: withPay(jobs.filter((j) => !j.isExternal && j.engineerId === e.id)),
    }));
    // External SPs: roster ones by id, genuine one-offs by name + phone.
    const ext = new Map();
    for (const j of jobs.filter((x) => x.isExternal)) {
      const k = j.externalEngineerId ? `id:${j.externalEngineerId}` : `one:${(j.externalName || "").trim().toLowerCase()}|${(j.externalPhone || "").replace(/\D/g, "")}`;
      if (!ext.has(k)) {
        const sp = j.externalEngineerId ? externalSps.find((s) => s.id === j.externalEngineerId) : null;
        ext.set(k, { key: `ext-${k}`, external: true, name: sp?.name || j.externalName || "External SP", sub: [sp?.company || j.externalCompany, sp?.phone || j.externalPhone].filter(Boolean).join(" · "), jobs: [] });
      }
      ext.get(k).jobs.push(j);
    }
    for (const g of ext.values()) out.push({ ...g, items: withPay(g.jobs) });
    for (const p of out) {
      const sum = (st) => p.items.filter((x) => x.p.state === st).reduce((s, x) => s + x.p.amount, 0);
      p.owed = sum("owed"); p.paid = sum("paid"); p.pending = sum("pending");
    }
    return out.sort((a, b) => b.owed - a.owed || b.pending - a.pending || b.paid - a.paid || a.name.localeCompare(b.name));
  }, [jobs, engineers, externalSps]);

  const totalOwed = payees.reduce((s, p) => s + p.owed, 0);
  const initials = (n) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const jobText = (j) => <>{jobRef(j)} {j.customer}<span style={{ color: C.light, fontSize: 11 }}> · {j.appliance}{j.brand ? ` · ${j.brand}` : ""}</span></>;

  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 900, color: C.text }}>SP payments</h2>
        <span style={{ fontSize: 13, fontWeight: 800, color: totalOwed ? C.danger : C.success }}>{totalOwed ? `${penceToGBP(totalOwed)} owed to external SPs` : "Nothing owed"}</span>
      </div>
      <div style={{ fontSize: 12, color: C.mid, marginBottom: 10 }}>In-house SPs are paid their share through Stripe as soon as the customer pays. External SPs are paid by bank transfer, so mark each one paid here once you've sent it.</div>
      <div style={{ background: C.card, borderRadius: 11, border: `1px solid ${C.border}`, overflow: "hidden" }}>
        {payees.length === 0 && <div style={{ padding: 14, color: C.light, fontSize: 13 }}>No SPs yet.</div>}
        {payees.map((p) => {
          const isOpen = open === p.key;
          const owed = p.items.filter((x) => x.p.state === "owed");
          const pending = p.items.filter((x) => x.p.state === "pending");
          const history = p.items.filter((x) => x.p.state === "paid").sort((a, b) => String(b.p.date || "").localeCompare(String(a.p.date || "")));
          return (
            <div key={p.key} style={{ borderBottom: `1px solid ${C.border}` }}>
              <div onClick={() => setOpen(isOpen ? null : p.key)} style={{ padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flexWrap: "wrap" }}>
                <span style={{ width: 30, height: 30, borderRadius: "50%", background: p.external ? C.purple : C.primary, color: "#0a0a0a", fontWeight: 900, fontSize: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{initials(p.name)}</span>
                <div style={{ flex: "1 1 180px", minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>{p.name}<Pill color={p.external ? C.purple : C.mid} bg={p.external ? C.purpleLight : undefined}>{p.external ? "External · bank transfer" : "In-house · Stripe"}</Pill></div>
                  {p.sub && <div style={{ fontSize: 11, color: C.light }}>{p.sub}</div>}
                </div>
                <div style={{ textAlign: "right", fontSize: 12 }}>
                  {p.owed > 0 && <div style={{ color: C.danger, fontWeight: 900, fontSize: 14 }}>{penceToGBP(p.owed)} owed</div>}
                  {p.pending > 0 && <div style={{ color: C.warn, fontWeight: 700 }}>{penceToGBP(p.pending)} waiting for customer</div>}
                  <div style={{ color: p.paid ? C.success : C.light, fontWeight: 700 }}>{p.paid ? `${penceToGBP(p.paid)} paid` : "No payments yet"}</div>
                </div>
                <span style={{ color: C.light, fontSize: 12, width: 12 }}>{isOpen ? "▾" : "▸"}</span>
              </div>
              {isOpen && (
                <div style={{ padding: "4px 14px 14px", background: "#161B22" }}>
                  {owed.length > 0 && <div style={{ ...label(), marginTop: 10 }}>To pay by bank transfer</div>}
                  {owed.map(({ j, p: pay }) => <OwedPayoutRow key={j.id} job={j} pay={pay} isOwner={isOwner} jobText={jobText} onOpenJob={onOpenJob} onChanged={onChanged} />)}
                  {pending.length > 0 && <div style={{ ...label(), marginTop: 12 }}>Waiting for the customer to pay</div>}
                  {pending.map(({ j, p: pay }) => (
                    <div key={j.id} onClick={() => onOpenJob?.(j)} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "6px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
                      <span>{jobText(j)}</span><b style={{ color: C.warn }}>{penceToGBP(pay.amount)}</b>
                    </div>
                  ))}
                  <div style={{ ...label(), marginTop: 12 }}>Payment history</div>
                  {history.length === 0 && <div style={{ fontSize: 12, color: C.light }}>No payments yet.</div>}
                  {history.map(({ j, p: pay }) => (
                    <div key={j.id} onClick={() => onOpenJob?.(j)} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "6px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer", flexWrap: "wrap" }}>
                      <span><span style={{ color: C.mid, fontSize: 12 }}>{pay.date ? fmtDateTime(pay.date) : "—"} · </span>{jobText(j)}</span>
                      <span style={{ textAlign: "right" }}><b style={{ color: C.success }}>{penceToGBP(pay.amount)}</b><div style={{ fontSize: 11, color: C.light }}>{spPayLabel(pay)}{pay.via === "bank" && pay.ref ? ` · ref ${pay.ref}` : ""}</div></span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OwedPayoutRow({ job, pay, isOwner, jobText, onOpenJob, onChanged }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const markPaid = async () => {
    setBusy(true); setErr("");
    const { error } = await supabase.from("bookings").update({ sp_payout_status: "paid", sp_paid_at: new Date().toISOString(), sp_payout_ref: ref.trim() || null }).eq("id", job.id);
    setBusy(false);
    if (error) setErr(error.message); else await onChanged?.();
  };
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span onClick={() => onOpenJob?.(job)} style={{ fontSize: 13, cursor: "pointer" }}>{jobText(job)}{pay.date && <span style={{ color: C.light, fontSize: 11 }}> · customer paid {fmtDateTime(pay.date)}</span>}</span>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ color: C.danger }}>{penceToGBP(pay.amount)}</b>
          {isOwner && <>
            <input style={{ ...inp, width: 170, padding: "5px 8px" }} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Transfer ref (optional)" />
            <Btn variant="success" sm disabled={busy} onClick={markPaid}>{busy ? "Saving…" : "Mark paid"}</Btn>
          </>}
        </div>
      </div>
      <ErrorLine msg={err} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  PROTECTION PLAN BILLING (inside PlanDetail)
// ═══════════════════════════════════════════════════════════════════════════
export function PlanBillingPanel({ plan, onChanged }) {
  const { settings, loaded } = usePaymentSettings();
  const changesFilter = useCallback((q) => q.eq("plan_id", plan.id), [plan.id]);
  const { rows: changes, reload: reloadChanges } = useTable("plan_changes", { order: "created_at", filter: changesFilter });
  const [modal, setModal] = useState(null);
  const [err, setErr] = useState("");
  if (!loaded) return null;
  const live = settings.payments_live || !!plan.isTest;
  const interval = plan.billingInterval || "month";
  const count = plan.applianceCount || 1;
  const listPrice = planPricePence(settings, interval, count);
  const price = plan.pricePence ?? listPrice;
  const cancel = planCancellationFee(plan, settings);
  const d = (x) => (x ? new Date(x).toLocaleDateString("en-GB") : "—");

  const logChange = async (summary, details) => {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("plan_changes").insert({ plan_id: plan.id, summary, details, changed_by: u?.user?.id || null });
  };
  const update = async (p, summary, details, stripeAction) => {
    setErr("");
    if (live && stripeAction && plan.stripeSubscriptionId) {
      try { await callPayments(stripeAction, { planId: plan.id, ...details }); }
      catch (e) { setErr(e.message); return false; }
    }
    const { error } = await supabase.from("service_plans").update(p).eq("id", plan.id);
    if (error) { setErr(error.message); return false; }
    await logChange(summary, details);
    await reloadChanges(); await onChanged?.();
    return true;
  };

  return (
    <div style={{ ...box(), border: `1px solid ${C.purple}44` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: .4 }}>Billing</div>
        <div style={{ display: "flex", gap: 6 }}>
          <Pill color={C.purple} bg={C.purpleLight}>{interval === "year" ? "Annual" : "Monthly"}</Pill>
          {plan.pendingInterval && <Pill color={C.warn} bg={C.warnLight}>Switching to {plan.pendingInterval === "year" ? "annual" : "monthly"} at renewal</Pill>}
          {!live && <Pill color={C.warn} bg={C.warnLight}>Payments not live</Pill>}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
        <div>
          <Row k="Appliances covered" v={count} />
          <Row k={`Price per ${interval === "year" ? "year" : "month"}`} v={penceToGBP(price)} strong />
          {price !== listPrice && <Row k="Current list price" v={penceToGBP(listPrice)} />}
          <Row k="First payment" v={d(plan.firstPaymentAt)} />
        </div>
        <div>
          <Row k={`Term ${plan.termNumber || 1}`} v={plan.agreementStart ? `${d(plan.agreementStart)} – ${d(plan.agreementEnd)}` : "Starts with the first payment"} />
          <Row k="Cooling-off ends" v={d(plan.coolingOffEndsAt)} />
          <Row k="Next renewal" v={d(plan.nextRenewalAt)} />
          <Row k="Cancelling today costs" v={`${penceToGBP(cancel.fee)} · ${cancel.why}`} />
        </div>
      </div>
      {(plan.appliances || []).length > 0 && <div style={{ fontSize: 12, color: C.mid, marginTop: 8 }}>Covered: {(plan.appliances || []).map((a) => [a.appliance, a.brand].filter(Boolean).join(" ")).join(", ")}</div>}
      {plan.status === "active" && (
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <Btn sm variant="ghost" onClick={() => setModal("appliances")}>Change appliances</Btn>
          <Btn sm variant="ghost" onClick={() => setModal("interval")}>Switch to {interval === "year" ? "monthly" : "annual"}</Btn>
          <Btn sm variant="danger" onClick={() => setModal("cancel")}>Cancel plan…</Btn>
        </div>
      )}
      {!live && <div style={{ fontSize: 11, color: C.warn, marginTop: 6 }}>Changes are saved and logged now. Stripe billing and customer confirmation emails start once payments go live.</div>}
      <ErrorLine msg={err} />
      {changes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={label()}>Change log</div>
          {[...changes].reverse().map((c) => <Row key={c.id} k={`${fmtDateTime(c.created_at)} · ${c.summary}`} v={c.customer_confirmed_at ? "Customer confirmed" : "Awaiting customer confirmation"} />)}
          <div style={{ fontSize: 11, color: C.light, marginTop: 4 }}>Each change emails the customer a confirmation link once payments are live.</div>
        </div>
      )}

      {modal === "appliances" && <PlanAppliancesModal plan={plan} settings={settings} onClose={() => setModal(null)} onSave={async (n, list) => {
        const newPrice = planPricePence(settings, interval, n);
        if (await update({ appliance_count: n, appliances: list, price_pence: newPrice }, `Appliances ${count} → ${n}; price ${penceToGBP(price)} → ${penceToGBP(newPrice)} per ${interval}`, { appliance_count: n, appliances: list, price_pence: newPrice, interval }, "update_plan")) setModal(null);
      }} />}
      {modal === "interval" && <PlanIntervalModal plan={plan} settings={settings} onClose={() => setModal(null)} onSave={async (when) => {
        const to = interval === "year" ? "month" : "year";
        const newPrice = planPricePence(settings, to, count);
        const ok = when === "now"
          ? await update({ billing_interval: to, pending_interval: null, price_pence: newPrice }, `Billing switched to ${to === "year" ? "annual" : "monthly"} now (${penceToGBP(newPrice)} per ${to})`, { interval: to, when, price_pence: newPrice }, "update_plan")
          : await update({ pending_interval: to }, `Billing switches to ${to === "year" ? "annual" : "monthly"} at renewal (${penceToGBP(newPrice)} per ${to})`, { interval: to, when, price_pence: newPrice }, "update_plan");
        if (ok) setModal(null);
      }} />}
      {modal === "cancel" && <PlanCancelModal plan={plan} fee={cancel} onClose={() => setModal(null)} onSave={async (reason, chargeFee) => {
        const fee = chargeFee ? cancel.fee : 0;
        if (await update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: reason || null, cancellation_fee_pence: fee }, `Plan cancelled${fee ? ` with ${penceToGBP(fee)} fee` : " (no fee)"}${reason ? ` — ${reason}` : ""}`, { fee_pence: fee, reason }, "cancel_plan")) setModal(null);
      }} />}
    </div>
  );
}

function PlanAppliancesModal({ plan, settings, onClose, onSave }) {
  const start = (plan.appliances || []).length ? plan.appliances : [{ appliance: plan.appliance || "", brand: plan.brand || "" }];
  const [list, setList] = useState(start);
  const interval = plan.billingInterval || "month";
  const setItem = (i, k, v) => setList(list.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  return (
    <Modal title="Appliances covered" onClose={onClose}>
      <div style={{ fontSize: 13, color: C.mid, marginBottom: 10 }}>Added after the follow-up call. Billed from the next payment date; the customer is emailed to confirm.</div>
      {list.map((a, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, marginBottom: 6 }}>
          <input style={inp} placeholder="Appliance" value={a.appliance} onChange={(e) => setItem(i, "appliance", e.target.value)} />
          <input style={inp} placeholder="Brand" value={a.brand} onChange={(e) => setItem(i, "brand", e.target.value)} />
          {list.length > 1 ? <Btn variant="danger" sm onClick={() => setList(list.filter((_, j) => j !== i))}>Remove</Btn> : <span />}
        </div>
      ))}
      <Btn variant="ghost" sm onClick={() => setList([...list, { appliance: "", brand: "" }])}>+ Add appliance</Btn>
      <div style={{ fontSize: 13, marginTop: 12 }}>New price: <b>{penceToGBP(planPricePence(settings, interval, list.length))}</b> per {interval} for {list.length} appliance{list.length > 1 ? "s" : ""}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}><Btn onClick={() => onSave(list.length, list)}>Save</Btn><Btn variant="ghost" onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

function PlanIntervalModal({ plan, settings, onClose, onSave }) {
  const interval = plan.billingInterval || "month";
  const to = interval === "year" ? "month" : "year";
  const [when, setWhen] = useState("renewal");
  return (
    <Modal title={`Switch to ${to === "year" ? "annual" : "monthly"} billing`} onClose={onClose}>
      <div style={{ fontSize: 13, color: C.mid, marginBottom: 10 }}>New price: <b style={{ color: C.text }}>{penceToGBP(planPricePence(settings, to, plan.applianceCount || 1))}</b> per {to}.</div>
      <label style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 6 }}><input type="radio" checked={when === "renewal"} onChange={() => setWhen("renewal")} /> At the next renewal</label>
      <label style={{ display: "flex", gap: 8, fontSize: 13 }}><input type="radio" checked={when === "now"} onChange={() => setWhen("now")} /> Now (Stripe credits the unused part of the current period)</label>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}><Btn onClick={() => onSave(when)}>Switch</Btn><Btn variant="ghost" onClick={onClose}>Cancel</Btn></div>
    </Modal>
  );
}

function PlanCancelModal({ plan, fee, onClose, onSave }) {
  const [reason, setReason] = useState("");
  const [charge, setCharge] = useState(fee.fee > 0);
  return (
    <Modal title="Cancel protection plan" onClose={onClose}>
      <div style={{ fontSize: 13, color: C.mid, marginBottom: 10 }}>{fee.why}: cancellation fee <b style={{ color: C.text }}>{penceToGBP(fee.fee)}</b>.</div>
      {fee.fee > 0 && <label style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 10 }}><input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} /> Charge the {penceToGBP(fee.fee)} fee to the saved card</label>}
      <Fl label="Reason / how the customer asked"><textarea style={ta} value={reason} onChange={(e) => setReason(e.target.value)} /></Fl>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}><Btn variant="danger" onClick={() => onSave(reason, charge)}>Cancel plan</Btn><Btn variant="ghost" onClick={onClose}>Keep plan</Btn></div>
    </Modal>
  );
}

export { penceToGBP };
