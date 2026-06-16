import React, { useState, useEffect, useMemo, useRef } from "react";

// ————— stockage local (autonome, hors Claude) —————
const storage = {
  async get(key) { const v = localStorage.getItem(key); return v == null ? null : { key, value: v }; },
  async set(key, value) { localStorage.setItem(key, value); return { key, value }; },
};


const safeConfirm = (msg) => { try { return safeConfirm(msg); } catch { return true; } };
const safeAlert = (msg) => { try { safeAlert(msg); } catch {} };
const safePrompt = (msg) => { try { return safePrompt(msg); } catch { return null; } };


// ————————————————————————————————————————————————————————
// LE PASSE v3 — gestion de bar pour indépendants
// Tableau de bord · Marges · Stocks · Hygiène · Traçabilité
// · Équipe (fiches techniques) · Assistant IA · Réglages
// ————————————————————————————————————————————————————————

async function askClaude(messages, useSearch) {
  const res = await fetch("/api/assistant", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, useSearch: !!useSearch }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "Assistant indisponible — vérifie la clé API côté serveur."); }
  const data = await res.json(); return data.text || "";
}

function parseJsonLoose(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  const a = clean.indexOf("["), o = clean.indexOf("{");
  const s = a >= 0 && (o < 0 || a < o) ? a : o;
  if (s < 0) throw new Error("Pas de JSON");
  const e = Math.max(clean.lastIndexOf("]"), clean.lastIndexOf("}"));
  return JSON.parse(clean.slice(s, e + 1));
}

// Compresse la photo (les factures en pleine résolution sont trop lourdes)
function compressImage(file, maxDim = 1568, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Lecture impossible"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image illisible"));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality).split(",")[1]);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ————— blindage : validation des données chargées —————
function sanitizeData(raw, seed) {
  const d = { ...seed, ...(raw && typeof raw === "object" ? raw : {}) };
  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, fb = "") => (typeof v === "string" ? v : fb);
  const n = (v, fb = 0) => (typeof v === "number" && isFinite(v) ? v : fb);
  d.target = Math.max(1, Math.min(99, n(d.target, 80)));
  d.barName = str(d.barName, seed.barName);
  d.city = str(d.city, seed.city);
  d.bottles = arr(d.bottles).filter((b) => b && b.id && b.name).map((b) => ({
    id: String(b.id), name: str(b.name).slice(0, 80), cat: str(b.cat, "Autre"),
    volume: Math.max(1, n(b.volume, 70)), price: Math.max(0, n(b.price)),
    stock: Math.max(0, Math.round(n(b.stock))), threshold: Math.max(0, Math.round(n(b.threshold, 2))),
    max: Math.max(0, Math.round(n(b.max))), supplier: str(b.supplier),
    history: arr(b.history).filter((h) => h && h.date && isFinite(h.price)).slice(-24),
  }));
  const bIds = new Set(d.bottles.map((b) => b.id));
  d.recipes = arr(d.recipes).filter((r) => r && r.id && r.name).map((r) => ({
    id: String(r.id), name: str(r.name).slice(0, 80), price: Math.max(0, n(r.price)),
    otherCost: Math.max(0, n(r.otherCost)),
    ingredients: arr(r.ingredients).filter((i) => i && bIds.has(i.bottleId) && n(i.cl) > 0).map((i) => ({ bottleId: i.bottleId, cl: n(i.cl) })),
    glass: str(r.glass), method: str(r.method), garnish: str(r.garnish), steps: str(r.steps),
  }));
  d.foodItems = arr(d.foodItems).filter((x) => x && x.id && x.name).map((x) => ({
    id: String(x.id), name: str(x.name).slice(0, 80), unit: str(x.unit, "pièce"),
    price: Math.max(0, n(x.price)), supplier: str(x.supplier),
  }));
  const fiIds = new Set(d.foodItems.map((x) => x.id));
  d.dishes = arr(d.dishes).filter((x) => x && x.id && x.name).map((x) => ({
    id: String(x.id), name: str(x.name).slice(0, 80), price: Math.max(0, n(x.price)), otherCost: Math.max(0, n(x.otherCost)),
    ingredients: arr(x.ingredients).filter((i) => i && fiIds.has(i.itemId) && n(i.qty) > 0).map((i) => ({ itemId: i.itemId, qty: n(i.qty) })),
  }));
  d.equipments = arr(d.equipments).filter((e) => e && e.id && e.name);
  d.machines = arr(d.machines).filter((m) => m && m.id && m.name).map((m) => ({
    ...m, serviceFreq: Math.max(1, Math.round(n(m.serviceFreq, 7))),
    status: ["ok", "surveiller", "panne"].includes(m.status) ? m.status : "ok",
  }));
  d.cleaning = arr(d.cleaning).filter((t) => t && t.id && t.label).map((t) => ({ ...t, freq: FREQ[t.freq] ? t.freq : "jour" }));
  d.temps = arr(d.temps).filter((t) => t && t.date && isFinite(t.value)).slice(0, 600);
  d.receptions = arr(d.receptions).filter((r) => r && r.id && r.product).slice(0, 400);
  d.inventories = arr(d.inventories).slice(0, 24);
  d.checklists = d.checklists && typeof d.checklists === "object"
    ? { ouverture: arr(d.checklists.ouverture), fermeture: arr(d.checklists.fermeture) }
    : seed.checklists;
  d.checkDone = d.checkDone && typeof d.checkDone === "object" ? { date: str(d.checkDone.date), done: arr(d.checkDone.done) } : { date: "", done: [] };
  return d;
}

// ————— blindage : garde-fou anti écran blanc —————
class SafeBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: false }; }
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    if (this.state.err) {
      return (
        <div style={{ minHeight: "100vh", background: "#FBFAF7", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", padding: 20 }}>
          <div style={{ textAlign: "center", maxWidth: 380 }}>
            <div style={{ fontSize: 18, marginBottom: 8 }}>Un imprévu est survenu</div>
            <div style={{ fontSize: 13.5, color: "#6E675C", lineHeight: 1.6, marginBottom: 16 }}>Tes données sont en sécurité. Recharge l'application pour reprendre.</div>
            <button onClick={() => { this.setState({ err: false }); }} style={{ background: "#A07C3F", color: "#fff", border: "none", borderRadius: 6, padding: "11px 22px", fontSize: 14, cursor: "pointer" }}>Reprendre</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const C = {
  bg: "#F4F6FA",
  panel: "#FFFFFF",
  panelSolid: "#FFFFFF",
  soft: "#EEF1F6",
  ink: "#15203A",
  sub: "#5C6B86",
  brass: "#3B82F6",
  brassSoft: "#DCE7FB",
  line: "#E2E7F0",
  ok: "#1E9E6A",
  okSoft: "#E2F3EA",
  warn: "#C98A12",
  warnSoft: "#FBF0D8",
  bad: "#D64A3B",
  badSoft: "#FAE4E1",
};
const MODCOL = {
  bord: "#3B82F6",
  marges: "#22C55E",
  stocks: "#F59E0B",
  hygiene: "#06B6D4",
  trace: "#A855F7",
  equipe: "#EC4899",
  assistant: "#8B5CF6",
  reglages: "#64748B",
  commandes: "#0EA5A5",
  cuisine: "#E2674A",
};
const MODICON = {
  bord: "▦", marges: "€", stocks: "▤", hygiene: "✦", trace: "❉", equipe: "❖", assistant: "✺", reglages: "⚙", commandes: "▣", cuisine: "🍽",
};


const TVA = 1.2;
const fmt = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2 }).format(n || 0);
const fmt0 = (n) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);
const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };
const FREQ = { jour: 1, semaine: 7, mois: 30 };
const CATS = ["Spiritueux", "Liqueur", "Vin", "Bière", "Softs", "Autre"];

const SEED = {
  target: 80,
  barName: "Les Mauvais Garçons",
  city: "Bordeaux",
  bottles: [
    { id: "b1", name: "Cognac VS", cat: "Spiritueux", volume: 70, price: 28, stock: 6, threshold: 2, max: 8, supplier: "Métro" },
    { id: "b2", name: "Amaretto", cat: "Liqueur", volume: 70, price: 16, stock: 4, threshold: 2, max: 6, supplier: "Métro" },
    { id: "b3", name: "Mezcal", cat: "Spiritueux", volume: 70, price: 38, stock: 3, threshold: 1, max: 4, supplier: "Bordeaux Aquitaine Boissons" },
    { id: "b4", name: "Vodka", cat: "Spiritueux", volume: 70, price: 18, stock: 8, threshold: 3, max: 12, supplier: "Métro" },
  ],
  foodItems: [
    { id: "fi1", name: "Burrata", unit: "pièce", price: 2.4, supplier: "Transgourmet" },
    { id: "fi2", name: "Tomates anciennes", unit: "kg", price: 3.8, supplier: "Transgourmet" },
    { id: "fi3", name: "Huile d'olive", unit: "L", price: 9.0, supplier: "Métro" },
    { id: "fi4", name: "Pain de campagne", unit: "pièce", price: 1.6, supplier: "Transgourmet" },
  ],
  dishes: [
    { id: "d1", name: "Burrata, tomates anciennes", price: 14, otherCost: 0.8,
      ingredients: [{ itemId: "fi1", qty: 1 }, { itemId: "fi2", qty: 0.15 }, { itemId: "fi3", qty: 0.02 }, { itemId: "fi4", qty: 0.5 }] },
  ],
  recipes: [
    { id: "r1", name: "Signature Cognac-Amaretto", price: 12, otherCost: 0.9, ingredients: [{ bottleId: "b1", cl: 4 }, { bottleId: "b2", cl: 2 }], glass: "Rocks", method: "Shaker", garnish: "Zeste d'orange brûlé", steps: "Shaker avec glace 12 s. Double filtration sur gros glaçon. Exprimer le zeste, le passer à la flamme, déposer." },
    { id: "r2", name: "Vodka-Mezcal fumé", price: 12, otherCost: 0.7, ingredients: [{ bottleId: "b4", cl: 3 }, { bottleId: "b3", cl: 2 }], glass: "Coupe", method: "Mixing glass", garnish: "Sel fumé en demi-givrage", steps: "Givrer la moitié de la coupe au sel fumé. Remuer 20 s à la cuillère. Filtrer." },
  ],
  equipments: [
    { id: "e1", name: "Frigo bar", type: "frigo", zone: "Bas" },
    { id: "e2", name: "Chambre froide", type: "frigo", zone: "Bas" },
    { id: "e3", name: "Congélateur", type: "congel", zone: "Bas" },
    { id: "e4", name: "Frigo de jour", type: "frigo", zone: "Cuisine" },
    { id: "e5", name: "Congélateur de jour", type: "congel", zone: "Cuisine" },
    { id: "e6", name: "Frigo cuisine", type: "frigo", zone: "Cuisine" },
    { id: "e7", name: "Congélateur cuisine", type: "congel", zone: "Cuisine" },
  ],
  machines: [
    { id: "m1", name: "Machine à glaçons", type: "Glaçons", zone: "Bas", status: "ok", serviceFreq: 30, lastService: null, note: "Détartrage + désinfection bac" },
    { id: "m2", name: "Lave-verre osmoseur", type: "Lave-verre", zone: "Bas", status: "ok", serviceFreq: 7, lastService: null, note: "Vérifier osmoseur + filtres, vidange" },
    { id: "m3", name: "Lave-verre osmoseur", type: "Lave-verre", zone: "Haut", status: "ok", serviceFreq: 7, lastService: null, note: "Vérifier osmoseur + filtres, vidange" },
    { id: "m4", name: "Tireuse à bière", type: "Tireuse", zone: "Bas", status: "ok", serviceFreq: 14, lastService: null, note: "Nettoyage lignes + têtes, contrôle CO2" },
    { id: "m5", name: "Machine à café", type: "Café", zone: "Bas", status: "ok", serviceFreq: 7, lastService: null, note: "Détartrage groupe, joints, buse vapeur" },
    { id: "m6", name: "Machine à café", type: "Café", zone: "Haut", status: "ok", serviceFreq: 7, lastService: null, note: "Détartrage groupe, joints, buse vapeur" },
    { id: "m7", name: "Plonge (lave-vaisselle)", type: "Lave-vaisselle", zone: "Cuisine", status: "ok", serviceFreq: 7, lastService: null, note: "Vidange, filtres, bras de lavage, détartrage" },
    { id: "m8", name: "Friteuse 1", type: "Friteuse", zone: "Cuisine", status: "ok", serviceFreq: 7, lastService: null, note: "Changement d'huile + filtration, contrôle qualité huile (test polarité), nettoyage cuve" },
    { id: "m9", name: "Friteuse 2", type: "Friteuse", zone: "Cuisine", status: "ok", serviceFreq: 7, lastService: null, note: "Changement d'huile + filtration, contrôle qualité huile (test polarité), nettoyage cuve" },
    { id: "m10", name: "Hotte", type: "Hotte", zone: "Cuisine", status: "ok", serviceFreq: 30, lastService: null, note: "Dégraissage filtres (bac à graisse hebdo) ; dégraissage conduit par société agréée 1×/an — exigence assurance" },
    { id: "m11", name: "Four", type: "Four", zone: "Cuisine", status: "ok", serviceFreq: 7, lastService: null, note: "Nettoyage enceinte + joints, contrôle sonde de température" },
    { id: "m12", name: "Machine sous vide", type: "Sous-vide", zone: "Cuisine", status: "ok", serviceFreq: 30, lastService: null, note: "Nettoyage cuve + barre de soudure, contrôle huile de pompe" },
  ],
  cleaning: [
    { id: "c1", label: "Plan de travail bar", freq: "jour", lastDone: null },
    { id: "c2", label: "Becs verseurs & pichets", freq: "jour", lastDone: null },
    { id: "c3", label: "Machine à glaçons", freq: "semaine", lastDone: null },
    { id: "c4", label: "Frigos (intérieur + joints)", freq: "semaine", lastDone: null },
    { id: "c5", label: "Siphon & tireuse (détartrage)", freq: "mois", lastDone: null },
  ],
  temps: [],
  receptions: [],
  checklists: {
    ouverture: [
      { id: "o1", label: "Relevés de température faits" },
      { id: "o2", label: "Machine à glaçons : niveau OK" },
      { id: "o3", label: "Mise en place bar (fruits, jus, garnishes)" },
      { id: "o4", label: "Fond de caisse vérifié" },
      { id: "o5", label: "Salle et terrasse propres" },
    ],
    fermeture: [
      { id: "f1", label: "Becs verseurs rincés" },
      { id: "f2", label: "Plans de travail désinfectés" },
      { id: "f3", label: "Frigos fermés, températures OK" },
      { id: "f4", label: "Poubelles sorties" },
      { id: "f5", label: "Caisse clôturée" },
    ],
  },
  checkDone: { date: "", done: [] },
};

// ————— UI de base —————
const inputStyle = {
  width: "100%", boxSizing: "border-box", background: C.bg, border: `1px solid ${C.line}`,
  borderRadius: 10, padding: "12px 13px", color: C.ink, fontSize: 16, outline: "none", fontFamily: "inherit",
};
function Field({ label, multiline, ...props }) {
  return (
    <label style={{ display: "block", marginBottom: 12, flex: 1 }}>
      <span style={{ display: "block", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub, marginBottom: 5 }}>{label}</span>
      {multiline ? <textarea {...props} style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} /> : <input {...props} style={inputStyle} />}
    </label>
  );
}
function Select({ label, children, ...props }) {
  return (
    <label style={{ display: "block", marginBottom: 12, flex: 1 }}>
      <span style={{ display: "block", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub, marginBottom: 5 }}>{label}</span>
      <select {...props} style={{ ...inputStyle, padding: "11px 10px" }}>{children}</select>
    </label>
  );
}
function Title({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "22px 0 14px", gap: 10 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: C.ink, letterSpacing: -0.2 }}>{children}</div>
      {right}
    </div>
  );
}
function Badge({ status, children }) {
  const map = { ok: [C.ok, C.okSoft], warn: [C.warn, C.warnSoft], bad: [C.bad, C.badSoft] };
  const [fg, bg] = map[status] || [C.sub, C.soft];
  return <span style={{ background: bg, color: fg, fontSize: 11, padding: "3px 9px", borderRadius: 20, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>;
}
function Card({ children, onClick, accent }) {
  return (
    <div onClick={onClick} style={{
      background: C.panelSolid, border: `1px solid ${accent || C.line}`, borderRadius: 14,
      padding: "14px 16px", marginBottom: 10, cursor: onClick ? "pointer" : "default",
    }}>{children}</div>
  );
}
function DayCheck({ done, onToggle, label }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle(); }} title={done ? "Fait aujourd'hui — décocher" : "Marquer comme fait"}
      style={{
        display: "flex", alignItems: "center", gap: 7, background: done ? "#E2F3EA" : "transparent",
        border: `1.5px solid ${done ? "#1E9E6A" : "#C7D0DE"}`, borderRadius: 8, padding: "6px 11px",
        cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: done ? "#1E9E6A" : "#5C6B86", whiteSpace: "nowrap",
      }}>
      <span style={{ fontSize: 14 }}>{done ? "☑" : "☐"}</span>{label || (done ? "Fait" : "À faire")}
    </button>
  );
}

function Gauge({ value, target }) {
  const w = Math.max(0, Math.min(100, value));
  const color = value >= target ? C.ok : value >= target - 10 ? C.warn : C.bad;
  return (
    <div>
      <div style={{ position: "relative", height: 8, background: C.soft, borderRadius: 4 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${w}%`, background: color, borderRadius: 4 }} />
        <div style={{ position: "absolute", left: `${target}%`, top: -3, bottom: -3, width: 2, background: C.brass, borderRadius: 1 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.sub, marginTop: 3 }}>
        <span>0 %</span><span style={{ color: C.brass }}>objectif {target} %</span><span>100 %</span>
      </div>
    </div>
  );
}

function AppInner() {
  const [data, setData] = useState(SEED);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("home");
  const [bottleForm, setBottleForm] = useState(null);
  const [recipeForm, setRecipeForm] = useState(null);
  const [recForm, setRecForm] = useState(null);
  const [tempForm, setTempForm] = useState({ equipId: "e1", value: "" });
  const [orderOpen, setOrderOpen] = useState(false);
  const [stockSearch, setStockSearch] = useState("");
  const [invCounts, setInvCounts] = useState(null);
  const [reportCopied, setReportCopied] = useState(false);
  const [recScanBusy, setRecScanBusy] = useState(false);
  const [recScanItems, setRecScanItems] = useState(null);
  const [recScanMsg, setRecScanMsg] = useState("");
  const recScanInput = useRef(null);
  const [checkForm, setCheckForm] = useState({ list: "ouverture", label: "" });
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [invoiceItems, setInvoiceItems] = useState(null);
  const [invoiceMsg, setInvoiceMsg] = useState("");
  const invoiceInput = useRef(null);
  const [copied, setCopied] = useState(false);
  const [stockFilter, setStockFilter] = useState("Tous");
  const [orderQty, setOrderQty] = useState({});
  const [dishForm, setDishForm] = useState(null);
  const [foodForm, setFoodForm] = useState(null);
  const [dishScanBusy, setDishScanBusy] = useState(false);
  const [dishScanItems, setDishScanItems] = useState(null);
  const [dishScanMsg, setDishScanMsg] = useState("");
  const dishScanInput = useRef(null);
  const [copiedSup, setCopiedSup] = useState("");
  const [ficheOpen, setFicheOpen] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [equipForm, setEquipForm] = useState({ name: "", type: "frigo", zone: "Bas" });
  const [machineForm, setMachineForm] = useState({ name: "", type: "Autre", zone: "Bas", serviceFreq: "7", note: "" });
  const [cleanForm, setCleanForm] = useState({ label: "", freq: "jour" });
  const [exported, setExported] = useState(false);
  const chatEnd = useRef(null);
  const lastBackupDay = useRef("");
  const storageGetBackup = async () => {
    try { const r = await storage.get("lepasse-backup"); return r?.value || null; } catch { return null; }
  };

  useEffect(() => {
    (async () => {
      try {
        let r = null;
        try { r = await storage.get("lepasse-v4"); } catch {}
        if (!r) { try { r = await storage.get("lepasse-v3"); } catch {} }
        if (!r) { try { r = await storage.get("lepasse-v2"); } catch {} }
        if (!r) { try { r = await storage.get("lepasse-v1"); } catch {} }
        if (r?.value) {
          let parsed = null;
          try { parsed = JSON.parse(r.value); } catch { parsed = null; }
          if (!parsed) {
            try {
              const bk = await storageGetBackup();
              if (bk) parsed = JSON.parse(bk);
            } catch {}
          }
          if (parsed) {
            const mergeSeed = (saved = [], seed = []) => {
              const keys = new Set(saved.map((x) => `${x.name}|${x.zone || ""}`));
              return [...saved, ...seed.filter((s) => !keys.has(`${s.name}|${s.zone || ""}`))];
            };
            const clean = sanitizeData(parsed, SEED);
            setData({
              ...clean,
              equipments: mergeSeed(clean.equipments, SEED.equipments),
              machines: mergeSeed(clean.machines, SEED.machines),
            });
          }
        }
      } catch {}
      setLoaded(true);
    })();
  }, []);
  // sauvegarde différée (évite les écritures à chaque frappe) + copie de secours quotidienne
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      const json = JSON.stringify(data);
      storage.set("lepasse-v4", json).catch(() => {});
      const day = today();
      if (lastBackupDay.current !== day) {
        lastBackupDay.current = day;
        storage.set("lepasse-backup", json).catch(() => {});
      }
    }, 700);
    return () => clearTimeout(t);
  }, [data, loaded]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, thinking]);

  const { bottles, recipes, equipments, cleaning, temps, receptions, target, barName, city } = data;
  const machines = data.machines || [];
  const foodItems = data.foodItems || [];
  const dishes = data.dishes || [];
  const set = (patch) => setData((d) => ({ ...d, ...patch }));

  // ————— calculs —————
  const bottleById = useMemo(() => Object.fromEntries(bottles.map((b) => [b.id, b])), [bottles]);
  const costOf = (r) => (r.ingredients || []).reduce((s, i) => {
    const b = bottleById[i.bottleId];
    return b && b.volume ? s + (i.cl / b.volume) * b.price : s;
  }, 0) + (r.otherCost || 0);
  const margeOf = (r) => { const ht = r.price / TVA; return ht > 0 ? ((ht - costOf(r)) / ht) * 100 : 0; };
  const foodById = useMemo(() => Object.fromEntries(foodItems.map((f) => [f.id, f])), [foodItems]);
  const dishCost = (d) => (d.ingredients || []).reduce((s, i) => {
    const f = foodById[i.itemId];
    return f ? s + i.qty * f.price : s;
  }, 0) + (d.otherCost || 0);
  const dishMarge = (d) => { const ht = d.price / TVA; return ht > 0 ? ((ht - dishCost(d)) / ht) * 100 : 0; };
  const dishPriceFor = (d) => { const c = dishCost(d); const t = target / 100; const p = t < 1 ? (c / (1 - t)) * TVA : 0; return isFinite(p) ? p : 0; };
  const priceFor = (r) => { // prix TTC conseillé pour atteindre l'objectif
    const c = costOf(r); const t = target / 100;
    const p = t < 1 ? (c / (1 - t)) * TVA : 0;
    return isFinite(p) ? p : 0;
  };

  const caveValue = bottles.reduce((s, b) => s + b.stock * b.price, 0);
  const lowStock = bottles.filter((b) => b.stock <= b.threshold);
  const avgMarge = recipes.length ? recipes.reduce((s, r) => s + margeOf(r), 0) / recipes.length : 0;
  const sortedRecipes = [...recipes].sort((a, b) => margeOf(a) - margeOf(b));

  const daysSince = (d) => (d ? Math.floor((Date.now() - new Date(d + "T12:00:00").getTime()) / 86400000) : Infinity);
  const cleanStatus = (t) => { const ds = daysSince(t.lastDone); return ds >= FREQ[t.freq] * 2 ? "bad" : ds >= FREQ[t.freq] ? "warn" : "ok"; };
  const tempConform = (eq, v) => (eq?.type === "congel" ? v <= -18 : v >= 0 && v <= 4);
  const todayTemps = temps.filter((t) => t.date === today());
  const tempsTodo = equipments.filter((e) => !todayTemps.some((t) => t.equipId === e.id));
  const tempsBad = todayTemps.filter((t) => !tempConform(equipments.find((e) => e.id === t.equipId), t.value));
  const cleanLate = cleaning.filter((t) => cleanStatus(t) !== "ok");
  const dlcSoon = receptions.filter((r) => r.dlc && daysSince(r.dlc) >= -3 && !r.consumed);
  const machineStatus = (m) => {
    if (m.status === "panne") return "bad";
    const ds = daysSince(m.lastService);
    if (ds >= m.serviceFreq * 2) return "bad";
    if (ds >= m.serviceFreq || m.status === "surveiller") return "warn";
    return "ok";
  };
  const machineAlerts = machines.filter((m) => machineStatus(m) !== "ok");
  const hygCount = tempsTodo.length + tempsBad.length + cleanLate.length + machineAlerts.length;
  const priceHikes = bottles.filter((b) => {
    const h = b.history || [];
    if (h.length < 2) return false;
    const last = h[h.length - 1], prev = h[h.length - 2];
    return last.price > prev.price * 1.02 && daysSince(last.date) <= 30;
  });
  const inventories = data.inventories || [];
  const lastInv = inventories[0] || null;

  const startInventory = () => setInvCounts(Object.fromEntries(bottles.map((b) => [b.id, String(b.stock)])));
  const validateInventory = () => {
    const lines = bottles.map((b) => { const raw = invCounts[b.id]; const counted = raw == null || String(raw).trim() === "" ? b.stock : Math.max(0, Math.round(num(raw))); return { bottleId: b.id, name: b.name, theoretical: b.stock, counted, price: b.price }; });
    const valueGap = lines.reduce((s, l) => s + (l.counted - l.theoretical) * l.price, 0);
    set({
      inventories: [{ id: uid(), date: today(), lines, valueGap }, ...inventories].slice(0, 24),
      bottles: bottles.map((b) => { const l = lines.find((x) => x.bottleId === b.id); return { ...b, stock: l ? l.counted : b.stock }; }),
    });
    setInvCounts(null);
  };

  const buildHygieneReport = () => {
    const since = Date.now() - 30 * 86400000;
    const recent = temps.filter((t) => new Date(t.date + "T12:00:00").getTime() >= since);
    const nonConf = recent.filter((t) => !tempConform(equipments.find((e) => e.id === t.equipId), t.value));
    const lines = [
      "RAPPORT DE CONFORMITE HYGIENE — " + barName + " (" + city + ")",
      "Genere le " + new Date().toLocaleDateString("fr-FR") + " — periode : 30 derniers jours",
      "",
      "1. RELEVES DE TEMPERATURE",
      "Releves effectues : " + recent.length + " — Non conformes : " + nonConf.length,
      ...nonConf.slice(0, 20).map((t) => "  ! " + t.date + " " + t.time + " — " + (equipments.find((e) => e.id === t.equipId)?.name || "?") + " : " + t.value + " degC"),
      "",
      "2. PLAN DE NETTOYAGE",
      ...cleaning.map((t) => "  " + (cleanStatus(t) === "ok" ? "OK" : "RETARD") + " — " + t.label + " (chaque " + t.freq + ") — dernier : " + (t.lastDone || "jamais")),
      "",
      "3. ENTRETIEN DES MACHINES",
      ...machines.map((m) => "  " + (m.status === "panne" ? "PANNE" : machineStatus(m) === "ok" ? "OK" : "A FAIRE") + " — " + m.name + " (" + m.zone + ") — dernier entretien : " + (m.lastService || "jamais")),
      "",
      "4. RECEPTIONS / TRACABILITE",
      "Receptions enregistrees (30 j) : " + receptions.filter((r) => new Date(r.date + "T12:00:00").getTime() >= since).length,
      "Avec reserve : " + receptions.filter((r) => !r.conform && new Date(r.date + "T12:00:00").getTime() >= since).length,
    ];
    return lines.join("\n");
  };
  const copyReport = async () => {
    try { await navigator.clipboard.writeText(buildHygieneReport()); setReportCopied(true); setTimeout(() => setReportCopied(false), 2000); } catch {}
  };

  const orderText = useMemo(() => {
    const bySup = {};
    for (const b of lowStock) { const s = b.supplier || "Fournisseur"; (bySup[s] = bySup[s] || []).push(b); }
    return Object.entries(bySup).map(([sup, items]) =>
      `— ${sup} —\n` + items.map((b) => `• ${b.name} (${b.volume} cl) : ${Math.max(1, (b.max || b.threshold * 2) - b.stock)} bt`).join("\n")
    ).join("\n\n");
  }, [bottles]);

  // ————— commandes : quoi commander selon stock vs max —————
  const toOrder = bottles
    .map((b) => {
      const target = b.max && b.max > 0 ? b.max : b.threshold * 2;
      const qty = Math.max(0, target - b.stock);
      return { ...b, suggestQty: qty };
    })
    .filter((b) => b.suggestQty > 0 && (b.stock <= b.threshold || (b.max && b.max > 0 && b.stock < b.max)));

  const ordersBySupplier = (() => {
    const g = {};
    for (const b of toOrder) {
      const sup = b.supplier || "Autre fournisseur";
      (g[sup] = g[sup] || []).push(b);
    }
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
  })();

  const orderTextFor = (sup, items) =>
    `Commande ${sup} — ${new Date().toLocaleDateString("fr-FR")}\n\n` +
    items.map((b) => `• ${b.name} (${b.volume} cl) : ${orderQty[b.id] != null ? orderQty[b.id] : b.suggestQty} bt`).join("\n");

  const copyOrderFor = async (sup, items) => {
    try { await navigator.clipboard.writeText(orderTextFor(sup, items)); setCopiedSup(sup); setTimeout(() => setCopiedSup(""), 2000); } catch {}
  };

  // ————— actions —————
  const withHistory = (prev, b) => {
    const h = [...(prev?.history || [])];
    if (!prev || prev.price !== b.price) h.push({ date: today(), price: b.price });
    return { ...b, history: h.slice(-24) };
  };
  const saveBottle = () => {
    const f = bottleForm;
    if (!f.name.trim() || num(f.volume) <= 0) return;
    const b = { id: f.id || uid(), name: f.name.trim(), cat: f.cat || "Autre", volume: num(f.volume), price: num(f.price), stock: num(f.stock), threshold: num(f.threshold), max: num(f.max) || 0, supplier: (f.supplier || "").trim() };
    set({ bottles: f.id ? bottles.map((x) => (x.id === f.id ? withHistory(x, b) : x)) : [...bottles, withHistory(null, b)] });
    setBottleForm(null);
  };
  const saveRecipe = () => {
    const f = recipeForm;
    if (!f.name.trim() || num(f.price) <= 0) return;
    const r = { id: f.id || uid(), name: f.name.trim(), price: num(f.price), otherCost: num(f.otherCost), ingredients: (f.ingredients || []).filter((i) => i.bottleId && num(i.cl) > 0).map((i) => ({ bottleId: i.bottleId, cl: num(i.cl) })), glass: (f.glass || "").trim(), method: (f.method || "").trim(), garnish: (f.garnish || "").trim(), steps: (f.steps || "").trim() };
    set({ recipes: f.id ? recipes.map((x) => (x.id === f.id ? r : x)) : [...recipes, r] });
    setRecipeForm(null);
  };

  // ————— assistant —————
  const barContext = () => {
    const recs = recipes.map((r) => `${r.name} — ${r.price}€ TTC, coût ${costOf(r).toFixed(2)}€, marge ${margeOf(r).toFixed(1)}% — ${(r.ingredients || []).map((i) => { const b = bottleById[i.bottleId]; return b ? `${b.name} ${i.cl}cl` : ""; }).join(" + ")}`).join("\n");
    const stk = bottles.map((b) => `${b.name} (${b.cat}) : ${b.stock} bt, seuil ${b.threshold}, ${b.price}€ HT/${b.volume}cl, fournisseur ${b.supplier || "?"}`).join("\n");
    const mac = machines.map((m) => `${m.name} (${m.zone}) : ${m.status === "panne" ? "EN PANNE" : machineStatus(m) === "warn" ? "entretien à faire" : "ok"}, entretien tous les ${m.serviceFreq} j`).join("\n");
    return `Bar : ${barName} (${city}). Objectif de marge : ${target}% HT.\n\nCARTE :\n${recs}\n\nSTOCK :\n${stk}\n\nMACHINES :\n${mac}\nDernier inventaire : ${lastInv ? lastInv.date + " (ecart " + lastInv.valueGap.toFixed(0) + " EUR)" : "aucun"} ; hausses fournisseurs recentes : ${priceHikes.map((b) => b.name).join(", ") || "aucune"}.\n\nALERTES : ${lowStock.length} réf. sous seuil (${lowStock.map((b) => b.name).join(", ") || "aucune"}) ; hygiène/machines : ${hygCount} point(s) à traiter ; DLC proches : ${dlcSoon.length}.`;
  };

  const MISSIONS = [
    {
      id: "ouverture", icon: "🌅", label: "Préparer l'ouverture",
      brief: "Tu es le bras droit du gérant pour l'ouverture du service. À partir de l'état du bar, dresse la liste claire et priorisée de TOUT ce qui doit être fait ou vérifié avant d'ouvrir aujourd'hui : relevés de température en retard, nettoyages du jour, machines à entretenir, DLC qui approchent, et références à commander d'urgence. Termine par un encouragement bref. Format : titres courts + listes à puces.",
    },
    {
      id: "commande", icon: "📦", label: "Faire le point commandes",
      brief: "Tu es le responsable des achats. À partir du stock et des stocks max, établis la commande de la semaine, regroupée par fournisseur, avec les quantités conseillées (max − stock). Signale les hausses de prix récentes et propose si un produit pourrait être commandé ailleurs. Termine par le total estimé si possible. Format : un bloc par fournisseur.",
    },
    {
      id: "marges", icon: "📈", label: "Optimiser mes marges",
      brief: "Tu es l'analyste financier du bar. Repère les cocktails dont la marge est sous l'objectif, explique pourquoi (coût matière élevé, prix trop bas), et propose pour chacun une action concrète : ajuster le prix, changer un ingrédient, revoir une dose. Classe du plus urgent au moins urgent. Sois chiffré.",
    },
    {
      id: "promo", icon: "💸", label: "Chercher promos & alternatives",
      brief: "Tu es l'acheteur malin du bar, chargé de réduire le coût matière. Pour les références de stock les plus chères ou les plus consommées, cherche sur le web : des promotions en cours chez les grossistes CHR français (Métro, Transgourmet, etc.), des produits équivalents moins chers (même catégorie, qualité comparable), et l'ordre de grandeur des prix du marché pour repérer si Gaby paie trop cher. Pour chaque piste : nom du produit, prix indicatif trouvé, économie potentielle, et la source. Sois honnête : si tu ne trouves pas d'info fiable en ligne pour un produit, dis-le plutôt que d'inventer. Termine par les 2-3 pistes les plus rentables à creuser.",
    },
    {
      id: "semaine", icon: "🗓️", label: "Résumer ma semaine",
      brief: "Tu es le directeur d'exploitation. Fais une synthèse de la situation globale du bar : santé des marges, niveau des stocks, conformité hygiène et entretien des machines, points de vigilance. Termine par les 3 priorités de la semaine. Vue d'ensemble, pas de détail inutile.",
    },
  ];

  const runMission = async (mission) => {
    if (thinking) return;
    const userMsg = { role: "user", content: mission.label };
    const next = [...chat, userMsg];
    setChat(next); setThinking(true);
    try {
      const sys = `Tu es un agent spécialisé intégré à l'appli "Le Passe" du bar ${barName} (${city}), géré par Gaby. ${mission.brief}\n\nRéponds en français, concret et actionnable. Tu peux chercher sur le web si une info externe (prix, réglementation, tendance) est utile. Voici l'état actuel du bar :\n\n${barContext()}`;
      const messages = [
        { role: "user", content: sys },
        { role: "assistant", content: "Mission reçue. J'analyse l'état du bar et je te fais le point." },
        { role: "user", content: mission.label },
      ];
      const text = await askClaude(messages, true);
      setChat([...next, { role: "assistant", content: text || "(vide)" }]);
    } catch {
      setChat([...next, { role: "assistant", content: "Erreur de connexion. Réessaie." }]);
    }
    setThinking(false);
  };

  const sendChat = async (preset) => {
    const q = (preset || chatInput).trim();
    if (!q || thinking) return;
    const next = [...chat, { role: "user", content: q }];
    setChat(next); setChatInput(""); setThinking(true);
    try {
      const sys = `Tu es l'assistant intégré de l'appli "Le Passe", outil de gestion pour le bar ${barName}. Tu parles à Gaby, gérant. Réponds en français, concret et bref. Tu connais l'état du bar ci-dessous. Tu peux chercher sur le web (prix fournisseurs, tendances cocktails, réglementation) si utile.\n\n${barContext()}`;
      const messages = [
        { role: "user", content: sys },
        { role: "assistant", content: "Compris, j'ai l'état du bar en tête. Je t'écoute." },
        ...next.map((m) => ({ role: m.role, content: m.content })),
      ];
      const text = await askClaude(messages, true);
      setChat([...next, { role: "assistant", content: text || "(vide)" }]);
    } catch {
      setChat([...next, { role: "assistant", content: "Erreur de connexion. Réessaie." }]);
    }
    setThinking(false);
  };

  const saveFood = () => {
    const f = foodForm;
    if (!f.name.trim() || num(f.price) < 0) return;
    const o = { id: f.id || uid(), name: f.name.trim(), unit: (f.unit || "pièce").trim(), price: num(f.price), supplier: (f.supplier || "").trim() };
    set({ foodItems: f.id ? foodItems.map((x) => (x.id === f.id ? o : x)) : [...foodItems, o] });
    setFoodForm(null);
  };
  const saveDish = () => {
    const f = dishForm;
    if (!f.name.trim() || num(f.price) <= 0) return;
    const o = { id: f.id || uid(), name: f.name.trim(), price: num(f.price), otherCost: num(f.otherCost),
      ingredients: (f.ingredients || []).filter((i) => i.itemId && num(i.qty) > 0).map((i) => ({ itemId: i.itemId, qty: num(i.qty) })) };
    set({ dishes: f.id ? dishes.map((x) => (x.id === f.id ? o : x)) : [...dishes, o] });
    setDishForm(null);
  };
  const scanDishMenu = async (file) => {
    if (!file || dishScanBusy) return;
    setDishScanBusy(true); setDishScanMsg(""); setDishScanItems(null);
    try {
      const b64 = await compressImage(file);
      const text = await askClaude([{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: 'Voici la photo de la carte des PLATS d\'un restaurant. Extrais chaque plat avec son nom et son prix de vente TTC en euros. Ignore les boissons et les cocktails. Reponds UNIQUEMENT avec ce JSON, sans texte autour :\n{"items":[{"name":"...","price":14.0}]}' },
        ],
      }], false);
      const parsed = parseJsonLoose(text);
      const items = (parsed.items || []).filter((x) => x.name).map((x) => ({ id: uid(), name: String(x.name).slice(0, 80), price: Number(x.price) || 0, keep: true }));
      if (items.length === 0) throw new Error("vide");
      setDishScanItems(items);
    } catch {
      setDishScanMsg("Lecture impossible — reprends la photo bien à plat, nette, cadrée sur les plats.");
    }
    setDishScanBusy(false);
    if (dishScanInput.current) dishScanInput.current.value = "";
  };
  const applyDishScan = () => {
    if (!dishScanItems) return;
    const newDishes = dishScanItems.filter((i) => i.keep).map((i) => ({ id: uid(), name: i.name, price: i.price, otherCost: 0, ingredients: [] }));
    set({ dishes: [...dishes, ...newDishes] });
    setDishScanItems(null);
    setDishScanMsg(newDishes.length + " plat(s) ajouté(s). Renseigne leurs ingrédients pour calculer la marge.");
  };

  const exportData = async () => {
    const json = JSON.stringify(data, null, 2);
    try { await navigator.clipboard.writeText(json); } catch {}
    try {
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "le-passe-sauvegarde-" + today() + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {}
    setExported(true); setTimeout(() => setExported(false), 2000);
  };
  const importData = () => {
    const txt = safePrompt("Colle ici le contenu d'une sauvegarde JSON (cela remplacera les données actuelles) :");
    if (!txt) return;
    try {
      const parsed = JSON.parse(txt);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.bottles)) throw new Error("format");
      if (!safeConfirm("Restaurer cette sauvegarde ? Les données actuelles seront remplacées.")) return;
      setData(sanitizeData(parsed, SEED));
    } catch {
      safeAlert("Sauvegarde illisible — vérifie que tu as collé le JSON complet.");
    }
  };

  // ————— scan de facture —————
  const scanInvoice = async (file) => {
    if (!file || invoiceBusy) return;
    setInvoiceBusy(true); setInvoiceMsg(""); setInvoiceItems(null);
    try {
      const b64 = await compressImage(file);
      const text = await askClaude([{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: `Voici la photo d'une facture ou d'un bon de livraison fournisseur d'un bar-restaurant. Extrais chaque ligne de produit BOISSON ou LIQUIDE (spiritueux, liqueurs, vins, bieres, softs, sirops). Ignore frais de port, consignes, remises globales.\nPour chaque produit : nom court et lisible, quantite en nombre de bouteilles/unites, contenance en cl (70 si bouteille standard non precisee, 75 pour vin, 33 pour biere bouteille), prix unitaire HT en euros (si seul le prix du carton figure, divise par le nombre d'unites), categorie parmi: Spiritueux, Liqueur, Vin, Biere, Softs, Autre. Indique aussi le nom du fournisseur si visible sur la facture.\nReponds UNIQUEMENT avec ce JSON, sans texte autour:\n{"supplier":"...","items":[{"name":"...","qty":6,"volumeCl":70,"unitPriceHT":12.50,"cat":"Spiritueux"}]}` },
        ],
      }], false);
      const parsed = parseJsonLoose(text);
      const items = (parsed.items || []).filter((x) => x.name && x.qty > 0).map((x) => ({
        id: uid(), name: String(x.name).slice(0, 60),
        qty: Math.max(1, Math.round(Number(x.qty) || 1)),
        volumeCl: Number(x.volumeCl) > 0 ? Number(x.volumeCl) : 70, // borne anti-division-par-zero
        unitPriceHT: Number(x.unitPriceHT) >= 0 ? Number(x.unitPriceHT) : 0,
        cat: CATS.includes(x.cat) ? x.cat : (x.cat === "Biere" ? "Bière" : "Autre"),
        keep: true,
      }));
      if (items.length === 0) throw new Error("vide");
      setInvoiceItems({ supplier: String(parsed.supplier || "").slice(0, 40), items });
    } catch (e) {
      setInvoiceMsg("Lecture impossible — reprends la photo bien a plat, nette et eclairee, ou rapproche-toi des lignes produits.");
    }
    setInvoiceBusy(false);
    if (invoiceInput.current) invoiceInput.current.value = "";
  };

  const applyInvoice = () => {
    if (!invoiceItems) return;
    const sup = invoiceItems.supplier;
    let next = [...bottles];
    let added = 0, updated = 0;
    for (const it of invoiceItems.items) {
      if (!it.keep) continue;
      const norm = (x) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
      const i = next.findIndex((b) => norm(b.name) === norm(it.name));
      if (i >= 0) {
        const np = it.unitPriceHT || next[i].price;
        next[i] = withHistory(next[i], { ...next[i], stock: next[i].stock + it.qty, price: np, supplier: sup || next[i].supplier });
        updated++;
      } else {
        next.push(withHistory(null, { id: uid(), name: it.name, cat: it.cat, volume: it.volumeCl, price: it.unitPriceHT, stock: it.qty, threshold: 2, supplier: sup }));
        added++;
      }
    }
    set({ bottles: next });
    setInvoiceItems(null);
    setInvoiceMsg(`Facture integree : ${updated} reference(s) mise(s) a jour, ${added} creee(s).`);
  };

  // ————— scan bon de livraison cuisine → traçabilité —————
  const scanReception = async (file) => {
    if (!file || recScanBusy) return;
    setRecScanBusy(true); setRecScanMsg(""); setRecScanItems(null);
    try {
      const b64 = await compressImage(file);
      const text = await askClaude([{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
          { type: "text", text: 'Voici la photo d\'un bon de livraison ou d\'une facture de denrees alimentaires (legumes, viandes, produits frais, epicerie) pour un restaurant. Extrais chaque produit pour le registre de tracabilite : nom court, numero de lot si visible (sinon vide), DLC ou DDM si visible au format AAAA-MM-JJ (sinon vide). Indique le fournisseur si visible. Ignore les boissons, frais de port et remises. Reponds UNIQUEMENT avec ce JSON, sans texte autour :\n{"supplier":"...","items":[{"product":"...","lot":"...","dlc":"2026-06-20"}]}' },
        ],
      }], false);
      const parsed = parseJsonLoose(text);
      const items = (parsed.items || []).filter((x) => x.product).map((x) => ({
        id: uid(), product: String(x.product).slice(0, 60),
        lot: String(x.lot || "").slice(0, 30),
        dlc: /^\d{4}-\d{2}-\d{2}$/.test(x.dlc || "") ? x.dlc : "",
        keep: true,
      }));
      if (items.length === 0) throw new Error("vide");
      setRecScanItems({ supplier: String(parsed.supplier || "").slice(0, 40), items });
    } catch {
      setRecScanMsg("Lecture impossible — photo bien a plat, nette, cadree sur les lignes produits.");
    }
    setRecScanBusy(false);
    if (recScanInput.current) recScanInput.current.value = "";
  };

  const applyRecScan = () => {
    if (!recScanItems) return;
    const sup = recScanItems.supplier;
    const newRecs = recScanItems.items.filter((i) => i.keep).map((i) => ({
      id: uid(), date: today(), product: i.product, supplier: sup, lot: i.lot, dlc: i.dlc, temp: null, conform: true, consumed: false,
    }));
    set({ receptions: [...newRecs, ...receptions].slice(0, 400) });
    setRecScanItems(null);
    setRecScanMsg(`${newRecs.length} ligne(s) de traçabilité créée(s).`);
  };

  // ————— checklists ouverture / fermeture (remise à zéro quotidienne) —————
  const checklists = data.checklists || { ouverture: [], fermeture: [] };
  const checkDone = (data.checkDone && data.checkDone.date === today()) ? data.checkDone : { date: today(), done: [] };
  const toggleCheck = (id) => {
    const done = checkDone.done.includes(id) ? checkDone.done.filter((x) => x !== id) : [...checkDone.done, id];
    set({ checkDone: { date: today(), done } });
  };
  const checkProgress = (list) => {
    const items = checklists[list] || [];
    if (!items.length) return null;
    return items.filter((i) => checkDone.done.includes(i.id)).length + "/" + items.length;
  };
  const saveReception = () => {
    const f = recForm;
    if (!f.product.trim()) return;
    set({ receptions: [{ id: uid(), date: today(), product: f.product.trim(), supplier: (f.supplier || "").trim(), lot: (f.lot || "").trim(), dlc: f.dlc || "", temp: f.temp ? num(f.temp) : null, conform: f.conform !== false, consumed: false }, ...receptions].slice(0, 400) });
    setRecForm(null);
  };
  const addTemp = () => {
    const v = num(tempForm.value);
    if (tempForm.value === "") return;
    if (v < -50 || v > 80) { safeAlert("Température improbable (" + v + " °C) — vérifie la saisie."); return; }
    set({ temps: [{ id: uid(), date: today(), time: new Date().toTimeString().slice(0, 5), equipId: tempForm.equipId, value: v }, ...temps].slice(0, 600) });
    setTempForm({ ...tempForm, value: "" });
  };
  const copyOrder = async () => {
    try { await navigator.clipboard.writeText(`Commande — ${new Date().toLocaleDateString("fr-FR")}\n\n${orderText}`); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const btn = (v) => ({
    background: v === "p" ? C.brass : v === "d" ? "transparent" : C.soft,
    color: v === "p" ? "#fff" : v === "d" ? C.bad : C.ink,
    border: v === "p" ? "none" : `1px solid ${v === "d" ? C.bad : C.line}`,
    borderRadius: 10, padding: "12px 18px", fontSize: 14, cursor: "pointer",
    fontWeight: v === "p" ? 700 : 600, letterSpacing: 0.2,
  });

  const TABS = [
    ["bord", "Tableau de bord", null],
    ["marges", "Marges", null],
    ["stocks", "Stocks", lowStock.length],
    ["commandes", "Commandes", toOrder.length],
    ["cuisine", "Cuisine", null],
    ["hygiene", "Hygiène", hygCount],
    ["trace", "Traçabilité", dlcSoon.length],
    ["equipe", "Équipe", null],
    ["assistant", "Assistant", null],
    ["reglages", "Réglages", null],
  ];

  const Kpi = ({ label, value, sub, status }) => (
    <div style={{ background: C.panelSolid, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px", flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub }}>{label}</div>
      <div style={{ fontSize: 24, marginTop: 4, fontWeight: 800, letterSpacing: -0.5, color: status === "bad" ? C.bad : status === "warn" ? C.warn : C.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" }}>
      {/* entête tactile */}
      <div style={{ background: C.panelSolid, borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ maxWidth: 980, margin: "0 auto", padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <button onClick={() => setTab("home")} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            <span style={{ position: "relative", width: 34, height: 34, borderRadius: 9, background: "#fff", border: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: C.brass }}>
              P
              <span style={{ position: "absolute", left: 13, top: 8, width: 5, height: 5, borderRadius: "50%", background: "#E8A33D" }} />
            </span>
            <span style={{ fontSize: 18, fontWeight: 800, color: C.ink, letterSpacing: -0.3 }}>Le Passe</span>
          </button>
          <span style={{ fontSize: 12, color: C.sub, textAlign: "right" }}>{barName}<br />{new Date().toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}</span>
        </div>
        {tab !== "home" && (
          <div style={{ maxWidth: 980, margin: "0 auto", padding: "0 8px", display: "flex", overflowX: "auto" }}>
            {TABS.map(([id, label, count]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                background: "none", border: "none", cursor: "pointer", padding: "11px 13px",
                fontSize: 13, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6,
                color: tab === id ? C.ink : C.sub, fontWeight: tab === id ? 800 : 500,
                borderBottom: tab === id ? `3px solid ${MODCOL[id]}` : "3px solid transparent",
              }}>
                <span style={{ color: MODCOL[id], fontSize: 14 }}>{MODICON[id]}</span>{label}
                {count ? <span style={{ background: C.bad, color: "#fff", borderRadius: 10, padding: "1px 7px", fontSize: 10.5, fontWeight: 800 }}>{count}</span> : null}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ———————— ACCUEIL EN TUILES (façon caisse tactile) ———————— */}
      {tab === "home" && (
        <div style={{ maxWidth: 980, margin: "0 auto", padding: "18px 16px 80px" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <Kpi label="Valeur de cave" value={fmt0(caveValue)} sub={`${bottles.length} réf.`} />
            <Kpi label="Marge moyenne" value={`${avgMarge.toFixed(1)} %`} sub={`obj. ${target} %`} status={avgMarge >= target ? "ok" : avgMarge >= target - 10 ? "warn" : "bad"} />
            <Kpi label="À traiter" value={hygCount + lowStock.length + dlcSoon.length} sub="alertes" status={(hygCount + lowStock.length + dlcSoon.length) ? "warn" : "ok"} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {TABS.map(([id, label, count]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                position: "relative", aspectRatio: "1 / 1", borderRadius: 18, cursor: "pointer",
                border: "none", color: "#fff", textAlign: "left", padding: "16px 16px",
                background: `linear-gradient(150deg, ${MODCOL[id]}, ${MODCOL[id]}CC)`,
                display: "flex", flexDirection: "column", justifyContent: "space-between",
                boxShadow: `0 8px 22px ${MODCOL[id]}33`,
              }}>
                <span style={{ fontSize: 30, lineHeight: 1, opacity: 0.95 }}>{MODICON[id]}</span>
                <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.2 }}>{label}</span>
                {count ? <span style={{ position: "absolute", top: 12, right: 12, background: "rgba(0,0,0,0.35)", borderRadius: 20, padding: "2px 10px", fontSize: 13, fontWeight: 800 }}>{count}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "12px 16px 80px", display: tab === "home" ? "none" : "block" }}>

        {/* ———————— TABLEAU DE BORD ———————— */}
        {tab === "bord" && (
          <div>
            <Title>Vue d'ensemble</Title>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Kpi label="Valeur de cave" value={fmt0(caveValue)} sub={`${bottles.length} références`} />
              <Kpi label="Marge moyenne" value={`${avgMarge.toFixed(1)} %`} sub={`objectif ${target} %`} status={avgMarge >= target ? "ok" : avgMarge >= target - 10 ? "warn" : "bad"} />
              <Kpi label="À commander" value={lowStock.length} sub="références sous seuil" status={lowStock.length ? "warn" : "ok"} />
              <Kpi label="Hygiène & machines" value={hygCount ? `${hygCount} à traiter` : "À jour"} sub={hygCount ? "relevés / nettoyage / entretien" : "tout est fait"} status={hygCount ? "warn" : "ok"} />
            </div>

            <Title>À faire maintenant</Title>
            {hygCount === 0 && lowStock.length === 0 && dlcSoon.length === 0 && priceHikes.length === 0 ? (
              <Card><span style={{ color: C.ok, fontSize: 14 }}>✓ Rien d'urgent. Le bar est en ordre.</span></Card>
            ) : (
              <div>
                {tempsTodo.map((e) => (
                  <Card key={e.id} onClick={() => setTab("hygiene")}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>Relever la température · <b>{e.name}</b></span>
                      <Badge status="warn">à faire</Badge>
                    </div>
                  </Card>
                ))}
                {tempsBad.map((t) => (
                  <Card key={t.id} onClick={() => setTab("hygiene")} accent={C.bad}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>Température non conforme · <b>{equipments.find((e) => e.id === t.equipId)?.name}</b> ({t.value} °C)</span>
                      <Badge status="bad">agir</Badge>
                    </div>
                  </Card>
                ))}
                {cleanLate.map((t) => (
                  <Card key={t.id} onClick={() => setTab("hygiene")}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>Nettoyage en retard · <b>{t.label}</b></span>
                      <Badge status={cleanStatus(t)}>{daysSince(t.lastDone) === Infinity ? "jamais fait" : `+${daysSince(t.lastDone)} j`}</Badge>
                    </div>
                  </Card>
                ))}
                {machineAlerts.map((m) => (
                  <Card key={m.id} onClick={() => setTab("hygiene")} accent={machineStatus(m) === "bad" ? C.bad : undefined}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>{m.status === "panne" ? "Machine en panne" : "Entretien machine"} · <b>{m.name} ({m.zone})</b></span>
                      <Badge status={machineStatus(m)}>{m.status === "panne" ? "panne" : "entretien"}</Badge>
                    </div>
                  </Card>
                ))}
                {priceHikes.map((b) => {
                  const h = b.history; const last = h[h.length - 1], prev = h[h.length - 2];
                  return (
                    <Card key={"hike" + b.id} onClick={() => setTab("marges")}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 14 }}>Hausse fournisseur · <b>{b.name}</b> : {fmt(prev.price)} → {fmt(last.price)}</span>
                        <Badge status="warn">+{(((last.price - prev.price) / prev.price) * 100).toFixed(0)} %</Badge>
                      </div>
                    </Card>
                  );
                })}
                <div style={{ display: "flex", gap: 8, margin: "18px 0 0" }}>
              <input value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} placeholder="Rechercher une référence…"
                style={{ ...inputStyle, flex: 1 }} />
              {!invCounts && <button onClick={startInventory} style={btn()}>Inventaire</button>}
            </div>
            {lastInv && !invCounts && (
              <div style={{ fontSize: 12, color: C.sub, marginTop: 8 }}>
                Dernier inventaire : {new Date(lastInv.date + "T12:00:00").toLocaleDateString("fr-FR")} · écart {lastInv.valueGap >= 0 ? "+" : ""}{fmt(lastInv.valueGap)}
                {lastInv.valueGap < -10 ? " — surveille le coulage (pertes, offerts non notés, surdosage)" : ""}
              </div>
            )}

            {invCounts && (
              <div style={{ background: C.soft, border: `1px solid ${C.brassSoft}`, borderRadius: 10, padding: 16, marginTop: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: C.brass, fontWeight: 700, marginBottom: 4 }}>Inventaire en cours</div>
                <div style={{ fontSize: 12, color: C.sub, marginBottom: 12 }}>Compte physiquement chaque référence. L'écart vs le stock théorique te donne le coulage.</div>
                {bottles.map((b) => {
                  const counted = num(invCounts[b.id]);
                  const gap = counted - b.stock;
                  return (
                    <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: `1px dashed ${C.line}` }}>
                      <span style={{ flex: 1, fontSize: 14 }}>{b.name} <span style={{ fontSize: 11, color: C.sub }}>(théorique {b.stock})</span></span>
                      <input inputMode="numeric" value={invCounts[b.id]} onChange={(e) => setInvCounts({ ...invCounts, [b.id]: e.target.value })}
                        style={{ ...inputStyle, width: 64, padding: "7px 9px", textAlign: "center" }} />
                      <span style={{ width: 70, textAlign: "right", fontSize: 12.5, color: gap === 0 ? C.sub : gap < 0 ? C.bad : C.ok }}>
                        {gap === 0 ? "—" : (gap > 0 ? "+" : "") + gap + " (" + (gap > 0 ? "+" : "") + (gap * b.price).toFixed(0) + " €)"}
                      </span>
                    </div>
                  );
                })}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, flexWrap: "wrap", gap: 10 }}>
                  <span style={{ fontSize: 13.5 }}>
                    Écart total : <b style={{ color: bottles.reduce((s, b) => s + (num(invCounts[b.id]) - b.stock) * b.price, 0) < 0 ? C.bad : C.ok }}>
                      {fmt(bottles.reduce((s, b) => s + (num(invCounts[b.id]) - b.stock) * b.price, 0))}
                    </b>
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={validateInventory} style={btn("p")}>Valider l'inventaire</button>
                    <button onClick={() => setInvCounts(null)} style={btn()}>Annuler</button>
                  </div>
                </div>
              </div>
            )}

            {lowStock.length > 0 && (
                  <Card onClick={() => setTab("stocks")}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>Commander · <b>{lowStock.map((b) => b.name).join(", ")}</b></span>
                      <Badge status="warn">{lowStock.length} réf.</Badge>
                    </div>
                  </Card>
                )}
                {dlcSoon.map((r) => (
                  <Card key={r.id} onClick={() => setTab("trace")} accent={C.bad}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 14 }}>DLC proche ou dépassée · <b>{r.product}</b></span>
                      <Badge status="bad">{r.dlc}</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            <Title>Ouverture & fermeture</Title>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["ouverture", "fermeture"].map((list) => (
                <div key={list} style={{ flex: 1, minWidth: 250, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: "13px 15px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: C.brass, fontWeight: 700 }}>{list === "ouverture" ? "Ouverture" : "Fermeture"}</span>
                    <span style={{ fontSize: 11.5, color: C.sub }}>{checkProgress(list)}</span>
                  </div>
                  {(checklists[list] || []).map((i) => {
                    const done = checkDone.done.includes(i.id);
                    return (
                      <label key={i.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 0", cursor: "pointer", fontSize: 13.5 }}>
                        <input type="checkbox" checked={done} onChange={() => toggleCheck(i.id)} />
                        <span style={{ textDecoration: done ? "line-through" : "none", color: done ? C.sub : C.ink }}>{i.label}</span>
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.sub, marginTop: 6 }}>Les cases se remettent à zéro chaque jour. Personnalise les listes dans Réglages.</div>

            <Title>Marges à surveiller</Title>
            {sortedRecipes.slice(0, 3).map((r) => {
              const m = margeOf(r);
              return (
                <Card key={r.id} onClick={() => setTab("marges")}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 14 }}>{r.name}</span>
                    <Badge status={m >= target ? "ok" : m >= target - 10 ? "warn" : "bad"}>{m.toFixed(1)} %</Badge>
                  </div>
                  <Gauge value={m} target={target} />
                </Card>
              );
            })}
          </div>
        )}

        {/* ———————— MARGES ———————— */}
        {tab === "marges" && (
          <div>
            <Title right={<button onClick={() => setRecipeForm({ name: "", price: "", otherCost: "", ingredients: [{ bottleId: bottles[0]?.id || "", cl: "" }] })} style={btn("p")}>+ Recette</button>}>
              Carte & marges
            </Title>

            <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: C.sub }}>Objectif de marge :</span>
              <input inputMode="numeric" value={target} onChange={(e) => set({ target: Math.max(1, Math.min(99, num(e.target.value) || 80)) })}
                style={{ ...inputStyle, width: 70, padding: "7px 10px", textAlign: "center" }} />
              <span style={{ fontSize: 12, color: C.sub }}>%</span>
            </div>

            {sortedRecipes.map((r) => {
              const cost = costOf(r);
              const m = margeOf(r);
              const advised = priceFor(r);
              return (
                <Card key={r.id} onClick={() => setRecipeForm({ ...r, price: String(r.price), otherCost: String(r.otherCost || ""), ingredients: r.ingredients.map((i) => ({ ...i, cl: String(i.cl) })) })}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{r.name}</span>
                    <span style={{ fontSize: 15, color: C.brass, fontWeight: 600 }}>{fmt0(r.price)} TTC</span>
                  </div>
                  <div onClick={(e) => e.stopPropagation()} style={{ marginBottom: 8 }}>
                    <DayCheck done={checkDone.done.includes("rec-" + r.id)} onToggle={() => toggleCheck("rec-" + r.id)} label="Préparée / vérifiée" />
                  </div>
                  <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>
                    {(r.ingredients || []).map((i) => {
                      const b = bottleById[i.bottleId];
                      return b ? `${b.name} ${i.cl} cl (${fmt((i.cl / b.volume) * b.price)})` : null;
                    }).filter(Boolean).join(" · ")}
                    {r.otherCost ? ` · autres ${fmt(r.otherCost)}` : ""}
                  </div>
                  <div style={{ display: "flex", gap: 16, fontSize: 12.5, marginBottom: 8, flexWrap: "wrap" }}>
                    <span>Coût : <b>{fmt(cost)}</b></span>
                    <span>Marge HT : <b style={{ color: m >= target ? C.ok : m >= target - 10 ? C.warn : C.bad }}>{m.toFixed(1)} %</b></span>
                    {m < target && <span style={{ color: C.brass }}>Prix conseillé pour {target} % : <b>{fmt(Math.ceil(advised * 2) / 2)}</b></span>}
                  </div>
                  <Gauge value={m} target={target} />
                </Card>
              );
            })}

            {recipeForm && (
              <div style={{ background: C.soft, border: `1px solid ${C.brassSoft}`, borderRadius: 10, padding: 18, marginTop: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.brass, marginBottom: 14, fontWeight: 700 }}>{recipeForm.id ? "Modifier la recette" : "Nouvelle recette"}</div>
                <Field label="Nom du cocktail" value={recipeForm.name} onChange={(e) => setRecipeForm({ ...recipeForm, name: e.target.value })} />
                <div style={{ display: "flex", gap: 10 }}>
                  <Field label="Prix carte TTC (€)" inputMode="decimal" value={recipeForm.price} onChange={(e) => setRecipeForm({ ...recipeForm, price: e.target.value })} />
                  <Field label="Autres coûts (€)" inputMode="decimal" value={recipeForm.otherCost} onChange={(e) => setRecipeForm({ ...recipeForm, otherCost: e.target.value })} />
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Field label="Verre" value={recipeForm.glass || ""} onChange={(e) => setRecipeForm({ ...recipeForm, glass: e.target.value })} />
                  <Field label="Méthode" value={recipeForm.method || ""} onChange={(e) => setRecipeForm({ ...recipeForm, method: e.target.value })} />
                  <Field label="Garnish" value={recipeForm.garnish || ""} onChange={(e) => setRecipeForm({ ...recipeForm, garnish: e.target.value })} />
                </div>
                <Field multiline label="Gestes & dressage (fiche staff)" value={recipeForm.steps || ""} onChange={(e) => setRecipeForm({ ...recipeForm, steps: e.target.value })} />
                <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub, margin: "2px 0 8px" }}>Ingrédients</div>
                {(recipeForm.ingredients || []).map((ing, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <select value={ing.bottleId} onChange={(e) => { const a = [...recipeForm.ingredients]; a[idx] = { ...a[idx], bottleId: e.target.value }; setRecipeForm({ ...recipeForm, ingredients: a }); }}
                      style={{ ...inputStyle, flex: 2, padding: "10px" }}>
                      {bottles.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <input inputMode="decimal" placeholder="cl" value={ing.cl} onChange={(e) => { const a = [...recipeForm.ingredients]; a[idx] = { ...a[idx], cl: e.target.value }; setRecipeForm({ ...recipeForm, ingredients: a }); }}
                      style={{ ...inputStyle, flex: 1, width: 64, padding: "10px" }} />
                    <button onClick={() => setRecipeForm({ ...recipeForm, ingredients: recipeForm.ingredients.filter((_, i) => i !== idx) })}
                      style={{ background: "none", border: "none", color: C.sub, cursor: "pointer", fontSize: 18 }} aria-label="Retirer l'ingrédient">×</button>
                  </div>
                ))}
                <button onClick={() => setRecipeForm({ ...recipeForm, ingredients: [...(recipeForm.ingredients || []), { bottleId: bottles[0]?.id || "", cl: "" }] })}
                  style={{ ...btn(), fontSize: 12, padding: "7px 12px", marginBottom: 14 }}>+ Ingrédient</button>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={saveRecipe} style={btn("p")}>Enregistrer</button>
                  <button onClick={() => setRecipeForm(null)} style={btn()}>Annuler</button>
                  {recipeForm.id && <button onClick={() => { if (!safeConfirm("Supprimer définitivement cette recette ?")) return; set({ recipes: recipes.filter((x) => x.id !== recipeForm.id) }); setRecipeForm(null); }} style={{ ...btn("d"), marginLeft: "auto" }}>Supprimer</button>}
                </div>
              </div>
            )}

            <div style={{ fontSize: 11.5, color: C.sub, marginTop: 16, lineHeight: 1.6 }}>
              Marge calculée sur le prix HT (TVA 20 %). Les recettes sont liées aux bouteilles : un prix fournisseur change dans Stocks → toutes les marges se recalculent, et un prix conseillé apparaît si tu passes sous l'objectif.
            </div>
          </div>
        )}

        {/* ———————— STOCKS ———————— */}
        {tab === "stocks" && (
          <div>
            {/* ————— scan de facture ————— */}
            <div style={{ background: C.soft, border: `1px dashed ${C.brass}`, borderRadius: 10, padding: "14px 16px", margin: "18px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>📷 Scanner une facture</div>
                  <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>Photographie la facture : produits, quantités et prix entrent tout seuls dans le stock.</div>
                </div>
                <button onClick={() => invoiceInput.current?.click()} disabled={invoiceBusy} style={{ ...btn("p"), opacity: invoiceBusy ? 0.6 : 1 }}>
                  {invoiceBusy ? "Lecture en cours…" : "Prendre la photo"}
                </button>
                <input ref={invoiceInput} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                  onChange={(e) => scanInvoice(e.target.files?.[0])} />
              </div>
              {invoiceMsg && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 10 }}>{invoiceMsg}</div>}

              {invoiceItems && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: C.brass, fontWeight: 700, marginBottom: 8 }}>
                    Vérifie avant d'intégrer {invoiceItems.supplier ? `· ${invoiceItems.supplier}` : ""}
                  </div>
                  {invoiceItems.items.map((it, idx) => (
                    <div key={it.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, opacity: it.keep ? 1 : 0.45 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                        <input type="checkbox" checked={it.keep} onChange={(e) => { const a = [...invoiceItems.items]; a[idx] = { ...a[idx], keep: e.target.checked }; setInvoiceItems({ ...invoiceItems, items: a }); }} />
                        <input value={it.name} onChange={(e) => { const a = [...invoiceItems.items]; a[idx] = { ...a[idx], name: e.target.value }; setInvoiceItems({ ...invoiceItems, items: a }); }}
                          style={{ ...inputStyle, padding: "8px 10px", fontSize: 14, flex: 1 }} />
                      </div>
                      <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
                        <label style={{ flex: 1 }}><span style={{ color: C.sub }}>Qté</span>
                          <input inputMode="numeric" value={it.qty} onChange={(e) => { const a = [...invoiceItems.items]; a[idx] = { ...a[idx], qty: num(e.target.value) }; setInvoiceItems({ ...invoiceItems, items: a }); }} style={{ ...inputStyle, padding: "7px 9px", fontSize: 13 }} /></label>
                        <label style={{ flex: 1 }}><span style={{ color: C.sub }}>cl</span>
                          <input inputMode="decimal" value={it.volumeCl} onChange={(e) => { const a = [...invoiceItems.items]; a[idx] = { ...a[idx], volumeCl: num(e.target.value) }; setInvoiceItems({ ...invoiceItems, items: a }); }} style={{ ...inputStyle, padding: "7px 9px", fontSize: 13 }} /></label>
                        <label style={{ flex: 1 }}><span style={{ color: C.sub }}>€ HT/u</span>
                          <input inputMode="decimal" value={it.unitPriceHT} onChange={(e) => { const a = [...invoiceItems.items]; a[idx] = { ...a[idx], unitPriceHT: num(e.target.value) }; setInvoiceItems({ ...invoiceItems, items: a }); }} style={{ ...inputStyle, padding: "7px 9px", fontSize: 13 }} /></label>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                    <button onClick={applyInvoice} style={btn("p")}>Intégrer au stock</button>
                    <button onClick={() => setInvoiceItems(null)} style={btn()}>Annuler</button>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.sub, marginTop: 8 }}>
                    Les quantités s'ajoutent au stock existant ; les prix d'achat sont mis à jour (et donc tes marges recalculées).
                  </div>
                </div>
              )}
            </div>

            {lowStock.length > 0 && (
              <div style={{ background: C.warnSoft, border: `1px solid ${C.warn}`, borderRadius: 10, padding: "14px 16px", margin: "18px 0" }}>
                <div style={{ fontSize: 13.5, color: C.ink }}><b style={{ color: C.warn }}>{lowStock.length} référence(s) sous le seuil.</b> Quantités proposées : remonter au stock max de chaque référence (à défaut, 2× le seuil).</div>
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <button onClick={() => setOrderOpen(!orderOpen)} style={btn("p")}>{orderOpen ? "Masquer le bon" : "Bon de commande"}</button>
                  {orderOpen && <button onClick={copyOrder} style={btn()}>{copied ? "✓ Copié" : "Copier"}</button>}
                </div>
                {orderOpen && (
                  <pre style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: 12, marginTop: 12, fontSize: 13, whiteSpace: "pre-wrap", fontFamily: "ui-monospace, monospace" }}>
                    {`Commande — ${new Date().toLocaleDateString("fr-FR")}\n\n${orderText}`}
                  </pre>
                )}
              </div>
            )}

            <Title right={<button onClick={() => setBottleForm({ name: "", cat: "Spiritueux", volume: "70", price: "", stock: "", threshold: "2", max: "", supplier: "" })} style={btn("p")}>+ Référence</button>}>
              Cave & réserve <span style={{ fontSize: 13, color: C.sub, fontFamily: "ui-sans-serif, system-ui" }}>· valeur {fmt0(caveValue)}</span>
            </Title>

            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
              {["Tous", ...CATS.filter((c) => bottles.some((b) => b.cat === c))].map((c) => (
                <button key={c} onClick={() => setStockFilter(c)} style={{
                  ...btn(), padding: "6px 12px", fontSize: 12,
                  background: stockFilter === c ? C.brassSoft : "transparent",
                  color: stockFilter === c ? C.brass : C.sub,
                  borderColor: stockFilter === c ? C.brass : C.line, fontWeight: 600,
                }}>{c}</button>
              ))}
            </div>

            {bottles.filter((b) => (stockFilter === "Tous" || b.cat === stockFilter) && b.name.toLowerCase().includes(stockSearch.trim().toLowerCase())).map((b) => {
              const low = b.stock <= b.threshold;
              return (
                <Card key={b.id} onClick={() => setBottleForm({ ...b, volume: String(b.volume), price: String(b.price), stock: String(b.stock), threshold: String(b.threshold), max: String(b.max || "") })} accent={low ? C.warn : undefined}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 15 }}>{b.name} {low && <Badge status="warn">à commander</Badge>}</div>
                      <div style={{ fontSize: 12, color: C.sub, marginTop: 3 }}>
                        {b.cat} · {b.volume} cl · {fmt(b.price)} HT{(b.history || []).length >= 2 ? (b.history[b.history.length - 1].price > b.history[b.history.length - 2].price ? " ↑" : b.history[b.history.length - 1].price < b.history[b.history.length - 2].price ? " ↓" : "") : ""} · {b.supplier || "—"} · seuil {b.threshold}{b.max ? ` · max ${b.max}` : ""} · valeur {fmt0(b.stock * b.price)}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button onClick={(e) => { e.stopPropagation(); set({ bottles: bottles.map((x) => x.id === b.id ? { ...x, stock: Math.max(0, x.stock - 1) } : x) }); }}
                        style={{ ...btn(), padding: "7px 13px", fontSize: 16 }} aria-label="Retirer une bouteille">−</button>
                      <span style={{ fontSize: 18, minWidth: 28, textAlign: "center", fontWeight: 600, color: low ? C.warn : C.ink }}>{b.stock}</span>
                      <button onClick={(e) => { e.stopPropagation(); set({ bottles: bottles.map((x) => x.id === b.id ? { ...x, stock: x.stock + 1 } : x) }); }}
                        style={{ ...btn(), padding: "7px 13px", fontSize: 16 }} aria-label="Ajouter une bouteille">+</button>
                      <DayCheck done={checkDone.done.includes("stk-" + b.id)} onToggle={() => toggleCheck("stk-" + b.id)} label="Commandé" />
                    </div>
                  </div>
                </Card>
              );
            })}

            {bottleForm && (
              <div style={{ background: C.soft, border: `1px solid ${C.brassSoft}`, borderRadius: 10, padding: 18, marginTop: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.brass, marginBottom: 14, fontWeight: 700 }}>{bottleForm.id ? "Modifier la référence" : "Nouvelle référence"}</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Field label="Nom" value={bottleForm.name} onChange={(e) => setBottleForm({ ...bottleForm, name: e.target.value })} />
                  <Select label="Catégorie" value={bottleForm.cat} onChange={(e) => setBottleForm({ ...bottleForm, cat: e.target.value })}>
                    {CATS.map((c) => <option key={c}>{c}</option>)}
                  </Select>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Field label="Contenance (cl)" inputMode="decimal" value={bottleForm.volume} onChange={(e) => setBottleForm({ ...bottleForm, volume: e.target.value })} />
                  <Field label="Prix d'achat HT (€)" inputMode="decimal" value={bottleForm.price} onChange={(e) => setBottleForm({ ...bottleForm, price: e.target.value })} />
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Field label="Stock" inputMode="numeric" value={bottleForm.stock} onChange={(e) => setBottleForm({ ...bottleForm, stock: e.target.value })} />
                  <Field label="Seuil d'alerte" inputMode="numeric" value={bottleForm.threshold} onChange={(e) => setBottleForm({ ...bottleForm, threshold: e.target.value })} />
                  <Field label="Stock max" inputMode="numeric" value={bottleForm.max || ""} onChange={(e) => setBottleForm({ ...bottleForm, max: e.target.value })} />
                  <label style={{ display: "block", marginBottom: 12, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub, marginBottom: 5 }}>Fournisseur</span>
                    <input list="suppliers" value={bottleForm.supplier} onChange={(e) => setBottleForm({ ...bottleForm, supplier: e.target.value })} style={inputStyle} />
                    <datalist id="suppliers">
                      <option value="Métro" />
                      <option value="Bordeaux Aquitaine Boissons" />
                      <option value="La Cave de Brienne" />
                      <option value="Transgourmet" />
                    </datalist>
                  </label>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={saveBottle} style={btn("p")}>Enregistrer</button>
                  <button onClick={() => setBottleForm(null)} style={btn()}>Annuler</button>
                  {bottleForm.id && <button onClick={() => { if (!safeConfirm("Supprimer définitivement cette référence ? Les recettes qui l’utilisent perdront cet ingrédient.")) return; set({ bottles: bottles.filter((x) => x.id !== bottleForm.id), recipes: recipes.map((r) => ({ ...r, ingredients: (r.ingredients || []).filter((i) => i.bottleId !== bottleForm.id) })) }); setBottleForm(null); }} style={{ ...btn("d"), marginLeft: "auto" }}>Supprimer</button>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ———————— COMMANDES ———————— */}
        {tab === "commandes" && (
          <div>
            <Title>Commandes à faire</Title>
            <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 16, lineHeight: 1.6 }}>
              Calculé d'après ton stock et le stock max de chaque référence. Quantité conseillée = max − stock actuel. Ajuste si besoin, puis copie le bon par fournisseur.
            </div>

            {toOrder.length === 0 ? (
              <Card><span style={{ color: C.ok, fontSize: 14 }}>✓ Rien à commander. Tous les stocks sont au niveau.</span></Card>
            ) : (
              ordersBySupplier.map(([sup, items]) => {
                const allChecked = items.every((b) => checkDone.done.includes("cmd-" + b.id));
                return (
                  <div key={sup} style={{ marginBottom: 22 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: MODCOL.commandes }}>{sup} <span style={{ color: C.sub, fontWeight: 500 }}>· {items.length} réf.</span></span>
                      <button onClick={() => copyOrderFor(sup, items)} style={btn("p")}>{copiedSup === sup ? "✓ Copié" : "Copier le bon"}</button>
                    </div>
                    {items.map((b) => {
                      const qty = orderQty[b.id] != null ? orderQty[b.id] : b.suggestQty;
                      const checked = checkDone.done.includes("cmd-" + b.id);
                      return (
                        <Card key={b.id} accent={checked ? C.ok : undefined}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ flex: 1, minWidth: 140 }}>
                              <div style={{ fontSize: 15, textDecoration: checked ? "line-through" : "none", color: checked ? C.sub : C.ink }}>{b.name}</div>
                              <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3 }}>
                                stock {b.stock} · max {b.max || b.threshold * 2} · {b.volume} cl
                              </div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <button onClick={() => setOrderQty({ ...orderQty, [b.id]: Math.max(0, qty - 1) })} style={{ ...btn(), padding: "7px 12px", fontSize: 16 }} aria-label="Moins">−</button>
                              <span style={{ fontSize: 18, minWidth: 30, textAlign: "center", fontWeight: 700, color: MODCOL.commandes }}>{qty}</span>
                              <button onClick={() => setOrderQty({ ...orderQty, [b.id]: qty + 1 })} style={{ ...btn(), padding: "7px 12px", fontSize: 16 }} aria-label="Plus">+</button>
                              <DayCheck done={checked} onToggle={() => toggleCheck("cmd-" + b.id)} label="Commandé" />
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                );
              })
            )}

            {toOrder.length > 0 && (
              <div style={{ fontSize: 11.5, color: C.sub, marginTop: 8, lineHeight: 1.6 }}>
                Les cases « Commandé » se réinitialisent chaque jour. Astuce : règle le stock max de chaque référence dans Stocks pour affiner les quantités conseillées.
              </div>
            )}
          </div>
        )}

        {/* ———————— CUISINE ———————— */}
        {tab === "cuisine" && (
          <div>
            {/* scan carte */}
            <div style={{ background: C.soft, border: `1px dashed ${MODCOL.cuisine}`, borderRadius: 10, padding: "14px 16px", margin: "18px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>📷 Scanner la carte des plats</div>
                  <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>Les plats et leurs prix entrent tout seuls. Tu renseignes les ingrédients ensuite.</div>
                </div>
                <button onClick={() => dishScanInput.current?.click()} disabled={dishScanBusy} style={{ ...btn("p"), opacity: dishScanBusy ? 0.6 : 1 }}>
                  {dishScanBusy ? "Lecture…" : "Prendre la photo"}
                </button>
                <input ref={dishScanInput} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => scanDishMenu(e.target.files?.[0])} />
              </div>
              {dishScanMsg && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 10 }}>{dishScanMsg}</div>}
              {dishScanItems && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: MODCOL.cuisine, fontWeight: 700, marginBottom: 8 }}>Vérifie avant d'ajouter</div>
                  {dishScanItems.map((it, idx) => (
                    <div key={it.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, opacity: it.keep ? 1 : 0.45 }}>
                      <input type="checkbox" checked={it.keep} onChange={(e) => { const a = [...dishScanItems]; a[idx] = { ...a[idx], keep: e.target.checked }; setDishScanItems(a); }} />
                      <input value={it.name} onChange={(e) => { const a = [...dishScanItems]; a[idx] = { ...a[idx], name: e.target.value }; setDishScanItems(a); }} style={{ ...inputStyle, padding: "8px 10px", fontSize: 14, flex: 2 }} />
                      <input inputMode="decimal" value={it.price} onChange={(e) => { const a = [...dishScanItems]; a[idx] = { ...a[idx], price: num(e.target.value) }; setDishScanItems(a); }} style={{ ...inputStyle, padding: "8px 10px", fontSize: 14, width: 70 }} />
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                    <button onClick={applyDishScan} style={btn("p")}>Ajouter les plats</button>
                    <button onClick={() => setDishScanItems(null)} style={btn()}>Annuler</button>
                  </div>
                </div>
              )}
            </div>

            <Title right={<button onClick={() => setDishForm({ name: "", price: "", otherCost: "", ingredients: [{ itemId: foodItems[0]?.id || "", qty: "" }] })} style={btn("p")}>+ Plat</button>}>
              Carte des plats
            </Title>

            {dishes.length === 0 && <div style={{ color: C.sub, fontSize: 14, padding: "10px 0" }}>Aucun plat. Scanne ta carte ou ajoute un plat.</div>}

            {[...dishes].sort((a, b) => dishMarge(a) - dishMarge(b)).map((d) => {
              const cost = dishCost(d);
              const m = dishMarge(d);
              const advised = dishPriceFor(d);
              const hasIngr = (d.ingredients || []).length > 0;
              return (
                <Card key={d.id} onClick={() => setDishForm({ ...d, price: String(d.price), otherCost: String(d.otherCost || ""), ingredients: (d.ingredients || []).map((i) => ({ ...i, qty: String(i.qty) })) })}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{d.name}</span>
                    <span style={{ fontSize: 15, color: MODCOL.cuisine, fontWeight: 600 }}>{fmt0(d.price)} TTC</span>
                  </div>
                  {hasIngr ? (
                    <>
                      <div style={{ fontSize: 12, color: C.sub, marginBottom: 4 }}>
                        {(d.ingredients || []).map((i) => { const f = foodById[i.itemId]; return f ? `${f.name} ${i.qty} ${f.unit}` : null; }).filter(Boolean).join(" · ")}
                      </div>
                      <div style={{ display: "flex", gap: 16, fontSize: 12.5, marginBottom: 8, flexWrap: "wrap" }}>
                        <span>Coût : <b>{fmt(cost)}</b></span>
                        <span>Marge HT : <b style={{ color: m >= target ? C.ok : m >= target - 10 ? C.warn : C.bad }}>{m.toFixed(1)} %</b></span>
                        {m < target && <span style={{ color: MODCOL.cuisine }}>Conseillé : <b>{fmt(Math.ceil(advised * 2) / 2)}</b></span>}
                      </div>
                      <Gauge value={m} target={target} />
                    </>
                  ) : (
                    <div style={{ fontSize: 12.5, color: C.warn }}>Ingrédients non renseignés — tape le plat pour les ajouter et voir la marge.</div>
                  )}
                </Card>
              );
            })}

            {dishForm && (
              <div style={{ background: C.soft, border: `1px solid ${C.brassSoft}`, borderRadius: 10, padding: 18, marginTop: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: MODCOL.cuisine, marginBottom: 14, fontWeight: 700 }}>{dishForm.id ? "Modifier le plat" : "Nouveau plat"}</div>
                <Field label="Nom du plat" value={dishForm.name} onChange={(e) => setDishForm({ ...dishForm, name: e.target.value })} />
                <div style={{ display: "flex", gap: 10 }}>
                  <Field label="Prix carte TTC (€)" inputMode="decimal" value={dishForm.price} onChange={(e) => setDishForm({ ...dishForm, price: e.target.value })} />
                  <Field label="Autres coûts (€)" inputMode="decimal" value={dishForm.otherCost} onChange={(e) => setDishForm({ ...dishForm, otherCost: e.target.value })} />
                </div>
                <div style={{ fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub, margin: "2px 0 8px" }}>Ingrédients</div>
                {(dishForm.ingredients || []).map((ing, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                    <select value={ing.itemId} onChange={(e) => { const a = [...dishForm.ingredients]; a[idx] = { ...a[idx], itemId: e.target.value }; setDishForm({ ...dishForm, ingredients: a }); }} style={{ ...inputStyle, flex: 2, padding: "10px" }}>
                      {foodItems.length === 0 && <option value="">— ajoute des denrées d'abord —</option>}
                      {foodItems.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.unit})</option>)}
                    </select>
                    <input inputMode="decimal" placeholder="qté" value={ing.qty} onChange={(e) => { const a = [...dishForm.ingredients]; a[idx] = { ...a[idx], qty: e.target.value }; setDishForm({ ...dishForm, ingredients: a }); }} style={{ ...inputStyle, flex: 1, width: 64, padding: "10px" }} />
                    <button onClick={() => setDishForm({ ...dishForm, ingredients: dishForm.ingredients.filter((_, i) => i !== idx) })} style={{ background: "none", border: "none", color: C.sub, cursor: "pointer", fontSize: 18 }} aria-label="Retirer">×</button>
                  </div>
                ))}
                <button onClick={() => setDishForm({ ...dishForm, ingredients: [...(dishForm.ingredients || []), { itemId: foodItems[0]?.id || "", qty: "" }] })} style={{ ...btn(), fontSize: 12, padding: "7px 12px", marginBottom: 14 }}>+ Ingrédient</button>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={saveDish} style={btn("p")}>Enregistrer</button>
                  <button onClick={() => setDishForm(null)} style={btn()}>Annuler</button>
                  {dishForm.id && <button onClick={() => { if (safeConfirm("Supprimer ce plat ?")) { set({ dishes: dishes.filter((x) => x.id !== dishForm.id) }); setDishForm(null); } }} style={{ ...btn("d"), marginLeft: "auto" }}>Supprimer</button>}
                </div>
              </div>
            )}

            <Title right={<button onClick={() => setFoodForm({ name: "", unit: "pièce", price: "", supplier: "" })} style={btn("p")}>+ Denrée</button>}>
              Denrées & ingrédients
            </Title>
            <div style={{ fontSize: 12, color: C.sub, marginBottom: 10 }}>Le garde-manger : chaque denrée avec son prix d'achat. Les plats s'en servent pour calculer leur marge.</div>
            {foodItems.map((f) => (
              <Card key={f.id} onClick={() => setFoodForm({ ...f, price: String(f.price) })}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14.5 }}>{f.name}</div>
                    <div style={{ fontSize: 11.5, color: C.sub, marginTop: 2 }}>{fmt(f.price)} / {f.unit}{f.supplier ? ` · ${f.supplier}` : ""}</div>
                  </div>
                </div>
              </Card>
            ))}

            {foodForm && (
              <div style={{ background: C.soft, border: `1px solid ${C.brassSoft}`, borderRadius: 10, padding: 18, marginTop: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: MODCOL.cuisine, marginBottom: 14, fontWeight: 700 }}>{foodForm.id ? "Modifier la denrée" : "Nouvelle denrée"}</div>
                <Field label="Nom" value={foodForm.name} onChange={(e) => setFoodForm({ ...foodForm, name: e.target.value })} />
                <div style={{ display: "flex", gap: 10 }}>
                  <Select label="Unité" value={foodForm.unit} onChange={(e) => setFoodForm({ ...foodForm, unit: e.target.value })}>
                    {["pièce", "kg", "g", "L", "cl", "botte", "portion"].map((u) => <option key={u}>{u}</option>)}
                  </Select>
                  <Field label="Prix d'achat (€ / unité)" inputMode="decimal" value={foodForm.price} onChange={(e) => setFoodForm({ ...foodForm, price: e.target.value })} />
                </div>
                <label style={{ display: "block", marginBottom: 12 }}>
                  <span style={{ display: "block", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub, marginBottom: 5 }}>Fournisseur</span>
                  <input list="suppliers" value={foodForm.supplier} onChange={(e) => setFoodForm({ ...foodForm, supplier: e.target.value })} style={inputStyle} />
                </label>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={saveFood} style={btn("p")}>Enregistrer</button>
                  <button onClick={() => setFoodForm(null)} style={btn()}>Annuler</button>
                  {foodForm.id && <button onClick={() => { if (safeConfirm("Supprimer cette denrée ? Les plats qui l'utilisent perdront cet ingrédient.")) { set({ foodItems: foodItems.filter((x) => x.id !== foodForm.id), dishes: dishes.map((d) => ({ ...d, ingredients: (d.ingredients || []).filter((i) => i.itemId !== foodForm.id) })) }); setFoodForm(null); } }} style={{ ...btn("d"), marginLeft: "auto" }}>Supprimer</button>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ———————— HYGIÈNE ———————— */}
        {tab === "hygiene" && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={copyReport} style={btn()}>{reportCopied ? "✓ Rapport copié" : "📋 Rapport de conformité (30 j)"}</button>
            </div>
            <Title>Températures du jour</Title>
            {equipments.map((e) => {
              const t = todayTemps.find((x) => x.equipId === e.id);
              const status = !t ? "warn" : tempConform(e, t.value) ? "ok" : "bad";
              return (
                <Card key={e.id} accent={status === "bad" ? C.bad : undefined}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 15 }}>{e.name}{e.zone ? <span style={{ fontSize: 11.5, color: C.sub }}> · {e.zone}</span> : null}</div>
                      <div style={{ fontSize: 11.5, color: C.sub }}>{e.type === "congel" ? "norme ≤ −18 °C" : "norme 0 à +4 °C"}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 15, color: status === "bad" ? C.bad : C.ink }}>{t ? `${t.value} °C · ${t.time}` : "—"}</span>
                      <Badge status={status}>{status === "ok" ? "conforme" : status === "bad" ? "non conforme" : "à relever"}</Badge>
                    </div>
                  </div>
                </Card>
              );
            })}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 4 }}>
              <Select label="Équipement" value={tempForm.equipId} onChange={(e) => setTempForm({ ...tempForm, equipId: e.target.value })}>
                {equipments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
              <Field label="°C" inputMode="decimal" value={tempForm.value} onChange={(e) => setTempForm({ ...tempForm, value: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addTemp()} />
              <button onClick={addTemp} style={{ ...btn("p"), padding: "12px 18px", marginBottom: 12 }}>Relever</button>
            </div>

            <Title>Plan de nettoyage</Title>
            {cleaning.map((t) => {
              const s = cleanStatus(t);
              const ds = daysSince(t.lastDone);
              return (
                <Card key={t.id} accent={s === "bad" ? C.bad : undefined}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 14 }}>{t.label}</div>
                      <div style={{ fontSize: 11.5, color: C.sub }}>chaque {t.freq} · {t.lastDone ? (ds === 0 ? "fait aujourd'hui" : `il y a ${ds} j`) : "jamais fait"}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Badge status={s}>{s === "ok" ? "à jour" : s === "warn" ? "à faire" : "en retard"}</Badge>
                      <button onClick={() => { const doneToday = t.lastDone === today(); set({ cleaning: cleaning.map((x) => x.id === t.id ? { ...x, lastDone: doneToday ? null : today() } : x) }); }}
                        style={{ ...btn(t.lastDone === today() ? undefined : "p"), padding: "8px 14px", fontSize: 12, ...(t.lastDone === today() ? { background: "#E2F3EA", color: "#1E9E6A", borderColor: "#1E9E6A" } : {}) }}>{t.lastDone === today() ? "☑ Fait" : "☐ Fait"}</button>
                    </div>
                  </div>
                </Card>
              );
            })}

            <Title>Parc machines</Title>
            {machines.map((m) => {
              const s = machineStatus(m);
              const ds = daysSince(m.lastService);
              return (
                <Card key={m.id} accent={s === "bad" ? C.bad : undefined}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 14.5 }}>{m.name} <span style={{ fontSize: 11.5, color: C.sub }}>· {m.zone}</span></div>
                      <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3 }}>
                        entretien tous les {m.serviceFreq} j · {m.lastService ? (ds === 0 ? "fait aujourd'hui" : `il y a ${ds} j`) : "jamais fait"}{m.note ? ` · ${m.note}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <Badge status={s}>{m.status === "panne" ? "en panne" : s === "ok" ? "à jour" : s === "warn" ? "à entretenir" : "en retard"}</Badge>
                      <button onClick={() => { const doneToday = m.lastService === today(); set({ machines: machines.map((x) => x.id === m.id ? { ...x, lastService: doneToday ? null : today(), status: x.status === "panne" ? x.status : "ok" } : x) }); }}
                        style={{ ...btn(m.lastService === today() ? undefined : "p"), padding: "8px 12px", fontSize: 12, ...(m.lastService === today() ? { background: "#E2F3EA", color: "#1E9E6A", borderColor: "#1E9E6A" } : {}) }}>{m.lastService === today() ? "☑ Entretien fait" : "☐ Entretien fait"}</button>
                      <button onClick={() => set({ machines: machines.map((x) => x.id === m.id ? { ...x, status: x.status === "panne" ? "ok" : "panne" } : x) })}
                        style={{ ...btn(m.status === "panne" ? "p" : "d"), padding: "8px 12px", fontSize: 12 }}>{m.status === "panne" ? "Réparée" : "Panne"}</button>
                    </div>
                  </div>
                </Card>
              );
            })}

            <Title>Historique des relevés</Title>
            {temps.length === 0 ? (
              <div style={{ color: C.sub, fontSize: 13 }}>Aucun relevé. L'historique horodaté sert de preuve en cas de contrôle sanitaire.</div>
            ) : (
              <div style={{ maxHeight: 230, overflowY: "auto", border: `1px solid ${C.line}`, borderRadius: 10, background: C.panel }}>
                {temps.slice(0, 80).map((t) => {
                  const eq = equipments.find((e) => e.id === t.equipId);
                  const ok = tempConform(eq, t.value);
                  return (
                    <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "9px 14px", fontSize: 13, borderBottom: `1px solid ${C.line}`, color: C.sub }}>
                      <span>{new Date(t.date + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} {t.time} · {eq?.name || "?"}</span>
                      <span style={{ color: ok ? C.ink : C.bad, fontWeight: ok ? 400 : 700 }}>{t.value} °C</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ———————— TRAÇABILITÉ ———————— */}
        {tab === "trace" && (
          <div>
            <Title right={<button onClick={() => setRecForm({ product: "", supplier: "", lot: "", dlc: "", temp: "", conform: true })} style={btn("p")}>+ Réception</button>}>
              Réceptions & traçabilité
            </Title>
            <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 14, lineHeight: 1.6 }}>
              Enregistre chaque livraison de denrées : produit, lot, DLC, température de réception. C'est le registre que demande la DDPP en contrôle — et l'appli te prévient quand une DLC approche.
            </div>

            <div style={{ background: C.soft, border: `1px dashed ${C.brass}`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>📷 Scanner un bon de livraison</div>
                  <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>Transgourmet & co : produits, lots et DLC entrent tout seuls dans le registre.</div>
                </div>
                <button onClick={() => recScanInput.current?.click()} disabled={recScanBusy} style={{ ...btn("p"), opacity: recScanBusy ? 0.6 : 1 }}>
                  {recScanBusy ? "Lecture en cours…" : "Prendre la photo"}
                </button>
                <input ref={recScanInput} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                  onChange={(e) => scanReception(e.target.files?.[0])} />
              </div>
              {recScanMsg && <div style={{ fontSize: 12.5, color: C.sub, marginTop: 10 }}>{recScanMsg}</div>}
              {recScanItems && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 11, letterSpacing: 1.6, textTransform: "uppercase", color: C.brass, fontWeight: 700, marginBottom: 8 }}>
                    Vérifie avant d'enregistrer {recScanItems.supplier ? `· ${recScanItems.supplier}` : ""}
                  </div>
                  {recScanItems.items.map((it, idx) => (
                    <div key={it.id} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 8, opacity: it.keep ? 1 : 0.45 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                        <input type="checkbox" checked={it.keep} onChange={(e) => { const a = [...recScanItems.items]; a[idx] = { ...a[idx], keep: e.target.checked }; setRecScanItems({ ...recScanItems, items: a }); }} />
                        <input value={it.product} onChange={(e) => { const a = [...recScanItems.items]; a[idx] = { ...a[idx], product: e.target.value }; setRecScanItems({ ...recScanItems, items: a }); }}
                          style={{ ...inputStyle, padding: "8px 10px", fontSize: 14, flex: 1 }} />
                      </div>
                      <div style={{ display: "flex", gap: 8, fontSize: 12 }}>
                        <label style={{ flex: 1 }}><span style={{ color: C.sub }}>Lot</span>
                          <input value={it.lot} onChange={(e) => { const a = [...recScanItems.items]; a[idx] = { ...a[idx], lot: e.target.value }; setRecScanItems({ ...recScanItems, items: a }); }} style={{ ...inputStyle, padding: "7px 9px", fontSize: 13 }} /></label>
                        <label style={{ flex: 1 }}><span style={{ color: C.sub }}>DLC</span>
                          <input type="date" value={it.dlc} onChange={(e) => { const a = [...recScanItems.items]; a[idx] = { ...a[idx], dlc: e.target.value }; setRecScanItems({ ...recScanItems, items: a }); }} style={{ ...inputStyle, padding: "7px 9px", fontSize: 13 }} /></label>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                    <button onClick={applyRecScan} style={btn("p")}>Enregistrer en traçabilité</button>
                    <button onClick={() => setRecScanItems(null)} style={btn()}>Annuler</button>
                  </div>
                </div>
              )}
            </div>

            {recForm && (
              <div style={{ background: C.soft, border: `1px solid ${C.brassSoft}`, borderRadius: 10, padding: 18, marginBottom: 16 }}>
                <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.brass, marginBottom: 14, fontWeight: 700 }}>Nouvelle réception</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Field label="Produit" value={recForm.product} onChange={(e) => setRecForm({ ...recForm, product: e.target.value })} />
                  <label style={{ display: "block", marginBottom: 12, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub, marginBottom: 5 }}>Fournisseur</span>
                    <input list="suppliers" value={recForm.supplier} onChange={(e) => setRecForm({ ...recForm, supplier: e.target.value })} style={inputStyle} />
                  </label>
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <Field label="N° de lot" value={recForm.lot} onChange={(e) => setRecForm({ ...recForm, lot: e.target.value })} />
                  <Field label="DLC" type="date" value={recForm.dlc} onChange={(e) => setRecForm({ ...recForm, dlc: e.target.value })} />
                  <Field label="T° réception (°C)" inputMode="decimal" value={recForm.temp} onChange={(e) => setRecForm({ ...recForm, temp: e.target.value })} />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, marginBottom: 14, cursor: "pointer" }}>
                  <input type="checkbox" checked={recForm.conform !== false} onChange={(e) => setRecForm({ ...recForm, conform: e.target.checked })} />
                  Livraison conforme (emballage, fraîcheur, température)
                </label>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={saveReception} style={btn("p")}>Enregistrer</button>
                  <button onClick={() => setRecForm(null)} style={btn()}>Annuler</button>
                </div>
              </div>
            )}

            {receptions.length === 0 ? (
              <Card><span style={{ color: C.sub, fontSize: 14 }}>Aucune réception enregistrée. Ajoute ta première livraison.</span></Card>
            ) : receptions.map((r) => {
              const ds = r.dlc ? daysSince(r.dlc) : null;
              const dlcStatus = !r.dlc || r.consumed ? "ok" : ds >= 0 ? "bad" : ds >= -3 ? "warn" : "ok";
              return (
                <Card key={r.id} accent={dlcStatus === "bad" ? C.bad : undefined}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 14.5, textDecoration: r.consumed ? "line-through" : "none", color: r.consumed ? C.sub : C.ink }}>
                        {r.product} {!r.conform && <Badge status="bad">réserve émise</Badge>}
                      </div>
                      <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3 }}>
                        reçu le {new Date(r.date + "T12:00:00").toLocaleDateString("fr-FR")} · {r.supplier || "—"} · lot {r.lot || "—"}{r.temp != null ? ` · ${r.temp} °C` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {r.dlc && !r.consumed && <Badge status={dlcStatus}>DLC {new Date(r.dlc + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</Badge>}
                      {!r.consumed ? (
                        <button onClick={() => set({ receptions: receptions.map((x) => x.id === r.id ? { ...x, consumed: true } : x) })}
                          style={{ ...btn(), padding: "7px 12px", fontSize: 12 }}>Épuisé</button>
                      ) : <span style={{ fontSize: 11.5, color: C.sub }}>épuisé</span>}
                      <DayCheck done={checkDone.done.includes("rec-trace-" + r.id)} onToggle={() => toggleCheck("rec-trace-" + r.id)} label="Vérifiée" />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* ———————— ÉQUIPE ———————— */}
        {tab === "equipe" && (
          <div>
            <Title>Fiches techniques — mode service</Title>
            <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 14, lineHeight: 1.6 }}>
              La version "staff" de la carte : doses, verre, méthode, gestes — sans les prix d'achat ni les marges. Tape une fiche pour l'ouvrir en grand pendant le service ou la formation.
            </div>
            {recipes.map((r) => (
              <Card key={r.id} onClick={() => setFicheOpen(ficheOpen === r.id ? null : r.id)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{r.name}</span>
                  <span style={{ fontSize: 13, color: C.sub }}>{r.glass || "—"} · {fmt0(r.price)}</span>
                </div>
                {ficheOpen === r.id && (
                  <div style={{ marginTop: 12, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
                    <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 10 }}>
                      <div><div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub }}>Verre</div><div style={{ fontSize: 14, marginTop: 2 }}>{r.glass || "—"}</div></div>
                      <div><div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub }}>Méthode</div><div style={{ fontSize: 14, marginTop: 2 }}>{r.method || "—"}</div></div>
                      <div><div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub }}>Garnish</div><div style={{ fontSize: 14, marginTop: 2 }}>{r.garnish || "—"}</div></div>
                    </div>
                    <div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub, marginBottom: 6 }}>Doses</div>
                    {(r.ingredients || []).map((i, idx) => {
                      const b = bottleById[i.bottleId];
                      return b ? (
                        <div key={idx} style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "6px 0", borderBottom: `1px dashed ${C.line}` }}>
                          <span>{b.name}</span><b>{i.cl} cl</b>
                        </div>
                      ) : null;
                    })}
                    {r.steps && (
                      <div style={{ marginTop: 12 }}>
                        <div style={{ fontSize: 9.5, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub, marginBottom: 6 }}>Gestes & dressage</div>
                        <div style={{ fontSize: 14, lineHeight: 1.7 }}>{r.steps}</div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            ))}
            <div style={{ fontSize: 11.5, color: C.sub, marginTop: 10 }}>
              Pour compléter une fiche (verre, méthode, gestes) : onglet Marges → ouvre la recette.
            </div>
          </div>
        )}

        {/* ———————— ASSISTANT ———————— */}
        {tab === "assistant" && (
          <div>
            <Title>Assistant du bar</Title>
            <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 14, lineHeight: 1.6 }}>
              Lance une mission : l'assistant analyse l'état complet du bar et te fait le point. Ou pose ta question librement en bas.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, marginBottom: 18 }}>
              {MISSIONS.map((m) => (
                <button key={m.id} onClick={() => runMission(m)} disabled={thinking} style={{
                  background: C.panelSolid, border: `1.5px solid ${thinking ? C.line : MODCOL.assistant}`,
                  borderRadius: 14, padding: "14px 14px", cursor: thinking ? "default" : "pointer",
                  textAlign: "left", opacity: thinking ? 0.5 : 1, display: "flex", flexDirection: "column", gap: 8,
                }}>
                  <span style={{ fontSize: 26, lineHeight: 1 }}>{m.icon}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{m.label}</span>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase", color: C.sub, marginBottom: 8 }}>Questions rapides</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              {["Propose un cocktail avec mon stock actuel", "Tendances cocktails de l'été", "Une idée pour écouler un stock qui dort ?"].map((p) => (
                <button key={p} onClick={() => sendChat(p)} disabled={thinking} style={{ ...btn(), fontSize: 12, padding: "8px 12px", opacity: thinking ? 0.5 : 1 }}>{p}</button>
              ))}
            </div>
            <div style={{ minHeight: 100 }}>
              {chat.length === 0 && (
                <Card><span style={{ color: C.sub, fontSize: 13.5, lineHeight: 1.6 }}>L'assistant connaît ta carte, tes marges, ton stock et tes alertes du moment. Il peut aussi chercher sur le web (tendances, réglementation, prix). Pose ta question ou utilise un raccourci.</span></Card>
              )}
              {chat.map((m, i) => (
                <div key={i} style={{
                  background: m.role === "user" ? C.soft : C.panel,
                  border: `1px solid ${m.role === "user" ? C.brassSoft : C.line}`,
                  borderRadius: 10, padding: "12px 14px", marginBottom: 10, fontSize: 14, lineHeight: 1.65,
                  whiteSpace: "pre-wrap", marginLeft: m.role === "user" ? 30 : 0, marginRight: m.role === "user" ? 0 : 30,
                }}>
                  <div style={{ fontSize: 9, letterSpacing: 1.8, textTransform: "uppercase", color: m.role === "user" ? C.brass : C.sub, marginBottom: 5, fontWeight: 700 }}>
                    {m.role === "user" ? "Toi" : "Assistant"}
                  </div>
                  {m.content}
                </div>
              ))}
              {thinking && <div style={{ color: C.sub, fontSize: 13, padding: "6px 2px" }}>L'assistant réfléchit…</div>}
              <div ref={chatEnd} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="Pose ta question…" style={{ ...inputStyle, flex: 1 }} />
              <button onClick={() => sendChat()} disabled={thinking} style={{ ...btn("p"), opacity: thinking ? 0.6 : 1 }}>Envoyer</button>
            </div>
          </div>
        )}

        {/* ———————— RÉGLAGES ———————— */}
        {tab === "reglages" && (
          <div>
            <Title>Établissement</Title>
            <div style={{ display: "flex", gap: 10 }}>
              <Field label="Nom du bar" value={barName} onChange={(e) => set({ barName: e.target.value })} />
              <Field label="Ville" value={city} onChange={(e) => set({ city: e.target.value })} />
            </div>

            <Title>Équipements froids</Title>
            {equipments.map((e) => (
              <Card key={e.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14 }}>{e.name} <span style={{ fontSize: 11.5, color: C.sub }}>· {e.type === "congel" ? "congélateur" : "frigo"}</span></span>
                  <button onClick={() => { if (safeConfirm("Retirer cet équipement ? Son historique de relevés sera conservé.")) set({ equipments: equipments.filter((x) => x.id !== e.id) }); }} style={{ ...btn("d"), padding: "6px 12px", fontSize: 12 }}>Retirer</button>
                </div>
              </Card>
            ))}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label="Nom" value={equipForm.name} onChange={(e) => setEquipForm({ ...equipForm, name: e.target.value })} />
              <Select label="Type" value={equipForm.type} onChange={(e) => setEquipForm({ ...equipForm, type: e.target.value })}>
                <option value="frigo">Frigo (0 à +4 °C)</option>
                <option value="congel">Congélateur (≤ −18 °C)</option>
              </Select>
              <Select label="Zone" value={equipForm.zone} onChange={(e) => setEquipForm({ ...equipForm, zone: e.target.value })}>
                <option>Bas</option><option>Haut</option><option>Cave</option><option>Cuisine</option>
              </Select>
              <button onClick={() => { if (!equipForm.name.trim()) return; set({ equipments: [...equipments, { id: uid(), name: equipForm.name.trim(), type: equipForm.type, zone: equipForm.zone }] }); setEquipForm({ name: "", type: "frigo", zone: "Bas" }); }}
                style={{ ...btn("p"), marginBottom: 12, padding: "12px 16px" }}>Ajouter</button>
            </div>

            <Title>Parc machines</Title>
            {machines.map((m) => (
              <Card key={m.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14 }}>{m.name} <span style={{ fontSize: 11.5, color: C.sub }}>· {m.type} · {m.zone} · entretien / {m.serviceFreq} j</span></span>
                  <button onClick={() => { if (safeConfirm("Retirer cette machine du parc ?")) set({ machines: machines.filter((x) => x.id !== m.id) }); }} style={{ ...btn("d"), padding: "6px 12px", fontSize: 12 }}>Retirer</button>
                </div>
              </Card>
            ))}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Field label="Nom" value={machineForm.name} onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })} />
              <Select label="Type" value={machineForm.type} onChange={(e) => setMachineForm({ ...machineForm, type: e.target.value })}>
                <option>Glaçons</option><option>Lave-verre</option><option>Tireuse</option><option>Café</option><option>Lave-vaisselle</option><option>Friteuse</option><option>Hotte</option><option>Four</option><option>Sous-vide</option><option>Autre</option>
              </Select>
              <Select label="Zone" value={machineForm.zone} onChange={(e) => setMachineForm({ ...machineForm, zone: e.target.value })}>
                <option>Bas</option><option>Haut</option><option>Cave</option><option>Cuisine</option>
              </Select>
              <Field label="Entretien (jours)" inputMode="numeric" value={machineForm.serviceFreq} onChange={(e) => setMachineForm({ ...machineForm, serviceFreq: e.target.value })} />
            </div>
            <Field label="Note d'entretien (ce qu'il faut faire)" value={machineForm.note} onChange={(e) => setMachineForm({ ...machineForm, note: e.target.value })} />
            <button onClick={() => { if (!machineForm.name.trim()) return; set({ machines: [...machines, { id: uid(), name: machineForm.name.trim(), type: machineForm.type, zone: machineForm.zone, serviceFreq: Math.max(1, num(machineForm.serviceFreq) || 7), lastService: null, status: "ok", note: machineForm.note.trim() }] }); setMachineForm({ name: "", type: "Autre", zone: "Bas", serviceFreq: "7", note: "" }); }}
              style={{ ...btn("p"), marginBottom: 4 }}>Ajouter la machine</button>

            <Title>Tâches de nettoyage</Title>
            {cleaning.map((t) => (
              <Card key={t.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14 }}>{t.label} <span style={{ fontSize: 11.5, color: C.sub }}>· chaque {t.freq}</span></span>
                  <button onClick={() => { if (safeConfirm("Retirer cette tâche de nettoyage ?")) set({ cleaning: cleaning.filter((x) => x.id !== t.id) }); }} style={{ ...btn("d"), padding: "6px 12px", fontSize: 12 }}>Retirer</button>
                </div>
              </Card>
            ))}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <Field label="Tâche" value={cleanForm.label} onChange={(e) => setCleanForm({ ...cleanForm, label: e.target.value })} />
              <Select label="Fréquence" value={cleanForm.freq} onChange={(e) => setCleanForm({ ...cleanForm, freq: e.target.value })}>
                <option value="jour">Chaque jour</option>
                <option value="semaine">Chaque semaine</option>
                <option value="mois">Chaque mois</option>
              </Select>
              <button onClick={() => { if (!cleanForm.label.trim()) return; set({ cleaning: [...cleaning, { id: uid(), label: cleanForm.label.trim(), freq: cleanForm.freq, lastDone: null }] }); setCleanForm({ label: "", freq: "jour" }); }}
                style={{ ...btn("p"), marginBottom: 12, padding: "12px 16px" }}>Ajouter</button>
            </div>

            <Title>Checklists ouverture / fermeture</Title>
            {["ouverture", "fermeture"].map((list) => (
              <div key={list} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, letterSpacing: 1.4, textTransform: "uppercase", color: C.brass, fontWeight: 700, marginBottom: 6 }}>{list === "ouverture" ? "Ouverture" : "Fermeture"}</div>
                {(checklists[list] || []).map((i) => (
                  <Card key={i.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13.5 }}>{i.label}</span>
                      <button onClick={() => set({ checklists: { ...checklists, [list]: checklists[list].filter((x) => x.id !== i.id) } })} style={{ ...btn("d"), padding: "5px 11px", fontSize: 12 }}>Retirer</button>
                    </div>
                  </Card>
                ))}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <Field label="Nouvelle tâche" value={checkForm.label} onChange={(e) => setCheckForm({ ...checkForm, label: e.target.value })} />
              <Select label="Liste" value={checkForm.list} onChange={(e) => setCheckForm({ ...checkForm, list: e.target.value })}>
                <option value="ouverture">Ouverture</option>
                <option value="fermeture">Fermeture</option>
              </Select>
              <button onClick={() => { if (!checkForm.label.trim()) return; set({ checklists: { ...checklists, [checkForm.list]: [...(checklists[checkForm.list] || []), { id: uid(), label: checkForm.label.trim() }] } }); setCheckForm({ ...checkForm, label: "" }); }}
                style={{ ...btn("p"), marginBottom: 12, padding: "12px 16px" }}>Ajouter</button>
            </div>

            <Title>Données</Title>
            <Card>
              <div style={{ fontSize: 13, color: C.sub, marginBottom: 10, lineHeight: 1.6 }}>
                Les données vivent sur cet appareil. Exporte une sauvegarde régulièrement (texte JSON copié dans le presse-papiers, à coller dans une note ou un fichier).
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button onClick={exportData} style={btn("p")}>{exported ? "✓ Exportée (fichier + copie)" : "Exporter la sauvegarde"}</button>
                <button onClick={importData} style={btn()}>Restaurer une sauvegarde</button>
              </div>
            </Card>
          </div>
        )}

        <footer style={{ textAlign: "center", marginTop: 46, fontSize: 11, color: C.sub, letterSpacing: 0.8 }}>
          Le Passe · v1.0 · données enregistrées sur cet appareil
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SafeBoundary>
      <AppInner />
    </SafeBoundary>
  );
}
