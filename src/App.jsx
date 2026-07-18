import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Search, Plus, Pencil, Trash2, X, Users, User, GraduationCap,
  Accessibility, Bus, MapPin, Phone, CreditCard, Heart, Sparkles,
  AlertTriangle, Wifi, WifiOff, PackageCheck, PackageX, Calendar, Download,
  Camera, ImagePlus, ScanLine, Loader2, CheckCircle2,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { parseCardText } from "./cardScan";
import { lookupPincode, getPincodeSet, pickBestVillage } from "./pincodeLookup";

const SITE_PASSWORD = "Aditya";
const AUTH_KEY = "st_card_authed";
const CARD_PREFIX = "M260";

const CATEGORIES = [
  { key: "female", label: "Female", icon: User, color: "#A6234A" },
  { key: "student", label: "Student", icon: GraduationCap, color: "#B8860B" },
  { key: "handicapped", label: "Handicapped", icon: Accessibility, color: "#2F7A4F" },
  { key: "senior", label: "Senior Citizen", icon: Heart, color: "#5B4B8A" },
  { key: "amrut", label: "Amrut SCT", icon: Sparkles, color: "#C1622D" },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyForm = () => ({ name: "", mobile: "", cardNumber: CARD_PREFIX, village: "", pincode: "", category: "female", date: todayStr() });

// Map DB row (snake_case) <-> app object (camelCase)
const fromRow = (r) => ({
  id: r.id,
  name: r.name,
  mobile: r.mobile,
  cardNumber: r.card_number,
  village: r.village,
  category: r.category,
  delivered: r.delivered,
  date: r.entry_date,
  createdAt: r.created_at,
});
const toRow = (c) => ({
  name: c.name,
  mobile: c.mobile,
  card_number: c.cardNumber,
  village: c.village,
  category: c.category,
  entry_date: c.date,
});

export default function App() {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem(AUTH_KEY) === "true");

  if (!authed) return <PasswordGate onSuccess={() => setAuthed(true)} />;
  if (!isSupabaseConfigured) return <SetupNeeded />;
  return <CardRegister />;
}

function PasswordGate({ onSuccess }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const submit = () => {
    if (value === SITE_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, "true");
      onSuccess();
    } else {
      setError("Incorrect password");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F5F1E8", fontFamily: "'Inter', system-ui, sans-serif", color: "#2B2117", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 360, width: "100%", background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 1px 3px rgba(43,33,23,0.08)" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "#8B1A1A", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
          <Bus size={22} color="#fff" />
        </div>
        <h1 style={{ fontSize: 17, margin: "0 0 6px" }}>ST Card Register</h1>
        <p style={{ fontSize: 13, color: "#6B5D4F", margin: "0 0 16px" }}>Enter the password to view customer records.</p>
        <input
          type="password"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Password"
          autoFocus
          style={{ width: "100%", padding: "11px 12px", borderRadius: 10, border: error ? "1px solid #A6234A" : "1px solid #DED2C0", fontSize: 14.5, marginBottom: error ? 6 : 14 }}
        />
        {error && <div style={{ fontSize: 12, color: "#A6234A", marginBottom: 10 }}>{error}</div>}
        <button
          onClick={submit}
          style={{ width: "100%", padding: "12px", borderRadius: 12, border: "none", background: "#8B1A1A", color: "#fff", fontSize: 14.5, fontWeight: 700, cursor: "pointer" }}
        >
          Enter
        </button>
      </div>
    </div>
  );
}

function CardRegister() {
  const [customers, setCustomers] = useState([]);
  const [villages, setVillages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterDelivery, setFilterDelivery] = useState("all");
  const [filterVillage, setFilterVillage] = useState("all");
  const [addingVillage, setAddingVillage] = useState(false);
  const [newVillageName, setNewVillageName] = useState("");
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const nameInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const [scanning, setScanning] = useState(false);
  const [scanPct, setScanPct] = useState(0);
  const [scanFilled, setScanFilled] = useState(null); // which fields got auto-filled, e.g. {name:true, mobile:false, ...}
  const [pincodeStatus, setPincodeStatus] = useState(null); // null | 'loading' | 'done' | 'multiple' | 'error'
  const [villageCandidates, setVillageCandidates] = useState([]); // villages sharing the current pincode, when more than one
  const ocrVillageGuessRef = useRef(""); // village text (if any) the OCR pass read off the card, used to disambiguate
  const [showScanMenu, setShowScanMenu] = useState(false); // front-page quick-scan popover

  const showToast = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 2400);
  };

  const fetchCustomers = useCallback(async () => {
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setOnline(false);
      showToast("Could not reach the database", true);
    } else {
      setOnline(true);
      setCustomers((data || []).map(fromRow));
    }
    setLoading(false);
  }, []);

  const fetchVillages = useCallback(async () => {
    const { data, error } = await supabase.from("villages").select("*").order("name", { ascending: true });
    if (!error) setVillages(data || []);
  }, []);

  const addVillage = useCallback(async (rawName) => {
    const name = rawName.trim().toUpperCase();
    if (!name) return false;
    const { error } = await supabase.from("villages").insert({ name });
    if (error && error.code !== "23505") {
      // 23505 = already exists, which is fine — just means it's already usable
      showToast("Could not add village", true);
      return false;
    }
    fetchVillages();
    return true;
  }, [fetchVillages]);

  useEffect(() => {
    fetchCustomers();
    fetchVillages();
    const channel = supabase
      .channel("customers-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () => {
        fetchCustomers();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "villages" }, () => {
        fetchVillages();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchCustomers, fetchVillages]);

  const openAddForm = () => {
    setForm({ ...emptyForm(), village: filterVillage !== "all" ? filterVillage : "" });
    setErrors({});
    setEditingId(null);
    setScanFilled(null);
    setPincodeStatus(null);
    setVillageCandidates([]);
    ocrVillageGuessRef.current = "";
    setShowForm(true);
  };

  const openEditForm = (c) => {
    setForm({ name: c.name, mobile: c.mobile, cardNumber: c.cardNumber, village: c.village, pincode: "", category: c.category, date: c.date || todayStr() });
    setErrors({});
    setEditingId(c.id);
    setScanFilled(null);
    setPincodeStatus(null);
    setVillageCandidates([]);
    ocrVillageGuessRef.current = "";
    setShowForm(true);
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Name required";
    if (!form.mobile.trim()) e.mobile = "Number required";
    else if (!/^\d{10}$/.test(form.mobile.trim())) e.mobile = "Enter 10-digit number";
    if (!form.cardNumber.trim()) e.cardNumber = "Card number required";
    if (!form.village.trim()) e.village = "Village required";
    if (!form.date) e.date = "Date required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    const payload = { ...form, name: form.name.trim().toUpperCase(), village: form.village.trim().toUpperCase() };

    if (editingId) {
      const { error } = await supabase.from("customers").update(toRow(payload)).eq("id", editingId);
      if (error) {
        if (error.code === "23505") setErrors({ cardNumber: "Card number already exists" });
        else showToast("Could not save changes", true);
        setSaving(false);
        return;
      }
      showToast("Customer updated");
    } else {
      const { error } = await supabase.from("customers").insert(toRow(payload));
      if (error) {
        if (error.code === "23505") setErrors({ cardNumber: "Card number already exists" });
        else showToast("Could not add customer", true);
        setSaving(false);
        return;
      }
      showToast("Customer added");
    }
    setSaving(false);
    setShowForm(false);
    setForm(emptyForm);
    setEditingId(null);
    fetchCustomers();
    if (!villages.some((v) => v.name === payload.village)) {
      addVillage(payload.village);
    }
  };

  const handleDelete = async (id) => {
    const { error } = await supabase.from("customers").delete().eq("id", id);
    setConfirmDelete(null);
    if (error) {
      showToast("Could not remove record", true);
    } else {
      showToast("Customer removed");
      fetchCustomers();
    }
  };

  const toggleDelivered = async (c) => {
    const next = !c.delivered;
    // Optimistic update so the tap feels instant
    setCustomers((prev) => prev.map((x) => (x.id === c.id ? { ...x, delivered: next } : x)));
    const { error } = await supabase.from("customers").update({ delivered: next }).eq("id", c.id);
    if (error) {
      setCustomers((prev) => prev.map((x) => (x.id === c.id ? { ...x, delivered: !next } : x)));
      showToast("Could not update delivery status", true);
    } else {
      showToast(next ? "Marked delivered" : "Marked undelivered");
    }
  };

  const markLatestDelivered = async () => {
    if (customers.length === 0) return;
    const latest = customers[0]; // list is sorted newest-first
    if (latest.delivered) {
      showToast("Latest customer is already marked delivered");
      return;
    }
    setCustomers((prev) => prev.map((x) => (x.id === latest.id ? { ...x, delivered: true } : x)));
    const { error } = await supabase.from("customers").update({ delivered: true }).eq("id", latest.id);
    if (error) {
      setCustomers((prev) => prev.map((x) => (x.id === latest.id ? { ...x, delivered: false } : x)));
      showToast("Could not update delivery status", true);
    } else {
      showToast(`${latest.name} marked delivered`);
    }
  };

  // Keyboard shortcuts: Ctrl+N (or Cmd+N) = add new customer,
  // Ctrl+D (or Cmd+D) = mark the most recently added customer delivered,
  // Ctrl+S (or Cmd+S) = save the open form.
  // Note: some desktop browsers (esp. Chrome) permanently reserve Ctrl+N and
  // Ctrl+D for their own use (new window / bookmark) and never let a webpage
  // override them. So this app supports three ways in, whichever works on
  // your browser: Ctrl+N/Ctrl+D, Alt+N/Alt+D, or just pressing N / D alone
  // (only when you're not typing in a text field).
  useEffect(() => {
    const isTypingField = (el) =>
      el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

    const handler = (e) => {
      const key = e.key.toLowerCase();
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      const alt = e.altKey;
      const bareKey = !ctrlOrCmd && !alt && !isTypingField(e.target);

      if (ctrlOrCmd && key === "s") {
        e.preventDefault();
        if (showForm) handleSubmit();
        return;
      }

      const wantsNew = (ctrlOrCmd && key === "n") || (alt && key === "n") || (bareKey && key === "n");
      const wantsDelivered = (ctrlOrCmd && key === "d") || (alt && key === "d") || (bareKey && key === "d");

      if (wantsNew) {
        e.preventDefault();
        if (!showForm) openAddForm();
      } else if (wantsDelivered) {
        e.preventDefault();
        if (!showForm) markLatestDelivered();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // Autofocus the "Full name" field whenever the form opens
  useEffect(() => {
    if (showForm && nameInputRef.current) {
      const t = setTimeout(() => {
        nameInputRef.current.focus();
        nameInputRef.current.select();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [showForm]);

  // Large phone-camera photos (often 8-12MB, 4000px+ on a side) are a common
  // cause of the scanner silently failing or hanging on low-end Android
  // phones — the OCR engine runs entirely in-browser via WebAssembly, and
  // feeding it a huge image can exhaust memory or simply take too long.
  // Downscaling to a sane max dimension first fixes that and also makes
  // recognition noticeably faster.
  const downscaleImage = (file, maxDimension = 1600) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        if (scale === 1) {
          resolve(file);
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : resolve(file)),
          "image/jpeg",
          0.9
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file); // fall back to the original file rather than failing the whole scan
      };
      img.src = url;
    });

  const handleScanImage = async (file) => {
    if (!file) return;
    setScanning(true);
    setScanPct(0);
    setScanFilled(null);
    try {
      const [Tesseract, resized, pincodeSet] = await Promise.all([
        import("tesseract.js"),
        downscaleImage(file),
        getPincodeSet().catch(() => new Set()),
      ]);

      const recognizePromise = Tesseract.recognize(resized, "eng", {
        // Pinned to a version compatible with tesseract.js@5.1.1 so the
        // worker/core/traineddata fetched from the CDN never mismatch —
        // a mismatch is the most common cause of the scanner failing with
        // no useful error message.
        workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
        corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.0/tesseract-core-simd-lstm.wasm.js",
        langPath: "https://tessdata.projectnaptha.com/4.0.0",
        logger: (m) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            setScanPct(Math.round(m.progress * 100));
          }
        },
      });
      // If the CDN is unreachable (weak signal, captive portal, etc.) the
      // worker can hang indefinitely instead of rejecting — cap it so the
      // person gets a clear "try again" message instead of a frozen screen.
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Scan timed out — check your internet connection and try again")), 45000)
      );
      const { data } = await Promise.race([recognizePromise, timeoutPromise]);

      const parsed = parseCardText(data.text, CARD_PREFIX, pincodeSet);
      ocrVillageGuessRef.current = parsed.village || "";
      const filled = {};
      setForm((f) => {
        const next = { ...f };
        if (parsed.name) { next.name = parsed.name.toUpperCase(); filled.name = true; }
        if (parsed.mobile) { next.mobile = parsed.mobile; filled.mobile = true; }
        if (parsed.cardNumber) { next.cardNumber = parsed.cardNumber; filled.cardNumber = true; }
        if (parsed.pincode) {
          // A pincode was found on the card — let the pincode lookup effect
          // fetch the official village name for it (cross-checked against
          // parsed.village above when more than one village shares it).
          next.pincode = parsed.pincode;
          filled.pincode = true;
        } else if (parsed.village) {
          next.village = parsed.village.toUpperCase();
          filled.village = true;
        }
        if (parsed.category) { next.category = parsed.category; filled.category = true; }
        return next;
      });
      setScanFilled(filled);
      if (Object.keys(filled).length === 0) {
        showToast("Couldn't read details from that image — please fill in manually", true);
      } else {
        showToast("Scanned — please check the highlighted fields below");
      }
    } catch (err) {
      console.error("Card scan failed:", err);
      showToast(err?.message?.includes("timed out") ? err.message : "Scan failed — please fill in manually", true);
    } finally {
      setScanning(false);
    }
  };

  // Look up the village name from a 6-digit pincode using the local
  // Maharashtra pincode directory (bundled in pincodeData.json — no network
  // call, so this works even with no internet). Runs automatically whenever
  // form.pincode becomes a valid 6-digit number (typed manually or filled by
  // the card scan above), debounced so it doesn't fire on every keystroke.
  // Many pincodes cover several villages; when that happens we try to match
  // whatever village text the OCR pass already read off the card, and
  // otherwise ask the person to pick from the candidates below.
  useEffect(() => {
    const pin = (form.pincode || "").trim();
    if (!/^[1-9]\d{5}$/.test(pin)) {
      setPincodeStatus(null);
      setVillageCandidates([]);
      return;
    }
    let cancelled = false;
    setPincodeStatus("loading");
    const t = setTimeout(async () => {
      try {
        const entry = await lookupPincode(pin);
        if (cancelled) return;
        if (!entry || entry.villages.length === 0) {
          setPincodeStatus("error");
          setVillageCandidates([]);
          return;
        }
        setVillageCandidates(entry.villages);
        const guessed = entry.villages.length === 1
          ? entry.villages[0]
          : pickBestVillage(entry.villages, ocrVillageGuessRef.current);
        if (guessed) {
          setForm((f) => (f.pincode.trim() === pin ? { ...f, village: guessed.toUpperCase() } : f));
          setScanFilled((s) => (s ? { ...s, village: false } : s));
          setPincodeStatus("done");
        } else {
          setPincodeStatus("multiple");
        }
      } catch (err) {
        if (!cancelled) setPincodeStatus("error");
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.pincode]);

  const handleCardNumberChange = (e) => {
    let v = e.target.value.toUpperCase();
    // Strip any occurrences of the prefix the user typed, then force
    // exactly one at the very start — so it can never be deleted.
    v = CARD_PREFIX + v.split(CARD_PREFIX).join("");
    setForm((f) => ({ ...f, cardNumber: v }));
  };

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      const matchesCat = filterCategory === "all" || c.category === filterCategory;
      const matchesVillage = filterVillage === "all" || c.village === filterVillage;
      const matchesDelivery =
        filterDelivery === "all" ||
        (filterDelivery === "delivered" && c.delivered) ||
        (filterDelivery === "pending" && !c.delivered);
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.mobile.includes(q) ||
        c.cardNumber.toLowerCase().includes(q) ||
        c.village.toLowerCase().includes(q);
      return matchesCat && matchesVillage && matchesDelivery && matchesSearch;
    });
  }, [customers, search, filterCategory, filterVillage, filterDelivery]);

  const counts = useMemo(() => {
    const c = {};
    CATEGORIES.forEach((cat) => (c[cat.key] = 0));
    customers.forEach((cu) => { if (c[cu.category] !== undefined) c[cu.category]++; });
    return c;
  }, [customers]);

  const villageCounts = useMemo(() => {
    const c = {};
    customers.forEach((cu) => { c[cu.village] = (c[cu.village] || 0) + 1; });
    return c;
  }, [customers]);

  // Combine explicitly-added villages with any village names already used
  // by customers, so nothing is missing from the list either way.
  const allVillageNames = useMemo(() => {
    const names = new Set(villages.map((v) => v.name));
    customers.forEach((c) => { if (c.village) names.add(c.village); });
    return Array.from(names).sort();
  }, [villages, customers]);

  // For the open form's datalist, also surface villages that share the
  // currently-entered pincode (even if no one has used them here before) so
  // the "multiple villages, please pick one" case is actually pickable.
  const villageOptions = useMemo(() => {
    const names = new Set(allVillageNames);
    villageCandidates.forEach((v) => names.add(v.toUpperCase()));
    return Array.from(names).sort();
  }, [allVillageNames, villageCandidates]);

  const catMeta = (key) => CATEGORIES.find((c) => c.key === key) || CATEGORIES[0];

  const handleAddVillage = async () => {
    const ok = await addVillage(newVillageName);
    if (ok) {
      showToast("Village added");
      setNewVillageName("");
      setAddingVillage(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F5F1E8", fontFamily: "'Inter', system-ui, sans-serif", color: "#2B2117", paddingBottom: 90 }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        .card-shadow { box-shadow: 0 1px 3px rgba(43,33,23,0.08), 0 1px 2px rgba(43,33,23,0.06); }
        input:focus, select:focus { outline: 2px solid #A6234A; outline-offset: 1px; }
        button:focus-visible { outline: 2px solid #A6234A; outline-offset: 2px; }
        button:disabled { opacity: 0.6; cursor: not-allowed; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
        .slide-up { animation: slideUp 0.22s ease-out; }
        @keyframes slideUp { from { transform: translateY(16px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .fade-in { animation: fadeIn 0.2s ease-out; }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .spin { animation: spin 0.9s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      <header style={{ background: "#8B1A1A", color: "#F5F1E8", padding: "20px 16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 900, margin: "0 auto" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#F5F1E8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Bus size={22} color="#8B1A1A" />
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: -0.2 }}>ST Card Register</h1>
            <p style={{ margin: 0, fontSize: 12.5, color: "#EAD9CE", opacity: 0.9 }}>Maharashtra State Transport · Card holder records</p>
            <p style={{ margin: "2px 0 0", fontSize: 10.5, color: "#EAD9CE", opacity: 0.7 }}>N new · D mark latest delivered · Ctrl+S save form</p>
          </div>
          <div title={online ? "Synced" : "Offline"} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#EAD9CE" }}>
            {online ? <Wifi size={15} /> : <WifiOff size={15} />}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 900, margin: "0 auto", padding: "16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 16 }}>
          <div className="card-shadow" style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", borderLeft: "4px solid #2B2117" }}>
            <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{customers.length}</div>
            <div style={{ fontSize: 12, color: "#6B5D4F", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}><Users size={13}/> Total cards</div>
          </div>
          {CATEGORIES.map((cat) => {
            const active = filterCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setFilterCategory(active ? "all" : cat.key)}
                className="card-shadow"
                style={{
                  background: active ? cat.color + "14" : "#fff", borderRadius: 12, padding: "12px 14px",
                  border: active ? `2px solid ${cat.color}` : "none",
                  borderLeft: `4px solid ${cat.color}`, textAlign: "left", cursor: "pointer", font: "inherit",
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1, color: cat.color }}>{counts[cat.key]}</div>
                <div style={{ fontSize: 12, color: "#6B5D4F", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                  <cat.icon size={13} /> {cat.label}
                </div>
              </button>
            );
          })}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#6B5D4F", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
            <MapPin size={13} /> Villages
          </div>
          <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
            <button
              onClick={() => setFilterVillage("all")}
              style={{
                flexShrink: 0, padding: "7px 14px", borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                border: filterVillage === "all" ? "1px solid #8B1A1A" : "1px solid #DED2C0",
                background: filterVillage === "all" ? "#8B1A1A" : "#fff",
                color: filterVillage === "all" ? "#fff" : "#6B5D4F",
              }}
            >
              All ({customers.length})
            </button>
            {allVillageNames.map((name) => {
              const active = filterVillage === name;
              return (
                <button
                  key={name}
                  onClick={() => setFilterVillage(active ? "all" : name)}
                  style={{
                    flexShrink: 0, padding: "7px 14px", borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                    border: active ? "1px solid #8B1A1A" : "1px solid #DED2C0",
                    background: active ? "#8B1A1A" : "#fff",
                    color: active ? "#fff" : "#6B5D4F",
                  }}
                >
                  {name} ({villageCounts[name] || 0})
                </button>
              );
            })}
            {!addingVillage ? (
              <button
                onClick={() => setAddingVillage(true)}
                style={{ flexShrink: 0, padding: "7px 14px", borderRadius: 20, fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", border: "1px dashed #8B1A1A", background: "#fff", color: "#8B1A1A" }}
              >
                + Add village
              </button>
            ) : (
              <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
                <input
                  autoFocus
                  value={newVillageName}
                  onChange={(e) => setNewVillageName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddVillage()}
                  placeholder="Village name"
                  style={{ width: 140, padding: "7px 10px", borderRadius: 20, border: "1px solid #DED2C0", fontSize: 12.5 }}
                />
                <button onClick={handleAddVillage} style={{ border: "none", background: "#8B1A1A", color: "#fff", borderRadius: "50%", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} aria-label="Save village">
                  <Plus size={14} />
                </button>
                <button onClick={() => { setAddingVillage(false); setNewVillageName(""); }} style={{ border: "none", background: "#F5F1E8", borderRadius: "50%", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} aria-label="Cancel">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>
          {filterVillage !== "all" && (
            <div style={{ fontSize: 11.5, color: "#9A8B7A", marginTop: 6 }}>
              Showing {filterVillage}. Tap the + button below to add a customer here directly.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 200px" }}>
            <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#9A8B7A" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, number, card no., village"
              style={{ width: "100%", padding: "10px 12px 10px 34px", borderRadius: 10, border: "1px solid #DED2C0", fontSize: 14, background: "#fff" }}
            />
          </div>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            style={{ padding: "10px 10px", borderRadius: 10, border: "1px solid #DED2C0", fontSize: 14, background: "#fff", color: "#2B2117" }}
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <button
            onClick={() => {
              const data = filterVillage === "all" ? customers : customers.filter((c) => c.village === filterVillage);
              const title = filterVillage === "all" ? "All Villages" : filterVillage;
              exportCustomersPDF(data, title, (key) => catMeta(key).label);
            }}
            title={filterVillage === "all" ? "Export all customers to a PDF" : `Export only ${filterVillage} to a PDF`}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px", borderRadius: 10, border: "1px solid #DED2C0", background: "#fff", color: "#2B2117", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}
          >
            <Download size={15} /> {filterVillage === "all" ? "Export all" : `Export ${filterVillage}`}
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          {[
            { key: "all", label: "All" },
            { key: "pending", label: "Not delivered" },
            { key: "delivered", label: "Delivered" },
          ].map((opt) => {
            const active = filterDelivery === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => setFilterDelivery(opt.key)}
                style={{
                  padding: "7px 14px", borderRadius: 20, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                  border: active ? "1px solid #8B1A1A" : "1px solid #DED2C0",
                  background: active ? "#8B1A1A" : "#fff",
                  color: active ? "#fff" : "#6B5D4F",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#9A8B7A", fontSize: 14 }}>Loading records…</div>
        ) : filtered.length === 0 ? (
          <div className="card-shadow" style={{ background: "#fff", borderRadius: 14, padding: "40px 20px", textAlign: "center" }}>
            <Bus size={28} color="#CBBBA5" style={{ marginBottom: 10 }} />
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {customers.length === 0 ? "No cards registered yet" : "No matches found"}
            </div>
            <div style={{ fontSize: 13, color: "#9A8B7A", marginTop: 4 }}>
              {customers.length === 0 ? "Tap + to add your first customer" : "Try a different search or filter"}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((c) => {
              const meta = catMeta(c.category);
              const Icon = meta.icon;
              return (
                <div key={c.id} className="card-shadow fade-in" style={{ background: "#fff", borderRadius: 12, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, opacity: c.delivered ? 0.7 : 1 }}>
                  <div style={{ width: 38, height: 38, borderRadius: 10, background: meta.color + "1A", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={18} color={meta.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{c.name}</div>
                      <span style={{
                        fontSize: 10.5, fontWeight: 700, padding: "1px 7px", borderRadius: 8,
                        background: c.delivered ? "#E4F1E8" : "#FDECEC",
                        color: c.delivered ? "#2F7A4F" : "#A6234A",
                      }}>
                        {c.delivered ? "Delivered" : "Pending"}
                      </span>
                    </div>
                    <div style={{ fontSize: 12.5, color: "#6B5D4F", display: "flex", flexWrap: "wrap", gap: "2px 10px", marginTop: 2 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}><CreditCard size={11}/> {c.cardNumber}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Phone size={11}/> {c.mobile}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}><MapPin size={11}/> {c.village}</span>
                      {c.date && <span style={{ display: "flex", alignItems: "center", gap: 3 }}><Calendar size={11}/> {formatDisplayDate(c.date)}</span>}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => toggleDelivered(c)}
                      style={{ border: "none", background: c.delivered ? "#E4F1E8" : "#F5F1E8", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                      aria-label={c.delivered ? "Mark as not delivered" : "Mark as delivered"}
                      title={c.delivered ? "Mark as not delivered" : "Mark as delivered"}
                    >
                      {c.delivered ? <PackageCheck size={15} color="#2F7A4F" /> : <PackageX size={15} color="#9A8B7A" />}
                    </button>
                    <button onClick={() => openEditForm(c)} style={{ border: "none", background: "#F5F1E8", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} aria-label="Edit">
                      <Pencil size={14} color="#6B5D4F" />
                    </button>
                    <button onClick={() => setConfirmDelete(c.id)} style={{ border: "none", background: "#F5F1E8", borderRadius: 8, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }} aria-label="Delete">
                      <Trash2 size={14} color="#A6234A" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => { handleScanImage(e.target.files?.[0]); e.target.value = ""; }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { handleScanImage(e.target.files?.[0]); e.target.value = ""; }}
      />

      {showScanMenu && (
        <div style={{ position: "fixed", bottom: 148, right: 20, display: "flex", flexDirection: "column", gap: 8, zIndex: 40 }} className="fade-in">
          <button
            onClick={() => { setShowScanMenu(false); openAddForm(); galleryInputRef.current?.click(); }}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #DED2C0", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 600, color: "#2B2117", boxShadow: "0 4px 10px rgba(43,33,23,0.15)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <ImagePlus size={16} /> Upload card image
          </button>
          <button
            onClick={() => { setShowScanMenu(false); openAddForm(); cameraInputRef.current?.click(); }}
            style={{ display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #DED2C0", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 600, color: "#2B2117", boxShadow: "0 4px 10px rgba(43,33,23,0.15)", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <Camera size={16} /> Take a photo
          </button>
        </div>
      )}

      <button
        onClick={() => setShowScanMenu((s) => !s)}
        style={{ position: "fixed", bottom: 88, right: 20, width: 46, height: 46, borderRadius: "50%", background: "#fff", color: "#8B1A1A", border: "1px solid #DED2C0", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 14px rgba(43,33,23,0.18)", zIndex: 40 }}
        aria-label="Scan card to add customer"
        title="Scan a card to add a customer"
      >
        <ScanLine size={20} />
      </button>

      <button
        onClick={openAddForm}
        style={{ position: "fixed", bottom: 24, right: 20, width: 54, height: 54, borderRadius: "50%", background: "#8B1A1A", color: "#fff", border: "none", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 4px 14px rgba(139,26,26,0.4)" }}
        aria-label="Add customer"
      >
        <Plus size={26} />
      </button>

      {toast && (
        <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: toast.isError ? "#A6234A" : "#2B2117", color: "#fff", padding: "9px 16px", borderRadius: 20, fontSize: 13.5, boxShadow: "0 4px 12px rgba(0,0,0,0.2)", zIndex: 60 }}>
          {toast.msg}
        </div>
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(43,33,23,0.45)", display: "flex", alignItems: "flex-end", zIndex: 50 }} onClick={() => !saving && setShowForm(false)}>
          <div className="slide-up" onClick={(e) => e.stopPropagation()} style={{ background: "#F5F1E8", width: "100%", maxWidth: 900, margin: "0 auto", borderRadius: "18px 18px 0 0", padding: "18px 18px 24px", maxHeight: "88vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{editingId ? "Edit customer" : "Add customer"}</h2>
              <button onClick={() => setShowForm(false)} style={{ border: "none", background: "#fff", borderRadius: 8, width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <X size={16} />
              </button>
            </div>

            <div style={{ background: "#fff", border: "1px dashed #DED2C0", borderRadius: 12, padding: 12, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#6B5D4F", marginBottom: 8 }}>
                <ScanLine size={14} /> Scan card to auto-fill (optional)
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => cameraInputRef.current?.click()}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 10, border: "1px solid #DED2C0", background: "#F5F1E8", fontSize: 13, fontWeight: 600, color: "#2B2117", cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.6 : 1 }}
                >
                  <Camera size={16} /> Take photo
                </button>
                <button
                  type="button"
                  disabled={scanning}
                  onClick={() => galleryInputRef.current?.click()}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px", borderRadius: 10, border: "1px solid #DED2C0", background: "#F5F1E8", fontSize: 13, fontWeight: 600, color: "#2B2117", cursor: scanning ? "default" : "pointer", opacity: scanning ? 0.6 : 1 }}
                >
                  <ImagePlus size={16} /> Upload image
                </button>
              </div>
              {scanning && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#6B5D4F" }}>
                  <Loader2 size={14} className="spin" /> Reading image… {scanPct}%
                </div>
              )}
              {!scanning && scanFilled && Object.keys(scanFilled).length > 0 && (
                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#2F7A4F" }}>
                  <CheckCircle2 size={14} /> Auto-filled below — double-check before saving.
                </div>
              )}
            </div>

            <Field label="Full name" error={errors.name}>
              <input
                ref={nameInputRef}
                value={form.name}
                onChange={(e) => { setForm({ ...form, name: e.target.value }); setScanFilled((s) => (s ? { ...s, name: false } : s)); }}
                placeholder="e.g. KIRTI PATIL"
                style={{ ...inputStyle(errors.name), ...(scanFilled?.name ? scannedFieldStyle : {}) }}
              />
            </Field>

            <Field label="Mobile number" error={errors.mobile}>
              <input
                value={form.mobile}
                onChange={(e) => { setForm({ ...form, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) }); setScanFilled((s) => (s ? { ...s, mobile: false } : s)); }}
                placeholder="10-digit number"
                inputMode="numeric"
                style={{ ...inputStyle(errors.mobile), ...(scanFilled?.mobile ? scannedFieldStyle : {}) }}
              />
            </Field>

            <Field label="Card number" error={errors.cardNumber}>
              <input
                value={form.cardNumber}
                onChange={(e) => { handleCardNumberChange(e); setScanFilled((s) => (s ? { ...s, cardNumber: false } : s)); }}
                placeholder="e.g. M26000123"
                style={{ ...inputStyle(errors.cardNumber), ...(scanFilled?.cardNumber ? scannedFieldStyle : {}) }}
              />
            </Field>

            <Field label="Date" error={errors.date}>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} style={inputStyle(errors.date)} />
            </Field>

            <Field label="Pincode" hint="Auto-fills village below">
              <div style={{ position: "relative" }}>
                <input
                  value={form.pincode}
                  onChange={(e) => { setForm({ ...form, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) }); setScanFilled((s) => (s ? { ...s, pincode: false } : s)); }}
                  placeholder="6-digit pincode"
                  inputMode="numeric"
                  style={{ ...inputStyle(null), ...(scanFilled?.pincode ? scannedFieldStyle : {}) }}
                />
                {pincodeStatus === "loading" && (
                  <Loader2 size={15} className="spin" color="#6B5D4F" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }} />
                )}
                {pincodeStatus === "done" && (
                  <CheckCircle2 size={15} color="#2F7A4F" style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }} />
                )}
              </div>
              {pincodeStatus === "error" && (
                <div style={{ fontSize: 11.5, color: "#A6234A", marginTop: 4 }}>Couldn't find that pincode — enter village manually.</div>
              )}
              {pincodeStatus === "multiple" && (
                <div style={{ fontSize: 11.5, color: "#B8860B", marginTop: 4 }}>
                  {villageCandidates.length} villages share this pincode — pick the correct one below.
                </div>
              )}
            </Field>

            <Field label="Village" error={errors.village}>
              {villageCandidates.length > 1 && (
                <select
                  value={villageCandidates.some((v) => v.toUpperCase() === form.village) ? form.village : ""}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setForm({ ...form, village: e.target.value });
                    setScanFilled((s) => (s ? { ...s, village: true } : s));
                    setPincodeStatus("done");
                  }}
                  style={{ ...inputStyle(null), marginBottom: 8, fontWeight: 600, borderColor: "#B8860B", background: "#FFF9EE" }}
                >
                  <option value="">{villageCandidates.length} villages share this pincode — tap to pick one</option>
                  {villageCandidates.map((v) => (
                    <option key={v} value={v.toUpperCase()}>{v}</option>
                  ))}
                </select>
              )}
              <input
                value={form.village}
                onChange={(e) => { setForm({ ...form, village: e.target.value }); setScanFilled((s) => (s ? { ...s, village: false } : s)); }}
                placeholder="Start typing or pick a saved village"
                list="village-options"
                style={{ ...inputStyle(errors.village), ...(scanFilled?.village ? scannedFieldStyle : {}) }}
              />
              <datalist id="village-options">
                {villageOptions.map((name) => <option key={name} value={name} />)}
              </datalist>
            </Field>

            <Field label="Category">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const active = form.category === cat.key;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => { setForm({ ...form, category: cat.key }); setScanFilled((s) => (s ? { ...s, category: false } : s)); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10,
                        border: active ? `2px solid ${cat.color}` : (scanFilled?.category && active ? "2px solid #2F7A4F" : "1px solid #DED2C0"),
                        background: active ? cat.color + "14" : "#fff", cursor: "pointer", fontSize: 13.5, fontWeight: active ? 700 : 500,
                        color: active ? cat.color : "#2B2117",
                      }}
                    >
                      <Icon size={16} /> {cat.label}
                    </button>
                  );
                })}
              </div>
            </Field>

            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{ width: "100%", marginTop: 18, padding: "13px", borderRadius: 12, border: "none", background: "#8B1A1A", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add customer"}
            </button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(43,33,23,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 20 }} onClick={() => setConfirmDelete(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 20, maxWidth: 320, width: "100%" }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Remove this record?</div>
            <div style={{ fontSize: 13, color: "#6B5D4F", marginBottom: 16 }}>This can't be undone.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setConfirmDelete(null)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid #DED2C0", background: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: "#A6234A", color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SetupNeeded() {
  return (
    <div style={{ minHeight: "100vh", background: "#F5F1E8", fontFamily: "'Inter', system-ui, sans-serif", color: "#2B2117", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 480, background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 1px 3px rgba(43,33,23,0.08)" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "#FDECEC", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
          <AlertTriangle size={22} color="#A6234A" />
        </div>
        <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>Database not connected yet</h1>
        <p style={{ fontSize: 14, color: "#6B5D4F", lineHeight: 1.6, margin: "0 0 12px" }}>
          This site needs a Supabase project so your data syncs across every device.
          Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> as
          environment variables (see the README included in the project), then redeploy.
        </p>
        <p style={{ fontSize: 13, color: "#9A8B7A", margin: 0 }}>
          Once those two values are set, this screen will be replaced by your card register.
        </p>
      </div>
    </div>
  );
}

function formatDisplayDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

function exportCustomersPDF(customers, title, catLabel) {
  const doc = new jsPDF({ orientation: "landscape" });

  doc.setFontSize(15);
  doc.text(`ST Card Register — ${title}`, 14, 15);
  doc.setFontSize(10);
  doc.setTextColor(110, 100, 90);
  const dateStr = new Date().toLocaleDateString("en-IN");
  doc.text(`Generated ${dateStr} · ${customers.length} customer${customers.length === 1 ? "" : "s"}`, 14, 21);

  const rows = customers.map((c) => [
    c.date ? formatDisplayDate(c.date) : "",
    c.name || "",
    c.cardNumber || "",
    c.mobile || "",
    c.village || "",
    catLabel(c.category),
    c.delivered ? "Yes" : "No",
  ]);

  autoTable(doc, {
    startY: 26,
    head: [["Date", "Name", "Card Number", "Contact Number", "Village", "Category", "Delivered"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [139, 26, 26], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [245, 241, 232] },
  });

  const safeTitle = title.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  doc.save(`st-card-customers-${safeTitle}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function Field({ label, hint, error, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#6B5D4F", marginBottom: 5 }}>
        {label}{hint && <span style={{ fontWeight: 400, color: "#9C8F7F" }}> — {hint}</span>}
      </label>
      {children}
      {error && <div style={{ fontSize: 11.5, color: "#A6234A", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

const scannedFieldStyle = { borderColor: "#2F7A4F", background: "#F1F8F3" };

function inputStyle(error) {
  return {
    width: "100%", padding: "11px 12px", borderRadius: 10,
    border: error ? "1px solid #A6234A" : "1px solid #DED2C0",
    fontSize: 14.5, background: "#fff", color: "#2B2117",
  };
}