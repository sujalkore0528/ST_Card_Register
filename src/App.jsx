import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search, Plus, Pencil, Trash2, X, Users, User, GraduationCap,
  Accessibility, Bus, MapPin, Phone, CreditCard, Heart, Sparkles,
  AlertTriangle, Wifi, WifiOff, PackageCheck, PackageX,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

const SITE_PASSWORD = "Aditya";
const AUTH_KEY = "st_card_authed";

const CATEGORIES = [
  { key: "female", label: "Female", icon: User, color: "#A6234A" },
  { key: "student", label: "Student", icon: GraduationCap, color: "#B8860B" },
  { key: "handicapped", label: "Handicapped", icon: Accessibility, color: "#2F7A4F" },
  { key: "senior", label: "Senior Citizen", icon: Heart, color: "#5B4B8A" },
  { key: "amrut", label: "Amrut SCT", icon: Sparkles, color: "#C1622D" },
];

const emptyForm = { name: "", mobile: "", cardNumber: "", village: "", category: "female" };

// Map DB row (snake_case) <-> app object (camelCase)
const fromRow = (r) => ({
  id: r.id,
  name: r.name,
  mobile: r.mobile,
  cardNumber: r.card_number,
  village: r.village,
  category: r.category,
  delivered: r.delivered,
  createdAt: r.created_at,
});
const toRow = (c) => ({
  name: c.name,
  mobile: c.mobile,
  card_number: c.cardNumber,
  village: c.village,
  category: c.category,
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
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterDelivery, setFilterDelivery] = useState("all");
  const [errors, setErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);

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

  useEffect(() => {
    fetchCustomers();
    const channel = supabase
      .channel("customers-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, () => {
        fetchCustomers();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchCustomers]);

  const openAddForm = () => {
    setForm(emptyForm);
    setErrors({});
    setEditingId(null);
    setShowForm(true);
  };

  const openEditForm = (c) => {
    setForm({ name: c.name, mobile: c.mobile, cardNumber: c.cardNumber, village: c.village, category: c.category });
    setErrors({});
    setEditingId(c.id);
    setShowForm(true);
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = "Name required";
    if (!form.mobile.trim()) e.mobile = "Number required";
    else if (!/^\d{10}$/.test(form.mobile.trim())) e.mobile = "Enter 10-digit number";
    if (!form.cardNumber.trim()) e.cardNumber = "Card number required";
    if (!form.village.trim()) e.village = "Village required";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSaving(true);
    const payload = { ...form, name: form.name.trim(), village: form.village.trim() };

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

  const filtered = useMemo(() => {
    return customers.filter((c) => {
      const matchesCat = filterCategory === "all" || c.category === filterCategory;
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
      return matchesCat && matchesDelivery && matchesSearch;
    });
  }, [customers, search, filterCategory, filterDelivery]);

  const counts = useMemo(() => {
    const c = {};
    CATEGORIES.forEach((cat) => (c[cat.key] = 0));
    customers.forEach((cu) => { if (c[cu.category] !== undefined) c[cu.category]++; });
    return c;
  }, [customers]);

  const catMeta = (key) => CATEGORIES.find((c) => c.key === key) || CATEGORIES[0];

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
      `}</style>

      <header style={{ background: "#8B1A1A", color: "#F5F1E8", padding: "20px 16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 900, margin: "0 auto" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#F5F1E8", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Bus size={22} color="#8B1A1A" />
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, letterSpacing: -0.2 }}>ST Card Register</h1>
            <p style={{ margin: 0, fontSize: 12.5, color: "#EAD9CE", opacity: 0.9 }}>Maharashtra State Transport · Card holder records</p>
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

            <Field label="Full name" error={errors.name}>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kirti Patil" style={inputStyle(errors.name)} />
            </Field>

            <Field label="Mobile number" error={errors.mobile}>
              <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} placeholder="10-digit number" inputMode="numeric" style={inputStyle(errors.mobile)} />
            </Field>

            <Field label="Card number" error={errors.cardNumber}>
              <input value={form.cardNumber} onChange={(e) => setForm({ ...form, cardNumber: e.target.value })} placeholder="e.g. ST-2026-00123" style={inputStyle(errors.cardNumber)} />
            </Field>

            <Field label="Village" error={errors.village}>
              <input value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} placeholder="e.g. Wadgaon" style={inputStyle(errors.village)} />
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
                      onClick={() => setForm({ ...form, category: cat.key })}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10,
                        border: active ? `2px solid ${cat.color}` : "1px solid #DED2C0",
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

function Field({ label, error, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#6B5D4F", marginBottom: 5 }}>{label}</label>
      {children}
      {error && <div style={{ fontSize: 11.5, color: "#A6234A", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

function inputStyle(error) {
  return {
    width: "100%", padding: "11px 12px", borderRadius: 10,
    border: error ? "1px solid #A6234A" : "1px solid #DED2C0",
    fontSize: 14.5, background: "#fff", color: "#2B2117",
  };
}
