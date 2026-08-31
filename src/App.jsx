import { useState, useMemo, useEffect } from "react";
import { supabase } from "./lib/supabaseClient";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const APPLIANCE_TYPES = ["Washing Machine","Tumble Dryer","Dishwasher","Fridge/Freezer","Oven/Cooker","Hob","Microwave"];
const BRANDS = {
  "Washing Machine":["AEG","Beko","Bosch","Candy","Hoover","Hotpoint","Indesit","LG","Miele","Samsung","Siemens","Whirlpool","Zanussi","Other"],
  "Tumble Dryer":   ["AEG","Beko","Bosch","Candy","Hoover","Hotpoint","Indesit","LG","Miele","Samsung","Siemens","Whirlpool","Zanussi","Other"],
  "Dishwasher":     ["AEG","Beko","Bosch","Candy","Hoover","Hotpoint","Indesit","LG","Miele","Samsung","Siemens","Whirlpool","Zanussi","Other"],
  "Fridge/Freezer": ["AEG","Beko","Bosch","Candy","Haier","Hotpoint","Indesit","LG","Miele","Samsung","Siemens","Whirlpool","Zanussi","Other"],
  "Oven/Cooker":    ["AEG","Beko","Bosch","Candy","Hotpoint","Indesit","Neff","Rangemaster","Samsung","Siemens","Smeg","Other"],
  "Hob":            ["AEG","Beko","Bosch","Candy","Hotpoint","Indesit","Neff","Siemens","Smeg","Other"],
  "Microwave":      ["Bosch","Hotpoint","LG","Panasonic","Samsung","Sharp","Siemens","Other"],
};
const SOURCES  = ["Website","Manchester Site","Leeds Site","Sheffield Site","Liverpool Site","Birmingham Site","Direct Call","Other"]; function shortSource(url){try{var u=new URL(url);var p=u.pathname&&u.pathname!=="/"?u.pathname:"";return u.hostname+p;}catch(e){return url;}}
const STATUSES = ["Quote","Booked","Assigned","Parts Awaited","In Progress","Completed","Beyond Repair","Cancelled"];
// Standard Royal Mail postcode area list (124 areas) -- used by
// Settings -> Websites -> Pricing to let pricing be set per area.
const POSTCODE_AREAS = [
  {code:"AB",name:"Aberdeen"},{code:"AL",name:"St Albans"},{code:"B",name:"Birmingham"},
  {code:"BA",name:"Bath"},{code:"BB",name:"Blackburn"},{code:"BD",name:"Bradford"},
  {code:"BH",name:"Bournemouth"},{code:"BL",name:"Bolton"},{code:"BN",name:"Brighton"},
  {code:"BR",name:"Bromley"},{code:"BS",name:"Bristol"},{code:"BT",name:"Belfast"},
  {code:"CA",name:"Carlisle"},{code:"CB",name:"Cambridge"},{code:"CF",name:"Cardiff"},
  {code:"CH",name:"Chester"},{code:"CM",name:"Chelmsford"},{code:"CO",name:"Colchester"},
  {code:"CR",name:"Croydon"},{code:"CT",name:"Canterbury"},{code:"CV",name:"Coventry"},
  {code:"CW",name:"Crewe"},{code:"DA",name:"Dartford"},{code:"DD",name:"Dundee"},
  {code:"DE",name:"Derby"},{code:"DG",name:"Dumfries"},{code:"DH",name:"Durham"},
  {code:"DL",name:"Darlington"},{code:"DN",name:"Doncaster"},{code:"DT",name:"Dorchester"},
  {code:"DY",name:"Dudley"},{code:"E",name:"London E"},{code:"EC",name:"London EC"},
  {code:"EH",name:"Edinburgh"},{code:"EN",name:"Enfield"},{code:"EX",name:"Exeter"},
  {code:"FK",name:"Falkirk"},{code:"FY",name:"Blackpool"},{code:"G",name:"Glasgow"},
  {code:"GL",name:"Gloucester"},{code:"GU",name:"Guildford"},{code:"GY",name:"Guernsey"},
  {code:"HA",name:"Harrow"},{code:"HD",name:"Huddersfield"},{code:"HG",name:"Harrogate"},
  {code:"HP",name:"Hemel Hempstead"},{code:"HR",name:"Hereford"},{code:"HS",name:"Outer Hebrides"},
  {code:"HU",name:"Hull"},{code:"HX",name:"Halifax"},{code:"IG",name:"Ilford"},
  {code:"IM",name:"Isle of Man"},{code:"IP",name:"Ipswich"},{code:"IV",name:"Inverness"},
  {code:"JE",name:"Jersey"},{code:"KA",name:"Kilmarnock"},{code:"KT",name:"Kingston upon Thames"},
  {code:"KW",name:"Kirkwall"},{code:"KY",name:"Kirkcaldy"},{code:"L",name:"Liverpool"},
  {code:"LA",name:"Lancaster"},{code:"LD",name:"Llandrindod Wells"},{code:"LE",name:"Leicester"},
  {code:"LL",name:"Llandudno"},{code:"LN",name:"Lincoln"},{code:"LS",name:"Leeds"},
  {code:"LU",name:"Luton"},{code:"M",name:"Manchester"},{code:"ME",name:"Medway"},
  {code:"MK",name:"Milton Keynes"},{code:"ML",name:"Motherwell"},{code:"N",name:"London N"},
  {code:"NE",name:"Newcastle upon Tyne"},{code:"NG",name:"Nottingham"},{code:"NN",name:"Northampton"},
  {code:"NP",name:"Newport"},{code:"NR",name:"Norwich"},{code:"NW",name:"London NW"},
  {code:"OL",name:"Oldham"},{code:"OX",name:"Oxford"},{code:"PA",name:"Paisley"},
  {code:"PE",name:"Peterborough"},{code:"PH",name:"Perth"},{code:"PL",name:"Plymouth"},
  {code:"PO",name:"Portsmouth"},{code:"PR",name:"Preston"},{code:"RG",name:"Reading"},
  {code:"RH",name:"Redhill"},{code:"RM",name:"Romford"},{code:"S",name:"Sheffield"},
  {code:"SA",name:"Swansea"},{code:"SE",name:"London SE"},{code:"SG",name:"Stevenage"},
  {code:"SK",name:"Stockport"},{code:"SL",name:"Slough"},{code:"SM",name:"Sutton"},
  {code:"SN",name:"Swindon"},{code:"SO",name:"Southampton"},{code:"SP",name:"Salisbury"},
  {code:"SR",name:"Sunderland"},{code:"SS",name:"Southend-on-Sea"},{code:"ST",name:"Stoke-on-Trent"},
  {code:"SW",name:"London SW"},{code:"SY",name:"Shrewsbury"},{code:"TA",name:"Taunton"},
  {code:"TD",name:"Galashiels"},{code:"TF",name:"Telford"},{code:"TN",name:"Tonbridge"},
  {code:"TQ",name:"Torquay"},{code:"TR",name:"Truro"},{code:"TS",name:"Cleveland"},
  {code:"TW",name:"Twickenham"},{code:"UB",name:"Southall"},{code:"W",name:"London W"},
  {code:"WA",name:"Warrington"},{code:"WC",name:"London WC"},{code:"WD",name:"Watford"},
  {code:"WF",name:"Wakefield"},{code:"WN",name:"Wigan"},{code:"WR",name:"Worcester"},
  {code:"WS",name:"Walsall"},{code:"WV",name:"Wolverhampton"},{code:"YO",name:"York"},
  {code:"ZE",name:"Lerwick"},
];
// Was hardcoded to a fixed demo date ("2026-06-06") left over from before real
// bookings existed -- that's why "Today's Bookings" on the dashboard sat at 0
// no matter what got completed: it was comparing every booking's
// scheduledDate against a date in the past, not today. Computed from the
// browser's local date now, in the same YYYY-MM-DD shape scheduledDate is
// already stored in (see mapBookingRow/bookingFieldsToRow), so the string
// comparison at `todayJobs` below actually matches real bookings.
const TODAY = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
})();
// Same deal -- the dashboard header used to show a hardcoded "Saturday 6 June
// 2026" underneath the title. This renders today's actual date instead.
const TODAY_LABEL = new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

// When someone follows an invite or password-reset email, Supabase redirects here with
// #access_token=...&type=invite (or type=recovery) in the URL. supabase-js's own
// auto-detection of this is turned off (see supabaseClient.js) because it ran
// asynchronously and reliably beat any check we did at render time -- by the time we
// looked, it had already consumed and stripped the hash, so the "set your password"
// screen this is supposed to trigger never appeared. Instead we capture it ourselves here,
// synchronously, the instant this module loads -- before anything else can touch it -- and
// the App component below establishes the session from these tokens itself.
const AUTH_HASH = (() => {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = params.get("type");
  if (!type) return null;
  return { type, accessToken: params.get("access_token"), refreshToken: params.get("refresh_token") };
})();

function inviteOrRecoveryType(){
  return AUTH_HASH?.type || null;
}

// ─── SEED DATA ───────────────────────────────────────────────────────────────
// Engineers, staff/owner accounts, and bookings are all real now (Supabase
// auth + the `profiles`/`engineers`/`bookings` tables) — see
// loadEngineers()/loadStaffUsers()/loadBookings() in the App component
// below. Nothing left in this file reads from local demo arrays.

// ─── AUTO-ASSIGN ─────────────────────────────────────────────────────────────
function autoAssign(job, engineers, jobs) {
  const pc = (job.postcode || "").toUpperCase().trim();
  const pcAlpha = pc.replace(/[0-9\s]+$/, "");

  const eligible = engineers.filter(eng => {
    const covers = eng.postcodes.some(p => {
      const up = p.toUpperCase();
      return pc === up || pc.startsWith(up) || pcAlpha === up;
    });
    if (!covers) return false;
    if (!eng.applianceTypes.includes(job.appliance)) return false;
    const excl = eng.brandExclusions[job.appliance] || [];
    if (job.brand && excl.includes(job.brand)) return false;
    return true;
  });

  if (!eligible.length) return null;

  return eligible.sort((a, b) => {
    const totA = a.stats.repairs + a.stats.beyondRepair;
    const totB = b.stats.repairs + b.stats.beyondRepair;
    const rA = totA ? a.stats.repairs / totA : 0;
    const rB = totB ? b.stats.repairs / totB : 0;
    if (Math.abs(rA - rB) > 0.02) return rB - rA;
    const actA = jobs.filter(j => j.engineerId === a.id && !["Completed","Beyond Repair","Cancelled"].includes(j.status)).length;
    const actB = jobs.filter(j => j.engineerId === b.id && !["Completed","Beyond Repair","Cancelled"].includes(j.status)).length;
    return actA - actB;
  })[0];
}

// ─── TOKENS — EasyRepair brand ───────────────────────────────────────────────
const C = {
  bg:"#000000",     card:"#141414",   sidebar:"#000000",
  primary:"#d4ff3c",  primaryLight:"rgba(212,255,60,0.12)",
  success:"#4ade80",  successLight:"rgba(74,222,128,0.12)",
  warn:"#fbbf24",     warnLight:"rgba(251,191,36,0.12)",
  danger:"#f87171",   dangerLight:"rgba(248,113,113,0.12)",
  purple:"#c084fc",   purpleLight:"rgba(192,132,252,0.12)",
  blue:"#60a5fa",     blueLight:"rgba(96,165,250,0.12)",
  text:"#F1F5F9", mid:"#94A3B8", light:"#94A2B8", border:"#262626",
};
const STATUS_C = {
  "Quote":         {bg:"rgba(96,165,250,0.15)",  t:"#60a5fa", dot:"#60a5fa"},
  "Booked":        {bg:"rgba(251,191,36,0.15)",  t:"#fbbf24", dot:"#fbbf24"},
  "Assigned":      {bg:"rgba(212,255,60,0.12)",  t:"#d4ff3c", dot:"#d4ff3c"},
  "Parts Awaited": {bg:"rgba(192,132,252,0.15)", t:"#c084fc", dot:"#c084fc"},
  "In Progress":   {bg:"rgba(251,146,60,0.15)",  t:"#fb923c", dot:"#fb923c"},
  "Completed":     {bg:"rgba(74,222,128,0.15)",  t:"#4ade80", dot:"#4ade80"},
  "Beyond Repair": {bg:"rgba(248,113,113,0.15)", t:"#f87171", dot:"#f87171"},
  "Cancelled":     {bg:"rgba(100,116,139,0.15)", t:"#64748B", dot:"#64748B"},
};
const ROLE_C = {
  owner:   {label:"Owner",    color:"#c084fc", bg:"rgba(192,132,252,0.15)"},
  staff:   {label:"Staff",    color:"#d4ff3c", bg:"rgba(212,255,60,0.12)"},
  engineer:{label:"SP", color:"#4ade80", bg:"rgba(74,222,128,0.12)"},
};

const inp = {width:"100%",padding:"8px 11px",border:"1.5px solid #262626",borderRadius:7,fontSize:13,color:"#F1F5F9",background:"#000000",boxSizing:"border-box",fontFamily:"inherit",outline:"none"};
const ta  = {...inp,resize:"vertical",minHeight:68};
const fmt = d => d ? new Date(d+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "—";
const pct = (a,b) => b===0 ? "—" : Math.round(a/b*100)+"%";

// ─── ATOMS ───────────────────────────────────────────────────────────────────
const Badge = ({status}) => {
  const c = STATUS_C[status]||STATUS_C["Booked"];
  return <span style={{background:c.bg,color:c.t,padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700,display:"inline-flex",alignItems:"center",gap:4,whiteSpace:"nowrap"}}><span style={{width:6,height:6,borderRadius:"50%",background:c.dot,flexShrink:0}}/>{status}</span>;
};
const PBadge = ({p}) => {
  const m={Normal:{bg:"rgba(100,116,139,0.2)",t:"#94A3B8"},High:{bg:"rgba(251,191,36,0.15)",t:"#fbbf24"},Urgent:{bg:"rgba(248,113,113,0.15)",t:"#f87171"}}[p]||{bg:"rgba(100,116,139,0.2)",t:"#94A3B8"};
  return <span style={{background:m.bg,color:m.t,padding:"2px 7px",borderRadius:4,fontSize:10,fontWeight:800,letterSpacing:.5}}>{(p||"Normal").toUpperCase()}</span>;
};
const RolePill = ({role}) => {
  const m=ROLE_C[role]||ROLE_C.staff;
  return <span style={{background:m.bg,color:m.color,padding:"2px 9px",borderRadius:12,fontSize:11,fontWeight:700}}>{m.label}</span>;
};
const Av = ({initials,size=32,color=C.primary}) =>
  <div style={{width:size,height:size,borderRadius:"50%",background:color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:size*.34,flexShrink:0}}>{initials}</div>;
const StatCard = ({label,value,sub,color="#d4ff3c"}) =>
  <div style={{background:C.card,borderRadius:11,padding:"16px 18px",borderLeft:`4px solid ${color}`,flex:1,minWidth:120,boxShadow:"0 4px 16px rgba(0,0,0,.3)"}}><div style={{fontSize:24,fontWeight:900,color:C.text}}>{value}</div><div style={{fontSize:11,color:C.mid,marginTop:1}}>{label}</div>{sub&&<div style={{fontSize:10,color,fontWeight:700,marginTop:2}}>{sub}</div>}</div>;
const Fl = ({label,children}) =>
  <div style={{marginBottom:11}}><div style={{fontSize:10,fontWeight:700,color:C.light,textTransform:"uppercase",letterSpacing:.7,marginBottom:4}}>{label}</div>{children}</div>;
// ─── NAV ICONS ────────────────────────────────────────────────────────────────
// Stroke-based (not emoji) so the sidebar/mobile-bar active-state color
// (lime when selected, grey otherwise) actually applies -- emoji glyphs
// render as fixed-color pictures on most platforms and ignored `color`.
const navIconBase = {viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};
const IconLayout = ({size=18}) => ( // Dashboard
  <svg width={size} height={size} {...navIconBase}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <line x1="9" y1="3" x2="9" y2="21"/>
  </svg>
);
const IconMenuLines = ({size=18}) => ( // Bookings
  <svg width={size} height={size} {...navIconBase}>
    <line x1="3" y1="6" x2="21" y2="6"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const IconList = ({size=18}) => ( // SP's (Engineers)
  <svg width={size} height={size} {...navIconBase}>
    <line x1="8" y1="6" x2="21" y2="6"/>
    <line x1="8" y1="12" x2="21" y2="12"/>
    <line x1="8" y1="18" x2="21" y2="18"/>
    <line x1="3" y1="6" x2="3.01" y2="6"/>
    <line x1="3" y1="12" x2="3.01" y2="12"/>
    <line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
);
const IconGear = ({size=18}) => ( // Settings
  <svg width={size} height={size} {...navIconBase}>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);
const Btn = ({onClick,children,variant="primary",sm,full,style:s={}}) => {
  const v={
    primary:{bg:"#d4ff3c",c:"#000000"},
    ghost:  {bg:"rgba(255,255,255,0.07)",c:"#94A3B8"},
    danger: {bg:"rgba(248,113,113,0.15)",c:"#f87171"},
    success:{bg:"rgba(74,222,128,0.15)",c:"#4ade80"},
  }[variant]||{bg:"#d4ff3c",c:"#000000"};
  return <button onClick={onClick} style={{background:v.bg,color:v.c,border:"none",borderRadius:7,padding:sm?"5px 10px":"9px 16px",fontWeight:700,fontSize:sm?11:13,cursor:"pointer",fontFamily:"inherit",width:full?"100%":"auto",...s}}>{children}</button>;
};

// ─── MODAL ───────────────────────────────────────────────────────────────────
const Modal = ({title,onClose,children,wide}) => (
  <div style={{position:"fixed",inset:0,background:"rgba(10,15,30,.6)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:12}} onClick={onClose}>
    <div style={{background:C.card,borderRadius:14,width:"100%",maxWidth:wide?840:620,maxHeight:"93vh",overflowY:"auto",boxShadow:"0 24px 80px rgba(0,0,0,.3)"}} onClick={e=>e.stopPropagation()}>
      <div style={{padding:"15px 22px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",position:"sticky",top:0,background:C.card,zIndex:1}}>
        <div style={{fontWeight:800,fontSize:15,color:C.text}}>{title}</div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.06)",border:"none",width:26,height:26,borderRadius:"50%",cursor:"pointer",fontSize:16,color:C.mid,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
      </div>
      <div style={{padding:"18px 22px"}}>{children}</div>
    </div>
  </div>
);

// Generic "are you sure" step in front of anything destructive/state-changing
// enough to deserve one -- currently Archive and Delete Forever for both
// Engineers and Users. `danger` swaps the confirm button to the red variant
// for the truly irreversible action (permanent delete).
function ConfirmModal({title,message,confirmLabel="Confirm",danger,busy,err,onConfirm,onCancel}){
  return (
    <Modal title={title} onClose={onCancel}>
      <div style={{fontSize:13,color:C.mid,lineHeight:1.5,marginBottom:16}}>{message}</div>
      {err&&<div style={{background:"rgba(248,113,113,0.15)",color:"#f87171",borderRadius:7,padding:"8px 12px",fontSize:13,marginBottom:14,fontWeight:600}}>{err}</div>}
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={onConfirm} variant={danger?"danger":"primary"} full style={{padding:"10px 0",opacity:busy?.7:1}}>{busy?"Working…":confirmLabel}</Btn>
        <Btn onClick={onCancel} variant="ghost" full style={{padding:"10px 0"}}>Cancel</Btn>
      </div>
    </Modal>
  );
}

// The Active / Onboarding / Archive (or Active / Archive) pill row at the top
// of the Engineers and Users pages.
function StatusTabs({tabs,value,onChange}){
  return (
    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
      {tabs.map(t=>(
        <button key={t.key} onClick={()=>onChange(t.key)} style={{
          border:"none",borderRadius:20,padding:"7px 15px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",
          display:"flex",alignItems:"center",gap:7,
          background:value===t.key?C.primary:"rgba(255,255,255,0.07)",
          color:value===t.key?"#000000":C.mid,
        }}>
          {t.label}
          <span style={{background:value===t.key?"rgba(0,0,0,0.15)":"rgba(255,255,255,0.09)",color:value===t.key?"#000000":C.light,borderRadius:10,padding:"1px 7px",fontSize:11,fontWeight:800}}>{t.count}</span>
        </button>
      ))}
    </div>
  );
}

// Pill switcher shown at the top of Bookings / Quotes / Payments -- three
// views over the same underlying jobs data, so it's quicker to hop between
// them here than back out to the sidebar/tab bar each time. The divider
// before Payments groups Bookings+Quotes (both about turning a lead into a
// completed job) apart from Payments (money owed once it's done).
function SectionTabs({value,onChange}){
  const pill = (active) => ({
    border: active ? "none" : `1.5px solid ${C.border}`,
    borderRadius:20, padding:"7px 18px", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"inherit",
    background: active ? C.primary : "transparent",
    color: active ? "#000000" : C.mid,
  });
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18,flexWrap:"wrap"}}>
      <button onClick={()=>onChange("jobs")} style={pill(value==="jobs")}>Bookings</button>
      <button onClick={()=>onChange("quotes")} style={pill(value==="quotes")}>Quotes</button>
      <div style={{width:1,height:20,background:C.border}}/>
      <button onClick={()=>onChange("payments")} style={pill(value==="payments")}>Payments</button>
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
// Real Supabase auth. FixFlow is staff/owner only — if the credentials
// belong to an engineer account (they now sign in at portal.easyrepair.co.uk
// instead), we sign them straight back out and explain why, rather than
// letting an engineer role into the admin panel.
function Login({onLogin}) {
  const [mode,setMode]=useState("login"); // "login" | "forgot"
  const [email,setEmail]=useState(""); const [pass,setPass]=useState(""); const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);
  const [resetMsg,setResetMsg]=useState("");
  const go = async () => {
    setErr(""); setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) { setErr("Incorrect email or password."); setLoading(false); return; }
    const { data: profile, error: profErr } = await supabase.from("profiles").select("*").eq("id", data.user.id).single();
    if (profErr || !profile) {
      await supabase.auth.signOut();
      setErr("Couldn't find an account for this login. Contact an owner."); setLoading(false); return;
    }
    if (profile.role === "engineer") {
      await supabase.auth.signOut();
      setErr("SP's sign in at portal.easyrepair.co.uk — this is the staff/owner admin panel."); setLoading(false); return;
    }
    onLogin(profile);
  };
  // Sends the standard Supabase recovery email. The link it contains lands the
  // user back here with #access_token=...&type=recovery in the hash, which
  // AUTH_HASH/inviteOrRecoveryType() above already know how to catch — App
  // renders SetPasswordScreen for that case exactly the same way it does for
  // an invite link, so no new landing screen is needed here.
  const sendReset = async () => {
    setErr(""); setResetMsg("");
    if (!email) { setErr("Enter your email above first."); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setResetMsg("If an account exists for that email, we've sent a link to reset your password. Check your inbox.");
  };
  const switchMode = m => { setMode(m); setErr(""); setResetMsg(""); };
  return (
    <div style={{minHeight:"100vh",background:"#000000",color:C.text,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter','Segoe UI',sans-serif",padding:16}}>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <img src="/logo.png" alt="Easy Repair" style={{height:80,margin:"0 auto 10px",display:"block"}}/>
          <div style={{color:"#94A2B8",fontSize:11,marginTop:2}}>FixFlow — Internal Portal</div>
        </div>
        <div style={{background:"#141414",borderRadius:16,padding:30,boxShadow:"0 24px 80px rgba(0,0,0,.6)",border:"1px solid #262626"}}>
          {mode==="login" ? (
            <>
              <Fl label="Email"><input style={inp} value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@easyrepair.co.uk" onKeyDown={e=>e.key==="Enter"&&go()}/></Fl>
              <Fl label="Password"><input type="password" style={inp} value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&go()}/></Fl>
              <div style={{textAlign:"right",marginTop:-3,marginBottom:14}}>
                <button onClick={()=>switchMode("forgot")} style={{background:"none",border:"none",padding:0,color:"#94A3B8",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Forgot your password?</button>
              </div>
              {err&&<div style={{background:"rgba(248,113,113,0.15)",color:"#f87171",borderRadius:7,padding:"8px 12px",fontSize:13,marginBottom:12,fontWeight:600,border:"1px solid rgba(248,113,113,0.3)"}}>{err}</div>}
              <Btn onClick={go} full style={{padding:"12px 0",fontSize:14,opacity:loading?.7:1}}>{loading?"Signing in…":"Sign In →"}</Btn>
            </>
          ) : (
            <>
              <div style={{fontSize:13,color:"#94A3B8",marginBottom:16,lineHeight:1.5}}>Enter your email and we'll send you a link to reset your password.</div>
              <Fl label="Email"><input style={inp} value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@easyrepair.co.uk" onKeyDown={e=>e.key==="Enter"&&sendReset()}/></Fl>
              {err&&<div style={{background:"rgba(248,113,113,0.15)",color:"#f87171",borderRadius:7,padding:"8px 12px",fontSize:13,marginBottom:12,fontWeight:600,border:"1px solid rgba(248,113,113,0.3)"}}>{err}</div>}
              {resetMsg&&<div style={{background:"rgba(74,222,128,0.12)",color:"#4ade80",borderRadius:7,padding:"8px 12px",fontSize:13,marginBottom:12,fontWeight:600,border:"1px solid rgba(74,222,128,0.3)"}}>{resetMsg}</div>}
              <Btn onClick={sendReset} full style={{padding:"12px 0",fontSize:14,opacity:loading?.7:1}}>{loading?"Sending…":"Send Reset Link →"}</Btn>
              <div style={{textAlign:"center",marginTop:16}}>
                <button onClick={()=>switchMode("login")} style={{background:"none",border:"none",padding:0,color:"#94A3B8",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>← Back to login</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SET PASSWORD (invite / reset link landing) ────────────────────────────────
function SetPasswordScreen({onDone}) {
  const [pass,setPass]=useState(""); const [confirm,setConfirm]=useState(""); const [err,setErr]=useState(""); const [busy,setBusy]=useState(false);
  const submit = async () => {
    setErr("");
    if(pass.length<8){setErr("Password must be at least 8 characters.");return;}
    if(pass!==confirm){setErr("Passwords don't match.");return;}
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pass });
    setBusy(false);
    if(error){setErr(error.message);return;}
    window.history.replaceState(null,"",window.location.pathname+window.location.search);
    onDone();
  };
  return (
    <div style={{minHeight:"100vh",background:"#000000",color:C.text,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter','Segoe UI',sans-serif",padding:16}}>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <img src="/logo.png" alt="Easy Repair" style={{height:40,margin:"0 auto 10px",display:"block"}}/>
          <div style={{color:"#94A2B8",fontSize:11,marginTop:2}}>Set your password</div>
        </div>
        <div style={{background:"#141414",borderRadius:16,padding:30,boxShadow:"0 24px 80px rgba(0,0,0,.6)",border:"1px solid #262626"}}>
          <Fl label="New Password"><input type="password" style={inp} value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••"/></Fl>
          <Fl label="Confirm Password"><input type="password" style={inp} value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&submit()}/></Fl>
          {err&&<div style={{background:"rgba(248,113,113,0.15)",color:"#f87171",borderRadius:7,padding:"8px 12px",fontSize:13,marginBottom:12,fontWeight:600}}>{err}</div>}
          <Btn onClick={submit} full style={{padding:"12px 0",fontSize:14,opacity:busy?.7:1}}>{busy?"Saving…":"Set Password →"}</Btn>
        </div>
      </div>
    </div>
  );
}

// ─── JOB FORM ─────────────────────────────────────────────────────────────────
function JobForm({initial,onSave,onCancel,canEditRate,engineers,jobs,defaultStatus="Booked"}) {
  const blank = {customer:"",phone:"",email:"",address:"",postcode:"",appliance:APPLIANCE_TYPES[0],brand:"",applianceAge:"",issue:"",source:SOURCES[0],status:defaultStatus,engineerId:null,scheduledDate:"",scheduledTime:"09:00",completedDate:"",priority:"Normal",partsNeeded:false,partsOrdered:false,partsArrived:false,rate:"",paid:false,notes:"",isExternal:false,externalName:"",externalPhone:"",externalEmail:"",externalCompany:""};
  const [f,setF] = useState(initial?{...initial,rate:initial.rate??""}:blank);
  const [hint,setHint] = useState(null);
  const set = (k,v) => setF(p=>({...p,[k]:v}));
  const brandList = BRANDS[f.appliance]||[];

  const tryAuto = () => {
    const s = autoAssign(f, engineers, jobs);
    if (s) { setHint({type:"ok",msg:`Best match: ${s.name} (${Math.round(s.stats.repairs/(s.stats.repairs+s.stats.beyondRepair)*100)||0}% success rate)`}); set("engineerId",s.id); if(!f.rate&&canEditRate) set("rate",s.rate); }
    else setHint({type:"err",msg:"No eligible SP found for this postcode, appliance and brand combination."});
  };

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Fl label="Customer Name"><input style={inp} value={f.customer} onChange={e=>set("customer",e.target.value)} placeholder="Full name"/></Fl>
        <Fl label="Phone"><input style={inp} value={f.phone} onChange={e=>set("phone",e.target.value)} placeholder="07..."/></Fl>
        <Fl label="Email"><input style={inp} value={f.email} onChange={e=>set("email",e.target.value)}/></Fl>
        <Fl label="Source Website"><select style={inp} value={f.source} onChange={e=>set("source",e.target.value)}>{SOURCES.map(s=><option key={s}>{s}</option>)}</select>{f.sourceUrl&&<div style={{fontSize:11,color:C.mid,marginTop:4,wordBreak:"break-all"}}>Captured URL: <a href={f.sourceUrl} target="_blank" rel="noreferrer" style={{color:C.primary}}>{f.sourceUrl}</a></div>}</Fl>
      </div>
      <Fl label="Full Address (inc. postcode)"><input style={inp} value={f.address} onChange={e=>set("address",e.target.value)} placeholder="Street, City, Postcode"/></Fl>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <Fl label="Postcode area (for matching)"><input style={inp} value={f.postcode} onChange={e=>set("postcode",e.target.value.toUpperCase())} placeholder="e.g. M1 or LS2"/></Fl>
        <Fl label="Appliance Type"><select style={inp} value={f.appliance} onChange={e=>{set("appliance",e.target.value);set("brand","");}}>{APPLIANCE_TYPES.map(a=><option key={a}>{a}</option>)}</select></Fl>
        <Fl label="Brand"><select style={inp} value={f.brand} onChange={e=>set("brand",e.target.value)}><option value="">— Select —</option>{brandList.map(b=><option key={b}>{b}</option>)}</select></Fl>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
        <Fl label="Appliance Age (years)"><input type="number" min="0" max="30" style={inp} value={f.applianceAge} onChange={e=>set("applianceAge",e.target.value)} placeholder="e.g. 5"/></Fl>
        <Fl label="Priority"><select style={inp} value={f.priority} onChange={e=>set("priority",e.target.value)}><option>Normal</option><option>High</option><option>Urgent</option></select></Fl>
        <Fl label="Status"><select style={inp} value={f.status} onChange={e=>set("status",e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></Fl>
      </div>
      <Fl label="Fault Description"><textarea style={ta} value={f.issue} onChange={e=>set("issue",e.target.value)} placeholder="Describe the fault in detail..."/></Fl>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Fl label="Scheduled Date"><input type="date" style={inp} value={f.scheduledDate} onChange={e=>set("scheduledDate",e.target.value)}/></Fl>
        <Fl label="Scheduled Time"><input type="time" style={inp} value={f.scheduledTime} onChange={e=>set("scheduledTime",e.target.value)}/></Fl>
      </div>

      <div style={{background:C.primaryLight,border:`1px solid #BFDBFE`,borderRadius:9,padding:"12px 14px",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,flexWrap:"wrap",gap:8}}>
          <span style={{fontSize:12,fontWeight:700,color:C.primary}}>SP Assignment</span>
          {!f.isExternal&&<Btn onClick={tryAuto} sm>⚡ Auto-Assign Best Match</Btn>}
        </div>
        <div style={{display:"flex",gap:8,marginBottom:10}}>
          <button type="button" onClick={()=>set("isExternal",false)} style={{flex:1,border:"none",borderRadius:7,padding:"7px 0",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",background:!f.isExternal?C.primary:"rgba(255,255,255,0.07)",color:!f.isExternal?"#000":C.mid}}>In-house SP</button>
          <button type="button" onClick={()=>set("isExternal",true)} style={{flex:1,border:"none",borderRadius:7,padding:"7px 0",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",background:f.isExternal?C.primary:"rgba(255,255,255,0.07)",color:f.isExternal?"#000":C.mid}}>External SP (one-off)</button>
        </div>
        {f.isExternal ? (
          <div>
            <div style={{fontSize:11,color:C.mid,lineHeight:1.5,marginBottom:10}}>
              Use this when no in-house SP covers this job's area — bring in a one-time external SP for just this booking. Their details are kept with this job only; they won't get a Portal login or appear on the SP's page.
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Fl label="SP / Contractor Name"><input style={inp} value={f.externalName} onChange={e=>set("externalName",e.target.value)} placeholder="Full name"/></Fl>
              <Fl label="Phone"><input style={inp} value={f.externalPhone} onChange={e=>set("externalPhone",e.target.value)} placeholder="07..."/></Fl>
              <Fl label="Email (optional)"><input style={inp} value={f.externalEmail} onChange={e=>set("externalEmail",e.target.value)}/></Fl>
              <Fl label="Company (optional)"><input style={inp} value={f.externalCompany} onChange={e=>set("externalCompany",e.target.value)} placeholder="e.g. sole trader / agency name"/></Fl>
            </div>
          </div>
        ) : (
          <>
            {hint&&<div style={{fontSize:12,fontWeight:600,marginBottom:8,color:hint.type==="ok"?C.success:C.danger}}>{hint.type==="ok"?"✓":"✕"} {hint.msg}</div>}
            <select style={inp} value={f.engineerId||""} onChange={e=>{const v=e.target.value;set("engineerId",v||null);if(v&&!f.rate&&canEditRate){const en=engineers.find(x=>x.id===v);if(en)set("rate",en.rate);}}}>
              <option value="">— Unassigned —</option>
              {engineers.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </>
        )}
      </div>

      {canEditRate&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Fl label="SP Rate (£)"><input type="number" style={inp} value={f.rate} onChange={e=>set("rate",e.target.value)}/></Fl>
          <Fl label="Date Completed"><input type="date" style={inp} value={f.completedDate||""} onChange={e=>set("completedDate",e.target.value)}/></Fl>
        </div>
      )}
      <div style={{display:"flex",gap:18,marginBottom:12,flexWrap:"wrap"}}>
        {[["partsNeeded","Parts needed"],["partsOrdered","Parts ordered"],["partsArrived","Parts arrived"],...(canEditRate?[["paid","SP paid"]]:[])] .map(([k,l])=>(
          <label key={k} style={{display:"flex",alignItems:"center",gap:5,fontSize:13,cursor:"pointer"}}><input type="checkbox" checked={!!f[k]} onChange={e=>set(k,e.target.checked)}/>{l}</label>
        ))}
      </div>
      <Fl label="Internal Notes"><textarea style={ta} value={f.notes} onChange={e=>set("notes",e.target.value)} placeholder="Admin notes (not visible to customer)..."/></Fl>
      <div style={{display:"flex",gap:10,marginTop:8}}>
        <Btn onClick={()=>onSave(f)} full style={{padding:"10px 0"}}>Save Job</Btn>
        <Btn onClick={onCancel} variant="ghost" full style={{padding:"10px 0"}}>Cancel</Btn>
      </div>
    </div>
  );
}

// ─── JOB DETAIL ───────────────────────────────────────────────────────────────
// Staff/owner only now — engineers manage their own jobs in the Portal.
function JobDetail({job,onClose,onEdit,onReassign,onDelete,engineers}) {
  const eng = engineers.find(e=>e.id===job.engineerId);
  return (
    <div>
      <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap"}}>
        <Badge status={job.status}/><PBadge p={job.priority}/>
        {job.partsNeeded&&<span style={{background:C.warnLight,color:C.warn,padding:"2px 8px",borderRadius:4,fontSize:10,fontWeight:800}}>PARTS{job.partsOrdered?" · ORDERED":""}{job.partsArrived?" · ARRIVED":""}</span>}
      </div>

      {/* Appliance banner */}
      <div style={{background:C.primaryLight,border:`1px solid #BFDBFE`,borderRadius:9,padding:"10px 16px",marginBottom:14,display:"flex",gap:24,flexWrap:"wrap",alignItems:"center"}}>
        {[["Appliance",job.appliance],["Brand",job.brand||"Unknown"],["Age",job.applianceAge?`${job.applianceAge} yr${job.applianceAge!=1?"s":""}` :"Unknown"],["Source",job.source]].map(([l,v])=>(
          <div key={l}><div style={{fontSize:10,color:C.light,fontWeight:700,textTransform:"uppercase"}}>{l}</div><div style={{fontWeight:700,fontSize:14,color:C.text}}>{v}</div></div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        <div style={{background:"#1E2530",borderRadius:9,padding:12}}>
          <div style={{fontSize:10,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:5}}>Customer</div>
          <div style={{fontWeight:700,fontSize:14}}>{job.customer}</div>
          <div style={{color:C.mid,fontSize:12,marginTop:2}}>📞 {job.phone}</div>
          <div style={{color:C.mid,fontSize:12}}>✉ {job.email}</div>
          {job.preferredCallTime&&<div style={{color:C.mid,fontSize:12,marginTop:2}}>🕐 Prefers: {job.preferredCallTime}</div>}
        </div>
        <div style={{background:"#1E2530",borderRadius:9,padding:12}}>
          <div style={{fontSize:10,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:5}}>SP</div>
          {job.isExternal ? (
            <>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{fontWeight:700,fontSize:14}}>{job.externalName}</div>
                <span style={{background:C.purpleLight,color:C.purple,padding:"1px 7px",borderRadius:10,fontSize:9,fontWeight:800}}>EXTERNAL</span>
              </div>
              {job.externalCompany&&<div style={{color:C.mid,fontSize:12,marginTop:2}}>{job.externalCompany}</div>}
              {job.externalPhone&&<div style={{color:C.mid,fontSize:12,marginTop:2}}>📞 {job.externalPhone}</div>}
              {job.externalEmail&&<div style={{color:C.mid,fontSize:12}}>✉ {job.externalEmail}</div>}
            </>
          ) : eng?<><div style={{fontWeight:700,fontSize:14}}>{eng.name}</div><div style={{color:C.mid,fontSize:12,marginTop:2}}>📞 {eng.phone}</div></>
              :<div style={{color:C.danger,fontStyle:"italic",fontSize:13}}>Not assigned</div>}
          <Btn onClick={onReassign} variant="ghost" sm style={{marginTop:8}}>⇄ Reassign SP</Btn>
        </div>
        <div style={{background:"#1E2530",borderRadius:9,padding:12}}>
          <div style={{fontSize:10,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:5}}>Scheduled</div>
          <div style={{fontWeight:700}}>{fmt(job.scheduledDate)} at {job.scheduledTime}</div>
          {job.completedDate&&<div style={{color:C.success,fontSize:12,fontWeight:600,marginTop:4}}>✓ Completed {fmt(job.completedDate)}</div>}
        </div>
        <div style={{background:"#1E2530",borderRadius:9,padding:12}}>
          <div style={{fontSize:10,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:5}}>SP Pay</div>
          <div style={{fontWeight:900,fontSize:18,color:job.paid?C.success:C.danger}}>{job.rate?`£${job.rate}`:"—"}<span style={{fontSize:10,marginLeft:6,fontWeight:700}}>{job.paid?"✓ PAID":"UNPAID"}</span></div>
        </div>
      </div>

      <div style={{background:"#1E2530",borderRadius:9,padding:12,marginBottom:12}}>
        <div style={{fontSize:10,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>Address</div>
        <div style={{fontSize:13}}>{job.address}</div>
        {job.postcode&&<div style={{fontSize:13,fontWeight:700,color:C.text,marginTop:3,letterSpacing:.3}}>{job.postcode}</div>}
        <a href={`https://maps.google.com?q=${encodeURIComponent(job.postcode?`${job.address}, ${job.postcode}`:job.address)}`} target="_blank" rel="noreferrer" style={{fontSize:12,color:C.primary,marginTop:3,display:"inline-block"}}>Open in Maps →</a>
      </div>

      <div style={{background:"#1E2530",borderRadius:9,padding:12,marginBottom:12}}>
        {job.sourceUrl&&<div style={{background:"#1E2530",borderRadius:9,padding:12,marginBottom:12}}><div style={{fontSize:10,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>Booking Form URL</div><a href={job.sourceUrl} target="_blank" rel="noreferrer" style={{fontSize:13,color:C.primary,wordBreak:"break-all"}}>{job.sourceUrl}</a>{job.referrerUrl&&<div style={{color:C.mid,fontSize:12,marginTop:6}}>Referred from: {job.referrerUrl}</div>}</div>}<div style={{fontSize:10,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>Fault Description</div>
        <div style={{fontSize:13}}>{job.issue}</div>
      </div>

      <div style={{background:"#1E2530",borderRadius:9,padding:12,marginBottom:12}}>
        <div style={{fontSize:10,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:8}}>Customer Notifications</div>
        {[["📩","Booking Confirmation",job.notifBooking],["🔔","Day-Before Reminder",job.notifReminder],["🚗","SP On the Way",job.notifOnWay],["✅","Job Completed",job.notifComplete]].map(([ic,lb,sent])=>(
          <div key={lb} style={{display:"flex",alignItems:"center",gap:9,padding:"6px 0",borderBottom:`1px solid ${C.border}`}}>
            <span>{ic}</span><div style={{flex:1,fontSize:13,fontWeight:600}}>{lb}</div>
            <span style={{fontSize:10,fontWeight:700,padding:"2px 7px",borderRadius:9,background:sent?C.successLight:"#F1F5F9",color:sent?C.success:C.light}}>{sent?"SENT":"PENDING"}</span>
          </div>
        ))}
      </div>

      {job.notes&&<div style={{background:"rgba(251,191,36,0.08)",borderRadius:9,padding:12,marginBottom:12,border:"1px solid rgba(251,191,36,0.25)"}}><div style={{fontSize:10,color:"#fbbf24",fontWeight:700,textTransform:"uppercase",marginBottom:4}}>Notes</div><div style={{fontSize:13,color:"#F1F5F9",whiteSpace:"pre-wrap"}}>{job.notes}</div></div>}
      <Btn onClick={onEdit} variant="ghost" full style={{padding:"10px 0"}}>✏ Edit This Job</Btn>
      {onDelete&&<Btn onClick={onDelete} variant="danger" full style={{padding:"10px 0",marginTop:8}}>🗑 Delete Booking</Btn>}
    </div>
  );
}

// ─── REASSIGN MODAL ───────────────────────────────────────────────────────────
// onReassign is called with either {type:"inhouse", engineerId} (engineerId
// may be null for "Unassigned") or {type:"external", external:{name,phone,
// email,company}} — see doReassign in the main App component.
function ReassignModal({job,engineers,jobs,onReassign,onClose}) {
  const [mode,setMode] = useState(job.isExternal?"external":"inhouse");
  const [chosen,setChosen] = useState(job.engineerId||"");
  const [ext,setExt] = useState({name:job.externalName||"",phone:job.externalPhone||"",email:job.externalEmail||"",company:job.externalCompany||""});
  const setExtField = (k,v)=>setExt(p=>({...p,[k]:v}));
  const suggested = useMemo(()=>autoAssign(job,engineers,jobs),[]);
  const canConfirm = mode==="inhouse" || ext.name.trim().length>0;

  const confirm = () => {
    if(!canConfirm) return;
    if(mode==="external") onReassign({type:"external",external:ext});
    else onReassign({type:"inhouse",engineerId:chosen||null});
  };

  return (
    <Modal title={`Reassign — Job #${job.id}: ${job.customer}`} onClose={onClose}>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <button type="button" onClick={()=>setMode("inhouse")} style={{flex:1,border:"none",borderRadius:7,padding:"7px 0",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",background:mode==="inhouse"?C.primary:"rgba(255,255,255,0.07)",color:mode==="inhouse"?"#000":C.mid}}>In-house SP</button>
        <button type="button" onClick={()=>setMode("external")} style={{flex:1,border:"none",borderRadius:7,padding:"7px 0",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",background:mode==="external"?C.primary:"rgba(255,255,255,0.07)",color:mode==="external"?"#000":C.mid}}>External SP (one-off)</button>
      </div>

      {mode==="external" ? (
        <div style={{marginBottom:14}}>
          <div style={{fontSize:11,color:C.mid,lineHeight:1.5,marginBottom:10}}>No in-house SP for this one? Bring in a one-time external SP for just this booking.</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Fl label="SP / Contractor Name"><input style={inp} value={ext.name} onChange={e=>setExtField("name",e.target.value)} placeholder="Full name"/></Fl>
            <Fl label="Phone"><input style={inp} value={ext.phone} onChange={e=>setExtField("phone",e.target.value)} placeholder="07..."/></Fl>
            <Fl label="Email (optional)"><input style={inp} value={ext.email} onChange={e=>setExtField("email",e.target.value)}/></Fl>
            <Fl label="Company (optional)"><input style={inp} value={ext.company} onChange={e=>setExtField("company",e.target.value)} placeholder="e.g. sole trader / agency name"/></Fl>
          </div>
        </div>
      ) : (
        <>
          {suggested&&<div style={{background:C.successLight,border:`1px solid #A7F3D0`,borderRadius:8,padding:"10px 14px",marginBottom:14,fontSize:13,fontWeight:600,color:C.success}}>⚡ Auto-suggestion: <strong>{suggested.name}</strong> — best match for postcode, appliance &amp; brand</div>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
            {engineers.map(e=>{
              const pc=(job.postcode||"").toUpperCase(); const pcA=pc.replace(/[0-9\s]+$/,"");
              const covers=e.postcodes.some(p=>{const up=p.toUpperCase();return pc===up||pc.startsWith(up)||pcA===up;});
              const handles=e.applianceTypes.includes(job.appliance);
              const excl=(e.brandExclusions[job.appliance]||[]).includes(job.brand);
              const ok=covers&&handles&&!excl;
              const done=jobs.filter(j=>j.engineerId===e.id&&j.status==="Completed").length;
              const ber=jobs.filter(j=>j.engineerId===e.id&&j.status==="Beyond Repair").length;
              return (
                <div key={e.id} onClick={()=>setChosen(e.id)} style={{border:`2px solid ${chosen===e.id?C.primary:C.border}`,borderRadius:9,padding:"10px 12px",cursor:"pointer",background:chosen===e.id?C.primaryLight:"#1E2530"}}>
                  <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>{e.name}</div>
                  <div style={{fontSize:11,color:C.success}}>✅ {done} repaired</div>
                  <div style={{fontSize:11,color:C.danger}}>🔴 {ber} BER</div>
                  <div style={{fontSize:11,color:C.mid}}>Success: {pct(done,done+ber)}</div>
                  {!ok&&<div style={{fontSize:10,color:C.warn,marginTop:4,fontWeight:700}}>⚠ Outside criteria</div>}
                </div>
              );
            })}
          </div>
          <Fl label="Or select manually">
            <select style={inp} value={chosen} onChange={e=>setChosen(e.target.value)}>
              <option value="">— Unassigned —</option>
              {engineers.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Fl>
        </>
      )}

      <div style={{display:"flex",gap:10,marginTop:10}}>
        <Btn onClick={confirm} full style={{padding:"10px 0",opacity:canConfirm?1:.6,cursor:canConfirm?"pointer":"not-allowed"}}>Confirm Reassignment</Btn>
        <Btn onClick={onClose} variant="ghost" full style={{padding:"10px 0"}}>Cancel</Btn>
      </div>
    </Modal>
  );
}

// ─── ENGINEER PROFILE EDITOR (existing engineers only — see AddEngineerModal
// for creating new ones, which is where login provisioning happens) ──────────
const ENG_DAYS = [["mon","Mon"],["tue","Tue"],["wed","Wed"],["thu","Thu"],["fri","Fri"],["sat","Sat"],["sun","Sun"]];
const ENG_DOC_KINDS = [
  { key:"id", label:"Photo ID", pathField:"idDocumentPath", uploadedField:"idDocumentUploadedAt", column:"id_document_path", uploadedColumn:"id_document_uploaded_at" },
  { key:"insurance", label:"Public Liability Insurance", pathField:"insuranceDocumentPath", uploadedField:"insuranceDocumentUploadedAt", column:"insurance_document_path", uploadedColumn:"insurance_document_uploaded_at" },
];

function EngineerEditor({eng,onSave,onCancel,isOwner}) {
  const [e,setE] = useState({...eng,brandExclusions:{...APPLIANCE_TYPES.reduce((a,t)=>({...a,[t]:[]}),{}),workingHours:eng.workingHours||{},...eng.brandExclusions}});
  const [newPc,setNewPc] = useState("");
  const [uploading,setUploading] = useState(null);
  const [uploadErr,setUploadErr] = useState("");
  const [viewingDoc,setViewingDoc] = useState(null);
  const [viewErr,setViewErr] = useState("");
  const setEng=(k,v)=>setE(p=>({...p,[k]:v}));
  const setDay=(day,patch)=>setEng("workingHours",{...e.workingHours,[day]:{...(e.workingHours[day]||{}),...patch}});
  const gaps = engineerProfileGaps(e);

  const uploadDoc = async (kind, file) => {
    if(!file) return;
    setUploadErr(""); setUploading(kind.key);
    const ext = file.name.split(".").pop()||"pdf";
    const path = `${eng.profileId}/${kind.key}-document.${ext}`;
    const { error: upErr } = await supabase.storage.from("engineer-documents").upload(path, file, {upsert:true});
    if(upErr){ setUploadErr(upErr.message); setUploading(null); return; }
    const nowIso = new Date().toISOString();
    // Written straight to the engineers row (not deferred to "Save All
    // Changes") so the file and its DB pointer never fall out of sync if
    // staff upload a document then cancel the rest of the form.
    const { error: dbErr } = await supabase.from("engineers").update({[kind.column]:path,[kind.uploadedColumn]:nowIso}).eq("id",eng.id);
    setUploading(null);
    if(dbErr){ setUploadErr(dbErr.message); return; }
    setEng(kind.pathField, path); setEng(kind.uploadedField, nowIso);
  };
  // The engineer-documents bucket is private (RLS-gated, not a public bucket -- see
  // "engineer docs: staff/owner can manage all" storage policy), so there's no plain
  // URL to link to. A short-lived signed URL is generated on demand each time staff
  // click View, opened in a new tab, and never stored -- it's only valid for 60s.
  const viewDoc = async (kind) => {
    const path = e[kind.pathField];
    if(!path) return;
    setViewErr(""); setViewingDoc(kind.key);
    const { data, error } = await supabase.storage.from("engineer-documents").createSignedUrl(path, 60);
    setViewingDoc(null);
    if(error){ setViewErr(error.message); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const addPc=()=>{const pc=newPc.trim().toUpperCase();if(pc&&!e.postcodes.includes(pc))setEng("postcodes",[...e.postcodes,pc]);setNewPc("");};
  const remPc=pc=>setEng("postcodes",e.postcodes.filter(x=>x!==pc));
  const toggleApp=a=>setEng("applianceTypes",e.applianceTypes.includes(a)?e.applianceTypes.filter(x=>x!==a):[...e.applianceTypes,a]);
  const toggleExcl=(app,brand)=>{const cur=e.brandExclusions[app]||[];setEng("brandExclusions",{...e.brandExclusions,[app]:cur.includes(brand)?cur.filter(b=>b!==brand):[...cur,brand]});};
  return (
    <div>
      <div style={{fontWeight:800,fontSize:13,color:C.mid,marginBottom:12,paddingBottom:8,borderBottom:`1px solid ${C.border}`,textTransform:"uppercase",letterSpacing:.5}}>Contact Details</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
        <Fl label="Full Name"><input style={inp} value={e.name} onChange={ev=>setEng("name",ev.target.value)}/></Fl>
        <Fl label="Phone"><input style={inp} value={e.phone} onChange={ev=>setEng("phone",ev.target.value)}/></Fl>
        <Fl label="Portal Login Email"><input style={inp} value={e.email} disabled/></Fl>
        {isOwner&&<Fl label="Pay Rate (£ per job)"><input type="number" style={inp} value={e.rate} onChange={ev=>setEng("rate",Number(ev.target.value))}/></Fl>}
      </div>
      <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:18,fontSize:13}}>
        <input type="checkbox" checked={!!e.selfServiceEnabled} onChange={ev=>setEng("selfServiceEnabled",ev.target.checked)}/>
        Let this SP edit their own Portal Settings (skills, coverage)
      </label>

      <div style={{fontWeight:800,fontSize:13,color:C.mid,marginBottom:10,paddingBottom:8,borderBottom:`1px solid ${C.border}`,textTransform:"uppercase",letterSpacing:.5}}>Postcode Areas Covered</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
        {e.postcodes.map(pc=>(
          <span key={pc} style={{background:C.primaryLight,color:C.primary,padding:"3px 9px",borderRadius:6,fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:4}}>
            {pc}
            <button onClick={()=>remPc(pc)} style={{background:"none",border:"none",cursor:"pointer",color:C.primary,fontSize:14,padding:0,lineHeight:1}}>×</button>
          </span>
        ))}
        {!e.postcodes.length&&<span style={{color:C.light,fontSize:12,fontStyle:"italic"}}>No areas added yet</span>}
      </div>
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        <input style={{...inp,maxWidth:130}} value={newPc} onChange={ev=>setNewPc(ev.target.value)} placeholder="e.g. M1 or LS" onKeyDown={ev=>ev.key==="Enter"&&addPc()}/>
        <Btn onClick={addPc} sm>+ Add</Btn>
      </div>

      <div style={{fontWeight:800,fontSize:13,color:C.mid,marginBottom:10,paddingBottom:8,borderBottom:`1px solid ${C.border}`,textTransform:"uppercase",letterSpacing:.5}}>Appliance Types &amp; Brand Exclusions</div>
      <div style={{fontSize:11,color:C.light,marginBottom:12}}>Tick the appliance types this SP handles. For each active type, click any brands they <strong>won't</strong> repair (highlighted in red).</div>
      {APPLIANCE_TYPES.map(app=>{
        const active=e.applianceTypes.includes(app);
        const excl=e.brandExclusions[app]||[];
        return (
          <div key={app} style={{marginBottom:10,background:active?"#141414":"#000000",borderRadius:9,padding:"10px 13px",border:`1.5px solid ${active?C.border:"transparent"}`}}>
            <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",marginBottom:active?10:0}}>
              <input type="checkbox" checked={active} onChange={()=>toggleApp(app)}/>
              <span style={{fontWeight:700,fontSize:13,color:active?C.text:C.light}}>{app}</span>
              {active&&excl.length>0&&<span style={{fontSize:10,color:C.danger,fontWeight:700}}>({excl.length} brand{excl.length>1?"s":""} excluded)</span>}
            </label>
            {active&&(
              <div>
                <div style={{fontSize:10,color:C.light,fontWeight:700,marginBottom:6,textTransform:"uppercase"}}>Won't repair — click to toggle:</div>
                <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                  {(BRANDS[app]||[]).filter(b=>b!=="Other").map(b=>(
                    <button key={b} onClick={()=>toggleExcl(app,b)} style={{padding:"3px 9px",borderRadius:5,border:`1.5px solid ${excl.includes(b)?C.danger:C.border}`,background:excl.includes(b)?C.dangerLight:"#fff",color:excl.includes(b)?C.danger:C.mid,fontSize:11,fontWeight:excl.includes(b)?700:400,cursor:"pointer",fontFamily:"inherit"}}>
                      {excl.includes(b)?"✕ ":""}{b}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div style={{fontWeight:800,fontSize:13,color:C.mid,marginBottom:10,paddingBottom:8,borderBottom:`1px solid ${C.border}`,textTransform:"uppercase",letterSpacing:.5,marginTop:20}}>Working Hours</div>
      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:20}}>
        {ENG_DAYS.map(([key,label])=>{
          const d=e.workingHours[key]||{};
          return (
            <div key={key} style={{display:"flex",alignItems:"center",gap:10,fontSize:12,background:"#000",borderRadius:7,padding:"7px 10px"}}>
              <span style={{width:36,color:C.text,fontWeight:700}}>{label}</span>
              <label style={{display:"flex",alignItems:"center",gap:5,color:C.mid}}>
                <input type="checkbox" checked={!!d.off} onChange={ev=>setDay(key,{off:ev.target.checked})}/> Off
              </label>
              {!d.off&&(
                <>
                  <input type="time" style={{...inp,width:110,padding:"5px 8px"}} value={d.start||"09:00"} onChange={ev=>setDay(key,{start:ev.target.value})}/>
                  <span style={{color:C.mid}}>to</span>
                  <input type="time" style={{...inp,width:110,padding:"5px 8px"}} value={d.end||"17:00"} onChange={ev=>setDay(key,{end:ev.target.value})}/>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div style={{fontWeight:800,fontSize:13,color:C.mid,marginBottom:10,paddingBottom:8,borderBottom:`1px solid ${C.border}`,textTransform:"uppercase",letterSpacing:.5}}>Documents</div>
      {uploadErr&&<div style={{background:"rgba(248,113,113,0.15)",color:"#f87171",borderRadius:7,padding:"8px 12px",fontSize:13,marginBottom:10,fontWeight:600}}>{uploadErr}</div>}
      {viewErr&&<div style={{background:"rgba(248,113,113,0.15)",color:"#f87171",borderRadius:7,padding:"8px 12px",fontSize:13,marginBottom:10,fontWeight:600}}>{viewErr}</div>}
      <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
        {ENG_DOC_KINDS.map(kind=>{
          const uploadedAt = e[kind.uploadedField];
          const hasFile = !!e[kind.pathField];
          return (
            <div key={kind.key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",background:"#000",borderRadius:7,padding:"8px 12px",fontSize:12}}>
              <div>
                <span style={{color:C.text,fontWeight:600}}>{kind.label}</span>
                {uploadedAt&&<span style={{marginLeft:8,color:C.light}}>Uploaded {new Date(uploadedAt).toLocaleDateString("en-GB")}</span>}
              </div>
              <div style={{display:"flex",gap:6}}>
                {hasFile&&(
                  <button
                    onClick={()=>viewDoc(kind)}
                    disabled={viewingDoc===kind.key}
                    style={{fontSize:11,fontWeight:700,borderRadius:6,padding:"5px 10px",cursor:"pointer",background:"transparent",color:C.primary,border:`1.5px solid ${C.primary}`,opacity:viewingDoc===kind.key?0.7:1,fontFamily:"inherit"}}
                  >
                    {viewingDoc===kind.key?"Opening…":"View"}
                  </button>
                )}
                <label style={{fontSize:11,fontWeight:700,borderRadius:6,padding:"5px 10px",cursor:"pointer",background:uploadedAt?"#1a1a1a":C.primary,color:uploadedAt?C.text:"#000",opacity:uploading===kind.key?0.7:1}}>
                  {uploading===kind.key?"Uploading…":uploadedAt?"Replace":"Upload"}
                  <input type="file" accept="image/*,.pdf" style={{display:"none"}} onChange={ev=>uploadDoc(kind,ev.target.files?.[0])}/>
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <Fl label="Insurance Expiry Date"><input type="date" style={inp} value={e.insuranceExpiryDate||""} onChange={ev=>setEng("insuranceExpiryDate",ev.target.value)}/></Fl>

      {gaps.length>0&&(
        <div style={{background:"rgba(251,191,36,0.12)",border:"1px solid rgba(251,191,36,0.3)",borderRadius:9,padding:"10px 13px",marginTop:16,marginBottom:6,fontSize:12,color:"#d97706"}}>
          <strong>Profile incomplete:</strong> {gaps.join(", ")}. The SP sees a reminder for these in the Portal until either of you fills them in.
        </div>
      )}

      <div style={{display:"flex",gap:10,marginTop:14}}>
        <Btn onClick={()=>onSave(e)} full style={{padding:"10px 0"}}>Save All Changes</Btn>
        <Btn onClick={onCancel} variant="ghost" full style={{padding:"10px 0"}}>Cancel</Btn>
      </div>
    </div>
  );
}

// supabase.functions.invoke() resolves `error` as a generic FunctionsHttpError whose
// .message is always the same unhelpful "Edge Function returned a non-2xx status code" —
// the actual reason our create-user function gave (e.g. "A user with this email address
// has already been registered") is only available by reading the raw Response it attaches
// as `.context`. Without this, every failure looked identical and gave no clue why.
async function edgeFnErrorMessage(error, fallback){
  if(!error) return null;
  if(error.context && typeof error.context.json==="function"){
    try{
      const body = await error.context.json();
      if(body?.error) return body.error;
    }catch{}
  }
  return error.message || fallback;
}

// ─── ADD ENGINEER MODAL — creates the auth login + engineers row via the
// create-user Edge Function. This is the only place a new engineer account
// gets created, and it's also where staff choose how that engineer gets
// into the Portal for the first time. ─────────────────────────────────────
function AddEngineerModal({onCreated,onCancel}) {
  const [f,setF] = useState({name:"",email:"",phone:"",rate:45,provisioning:"invite",password:""});
  const [busy,setBusy] = useState(false);
  const [err,setErr] = useState("");
  const set=(k,v)=>setF(p=>({...p,[k]:v}));

  const submit = async () => {
    setErr("");
    if(!f.name||!f.email){setErr("Name and email are required.");return;}
    if(f.provisioning==="password"&&f.password.length<8){setErr("Password must be at least 8 characters.");return;}
    setBusy(true);
    const { data: sess } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("create-user", {
      body: {
        name:f.name, email:f.email, phone:f.phone, role:"engineer",
        provisioning:f.provisioning, password:f.provisioning==="password"?f.password:undefined,
        engineer:{ payRate:Number(f.rate)||45, postcodes:[], applianceTypes:[], brandExclusions:{}, selfServiceEnabled:false },
      },
      headers:{ Authorization:`Bearer ${sess?.session?.access_token}` },
    });
    setBusy(false);
    if(error||data?.error){ setErr(data?.error || await edgeFnErrorMessage(error,"Something went wrong creating this SP.")); return; }
    onCreated(data);
  };

  return (
    <Modal title="Add SP" onClose={onCancel}>
      {err&&<div style={{background:"rgba(248,113,113,0.15)",color:"#f87171",borderRadius:7,padding:"8px 12px",fontSize:13,marginBottom:12,fontWeight:600}}>{err}</div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Fl label="Full Name"><input style={inp} value={f.name} onChange={e=>set("name",e.target.value)}/></Fl>
        <Fl label="Phone"><input style={inp} value={f.phone} onChange={e=>set("phone",e.target.value)} placeholder="07..."/></Fl>
        <Fl label="Email"><input style={inp} value={f.email} onChange={e=>set("email",e.target.value)} placeholder="sp@easyrepair.co.uk"/></Fl>
        <Fl label="Pay Rate (£ per job)"><input type="number" style={inp} value={f.rate} onChange={e=>set("rate",e.target.value)}/></Fl>
      </div>
      <div style={{background:C.primaryLight,border:`1px solid #BFDBFE`,borderRadius:9,padding:"12px 14px",marginTop:6,marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:700,color:C.primary,marginBottom:9}}>Portal Access</div>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,marginBottom:8,cursor:"pointer"}}>
          <input type="radio" checked={f.provisioning==="invite"} onChange={()=>set("provisioning","invite")}/>
          Email them an invite link to set their own password (recommended)
        </label>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,cursor:"pointer"}}>
          <input type="radio" checked={f.provisioning==="password"} onChange={()=>set("provisioning","password")}/>
          Set a temporary password myself
        </label>
        {f.provisioning==="password"&&(
          <div style={{marginTop:10}}>
            <input style={inp} type="text" value={f.password} onChange={e=>set("password",e.target.value)} placeholder="Temporary password (min 8 characters)"/>
            <div style={{fontSize:11,color:C.light,marginTop:5}}>Share this password with the SP directly — they can change it once logged in to portal.easyrepair.co.uk.</div>
          </div>
        )}
      </div>
      <div style={{display:"flex",gap:10}}>
        <Btn onClick={submit} full style={{padding:"10px 0",opacity:busy?.7:1}}>{busy?"Creating…":"Create SP"}</Btn>
        <Btn onClick={onCancel} variant="ghost" full style={{padding:"10px 0"}}>Cancel</Btn>
      </div>
    </Modal>
  );
}

// ─── USER MANAGER ─────────────────────────────────────────────────────────────
// Owner/staff accounts only now — engineers are created from the Engineers
// page (AddEngineerModal above), since that's also where their portal
// access gets provisioned. Account creation here goes through the same
// create-user Edge Function so these are real logins too.
function UserManager({users,onUserCreated,currentUserId,tab,onTabChange,onArchive,onRestore,onDelete,onResetPassword}) {
  const [editing,setEditing]=useState(null);
  const [showAdd,setShowAdd]=useState(false);
  const [newU,setNewU]=useState({name:"",email:"",phone:"",role:"staff",provisioning:"invite",password:""});
  const [err,setErr]=useState(""); const [busy,setBusy]=useState(false);
  const setN=(k,v)=>setNewU(p=>({...p,[k]:v}));

  const shown = users.filter(u=>userStatus(u)===tab);
  const counts = { active: users.filter(u=>userStatus(u)==="active").length, archived: users.filter(u=>userStatus(u)==="archived").length };

  const addUser=async ()=>{
    setErr("");
    if(!newU.name||!newU.email){setErr("Name and email are required.");return;}
    if(newU.provisioning==="password"&&newU.password.length<8){setErr("Password must be at least 8 characters.");return;}
    setBusy(true);
    const { data: sess } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("create-user", {
      body:{ name:newU.name, email:newU.email, phone:newU.phone, role:newU.role,
             provisioning:newU.provisioning, password:newU.provisioning==="password"?newU.password:undefined },
      headers:{ Authorization:`Bearer ${sess?.session?.access_token}` },
    });
    setBusy(false);
    if(error||data?.error){ setErr(data?.error || await edgeFnErrorMessage(error,"Something went wrong creating this user.")); return; }
    onUserCreated();
    setNewU({name:"",email:"",phone:"",role:"staff",provisioning:"invite",password:""});setShowAdd(false);
  };

  const saveEdit=async (updated)=>{
    await supabase.from("profiles").update({name:updated.name,phone:updated.phone,role:updated.role}).eq("id",updated.id);
    onUserCreated();
    setEditing(null);
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <h2 style={{margin:0,fontSize:18,fontWeight:900,color:C.text}}>User Accounts</h2>
        <Btn onClick={()=>{setErr("");setShowAdd(true);}}>+ Add User</Btn>
      </div>
      <StatusTabs value={tab} onChange={onTabChange} tabs={[
        {key:"active",label:"Active",count:counts.active},
        {key:"archived",label:"Archive",count:counts.archived},
      ]}/>
      <div style={{background:C.card,borderRadius:13,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
        {shown.map((u,i)=>(
          <div key={u.id} style={{padding:"12px 18px",borderBottom:i<shown.length-1?`1px solid ${C.border}`:"none",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <Av initials={(u.name||u.email).split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)} color={ROLE_C[u.role].color}/>
            <div style={{flex:1,minWidth:120}}>
              <div style={{fontWeight:700,fontSize:13}}>{u.name}</div>
              <div style={{color:C.light,fontSize:11}}>{u.email}</div>
              {tab==="archived"&&<div style={{color:C.light,fontSize:10,marginTop:2}}>Archived {u.archived_at?new Date(u.archived_at).toLocaleDateString("en-GB"):"—"}</div>}
            </div>
            <RolePill role={u.role}/>
            {tab==="active" ? (
              <>
                <Btn onClick={()=>setEditing({...u})} variant="ghost" sm>Edit</Btn>
                <Btn onClick={()=>onResetPassword(u)} variant="ghost" sm>Reset Password</Btn>
                {u.id!==currentUserId&&<Btn onClick={()=>onArchive(u)} variant="ghost" sm style={{color:C.danger}}>Archive</Btn>}
              </>
            ) : (
              <>
                <Btn onClick={()=>onRestore(u)} variant="ghost" sm>Restore</Btn>
                <Btn onClick={()=>onDelete(u)} variant="danger" sm>Delete Forever</Btn>
              </>
            )}
          </div>
        ))}
        {shown.length===0&&<div style={{padding:22,textAlign:"center",color:C.light,fontSize:13}}>{tab==="archived"?"No archived accounts.":"No staff/owner accounts yet."}</div>}
      </div>

      {editing&&(
        <Modal title={`Edit User: ${editing.name}`} onClose={()=>setEditing(null)}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
            <Fl label="Full Name"><input style={inp} value={editing.name} onChange={e=>setEditing(p=>({...p,name:e.target.value}))}/></Fl>
            <Fl label="Role"><select style={inp} value={editing.role} onChange={e=>setEditing(p=>({...p,role:e.target.value}))}><option value="owner">Owner</option><option value="staff">Staff</option></select></Fl>
            <Fl label="Phone"><input style={inp} value={editing.phone} onChange={e=>setEditing(p=>({...p,phone:e.target.value}))}/></Fl>
            <Fl label="Email (login)"><input style={inp} value={editing.email} disabled/></Fl>
          </div>
          <div style={{display:"flex",gap:10}}>
            <Btn onClick={()=>saveEdit(editing)} full style={{padding:"10px 0"}}>Save Changes</Btn>
            <Btn onClick={()=>setEditing(null)} variant="ghost" full style={{padding:"10px 0"}}>Cancel</Btn>
          </div>
        </Modal>
      )}

      {showAdd&&(
        <Modal title="Add New User" onClose={()=>setShowAdd(false)}>
          {err&&<div style={{background:"rgba(248,113,113,0.15)",color:"#f87171",borderRadius:7,padding:"8px 12px",fontSize:13,marginBottom:12,fontWeight:600}}>{err}</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Fl label="Full Name"><input style={inp} value={newU.name} onChange={e=>setN("name",e.target.value)}/></Fl>
            <Fl label="Role"><select style={inp} value={newU.role} onChange={e=>setN("role",e.target.value)}><option value="staff">Staff</option><option value="owner">Owner</option></select></Fl>
            <Fl label="Email"><input style={inp} value={newU.email} onChange={e=>setN("email",e.target.value)}/></Fl>
            <Fl label="Phone"><input style={inp} value={newU.phone} onChange={e=>setN("phone",e.target.value)} placeholder="07..."/></Fl>
          </div>
          <div style={{background:C.primaryLight,border:`1px solid #BFDBFE`,borderRadius:9,padding:"12px 14px",marginTop:6,marginBottom:6}}>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,marginBottom:8,cursor:"pointer"}}>
              <input type="radio" checked={newU.provisioning==="invite"} onChange={()=>setN("provisioning","invite")}/>
              Email an invite link to set their own password (recommended)
            </label>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,cursor:"pointer"}}>
              <input type="radio" checked={newU.provisioning==="password"} onChange={()=>setN("provisioning","password")}/>
              Set a temporary password myself
            </label>
            {newU.provisioning==="password"&&<input style={{...inp,marginTop:10}} value={newU.password} onChange={e=>setN("password",e.target.value)} placeholder="Temporary password (min 8 characters)"/>}
          </div>
          <div style={{display:"flex",gap:10,marginTop:10}}>
            <Btn onClick={addUser} full style={{padding:"10px 0",opacity:busy?.7:1}}>{busy?"Creating…":"Create User"}</Btn>
            <Btn onClick={()=>setShowAdd(false)} variant="ghost" full style={{padding:"10px 0"}}>Cancel</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
// Maps a Supabase `engineers` row (joined with its `profiles` row) to the
// flat shape the rest of this file already expects, so JobForm/ReassignModal/
// EngineerEditor etc. didn't need to change.
function mapEngineerRow(row){
  return {
    id: row.id, profileId: row.profile_id,
    name: row.profile?.name||"", phone: row.profile?.phone||"", email: row.profile?.email||"",
    rate: row.pay_rate, postcodes: row.postcodes||[], applianceTypes: row.appliance_types||[],
    brandExclusions: row.brand_exclusions||{}, selfServiceEnabled: row.self_service_enabled,
    stats: { repairs: row.stats_completed, beyondRepair: row.stats_ber },
    workingHours: row.working_hours||{},
    idDocumentPath: row.id_document_path||null, idDocumentUploadedAt: row.id_document_uploaded_at||null,
    insuranceDocumentPath: row.insurance_document_path||null, insuranceDocumentUploadedAt: row.insurance_document_uploaded_at||null,
    insuranceExpiryDate: row.insurance_expiry_date||null,
    // Carried over from the joined `profiles` row so onboarding-progress and
    // archive status can be computed for engineers the same way as for
    // owner/staff users, from one shared column (see engineerStatus above).
    archivedAt: row.profile?.archived_at||null,
    mustChangePassword: !!row.profile?.must_change_password,
    termsAcceptedAt: row.profile?.terms_accepted_at||null,
  };
}

// Maps a Supabase `bookings` row to the flat shape JobForm/JobDetail/
// ReassignModal etc. already expect (they were originally written against
// SEED_JOBS's local demo shape) -- and the reverse, for writes. Keeping both
// directions next to each other so a renamed/added column is easy to update
// in one place instead of drifting between read and write paths.
function mapBookingRow(row){
  return {
    id: row.id, customer: row.customer, phone: row.phone, email: row.email||"",
    address: row.address||"", postcode: row.postcode||"",
    appliance: row.appliance, brand: row.brand||"", applianceAge: row.appliance_age??"",
    issue: row.issue||"", preferredCallTime: row.preferred_call_time||"",
    source: row.source||"Website", sourceUrl: row.source_url||"", referrerUrl: row.referrer_url||"", status: row.status, engineerId: row.engineer_id,
    // When this came in (existing column, already used to order both the
    // Bookings and Quotes lists) -- shown as "Requested" on the Quotes page
    // since a quote has no scheduledDate yet to show instead.
    createdAt: row.created_at||null,
    scheduledDate: row.scheduled_date||"", scheduledTime: row.scheduled_time||"",
    completedDate: row.completed_date||"", priority: row.priority||"Normal",
    partsNeeded: row.parts_needed, partsOrdered: row.parts_ordered, partsArrived: row.parts_arrived,
    rate: row.rate, paid: row.paid, notes: row.notes||"",
    // One-off engineer from outside Easy Repair's normal roster, used when a
    // booking comes in somewhere we don't have in-house coverage. Stored
    // directly on the booking (see 0004_external_engineers.sql) rather than
    // as a real engineers/profiles row, since there's no portal login,
    // coverage area, or onboarding to track for a single job.
    isExternal: !!row.is_external,
    externalName: row.external_engineer_name||"", externalPhone: row.external_engineer_phone||"",
    externalEmail: row.external_engineer_email||"", externalCompany: row.external_engineer_company||"",
  };
}
function bookingFieldsToRow(form){
  return {
    customer: form.customer, phone: form.phone, email: form.email||null,
    address: form.address||null, postcode: form.postcode||null,
    appliance: form.appliance, brand: form.brand||null,
    appliance_age: form.applianceAge===""||form.applianceAge==null?null:Number(form.applianceAge),
    issue: form.issue||null, source: form.source||"Website", status: form.status,
    engineer_id: form.isExternal?null:(form.engineerId||null),
    scheduled_date: form.scheduledDate||null, scheduled_time: form.scheduledTime||null,
    completed_date: form.completedDate||null, priority: form.priority||"Normal",
    parts_needed: !!form.partsNeeded, parts_ordered: !!form.partsOrdered, parts_arrived: !!form.partsArrived,
    rate: form.rate===""||form.rate==null?null:Number(form.rate), paid: !!form.paid, notes: form.notes||null,
    is_external: !!form.isExternal,
    external_engineer_name: form.isExternal?(form.externalName||null):null,
    external_engineer_phone: form.isExternal?(form.externalPhone||null):null,
    external_engineer_email: form.isExternal?(form.externalEmail||null):null,
    external_engineer_company: form.isExternal?(form.externalCompany||null):null,
  };
}

// Same completion check Portal uses for its dashboard nudge — kept in sync
// here so staff can see at a glance what's still missing for an engineer,
// since either side filling these in clears the nudge for both.
function engineerProfileGaps(eng){
  const gaps=[];
  if(!eng.postcodes?.length) gaps.push("Coverage postcodes");
  if(!eng.applianceTypes?.length) gaps.push("Skills / appliance types");
  if(!eng.workingHours||Object.keys(eng.workingHours).length===0) gaps.push("Working hours");
  if(!eng.idDocumentPath) gaps.push("ID document");
  if(!eng.insuranceDocumentPath) gaps.push("Public Liability Insurance document");
  else if(!eng.insuranceExpiryDate) gaps.push("Public Liability Insurance expiry date");
  return gaps;
}

// Maps `pricing` rows (one per postcode_area+appliance_type[+brand]) into
// the per-area shape SettingsView/AreaPricingModal work with: one entry per
// appliance type, either a single `all` price row or a `perBrand` map keyed
// by brand. A row with brand===null is the "applies to every brand" row;
// a row with a brand set overrides just that brand.
function groupPricingRows(rows){
  const byArea = {};
  for(const r of (rows||[])){
    byArea[r.postcode_area] ||= {};
    byArea[r.postcode_area][r.appliance_type] ||= {enabled:true,mode:"single",all:null,perBrand:{}};
    const entry = byArea[r.postcode_area][r.appliance_type];
    const fields = {
      displayPrice: r.display_price, minAreaPrice: r.min_area_price,
      engineerPct: r.engineer_pct, easyRepairPct: r.easy_repair_pct,
      retainedVariancePct: r.retained_variance_pct,
    };
    if(r.brand==null){ entry.all = fields; entry.mode = Object.keys(entry.perBrand).length ? "perBrand" : "single"; }
    else { entry.perBrand[r.brand] = fields; entry.mode = "perBrand"; }
  }
  return byArea;
}

// ─── SETTINGS -> WEBSITES -> PRICING ─────────────────────────────────────────
// Per-postcode-area, per-appliance-type (optionally per-brand) pricing, used
// for dynamic PPC bidding: what the website advertises, the agreed floor
// price for that area, and how a booking at that floor price splits between
// Easy Repair and the engineer -- plus how much of the gap between the
// advertised price and the floor ("variance") Easy Repair keeps versus
// effectively passes through. Owner-only, same gating as the Users tab.
function computePriceSplit(fields){
  const display = Number(fields?.displayPrice)||0;
  const min = Number(fields?.minAreaPrice)||0;
  const engPct = Number(fields?.engineerPct)||0;
  const erPct = Number(fields?.easyRepairPct)||0;
  const varPct = Number(fields?.retainedVariancePct)||0;
  const variance = Math.max(display-min,0);
  const engAmount = min*engPct/100;
  const erBaseAmount = min*erPct/100;
  const erVarianceAmount = variance*varPct/100;
  const engVarianceAmount = variance-erVarianceAmount;
  return {
    variance, engTotal: engAmount+engVarianceAmount, erTotal: erBaseAmount+erVarianceAmount,
    splitWarning: Math.round(engPct+erPct)!==100,
  };
}
function blankPriceFields(){
  return {displayPrice:"",minAreaPrice:"",engineerPct:60,easyRepairPct:40,retainedVariancePct:100};
}
function PriceFieldsRow({fields,onChange}){
  const s = computePriceSplit(fields);
  const set = (k,v)=>onChange({...fields,[k]:v});
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:8}}>
        <Fl label="Website Price (£)"><input type="number" style={inp} value={fields.displayPrice} onChange={e=>set("displayPrice",e.target.value)}/></Fl>
        <Fl label="Min Area Price (£)"><input type="number" style={inp} value={fields.minAreaPrice} onChange={e=>set("minAreaPrice",e.target.value)}/></Fl>
        <Fl label="SP %"><input type="number" style={inp} value={fields.engineerPct} onChange={e=>set("engineerPct",e.target.value)}/></Fl>
        <Fl label="Easy Repair %"><input type="number" style={inp} value={fields.easyRepairPct} onChange={e=>set("easyRepairPct",e.target.value)}/></Fl>
        <Fl label="ER Retains Variance %"><input type="number" style={inp} value={fields.retainedVariancePct} onChange={e=>set("retainedVariancePct",e.target.value)}/></Fl>
      </div>
      <div style={{fontSize:11,background:"#161B22",borderRadius:7,padding:"7px 10px",display:"flex",gap:16,flexWrap:"wrap",marginTop:-4,marginBottom:10}}>
        <span style={{color:C.mid}}>Variance: <strong style={{color:C.text}}>£{s.variance.toFixed(2)}</strong></span>
        <span style={{color:C.primary}}>SP gets: <strong>£{s.engTotal.toFixed(2)}</strong></span>
        <span style={{color:C.purple}}>Easy Repair gets: <strong>£{s.erTotal.toFixed(2)}</strong></span>
        {s.splitWarning&&<span style={{color:C.danger}}>SP % + Easy Repair % should total 100</span>}
      </div>
    </div>
  );
}

function AreaPricingModal({area,existing,onClose,onSaved}){
  const [form,setForm] = useState(()=>{
    const init = {};
    for(const type of APPLIANCE_TYPES){
      const e = existing?.[type];
      init[type] = e ? {enabled:true,mode:e.mode,all:e.all||blankPriceFields(),perBrand:{...e.perBrand}} : {enabled:false,mode:"single",all:blankPriceFields(),perBrand:{}};
    }
    return init;
  });
  const [busy,setBusy] = useState(false);
  const [err,setErr] = useState("");

  const toggleType = (type) => setForm(f=>({...f,[type]:{...f[type],enabled:!f[type].enabled}}));
  const setMode = (type,mode) => setForm(f=>({...f,[type]:{...f[type],mode}}));
  const setAll = (type,fields) => setForm(f=>({...f,[type]:{...f[type],all:fields}}));
  const setBrand = (type,brand,fields) => setForm(f=>({...f,[type]:{...f[type],perBrand:{...f[type].perBrand,[brand]:fields}}}));
  const copyFirstBrand = (type) => setForm(f=>{
    const brands = BRANDS[type]||[];
    const template = f[type].perBrand[brands[0]] || blankPriceFields();
    const perBrand = {};
    brands.forEach(b=>{ perBrand[b]={...template}; });
    return {...f,[type]:{...f[type],perBrand}};
  });

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      for(const type of APPLIANCE_TYPES){
        const t = form[type];
        // Simplest reliable way to keep this in sync with what's on screen:
        // clear whatever's stored for this area+appliance, then reinsert
        // only what should actually be there now.
        await supabase.from("pricing").delete().eq("postcode_area",area.code).eq("appliance_type",type);
        if(!t.enabled) continue;
        if(t.mode==="single"){
          await supabase.from("pricing").insert({
            postcode_area:area.code, appliance_type:type, brand:null,
            display_price:t.all.displayPrice===""?null:Number(t.all.displayPrice),
            min_area_price:t.all.minAreaPrice===""?null:Number(t.all.minAreaPrice),
            engineer_pct:Number(t.all.engineerPct)||0, easy_repair_pct:Number(t.all.easyRepairPct)||0,
            retained_variance_pct:Number(t.all.retainedVariancePct)||0,
          });
        } else {
          const rows = (BRANDS[type]||[]).map(brand=>{
            const f = t.perBrand[brand]||blankPriceFields();
            return {
              postcode_area:area.code, appliance_type:type, brand,
              display_price:f.displayPrice===""?null:Number(f.displayPrice),
              min_area_price:f.minAreaPrice===""?null:Number(f.minAreaPrice),
              engineer_pct:Number(f.engineerPct)||0, easy_repair_pct:Number(f.easyRepairPct)||0,
              retained_variance_pct:Number(f.retainedVariancePct)||0,
            };
          });
          if(rows.length) await supabase.from("pricing").insert(rows);
        }
      }
      setBusy(false);
      onSaved();
    } catch(e){
      setBusy(false);
      setErr(e.message||"Something went wrong saving this area's pricing.");
    }
  };

  return (
    <Modal title={`Pricing for ${area.code} — ${area.name}`} onClose={onClose} wide>
      {err&&<div style={{background:"rgba(248,113,113,0.15)",color:"#f87171",borderRadius:7,padding:"8px 12px",fontSize:13,marginBottom:12,fontWeight:600}}>{err}</div>}
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {APPLIANCE_TYPES.map(type=>{
          const t = form[type];
          return (
            <div key={type} style={{border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 12px"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:700,cursor:"pointer"}}>
                <input type="checkbox" checked={t.enabled} onChange={()=>toggleType(type)}/> {type}
              </label>
              {t.enabled ? (
                <div style={{marginTop:8}}>
                  <div style={{display:"flex",gap:16,marginBottom:8}}>
                    <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.mid,cursor:"pointer"}}>
                      <input type="radio" checked={t.mode==="single"} onChange={()=>setMode(type,"single")}/> One price across every brand
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.mid,cursor:"pointer"}}>
                      <input type="radio" checked={t.mode==="perBrand"} onChange={()=>setMode(type,"perBrand")}/> Different price per brand
                    </label>
                  </div>
                  {t.mode==="single" ? (
                    <PriceFieldsRow fields={t.all} onChange={f=>setAll(type,f)}/>
                  ) : (
                    <div>
                      <button onClick={()=>copyFirstBrand(type)} style={{background:"none",border:"none",color:C.primary,fontSize:11,fontWeight:700,cursor:"pointer",padding:0,marginBottom:8}}>
                        Copy {(BRANDS[type]||[])[0]}'s pricing to every brand
                      </button>
                      <div style={{display:"flex",flexDirection:"column",gap:8}}>
                        {(BRANDS[type]||[]).map(brand=>(
                          <div key={brand} style={{background:"#161B22",borderRadius:7,padding:"8px 10px"}}>
                            <div style={{fontSize:11,fontWeight:700,color:C.mid,marginBottom:6}}>{brand}</div>
                            <PriceFieldsRow fields={t.perBrand[brand]||blankPriceFields()} onChange={f=>setBrand(type,brand,f)}/>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{fontSize:11,color:C.light,marginTop:4,marginLeft:24}}>Tick to set pricing for this appliance type in this area</div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{display:"flex",gap:10,marginTop:16}}>
        <Btn onClick={submit} full style={{padding:"10px 0",opacity:busy?.7:1}}>{busy?"Saving…":"Save Pricing"}</Btn>
        <Btn onClick={onClose} variant="ghost" full style={{padding:"10px 0"}}>Cancel</Btn>
      </div>
    </Modal>
  );
}

// Plain-text sub-nav shown under a Settings section that has more than one
// area (currently just Website -> Pricing/Services/Content/Booking Form).
// Sections with a single area (Users, Payments, Assignment for now) skip
// this and render straight into their content -- a subnav only if needed.
function SettingsSubTabs({tabs,value,onChange}){
  return (
    <div style={{display:"flex",gap:22,marginBottom:18,borderBottom:`1px solid ${C.border}`,flexWrap:"wrap"}}>
      {tabs.map(t=>(
        <button key={t.key} onClick={()=>onChange(t.key)} style={{
          border:"none",background:"none",cursor:"pointer",fontFamily:"inherit",
          padding:"0 0 10px",fontSize:13,fontWeight:800,
          color:value===t.key?C.primary:C.mid,
          borderBottom:value===t.key?`2px solid ${C.primary}`:"2px solid transparent",
        }}>{t.label}</button>
      ))}
    </div>
  );
}

// Filler for a Settings area that's in the nav but not wired up to real
// content yet (Services, Content, Booking Form, Payments, Assignment).
function ComingSoon({label}){
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:13,padding:"32px 20px",color:C.mid,fontSize:13,textAlign:"center"}}>
      {label} settings are coming soon.
    </div>
  );
}

const SETTINGS_SECTIONS = [
  {key:"website",label:"Website"},
  {key:"users",label:"Users"},
  {key:"payments",label:"Payments"},
  {key:"assignment",label:"Assignment"},
];
const WEBSITE_SUBTABS = [
  {key:"pricing",label:"Pricing"},
  {key:"services",label:"Services"},
  {key:"content",label:"Content"},
  {key:"bookingForm",label:"Booking Form"},
];

function SettingsView({pricing,onReload,users,onUserCreated,currentUserId,usersTab,onUsersTabChange,onArchive,onRestore,onDelete,onResetPassword}){
  const [editArea,setEditArea] = useState(null);
  const [search,setSearch] = useState("");
  const [section,setSection] = useState("website"); // "website" | "users" | "payments" | "assignment"
  const [websiteTab,setWebsiteTab] = useState("pricing"); // subsection of Website
  const grouped = useMemo(()=>groupPricingRows(pricing),[pricing]);

  const visible = POSTCODE_AREAS.filter(a=>
    !search || a.code.toLowerCase().includes(search.toLowerCase()) || a.name.toLowerCase().includes(search.toLowerCase())
  );

  const saveArea = async () => { await onReload(); setEditArea(null); };

  return (
    <div>
      <h1 style={{margin:"0 0 16px",fontSize:19,fontWeight:900,color:C.text}}>Settings</h1>
      <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
        {SETTINGS_SECTIONS.map(s=>(
          <button key={s.key} onClick={()=>setSection(s.key)} style={{
            border: section===s.key ? "none" : `1.5px solid ${C.border}`,
            borderRadius:20, padding:"7px 18px", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"inherit",
            background: section===s.key ? C.primary : "transparent",
            color: section===s.key ? "#000000" : C.mid,
          }}>{s.label}</button>
        ))}
      </div>

      {section==="website" && (
        <div>
          <SettingsSubTabs tabs={WEBSITE_SUBTABS} value={websiteTab} onChange={setWebsiteTab}/>

          {websiteTab==="pricing" && (
            <div>
              <div style={{fontSize:12,fontWeight:700,color:C.mid,textTransform:"uppercase",letterSpacing:.6,marginBottom:10}}>Websites → Pricing</div>
              <div style={{fontSize:13,color:C.mid,lineHeight:1.5,marginBottom:14}}>
                Set dynamic pricing per postcode area -- a website display price, an agreed minimum, and how the booking splits
                between Easy Repair and the SP. Choose one price across every brand, or break it down brand by brand.
              </div>
              <input style={{...inp,maxWidth:260,marginBottom:14}} placeholder="Search area code or name…" value={search} onChange={e=>setSearch(e.target.value)}/>
              <div style={{background:C.card,borderRadius:13,overflow:"hidden",border:`1px solid ${C.border}`}}>
                {visible.map(a=>{
                  const cfg = grouped[a.code]||{};
                  const count = APPLIANCE_TYPES.filter(t=>cfg[t]?.enabled).length;
                  return (
                    <div key={a.code} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"11px 16px",borderBottom:`1px solid ${C.border}`}}>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        <span style={{fontWeight:800,fontSize:13,width:34}}>{a.code}</span>
                        <span style={{fontSize:13,color:C.mid}}>{a.name}</span>
                      </div>
                      <div style={{display:"flex",gap:12,alignItems:"center"}}>
                        {count===0 ? (
                          <span style={{background:"rgba(255,255,255,0.07)",color:C.light,padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700}}>Not set up</span>
                        ) : (
                          <span style={{background:C.primaryLight,color:C.primary,padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700}}>{count}/{APPLIANCE_TYPES.length} configured</span>
                        )}
                        <Btn onClick={()=>setEditArea(a)} variant="ghost" sm>Edit Pricing</Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
              {editArea&&(
                <AreaPricingModal area={editArea} existing={grouped[editArea.code]} onClose={()=>setEditArea(null)} onSaved={saveArea}/>
              )}
            </div>
          )}

          {websiteTab==="services" && <ComingSoon label="Services"/>}
          {websiteTab==="content" && <ComingSoon label="Content"/>}
          {websiteTab==="bookingForm" && <ComingSoon label="Booking Form"/>}
        </div>
      )}

      {section==="users" && (
        <UserManager users={users} onUserCreated={onUserCreated} currentUserId={currentUserId}
          tab={usersTab} onTabChange={onUsersTabChange}
          onArchive={onArchive} onRestore={onRestore} onDelete={onDelete} onResetPassword={onResetPassword}
        />
      )}

      {section==="payments" && <ComingSoon label="Payments"/>}
      {section==="assignment" && <ComingSoon label="Assignment"/>}
    </div>
  );
}




// ─── ONBOARDING / ARCHIVE ───────────────────────────────────────────────────
// The full journey a new engineer goes through, in order. Each `done` check
// reuses the exact same fields engineerProfileGaps() (above) and Portal's own
// completion check already read, so this can't drift out of sync with what
// "complete" means elsewhere in the app -- it's just those same signals laid
// out as a sequence with labels, for the "step X of Y" progress shown on the
// Engineers page while someone is still onboarding.
const ENGINEER_ONBOARDING_STEPS = [
  { key:"password",  label:"Set their own password",            done:eng=>!eng.mustChangePassword },
  { key:"terms",      label:"Accept Terms & Conditions",         done:eng=>!!eng.termsAcceptedAt },
  { key:"postcodes",  label:"Add coverage postcodes",            done:eng=>!!eng.postcodes?.length },
  { key:"skills",     label:"Add appliance skills",              done:eng=>!!eng.applianceTypes?.length },
  { key:"hours",      label:"Set working hours",                 done:eng=>!!eng.workingHours&&Object.keys(eng.workingHours).length>0 },
  { key:"id",         label:"Upload ID document",                done:eng=>!!eng.idDocumentPath },
  { key:"insurance",  label:"Upload insurance document",         done:eng=>!!eng.insuranceDocumentPath },
  { key:"insuranceExpiry", label:"Set insurance expiry date",    done:eng=>!!eng.insuranceExpiryDate },
];
function engineerOnboardingProgress(eng){
  const steps = ENGINEER_ONBOARDING_STEPS.map(s=>({key:s.key,label:s.label,done:s.done(eng)}));
  const completed = steps.filter(s=>s.done).length;
  return { steps, completed, total: steps.length, next: steps.find(s=>!s.done)||null };
}
// Three-way status behind the Active / Onboarding / Archive pills. Archived
// always wins (an archived engineer shouldn't show as "onboarding" just
// because their checklist was never finished), otherwise it's however far
// through ENGINEER_ONBOARDING_STEPS they've got.
function engineerStatus(eng){
  if(eng.archivedAt) return "archived";
  const {completed,total} = engineerOnboardingProgress(eng);
  return completed<total ? "onboarding" : "active";
}
function userStatus(u){ return u.archived_at ? "archived" : "active"; }

export default function App() {
  const [currentUser,setCU]       = useState(null);
  const [authChecked,setAuthChecked] = useState(false);
  const [jobs,setJobs]            = useState([]);
  const [users,setUsers]          = useState([]);
  const [engineers,setEngineers]  = useState([]);
  const [view,setView]            = useState("dashboard");
  const [selJob,setSelJob]        = useState(null);
  const [editJob,setEditJob]      = useState(null);
  const [showNew,setShowNew]      = useState(false);
  const [reassign,setReassign]    = useState(null);
  const [editEng,setEditEng]      = useState(null);
  const [showAddEng,setShowAddEng]= useState(false);
  const [fsStatus,setFsStatus]    = useState("All");
  const [fsEng,setFsEng]          = useState("All");
  const [fsSearch,setFsSearch]    = useState("");
  const [qSearch,setQSearch]      = useState("");           // search box on the Quotes page
  const [newDefaultStatus,setNewDefaultStatus] = useState("Booked"); // "Booked" | "Quote" -- which the "+ New ..." button opened
  const [loadError,setLoadError]  = useState("");
  const [engTab,setEngTab]        = useState("active");   // "active" | "onboarding" | "archived"
  const [usersTab,setUsersTab]    = useState("active");    // "active" | "archived"
  const [confirmModal,setConfirmModal] = useState(null);   // {kind:"archive"|"delete", label, profileId}
  const [confirmBusy,setConfirmBusy]   = useState(false);
  const [confirmErr,setConfirmErr]     = useState("");
  const [resetPwTarget,setResetPwTarget] = useState(null); // {profileId,label} -- confirm step, before we have a result
  const [resetPwBusy,setResetPwBusy]     = useState(false);
  const [resetPwErr,setResetPwErr]       = useState("");
  const [resetPwResult,setResetPwResult] = useState(null); // {email,tempPassword,message,warning} from the Edge Function
  const [pricing,setPricing]      = useState([]);
  const [deleteJobTarget,setDeleteJobTarget] = useState(null); // {id,customer} -- confirm step before permanently deleting a booking
  const [deleteJobBusy,setDeleteJobBusy]     = useState(false);
  const [deleteJobErr,setDeleteJobErr]       = useState("");
  const [selectedJobIds,setSelectedJobIds]   = useState(()=>new Set()); // checked rows in All Bookings, for bulk delete
  const [bulkDeleteConfirm,setBulkDeleteConfirm] = useState(false); // just a flag -- the ids come from selectedJobIds
  const [bulkDeleteBusy,setBulkDeleteBusy]   = useState(false);
  const [bulkDeleteErr,setBulkDeleteErr]     = useState("");

  // Desktop notification permission for the "New Booking" alert below --
  // "unsupported" covers browsers/contexts without the Notification API at
  // all (safer than letting a ReferenceError on `Notification` blow up the
  // whole app). Starts from whatever the browser already remembers so a
  // returning user who already granted (or denied) it doesn't see the
  // banner again -- Safari/Chrome persist this per-origin across reloads.
  const [notifPermission,setNotifPermission] = useState(
    typeof Notification==="undefined" ? "unsupported" : Notification.permission
  );
  const [notifBannerDismissed,setNotifBannerDismissed] = useState(false);

  const isOwner = currentUser?.role==="owner";
  const accent  = {owner:C.purple,staff:C.primary}[currentUser?.role]||C.primary;

  // A failed load here used to just silently leave whatever was already in
  // state (empty, on first load) -- so if the `archived_at`/`must_change_
  // password`/`terms_accepted_at` columns this select relies on didn't exist
  // yet (e.g. 0002_provisioning_and_terms.sql or 0003_archiving.sql hadn't
  // been run against the live database), the whole Engineers list would just
  // render empty with no indication why, looking exactly like every engineer
  // had been deleted. Surfacing the error instead makes that failure mode
  // visible instead of indistinguishable from "there's genuinely no data".
  const loadEngineers = async () => {
    const { data, error } = await supabase.from("engineers").select("*, profile:profiles(name,phone,email,archived_at,must_change_password,terms_accepted_at)").order("created_at");
    if(error){ setLoadError(`Couldn't load engineers: ${error.message}`); return; }
    setLoadError(""); setEngineers((data||[]).map(mapEngineerRow));
  };
  const loadStaffUsers = async () => {
    const { data, error } = await supabase.from("profiles").select("*").in("role",["owner","staff"]).order("created_at");
    if(error){ setLoadError(`Couldn't load users: ${error.message}`); return; }
    setLoadError(""); setUsers(data||[]);
  };
  // Bookings now come from the shared `bookings` table -- created either
  // here (staff "+ New Booking") or, increasingly, from the public website's
  // form via the submit-booking Edge Function (which also runs the same
  // auto-assign logic as the Reassign modal below). Either source shows up
  // here identically once loaded.
  const loadBookings = async () => {
    const { data, error } = await supabase.from("bookings").select("*").order("created_at",{ascending:false});
    if(error){ setLoadError(`Couldn't load bookings: ${error.message}`); return; }
    setLoadError(""); setJobs((data||[]).map(mapBookingRow));
  };
  // Owner-only (see 0003_pricing.sql's RLS) -- if a non-owner somehow ends up
  // here this just quietly returns no rows rather than erroring, since
  // Settings itself is already gated to isOwner in the sidebar/view switch.
  const loadPricing = async () => {
    const { data, error } = await supabase.from("pricing").select("*");
    if(error){ setLoadError(`Couldn't load pricing: ${error.message}`); return; }
    setLoadError(""); setPricing(data||[]);
  };

  // Archive/restore both just flip `profiles.archived_at` -- the existing
  // "profiles: staff/owner can update all" RLS policy already covers this
  // column, so no privileged function is needed for either direction, and
  // it applies identically to engineers and owner/staff users since both
  // are backed by the same `profiles` row.
  const archiveProfile = async (profileId) => {
    await supabase.from("profiles").update({archived_at:new Date().toISOString()}).eq("id",profileId);
    await Promise.all([loadEngineers(),loadStaffUsers()]);
  };
  const restoreProfile = async (profileId) => {
    await supabase.from("profiles").update({archived_at:null}).eq("id",profileId);
    await Promise.all([loadEngineers(),loadStaffUsers()]);
  };
  // Permanent delete has to go through the delete-user Edge Function --
  // actually removing the auth.users row needs the service_role key, which
  // in turn cascades to delete the profiles/engineers rows automatically
  // (see the "on delete cascade" foreign keys in 0001_identity.sql). The
  // function itself also refuses unless the record is archived first, as a
  // second line of defence behind the UI only offering this from Archive.
  const permanentlyDeleteProfile = async (profileId) => {
    const { data: sess } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("delete-user", {
      body: { userId: profileId },
      headers: { Authorization:`Bearer ${sess?.session?.access_token}` },
    });
    if(error||data?.error) throw new Error(data?.error || await edgeFnErrorMessage(error,"Something went wrong deleting this account."));
    await Promise.all([loadEngineers(),loadStaffUsers()]);
  };

  const askArchive = (profileId,label) => { setConfirmErr(""); setConfirmModal({kind:"archive",profileId,label}); };
  const askDelete  = (profileId,label) => { setConfirmErr(""); setConfirmModal({kind:"delete",profileId,label}); };

  // Admin-side password reset -- for when someone's locked out and the
  // self-service "Forgot password" email (Login's resetPasswordForEmail
  // call) is down, delayed, or they just can't get to that inbox right now.
  // Goes through the reset-password Edge Function since setting someone
  // else's password needs the service_role key, same reasoning as create-user.
  // The temp password is generated server-side and only ever shown once, here.
  const askResetPassword = (profileId,label) => { setResetPwErr(""); setResetPwResult(null); setResetPwTarget({profileId,label}); };
  const runResetPassword = async () => {
    if(!resetPwTarget) return;
    setResetPwBusy(true); setResetPwErr("");
    const { data: sess } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke("reset-password", {
      body: { userId: resetPwTarget.profileId },
      headers: { Authorization:`Bearer ${sess?.session?.access_token}` },
    });
    setResetPwBusy(false);
    if(error||data?.error){ setResetPwErr(data?.error || await edgeFnErrorMessage(error,"Something went wrong resetting this password.")); return; }
    setResetPwTarget(null);
    setResetPwResult(data);
  };
  const runConfirm = async () => {
    if(!confirmModal) return;
    if(confirmModal.profileId===currentUser.id){ setConfirmErr("You can't archive or delete your own account."); return; }
    setConfirmBusy(true); setConfirmErr("");
    try{
      if(confirmModal.kind==="archive") await archiveProfile(confirmModal.profileId);
      else await permanentlyDeleteProfile(confirmModal.profileId);
      setConfirmModal(null);
    }catch(e){ setConfirmErr(e.message||"Something went wrong."); }
    setConfirmBusy(false);
  };

  // Restore session on load, and react to sign-in/out (e.g. after Login calls signInWithPassword).
  useEffect(()=>{
    (async ()=>{
      // If this page load is an invite/recovery link, establish the session from its
      // tokens ourselves now that supabase-js's own auto-detection is off (AUTH_HASH above).
      if(AUTH_HASH?.accessToken && AUTH_HASH?.refreshToken){
        await supabase.auth.setSession({ access_token: AUTH_HASH.accessToken, refresh_token: AUTH_HASH.refreshToken });
      }
      const { data } = await supabase.auth.getSession();
      if(data?.session?.user){
        const { data: profile } = await supabase.from("profiles").select("*").eq("id",data.session.user.id).single();
        if(profile && profile.role!=="engineer") setCU(profile);
        else if(profile?.role==="engineer") await supabase.auth.signOut();
      }
      setAuthChecked(true);
    })();
  },[]);

  useEffect(()=>{ if(currentUser){ loadEngineers(); loadStaffUsers(); loadBookings(); if(currentUser.role==="owner") loadPricing(); } },[currentUser]);

  // Safari (and every other browser) only lets you ask for notification
  // permission from inside a direct user gesture -- a click handler, not a
  // useEffect -- so this is wired to the "Enable notifications" button
  // below, never called automatically on load.
  const enableNotifications = async () => {
    if(typeof Notification==="undefined") return;
    const perm = await Notification.requestPermission();
    setNotifPermission(perm);
  };

  // Live "New Booking" desktop notification -- fires for every row inserted
  // into `bookings`, whichever of the two paths created it (staff's "+ New
  // Booking" here, or the public website's submit-booking Edge Function --
  // see loadBookings above). This is the simple, in-app version: it rides on
  // the Realtime subscription below, so it only fires while FixFlow is open
  // somewhere (it doesn't need to be the focused window/tab) -- it won't
  // wake the app up if it's been fully closed. That's a deliberate trade-off
  // for now; true background push (via a service worker + Web Push) is a
  // separate, bigger piece of work if this turns out not to be enough.
  //
  // Needs `bookings` added to the `supabase_realtime` publication once --
  // see supabase/migrations/0004_bookings_realtime.sql.
  useEffect(()=>{
    if(!currentUser) return;
    const channel = supabase
      .channel(`bookings-inserts-${currentUser.id}`)
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"bookings"},(payload)=>{
        if(typeof Notification==="undefined"||Notification.permission!=="granted") return;
        const b = payload.new||{};
        const n = new Notification("New Booking",{
          body: `${b.customer||"New customer"} — ${b.appliance||"appliance"}${b.postcode?` · ${b.postcode}`:""}`,
          icon: "/logo.png",
          tag: `booking-${b.id}`, // replaces rather than stacks if the same row fires twice (e.g. a dropped/retried insert)
        });
        n.onclick = () => { window.focus(); n.close(); };
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  },[currentUser?.id]);

  // Archived AND onboarding engineers drop out of new-booking/reassignment
  // pickers (see JobForm/ReassignModal below) but `engineers` itself stays
  // the full list everywhere else -- job history, the dashboard, and
  // Payments all still need to resolve/show an already-assigned engineer's
  // name even after they've been archived.
  //
  // This used to only check `!e.archivedAt`, which meant an engineer still
  // going through ENGINEER_ONBOARDING_STEPS (hasn't set their own password,
  // accepted Terms & Conditions, uploaded insurance, etc.) was NOT excluded
  // -- they'd show under the "Onboarding" tab but remain fully pickable for
  // a real job here. `engineerStatus(e)==="active"` is the correct gate:
  // it's "archived" first (see engineerStatus above), otherwise "onboarding"
  // until every step's done, otherwise "active" -- so only engineers who are
  // neither archived nor still onboarding are assignable.
  const assignableEngineers = engineers.filter(e=>engineerStatus(e)==="active");

  // Bookings never includes Quotes -- a Quote only shows up here once it's
  // been converted (see convertToBooking below), so the status filter
  // dropdown also leaves "Quote" out; it's only ever reached via the Quotes
  // tab.
  const filtJobs = jobs.filter(j=>{
    if(j.status==="Quote")return false;
    if(fsStatus!=="All"&&j.status!==fsStatus)return false;
    if(fsEng==="External"&&!j.isExternal)return false;
    else if(fsEng!=="All"&&fsEng!=="External"&&j.engineerId!==fsEng)return false;
    if(fsSearch&&![j.customer,j.address,String(j.id),j.appliance,j.brand||"",j.postcode||""].some(s=>s.toLowerCase().includes(fsSearch.toLowerCase())))return false;
    return true;
  });

  // Quotes -- booking-form submissions that stalled before turning into a
  // real job (no schedule, no SP). Currently these only get created here via
  // "+ New Quote"; a future change to the public booking form/submit-booking
  // Edge Function could also insert rows with status:"Quote" directly.
  const quoteJobs = jobs.filter(j=>j.status==="Quote");
  const filtQuotes = quoteJobs.filter(j=>
    !qSearch || [j.customer,j.address,String(j.id),j.appliance,j.brand||"",j.postcode||""].some(s=>s.toLowerCase().includes(qSearch.toLowerCase()))
  );

  const todayJobs  = jobs.filter(j=>j.scheduledDate===TODAY);
  const unassigned = jobs.filter(j=>!j.engineerId&&!j.isExternal&&!["Cancelled","Completed","Beyond Repair","Quote"].includes(j.status));
  const unpaidDone = jobs.filter(j=>j.status==="Completed"&&!j.paid);
  const unpaidAmt  = unpaidDone.reduce((s,j)=>s+Number(j.rate||0),0);

  // External engineers aren't a real engineers/profiles row (see
  // 0004_external_engineers.sql), so there's no id to group their jobs by --
  // Payments below groups by name+phone instead, same as how staff would
  // recognise "that's the same contractor" by eye.
  const externalGroups = useMemo(()=>{
    const groups = {};
    jobs.filter(j=>j.isExternal).forEach(j=>{
      const key = `${(j.externalName||"").trim().toLowerCase()}|${(j.externalPhone||"").trim()}`;
      groups[key] ||= { name:j.externalName||"Unnamed", phone:j.externalPhone||"", email:j.externalEmail||"", company:j.externalCompany||"", jobs:[] };
      groups[key].jobs.push(j);
    });
    return Object.values(groups);
  },[jobs]);

  // Engineers no longer log into FixFlow to update their own jobs (that's
  // the Portal's job now) — staff/owner update status via "Edit This Job",
  // so that's also where we keep each engineer's repaired/BER stats in
  // sync (used by auto-assign's success-rate scoring, and shown in the
  // Portal via the `engineers` table).
  const saveJob=async (form)=>{
    if(editJob){
      const row = bookingFieldsToRow({...form,rate:isOwner?form.rate:editJob.rate});
      await supabase.from("bookings").update(row).eq("id",editJob.id);
      const justFinished = ["Completed","Beyond Repair"].includes(form.status) && form.status!==editJob.status && form.engineerId;
      if(justFinished){
        const delta = { completed: form.status==="Completed"?1:0, ber: form.status==="Beyond Repair"?1:0 };
        const current = engineers.find(e=>e.id===form.engineerId);
        if(current){
          const stats = { repairs: current.stats.repairs+delta.completed, beyondRepair: current.stats.beyondRepair+delta.ber };
          await supabase.from("engineers").update({stats_completed:stats.repairs,stats_ber:stats.beyondRepair}).eq("id",current.id);
          await loadEngineers();
        }
      }
    } else {
      await supabase.from("bookings").insert(bookingFieldsToRow(form));
    }
    await loadBookings();
    setEditJob(null);setShowNew(false);setSelJob(null);
  };

  // Permanently removes a booking row -- owner-only, same reasoning as
  // permanentlyDeleteProfile: there's no undo here, unlike Cancelled which
  // is just another status that keeps the record around. RLS mirrors this
  // gate table-side too (see supabase/migrations/0003_bookings_delete_policy.sql)
  // so it isn't only a client-side check.
  const deleteJob = async (jobId) => {
    const { error } = await supabase.from("bookings").delete().eq("id",jobId);
    if(error) throw new Error(error.message || "Something went wrong deleting this booking.");
    await loadBookings();
  };
  const askDeleteJob = (job) => { setDeleteJobErr(""); setDeleteJobTarget(job); };
  const runDeleteJob = async () => {
    if(!deleteJobTarget) return;
    setDeleteJobBusy(true); setDeleteJobErr("");
    try{
      await deleteJob(deleteJobTarget.id);
      setDeleteJobTarget(null); setSelJob(null);
    }catch(e){ setDeleteJobErr(e.message||"Something went wrong."); }
    setDeleteJobBusy(false);
  };

  // Bulk version of the above, for the checkboxes in All Bookings -- same
  // table, same RLS policy, just one delete call instead of N so it isn't
  // tedious to clear out a batch of test/duplicate bookings at once.
  const toggleJobSelected = (id) => {
    setSelectedJobIds(prev=>{
      const next=new Set(prev);
      if(next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAllFiltered = (ids) => {
    setSelectedJobIds(prev=>{
      const allSelected = ids.length>0 && ids.every(id=>prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  };
  const runBulkDeleteJobs = async () => {
    const ids = Array.from(selectedJobIds);
    if(!ids.length) return;
    setBulkDeleteBusy(true); setBulkDeleteErr("");
    try{
      const { error } = await supabase.from("bookings").delete().in("id",ids);
      if(error) throw new Error(error.message || "Something went wrong deleting these bookings.");
      await loadBookings();
      setSelectedJobIds(new Set()); setBulkDeleteConfirm(false); setSelJob(null);
    }catch(e){ setBulkDeleteErr(e.message||"Something went wrong."); }
    setBulkDeleteBusy(false);
  };

  const doReassign=async (choice)=>{
    if(choice?.type==="external"){
      const ext=choice.external||{};
      await supabase.from("bookings").update({
        engineer_id:null, is_external:true, status:"Assigned",
        external_engineer_name:ext.name||null, external_engineer_phone:ext.phone||null,
        external_engineer_email:ext.email||null, external_engineer_company:ext.company||null,
      }).eq("id",reassign.id);
    } else {
      const engId = choice?.engineerId ?? null;
      const eng=engineers.find(e=>e.id===engId);
      await supabase.from("bookings").update({
        engineer_id: engId||null, is_external:false,
        external_engineer_name:null, external_engineer_phone:null, external_engineer_email:null, external_engineer_company:null,
        status: engId?"Assigned":"Booked", rate: eng?eng.rate:reassign.rate,
      }).eq("id",reassign.id);
    }
    await loadBookings();
    setReassign(null);setSelJob(null);
  };

  const saveEng=async (engData)=>{
    await supabase.from("profiles").update({name:engData.name,phone:engData.phone}).eq("id",engData.profileId);
    await supabase.from("engineers").update({
      pay_rate:engData.rate, postcodes:engData.postcodes, appliance_types:engData.applianceTypes,
      brand_exclusions:engData.brandExclusions, self_service_enabled:engData.selfServiceEnabled,
      working_hours:engData.workingHours, insurance_expiry_date:engData.insuranceExpiryDate||null,
    }).eq("id",engData.id);
    await loadEngineers();
    setEditEng(null);
  };

  // Opens the same JobForm used for editing any booking, just pre-set to
  // "Booked" -- nothing is written until staff actually fill in a schedule/SP
  // and hit Save, so cancelling leaves the quote exactly as it was.
  const convertToBooking = (job) => setEditJob({...job,status:"Booked"});

  // Payments dropped from the main nav -- it's reachable via the Payments
  // pill in SectionTabs (Bookings > Payments) now, so a dedicated top-level
  // entry would just be a redundant second way to get there. The "payments"
  // view itself is untouched; only this nav listing changed.
  const NAV = [{id:"dashboard",label:"Dashboard",Ic:IconLayout},{id:"jobs",label:"Bookings",Ic:IconMenuLines},{id:"engineers",label:"SP's",Ic:IconList},...(isOwner?[{id:"settings",label:"Settings",Ic:IconGear}]:[])];

  // Clears the forced-password-change flag once they've set their own —
  // covers both provisioning paths (they typed the temp password directly,
  // or clicked the emailed link) since this runs after either one lands
  // them here with a real session.
  const onPasswordChanged = async () => {
    if(currentUser) await supabase.from("profiles").update({must_change_password:false}).eq("id",currentUser.id);
    window.location.reload();
  };

  if(!authChecked) return null;
  if(["invite","recovery"].includes(inviteOrRecoveryType())) return <SetPasswordScreen onDone={()=>window.location.reload()}/>;
  if(!currentUser) return <Login onLogin={u=>{setCU(u);setView("dashboard");}}/>;
  if(currentUser.must_change_password) return <SetPasswordScreen onDone={onPasswordChanged}/>;

  return (
    <div style={{fontFamily:"'Inter','Segoe UI',sans-serif",background:"#000000",color:C.text,minHeight:"100vh",display:"flex"}}>
      {/* Sidebar -- desktop/tablet only; "display:flex" lives in the className
          (not inline) so the "hidden" half of "hidden md:flex" can actually
          take effect below md. On phones the MobileTabBar further down takes
          over instead. */}
      <div className="hidden md:flex" style={{width:208,background:C.sidebar,flexDirection:"column",height:"100vh",position:"sticky",top:0,flexShrink:0}}>
        <div style={{padding:"18px 15px 14px",display:"flex",alignItems:"center",borderBottom:"1px solid #141414"}}>
          <img src="/logo.png" alt="Easy Repair" style={{height:22,display:"block"}}/>
        </div>
        <nav style={{flex:1,padding:"6px 10px"}}>
          {NAV.map(n=>(
            <button key={n.id} onClick={()=>setView(n.id)} style={{width:"100%",textAlign:"left",background:view===n.id?"rgba(212,255,60,0.08)":"none",color:view===n.id?"#d4ff3c":"#94A2B8",border:"none",borderLeft:`3px solid ${view===n.id?"#d4ff3c":"transparent"}`,borderRadius:"0 7px 7px 0",padding:"9px 11px",cursor:"pointer",fontSize:13,fontWeight:view===n.id?700:500,display:"flex",alignItems:"center",gap:9,marginBottom:1,fontFamily:"inherit"}}>
              <n.Ic size={17}/>{n.label}
            </button>
          ))}
        </nav>
        <div style={{padding:"12px 13px",borderTop:"1px solid #1F2937",display:"flex",alignItems:"center",gap:9}}>
          <Av initials={(currentUser.avatar||currentUser.name||"").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2)} size={30} color={accent}/>
          <div style={{flex:1,overflow:"hidden"}}><div style={{color:"#E5E7EB",fontSize:12,fontWeight:700,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{currentUser.name}</div><RolePill role={currentUser.role}/></div>
          {notifPermission==="default"&&(
            <button onClick={enableNotifications} style={{background:"none",border:"none",color:"#6B7280",cursor:"pointer",fontSize:15,padding:0}} title="Enable new-booking notifications">🔕</button>
          )}
          {notifPermission==="granted"&&(
            <span style={{fontSize:15,padding:0}} title="New-booking notifications are on">🔔</span>
          )}
          <button onClick={()=>{setCU(null);setView("dashboard");}} style={{background:"none",border:"none",color:"#6B7280",cursor:"pointer",fontSize:17,padding:0}} title="Sign out">⏻</button>
        </div>
      </div>

      {/* Mobile bottom tab bar -- same NAV array as the sidebar above, so the
          two layouts can never list different destinations. "flex md:hidden"
          keeps this off desktop/tablet where the sidebar handles navigation.
          "display" is deliberately left out of the inline style (unlike the
          other position props) so the "md:hidden" class can actually win --
          an inline display would always beat a Tailwind class, breakpoint
          or not, since inline styles aren't subject to media queries. */}
      <nav className="flex md:hidden" style={{position:"fixed",bottom:0,left:0,right:0,background:C.sidebar,borderTop:"1px solid #262626",zIndex:50,paddingBottom:"env(safe-area-inset-bottom)"}}>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setView(n.id)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,padding:"7px 2px",background:"none",border:"none",color:view===n.id?"#d4ff3c":"#94A2B8",cursor:"pointer",fontFamily:"inherit"}}>
            <n.Ic size={19}/>
            <span style={{fontSize:10,fontWeight:600,lineHeight:1}}>{n.label}</span>
          </button>
        ))}
      </nav>

      {/* Content -- paddingBottom deliberately left out of the inline style
          (unlike top/left/right) so the "pb-[..]" classes below can actually
          control it per breakpoint; an inline padding shorthand would win
          over any Tailwind class regardless of breakpoint. Mobile gets extra
          clearance so content doesn't sit behind the fixed bottom tab bar. */}
      <div className="pb-[88px] md:pb-[22px]" style={{flex:1,overflowY:"auto",paddingTop:22,paddingLeft:24,paddingRight:24}}>
        <div style={{maxWidth:1080}}>

          {loadError&&(
            <div style={{background:"rgba(248,113,113,0.15)",border:"1px solid rgba(248,113,113,0.4)",color:"#f87171",borderRadius:9,padding:"10px 14px",marginBottom:16,fontSize:13,fontWeight:600}}>
              ⚠ {loadError} — likely a database migration hasn't been run yet (check the Supabase SQL Editor for 0002_provisioning_and_terms.sql / 0003_archiving.sql). Nothing was deleted; the page just couldn't load the data.
            </div>
          )}

          {notifPermission==="default"&&!notifBannerDismissed&&(
            <div style={{background:"rgba(212,255,60,0.08)",border:"1px solid rgba(212,255,60,0.35)",borderRadius:9,padding:"10px 14px",marginBottom:16,fontSize:13,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:200,color:C.text,fontWeight:600}}>🔔 Get a desktop notification the moment a new booking comes in.</div>
              <Btn onClick={enableNotifications} sm>Enable notifications</Btn>
              <button onClick={()=>setNotifBannerDismissed(true)} style={{background:"none",border:"none",color:C.light,cursor:"pointer",fontSize:12,fontWeight:600}}>Not now</button>
            </div>
          )}
          {notifPermission==="denied"&&!notifBannerDismissed&&(
            <div style={{background:"rgba(248,113,113,0.08)",border:"1px solid rgba(248,113,113,0.3)",color:C.light,borderRadius:9,padding:"10px 14px",marginBottom:16,fontSize:12,display:"flex",alignItems:"center",gap:12}}>
              <div style={{flex:1}}>Notifications are blocked for FixFlow in Safari. To turn them on: Safari menu → Settings for This Website → Notifications → Allow.</div>
              <button onClick={()=>setNotifBannerDismissed(true)} style={{background:"none",border:"none",color:C.light,cursor:"pointer",fontSize:12,fontWeight:600}}>Dismiss</button>
            </div>
          )}

          {/* ── DASHBOARD ── */}
          {view==="dashboard"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <div><h1 style={{margin:0,fontSize:20,fontWeight:900,color:C.text}}>Dashboard</h1><div style={{color:C.light,fontSize:12,marginTop:1}}>{TODAY_LABEL}</div></div>
                <Btn onClick={()=>{setEditJob(null);setNewDefaultStatus("Booked");setShowNew(true);}}>+ New Booking</Btn>
              </div>
              <div style={{display:"flex",gap:12,marginBottom:18,flexWrap:"wrap"}}>
                <StatCard label="Today's Bookings" value={todayJobs.length} color={C.primary} sub={`${todayJobs.filter(j=>j.status==="Completed").length} done`}/>
                <StatCard label="Unassigned" value={unassigned.length} color={C.warn} sub="Need SP"/>
                <StatCard label="Active Bookings" value={jobs.filter(j=>!["Cancelled","Completed","Beyond Repair","Quote"].includes(j.status)).length} color={C.blue}/>
                <StatCard label="Open Quotes" value={quoteJobs.length} color={C.purple}/>
                {isOwner&&<StatCard label="Outstanding Pay" value={`£${unpaidAmt}`} color={C.danger} sub={`${unpaidDone.length} unpaid`}/>}
              </div>
              <div style={{background:C.card,borderRadius:12,boxShadow:"0 1px 3px rgba(0,0,0,.05)",overflow:"hidden",marginBottom:14}}>
                <div style={{padding:"11px 17px",borderBottom:`1px solid ${C.border}`,fontWeight:800,color:C.text,fontSize:13}}>Today's Schedule</div>
                {todayJobs.length===0?<div style={{padding:22,textAlign:"center",color:C.light,fontSize:13}}>No jobs scheduled today</div>:todayJobs.map(j=>{
                  const eng=engineers.find(e=>e.id===j.engineerId);
                  return <div key={j.id} onClick={()=>setSelJob(j)} style={{padding:"10px 17px",borderBottom:`1px solid #262626`,cursor:"pointer",display:"flex",alignItems:"center",gap:12}} onMouseOver={e=>e.currentTarget.style.background="#1E2530"} onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{fontWeight:800,color:C.primary,fontSize:12,minWidth:42}}>{j.scheduledTime}</div>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:13}}>{j.customer} <span style={{color:C.light,fontWeight:400}}>· {j.appliance} · {j.brand||"?"}{j.applianceAge?` · ${j.applianceAge}yr`:""}</span></div>
                      <div style={{color:C.mid,fontSize:11}}>{j.address}</div>
                    </div>
                    <div style={{fontSize:11,color:C.mid}}>{j.isExternal?<>{j.externalName} <span style={{color:C.purple,fontWeight:700}}>(External)</span></>:eng?.name||<span style={{color:C.danger,fontWeight:700}}>Unassigned</span>}</div>
                    <Badge status={j.status}/><PBadge p={j.priority}/>
                  </div>;
                })}
              </div>
              {unassigned.length>0&&(
                <div style={{background:C.warnLight,border:`1px solid #FDE68A`,borderRadius:11,padding:"12px 16px"}}>
                  <div style={{fontWeight:700,color:"#fbbf24",marginBottom:9,fontSize:12}}>⚠ {unassigned.length} job{unassigned.length>1?"s":""} awaiting SP assignment</div>
                  {unassigned.map(j=>(
                    <div key={j.id} onClick={()=>setSelJob(j)} style={{background:"#141414",borderRadius:7,padding:"8px 12px",marginBottom:6,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:13}}><strong>{j.customer}</strong> · {j.appliance} · {j.brand||"?"} · {fmt(j.scheduledDate)}</span><PBadge p={j.priority}/>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── BOOKINGS ── */}
          {view==="jobs"&&(
            <div>
              <SectionTabs value={view} onChange={setView}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:15,flexWrap:"wrap",gap:8}}>
                <h1 style={{margin:0,fontSize:19,fontWeight:900,color:C.text}}>Bookings</h1>
                <div style={{display:"flex",gap:9}}>
                  {isOwner&&selectedJobIds.size>0&&(
                    <Btn onClick={()=>{setBulkDeleteErr("");setBulkDeleteConfirm(true);}} variant="danger">🗑 Delete {selectedJobIds.size} Selected</Btn>
                  )}
                  <Btn onClick={()=>{setEditJob(null);setNewDefaultStatus("Booked");setShowNew(true);}}>+ New Booking</Btn>
                </div>
              </div>
              <div style={{display:"flex",gap:9,marginBottom:12,flexWrap:"wrap"}}>
                <input style={{...inp,maxWidth:210}} placeholder="Name / address / brand / #ID" value={fsSearch} onChange={e=>setFsSearch(e.target.value)}/>
                <select style={{...inp,maxWidth:155}} value={fsStatus} onChange={e=>setFsStatus(e.target.value)}><option value="All">All Statuses</option>{STATUSES.filter(s=>s!=="Quote").map(s=><option key={s}>{s}</option>)}</select>
                <select style={{...inp,maxWidth:165}} value={fsEng} onChange={e=>setFsEng(e.target.value)}><option value="All">All SP's</option><option value="External">External (one-off)</option>{engineers.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select>
              </div>
              <div style={{background:C.card,borderRadius:12,boxShadow:"0 1px 3px rgba(0,0,0,.05)",overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:860}}>
                  <thead><tr style={{background:"#161B22"}}>
                    {isOwner&&(
                      <th style={{padding:"9px 13px",borderBottom:`1px solid ${C.border}`,width:1}}>
                        <input type="checkbox" checked={filtJobs.length>0&&filtJobs.every(j=>selectedJobIds.has(j.id))}
                          onChange={()=>toggleSelectAllFiltered(filtJobs.map(j=>j.id))}
                          style={{cursor:"pointer"}} aria-label="Select all bookings"/>
                      </th>
                    )}
                    {["#","Customer","Appliance","Brand","Age","Scheduled","SP","Status","Pay"].map(h=>(
                      <th key={h} style={{padding:"9px 13px",textAlign:"left",fontSize:10,fontWeight:700,color:C.light,textTransform:"uppercase",letterSpacing:.5,borderBottom:`1px solid ${C.border}`}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {filtJobs.length===0?<tr><td colSpan={isOwner?10:9} style={{padding:28,textAlign:"center",color:C.light}}>No bookings found</td></tr>:filtJobs.map(j=>{
                      const eng=engineers.find(e=>e.id===j.engineerId);
                      return <tr key={j.id} onClick={()=>setSelJob(j)} style={{cursor:"pointer",borderBottom:`1px solid #262626`,background:selectedJobIds.has(j.id)?"rgba(212,255,60,0.06)":"transparent"}} onMouseOver={e=>{if(!selectedJobIds.has(j.id))e.currentTarget.style.background="#1E2530";}} onMouseOut={e=>{e.currentTarget.style.background=selectedJobIds.has(j.id)?"rgba(212,255,60,0.06)":"transparent";}}>
                        {isOwner&&(
                          <td style={{padding:"9px 13px"}} onClick={e=>e.stopPropagation()}>
                            <input type="checkbox" checked={selectedJobIds.has(j.id)} onChange={()=>toggleJobSelected(j.id)} style={{cursor:"pointer"}} aria-label={`Select booking #${j.id}`}/>
                          </td>
                        )}
                        <td style={{padding:"9px 13px",fontSize:12,color:C.primary,fontWeight:800}}>#{j.id}</td>
                        <td style={{padding:"9px 13px"}}><div style={{fontWeight:700,fontSize:13}}>{j.customer}</div><div style={{color:C.light,fontSize:10}} title={j.sourceUrl||j.source}>{j.sourceUrl?shortSource(j.sourceUrl):j.source}</div></td>
                        <td style={{padding:"9px 13px",fontSize:12}}>{j.appliance}</td>
                        <td style={{padding:"9px 13px",fontSize:12,fontWeight:600}}>{j.brand||<span style={{color:C.light}}>—</span>}</td>
                        <td style={{padding:"9px 13px",fontSize:12}}>{j.applianceAge?`${j.applianceAge}yr`:<span style={{color:C.light}}>—</span>}</td>
                        <td style={{padding:"9px 13px",fontSize:11}}>{fmt(j.scheduledDate)}<br/><span style={{color:C.light}}>{j.scheduledTime}</span></td>
                        <td style={{padding:"9px 13px",fontSize:12,color:j.isExternal?C.purple:eng?C.text:C.danger,fontWeight:j.isExternal||!eng?700:400}}>{j.isExternal?`${j.externalName} (External)`:eng?.name||"Unassigned"}</td>
                        <td style={{padding:"9px 13px"}}><Badge status={j.status}/></td>
                        <td style={{padding:"9px 13px",fontSize:12,fontWeight:800,color:j.paid?C.success:j.rate?C.danger:C.light}}>{j.rate?`£${j.rate}`:"—"}{j.paid?" ✓":""}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── QUOTES ── */}
          {/* Booking-form submissions that stalled before turning into a real
              job -- no schedule, no SP assigned. "Convert to Booking" opens
              the same edit form as any booking, pre-set to "Booked", so
              staff can fill in the schedule/SP once the customer confirms. */}
          {view==="quotes"&&(
            <div>
              <SectionTabs value={view} onChange={setView}/>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:15,flexWrap:"wrap",gap:8}}>
                <h1 style={{margin:0,fontSize:19,fontWeight:900,color:C.text}}>Quotes</h1>
                <Btn onClick={()=>{setEditJob(null);setNewDefaultStatus("Quote");setShowNew(true);}}>+ New Quote</Btn>
              </div>
              <div style={{display:"flex",gap:9,marginBottom:12,flexWrap:"wrap"}}>
                <input style={{...inp,maxWidth:210}} placeholder="Name / address / brand / #ID" value={qSearch} onChange={e=>setQSearch(e.target.value)}/>
              </div>
              <div style={{background:C.card,borderRadius:12,boxShadow:"0 1px 3px rgba(0,0,0,.05)",overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",minWidth:680}}>
                  <thead><tr style={{background:"#161B22"}}>
                    {["#","Customer","Appliance","Brand","Age","Requested",""].map(h=>(
                      <th key={h} style={{padding:"9px 13px",textAlign:"left",fontSize:10,fontWeight:700,color:C.light,textTransform:"uppercase",letterSpacing:.5,borderBottom:`1px solid ${C.border}`}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {filtQuotes.length===0?<tr><td colSpan={7} style={{padding:28,textAlign:"center",color:C.light}}>No quotes right now</td></tr>:filtQuotes.map(j=>(
                      <tr key={j.id} style={{borderBottom:`1px solid #262626`}} onMouseOver={e=>e.currentTarget.style.background="#1E2530"} onMouseOut={e=>e.currentTarget.style.background="transparent"}>
                        <td onClick={()=>setSelJob(j)} style={{padding:"9px 13px",fontSize:12,color:C.primary,fontWeight:800,cursor:"pointer"}}>#{j.id}</td>
                        <td onClick={()=>setSelJob(j)} style={{padding:"9px 13px",cursor:"pointer"}}><div style={{fontWeight:700,fontSize:13}}>{j.customer}</div><div style={{color:C.light,fontSize:10}} title={j.sourceUrl||j.source}>{j.sourceUrl?shortSource(j.sourceUrl):j.source}</div></td>
                        <td onClick={()=>setSelJob(j)} style={{padding:"9px 13px",fontSize:12,cursor:"pointer"}}>{j.appliance}</td>
                        <td onClick={()=>setSelJob(j)} style={{padding:"9px 13px",fontSize:12,fontWeight:600,cursor:"pointer"}}>{j.brand||<span style={{color:C.light}}>—</span>}</td>
                        <td onClick={()=>setSelJob(j)} style={{padding:"9px 13px",fontSize:12,cursor:"pointer"}}>{j.applianceAge?`${j.applianceAge}yr`:<span style={{color:C.light}}>—</span>}</td>
                        <td onClick={()=>setSelJob(j)} style={{padding:"9px 13px",fontSize:11,color:C.light,cursor:"pointer"}}>{j.createdAt?new Date(j.createdAt).toLocaleDateString("en-GB"):"—"}</td>
                        <td style={{padding:"9px 13px",textAlign:"right"}} onClick={e=>e.stopPropagation()}><Btn onClick={()=>convertToBooking(j)} sm>Convert to Booking</Btn></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── ENGINEERS ── */}
          {view==="engineers"&&(()=>{
            const withStatus = engineers.map(eng=>({eng,status:engineerStatus(eng)}));
            const shown = withStatus.filter(x=>x.status===engTab).map(x=>x.eng);
            const counts = {
              active: withStatus.filter(x=>x.status==="active").length,
              onboarding: withStatus.filter(x=>x.status==="onboarding").length,
              archived: withStatus.filter(x=>x.status==="archived").length,
            };
            return (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <h1 style={{margin:0,fontSize:19,fontWeight:900,color:C.text}}>SP's</h1>
                <Btn onClick={()=>setShowAddEng(true)}>+ Add SP</Btn>
              </div>
              <StatusTabs value={engTab} onChange={setEngTab} tabs={[
                {key:"active",label:"Active",count:counts.active},
                {key:"onboarding",label:"Onboarding",count:counts.onboarding},
                {key:"archived",label:"Archive",count:counts.archived},
              ]}/>

              {engTab==="archived" ? (
                <div style={{background:C.card,borderRadius:13,overflow:"hidden",boxShadow:"0 1px 3px rgba(0,0,0,.05)"}}>
                  {shown.length===0&&<div style={{padding:22,textAlign:"center",color:C.light,fontSize:13}}>No archived SP's.</div>}
                  {shown.map((eng,i)=>(
                    <div key={eng.id} style={{padding:"12px 18px",borderBottom:i<shown.length-1?`1px solid ${C.border}`:"none",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                      <Av initials={eng.name.split(" ").map(w=>w[0]).join("")} color={accent}/>
                      <div style={{flex:1,minWidth:120}}>
                        <div style={{fontWeight:700,fontSize:13}}>{eng.name}</div>
                        <div style={{color:C.light,fontSize:11}}>{eng.phone} · {eng.email}</div>
                        <div style={{color:C.light,fontSize:10,marginTop:2}}>Archived {eng.archivedAt?new Date(eng.archivedAt).toLocaleDateString("en-GB"):"—"}</div>
                      </div>
                      <Btn onClick={()=>restoreProfile(eng.profileId)} variant="ghost" sm>Restore</Btn>
                      {isOwner&&<Btn onClick={()=>askDelete(eng.profileId,eng.name)} variant="danger" sm>Delete Forever</Btn>}
                    </div>
                  ))}
                </div>
              ) : (
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(330px,1fr))",gap:14}}>
                {shown.length===0&&<div style={{color:C.light,fontSize:13}}>{engTab==="onboarding"?"No SP's currently onboarding.":"No SP's yet — add one to get started."}</div>}
                {shown.map(eng=>{
                  const eJobs=jobs.filter(j=>j.engineerId===eng.id);
                  const done=eJobs.filter(j=>j.status==="Completed").length;
                  const ber=eJobs.filter(j=>j.status==="Beyond Repair").length;
                  const total=done+ber;
                  const sr=total?Math.round(done/total*100):null;
                  const active=eJobs.filter(j=>!["Completed","Beyond Repair","Cancelled"].includes(j.status)).length;
                  const owed=eJobs.filter(j=>j.status==="Completed"&&!j.paid).reduce((s,j)=>s+Number(j.rate||0),0);
                  const prog=engineerOnboardingProgress(eng);
                  return (
                    <div key={eng.id} style={{background:C.card,borderRadius:13,boxShadow:"0 1px 3px rgba(0,0,0,.05)",overflow:"hidden"}}>
                      <div style={{padding:"13px 15px",borderBottom:`1px solid ${C.border}`,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
                        <Av initials={eng.name.split(" ").map(w=>w[0]).join("")} color={accent}/>
                        <div style={{flex:1,minWidth:120}}><div style={{fontWeight:800,fontSize:14}}>{eng.name}</div><div style={{color:C.light,fontSize:11}}>{eng.phone} · {eng.email}</div></div>
                        {isOwner&&<span style={{fontWeight:800,color:accent,fontSize:13}}>£{eng.rate}/job</span>}
                        <Btn onClick={()=>setEditEng(eng)} variant="ghost" sm>Edit</Btn>
                        <Btn onClick={()=>askResetPassword(eng.profileId,eng.name)} variant="ghost" sm>Reset Password</Btn>
                        <Btn onClick={()=>askArchive(eng.profileId,eng.name)} variant="ghost" sm style={{color:C.danger}}>Archive</Btn>
                      </div>

                      {/* Onboarding progress -- which step this engineer is at */}
                      {engTab==="onboarding"&&(
                        <div style={{padding:"9px 15px",borderBottom:`1px solid ${C.border}`,background:"#161B22"}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                            <span style={{fontSize:9,color:C.light,fontWeight:700,textTransform:"uppercase",letterSpacing:.4}}>Onboarding</span>
                            <span style={{fontSize:11,fontWeight:800,color:C.warn}}>Step {prog.completed} of {prog.total}</span>
                          </div>
                          <div style={{height:5,background:"#000",borderRadius:3,overflow:"hidden",marginBottom:6}}>
                            <div style={{height:"100%",width:`${Math.round(prog.completed/prog.total*100)}%`,background:C.warn}}/>
                          </div>
                          {prog.next&&<div style={{fontSize:11,color:C.mid}}>Next: <strong style={{color:C.text}}>{prog.next.label}</strong></div>}
                        </div>
                      )}

                      {/* Stats row */}
                      <div style={{padding:"10px 15px",display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4,borderBottom:`1px solid ${C.border}`,background:"#161B22"}}>
                        {[["Active",active,C.blue],["Repaired",done,C.success],["BER",ber,C.danger],["Success",sr!==null?`${sr}%`:"—",sr>=80?C.success:sr>=60?C.warn:sr!==null?C.danger:C.light]].map(([l,v,col])=>(
                          <div key={l} style={{textAlign:"center"}}><div style={{fontWeight:900,fontSize:17,color:col}}>{v}</div><div style={{fontSize:9,color:C.light,textTransform:"uppercase",letterSpacing:.3}}>{l}</div></div>
                        ))}
                      </div>

                      {/* Coverage */}
                      <div style={{padding:"9px 15px",borderBottom:`1px solid ${C.border}`}}>
                        <div style={{fontSize:9,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:5,letterSpacing:.4}}>Postcode Areas</div>
                        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                          {eng.postcodes.length?eng.postcodes.map(pc=><span key={pc} style={{background:C.primaryLight,color:C.primary,fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4}}>{pc}</span>):<span style={{color:C.light,fontSize:11,fontStyle:"italic"}}>None set</span>}
                        </div>
                      </div>
                      <div style={{padding:"9px 15px",borderBottom:`1px solid ${C.border}`}}>
                        <div style={{fontSize:9,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:5,letterSpacing:.4}}>Appliances Covered</div>
                        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                          {eng.applianceTypes.length?eng.applianceTypes.map(a=><span key={a} style={{background:C.successLight,color:C.success,fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:4}}>{a}</span>):<span style={{color:C.light,fontSize:11,fontStyle:"italic"}}>None set</span>}
                        </div>
                      </div>

                      {isOwner&&owed>0&&<div style={{padding:"7px 15px",background:"rgba(248,113,113,0.12)",fontSize:12,color:"#f87171",fontWeight:700}}>£{owed} owed in unpaid jobs</div>}

                      {/* Recent jobs */}
                      <div style={{padding:"8px 15px"}}>
                        {eJobs.filter(j=>!["Completed","Beyond Repair","Cancelled"].includes(j.status)).slice(0,2).map(j=>(
                          <div key={j.id} onClick={()=>setSelJob(j)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:12,padding:"4px 0",cursor:"pointer",color:C.mid}} onMouseOver={e=>e.currentTarget.style.color=C.primary} onMouseOut={e=>e.currentTarget.style.color=C.mid}>
                            <span><strong style={{color:C.text}}>{j.customer}</strong> · {j.appliance}{j.brand?` · ${j.brand}`:""}</span><Badge status={j.status}/>
                          </div>
                        ))}
                        {!eJobs.filter(j=>!["Completed","Beyond Repair","Cancelled"].includes(j.status)).length&&<div style={{fontSize:11,color:C.light,fontStyle:"italic"}}>No active jobs</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
            );
          })()}

          {/* ── PAYMENTS ── */}
          {/* Combined list: in-house SPs and one-off external SPs both render
              through the same card template below, sorted by amount owed
              (highest first) so it reads as one unified payments section
              rather than two separate in-house/external groups. */}
          {view==="payments"&&(()=>{
            const payees = [
              ...engineers.map(eng=>{
                const done=jobs.filter(j=>j.engineerId===eng.id&&j.status==="Completed");
                const ber=jobs.filter(j=>j.engineerId===eng.id&&j.status==="Beyond Repair");
                return {
                  key:`eng-${eng.id}`, external:false,
                  name:eng.name, initials:eng.name.split(" ").map(w=>w[0]).join(""),
                  sub:`${done.length} completed · ${ber.length} BER`,
                  unpaid:done.filter(j=>!j.paid), paid:done.filter(j=>j.paid),
                };
              }),
              ...externalGroups.map((g,gi)=>{
                const done=g.jobs.filter(j=>j.status==="Completed");
                return {
                  key:`ext-${gi}`, external:true,
                  name:g.name, initials:g.name.split(" ").map(w=>w[0]).join("").slice(0,2),
                  sub:[g.company,g.phone].filter(Boolean).join(" · ")||"No contact details",
                  unpaid:done.filter(j=>!j.paid), paid:done.filter(j=>j.paid),
                };
              }),
            ].sort((a,b)=>b.unpaid.reduce((s,j)=>s+Number(j.rate||0),0)-a.unpaid.reduce((s,j)=>s+Number(j.rate||0),0));

            return (
            <div>
              <SectionTabs value={view} onChange={setView}/>
              <h1 style={{margin:"0 0 16px",fontSize:19,fontWeight:900,color:C.text}}>Payments</h1>
              {payees.map(p=>(
                <div key={p.key} style={{background:C.card,borderRadius:13,boxShadow:"0 1px 3px rgba(0,0,0,.05)",marginBottom:16,overflow:"hidden",...(p.external?{border:`1px solid ${C.purple}33`}:{})}}>
                  <div style={{padding:"13px 18px",borderBottom:`1px solid ${C.border}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:"#161B22"}}>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      <Av initials={p.initials} color={p.external?C.purple:accent}/>
                      <div>
                        <div style={{fontWeight:800,fontSize:14,display:"flex",alignItems:"center",gap:6}}>{p.name}{p.external&&<span style={{background:C.purpleLight,color:C.purple,padding:"1px 7px",borderRadius:10,fontSize:9,fontWeight:800}}>EXTERNAL</span>}</div>
                        <div style={{color:C.light,fontSize:11}}>{p.sub}</div>
                      </div>
                    </div>
                    <div style={{textAlign:"right"}}><div style={{color:C.danger,fontWeight:900,fontSize:16}}>£{p.unpaid.reduce((s,j)=>s+Number(j.rate||0),0)} owed</div><div style={{color:C.success,fontSize:11,fontWeight:600}}>£{p.paid.reduce((s,j)=>s+Number(j.rate||0),0)} paid total</div></div>
                  </div>
                  {p.unpaid.length===0?<div style={{padding:"11px 18px",color:C.success,fontWeight:600,fontSize:12}}>✓ All payments up to date</div>:p.unpaid.map(j=>(
                    <div key={j.id} style={{padding:"9px 18px",borderBottom:`1px solid #262626`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div><span style={{fontWeight:700,fontSize:13}}>#{j.id} {j.customer}</span><span style={{color:C.light,fontSize:11}}> · {j.appliance}{j.brand?` · ${j.brand}`:""} · {fmt(j.completedDate||j.scheduledDate)}</span></div>
                      <div style={{display:"flex",gap:9,alignItems:"center"}}>
                        <span style={{fontWeight:800,color:C.danger}}>£{j.rate}</span>
                        {isOwner&&<Btn onClick={async ()=>{ await supabase.from("bookings").update({paid:true}).eq("id",j.id); await loadBookings(); }} variant="success" sm>Mark Paid</Btn>}
                      </div>
                    </div>
                  ))}
                  {p.paid.length>0&&<div style={{padding:"9px 18px",background:"#161B22"}}>
                    <div style={{fontSize:9,color:C.light,fontWeight:700,textTransform:"uppercase",marginBottom:5,letterSpacing:.4}}>Payment History</div>
                    {p.paid.map(j=><div key={j.id} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"3px 0",color:C.mid}}><span>#{j.id} {j.customer} · {j.appliance}{j.brand?` · ${j.brand}`:""}</span><span style={{color:C.success,fontWeight:700}}>£{j.rate} ✓</span></div>)}
                  </div>}
                </div>
              ))}
              {payees.length===0&&<div style={{color:C.light,fontSize:13}}>No completed jobs yet.</div>}
            </div>
            );
          })()}

          {/* ── SETTINGS (Website[Pricing/Services/Content/Booking Form], Users, Payments, Assignment) ── */}
          {view==="settings"&&isOwner&&(
            <SettingsView pricing={pricing} onReload={loadPricing}
              users={users} onUserCreated={loadStaffUsers} currentUserId={currentUser.id}
              usersTab={usersTab} onUsersTabChange={setUsersTab}
              onArchive={(u)=>askArchive(u.id,u.name||u.email)}
              onRestore={(u)=>restoreProfile(u.id)}
              onDelete={(u)=>askDelete(u.id,u.name||u.email)}
              onResetPassword={(u)=>askResetPassword(u.id,u.name||u.email)}
            />
          )}

        </div>
      </div>

      {/* ── MODALS ── */}
      {(showNew||editJob)&&(
        <Modal title={editJob?`Edit Job #${editJob.id}`:(newDefaultStatus==="Quote"?"New Quote":"New Booking")} onClose={()=>{setShowNew(false);setEditJob(null);}} wide>
          <JobForm initial={editJob} defaultStatus={newDefaultStatus} onSave={saveJob} onCancel={()=>{setShowNew(false);setEditJob(null);}} canEditRate={isOwner} engineers={assignableEngineers} jobs={jobs}/>
        </Modal>
      )}
      {selJob&&!editJob&&!reassign&&(
        <Modal title={`Job #${selJob.id} — ${selJob.customer}`} onClose={()=>setSelJob(null)} wide>
          <JobDetail job={selJob} onClose={()=>setSelJob(null)} onEdit={()=>{setEditJob(selJob);setSelJob(null);}} onReassign={()=>setReassign(selJob)} onDelete={isOwner?()=>askDeleteJob(selJob):undefined} engineers={engineers}/>
        </Modal>
      )}
      {reassign&&(
        <ReassignModal job={reassign} engineers={assignableEngineers} jobs={jobs} onReassign={doReassign} onClose={()=>setReassign(null)}/>
      )}
      {editEng&&(
        <Modal title={`Edit SP: ${editEng.name}`} onClose={()=>setEditEng(null)} wide>
          <EngineerEditor eng={editEng} onSave={saveEng} onCancel={()=>setEditEng(null)} isOwner={isOwner}/>
        </Modal>
      )}
      {showAddEng&&(
        <AddEngineerModal onCreated={()=>{loadEngineers();setShowAddEng(false);}} onCancel={()=>setShowAddEng(false)}/>
      )}
      {confirmModal&&(
        <ConfirmModal
          title={confirmModal.kind==="archive"?`Archive ${confirmModal.label}?`:`Permanently delete ${confirmModal.label}?`}
          message={confirmModal.kind==="archive"
            ? "They'll be moved to the Archive tab and won't show up in Active/Onboarding lists or be assignable to new jobs. You can restore them from Archive at any time."
            : "This permanently deletes their login, profile, and (if an SP) their SP record. This cannot be undone."}
          confirmLabel={confirmModal.kind==="archive"?"Archive":"Delete Forever"}
          danger={confirmModal.kind==="delete"}
          busy={confirmBusy}
          err={confirmErr}
          onConfirm={runConfirm}
          onCancel={()=>{setConfirmModal(null);setConfirmErr("");}}
        />
      )}
      {resetPwTarget&&(
        <ConfirmModal
          title={`Reset ${resetPwTarget.label}'s password?`}
          message={`This immediately replaces their current password with a new temporary one -- their old password stops working right away. Use this if their own "Forgot password" email isn't arriving or the link is down. They'll be asked to set their own password the next time they log in.`}
          confirmLabel="Reset Password"
          busy={resetPwBusy}
          err={resetPwErr}
          onConfirm={runResetPassword}
          onCancel={()=>{setResetPwTarget(null);setResetPwErr("");}}
        />
      )}
      {deleteJobTarget&&(
        <ConfirmModal
          title={`Delete Booking #${deleteJobTarget.id}?`}
          message={`This permanently removes ${deleteJobTarget.customer}'s booking (#${deleteJobTarget.id}) and its job history -- this cannot be undone. If you just want it off the active lists, set its status to Cancelled instead.`}
          confirmLabel="Delete Forever"
          danger
          busy={deleteJobBusy}
          err={deleteJobErr}
          onConfirm={runDeleteJob}
          onCancel={()=>{setDeleteJobTarget(null);setDeleteJobErr("");}}
        />
      )}
      {bulkDeleteConfirm&&(
        <ConfirmModal
          title={`Delete ${selectedJobIds.size} booking${selectedJobIds.size===1?"":"s"}?`}
          message={`This permanently removes the ${selectedJobIds.size} selected booking${selectedJobIds.size===1?"":"s"} and their job history -- this cannot be undone. If you just want them off the active lists, set their status to Cancelled instead.`}
          confirmLabel={`Delete ${selectedJobIds.size} Forever`}
          danger
          busy={bulkDeleteBusy}
          err={bulkDeleteErr}
          onConfirm={runBulkDeleteJobs}
          onCancel={()=>{setBulkDeleteConfirm(false);setBulkDeleteErr("");}}
        />
      )}
      {resetPwResult&&(
        <Modal title="Password Reset" onClose={()=>setResetPwResult(null)}>
          <div style={{fontSize:13,color:C.mid,lineHeight:1.5,marginBottom:14}}>
            New temporary password for <strong style={{color:C.text}}>{resetPwResult.email}</strong> -- share it with them directly (call/text, not email, since this won't be emailed to them). {resetPwResult.message}
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",background:"#161B22",border:`1px solid ${C.border}`,borderRadius:9,padding:"12px 14px",marginBottom:14}}>
            <code style={{flex:1,fontSize:17,fontWeight:800,letterSpacing:1,color:C.text}}>{resetPwResult.tempPassword}</code>
            <Btn onClick={()=>navigator.clipboard?.writeText(resetPwResult.tempPassword)} variant="ghost" sm>Copy</Btn>
          </div>
          {resetPwResult.warning&&<div style={{background:"rgba(251,191,36,0.15)",color:"#fbbf24",borderRadius:7,padding:"8px 12px",fontSize:12,marginBottom:14,fontWeight:600}}>{resetPwResult.warning}</div>}
          <Btn onClick={()=>setResetPwResult(null)} full style={{padding:"10px 0"}}>Done</Btn>
        </Modal>
      )}
    </div>
  );
}
