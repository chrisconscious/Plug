"use client";

import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { Plus, X, ChevronUp, ChevronDown, Banknote, Smartphone, ShieldAlert, Power, Trash2, Wallet, Pencil, Truck, MapPin, CreditCard, MessageSquareText } from "lucide-react";
import * as api from "../../lib/api";
import { formatTZS } from "../../lib/currency";
import { usePlatformSettings } from "../../lib/PlatformSettingsContext";
import { redirectToLoginExpired } from "../../lib/returnTo";
import { userMessage } from "../../lib/errors";

type EditorState =
  | { mode: "create" }
  | { mode: "edit"; id: string; kind: api.PaymentMethodKind; name: string; paymentNumber: string; instructions: string }
  | null;

function handleAuthError(e: unknown): boolean {
  if (e instanceof api.ApiError && e.status === 401) {
    api.logout().catch(() => {});
    redirectToLoginExpired();
    return true;
  }
  return false;
}

export function PaymentMethodsPage() {
  const { darEsSalaamFeeTzs, outsideDarFeeTzs, codMessage, loading: platformLoading, refresh: refreshPlatformSettings } = usePlatformSettings();
  const [methods, setMethods] = useState<api.PaymentMethod[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [editor, setEditor] = useState<EditorState>(null);
  const [busy, setBusy] = useState(false);
  const [iconTarget, setIconTarget] = useState<api.PaymentMethod | null>(null);

  // Delivery & Checkout settings (moved from the old Platform Branding module —
  // transport fees are charged by delivery location, the same whether the
  // customer pays online or on delivery).
  const [delivery, setDelivery] = useState<{ dar: string; outside: string; codMessage: string } | null>(null);
  const [deliveryUnsaved, setDeliveryUnsaved] = useState(false);
  const [savingDelivery, setSavingDelivery] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  // Seed the delivery form once the shared platform settings finish loading.
  // Only seeded while null — a later platform refresh never clobbers fee
  // values the admin is mid-edit on.
  useEffect(() => {
    if (delivery === null && !platformLoading) {
      setDelivery({ dar: String(darEsSalaamFeeTzs || 0), outside: String(outsideDarFeeTzs || 0), codMessage: codMessage ?? "" });
    }
  }, [delivery, platformLoading, darEsSalaamFeeTzs, outsideDarFeeTzs, codMessage]);

  const triggerIconUpload = (method: api.PaymentMethod) => {
    setIconTarget(method);
    requestAnimationFrame(() => {
      const el = document.getElementById("pm-icon-input") as HTMLInputElement | null;
      if (el) el.click();
    });
  };

  const onIconFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = iconTarget;
    e.target.value = "";
    setIconTarget(null);
    if (!file || !target) return;
    try {
      await api.uploadPaymentMethodIcon(target.id, file);
      flash(`${target.name} icon updated ✓`);
      await load();
    } catch (err) {
      if (handleAuthError(err)) return;
      fail(userMessage(err, "Could not upload icon."));
    }
  };

  const removeIcon = async (method: api.PaymentMethod) => {
    try {
      await api.removePaymentMethodIcon(method.id);
      flash(`${method.name} icon removed`);
      await load();
    } catch (err) {
      if (handleAuthError(err)) return;
      fail(userMessage(err, "Could not remove icon."));
    }
  };

  const load = useCallback(async () => {
    try {
      const r = await api.listAdminPaymentMethods();
      const sorted = [...r.methods].sort((a, b) => a.displayOrder - b.displayOrder);
      setMethods(sorted);
    } catch (e) {
      if (handleAuthError(e)) return;
      setError(userMessage(e, "Could not load payment methods"));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (text: string) => { setBanner({ text, tone: "ok" }); setTimeout(() => setBanner((b) => (b?.tone === "ok" && b.text === text ? null : b)), 3200); };
  // Failures stay until the next action so they can't be missed.
  const fail = (text: string) => setBanner({ text, tone: "error" });

  const cash = methods?.find((m) => m.kind === "CASH") ?? null;
  const online = methods?.filter((m) => m.kind === "ONLINE") ?? [];

  const saveDelivery = async () => {
    if (!delivery) return;
    // A cleared box must not silently become a free delivery fee.
    if (delivery.dar.trim() === "" || delivery.outside.trim() === "") {
      setDeliveryError("Enter both transport fees (use 0 for free delivery).");
      return;
    }
    const dar = Math.max(0, Math.round(Number(delivery.dar)));
    const outside = Math.max(0, Math.round(Number(delivery.outside)));
    setSavingDelivery(true);
    setDeliveryError(null);
    try {
      const updated = (await api.updatePlatformSettings({
        darEsSalaamFeeTzs: dar,
        outsideDarFeeTzs: outside,
        codMessage: delivery.codMessage.trim() || null,
      })).settings;
      setDelivery({ dar: String(updated.darEsSalaamFeeTzs), outside: String(updated.outsideDarFeeTzs), codMessage: updated.codMessage ?? "" });
      setDeliveryUnsaved(false);
      await refreshPlatformSettings(); // so Checkout.tsx reflects the new fees immediately
      flash("Delivery & checkout settings saved ✓");
    } catch (e) {
      if (handleAuthError(e)) return;
      setDeliveryError(userMessage(e, "Could not save delivery settings"));
    } finally { setSavingDelivery(false); }
  };

  const saveEditor = async (input: { kind: api.PaymentMethodKind; name: string; paymentNumber?: string; instructions?: string | null }) => {
    setBusy(true);
    try {
      if (editor?.mode === "edit") {
        await api.updateAdminPaymentMethod(editor.id, {
          name: input.name.trim(),
          paymentNumber: input.kind === "ONLINE" ? (input.paymentNumber ?? "").trim() || null : null,
          instructions: input.instructions ?? null,
        });
        flash("Payment method updated");
      } else {
        await api.createAdminPaymentMethod({
          kind: input.kind,
          name: input.name.trim(),
          paymentNumber: (input.paymentNumber ?? "").trim() || null,
          feeTzs: 0,
          instructions: input.instructions ?? null,
        });
        flash("Payment network added");
      }
      setEditor(null);
      await load();
    } catch (e) {
      if (handleAuthError(e)) return;
      fail(userMessage(e, "Could not save"));
    } finally { setBusy(false); }
  };

  const toggleActive = async (m: api.PaymentMethod) => {
    try {
      await api.updateAdminPaymentMethod(m.id, { isActive: !m.isActive });
      flash(`${m.name} ${m.isActive ? "paused" : "activated"}`);
      await load();
    } catch (e) {
      if (handleAuthError(e)) return;
      fail(userMessage(e, "Could not update"));
    }
  };

  const remove = async (m: api.PaymentMethod) => {
    if (!window.confirm(`Remove "${m.name}"? This cannot be undone.`)) return;
    try {
      await api.deleteAdminPaymentMethod(m.id);
      flash(`${m.name} removed`);
      await load();
    } catch (e) {
      if (handleAuthError(e)) return;
      fail(userMessage(e, "Could not remove"));
    }
  };

  // `idx` is the row's position among the ONLINE networks (the list the
  // buttons live in). Swap within that list, then rebuild the full order with
  // Cash on Delivery kept in its own slot.
  const move = async (dir: -1 | 1, idx: number) => {
    if (!methods) return;
    const nextOnline = methods.filter((m) => m.kind === "ONLINE");
    const j = idx + dir;
    if (j < 0 || j >= nextOnline.length) return;
    [nextOnline[idx], nextOnline[j]] = [nextOnline[j], nextOnline[idx]];
    let k = 0;
    const full = methods.map((m) => (m.kind === "ONLINE" ? nextOnline[k++] : m));
    try {
      const r = await api.reorderAdminPaymentMethods(full.map((m) => m.id));
      setMethods([...r.methods].sort((a, b) => a.displayOrder - b.displayOrder));
    } catch (e) {
      if (handleAuthError(e)) return;
      fail(userMessage(e, "Reorder failed"));
      await load();
    }
  };

  if (error && !methods) {
    return (
      <div style={{ padding: 40, fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <p style={{ color: "#c00", marginBottom: 12 }}>{error}</p>
        <button className="blackButton" onClick={() => { setError(null); load(); }}>RETRY</button>
      </div>
    );
  }
  if (!methods || delivery === null) {
    return <div style={{ padding: 40, color: "#71717a", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>Loading payments & transactions…</div>;
  }

  const chip = (k: api.PaymentMethodKind) => (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".5px", padding: "3px 8px", borderRadius: 999, background: k === "CASH" ? "#fde8e8" : "#e7eef8", color: k === "CASH" ? "#b91c1c" : "#1e4e8c" }}>
      {k === "CASH" ? "CASH ON DELIVERY" : "ONLINE"}
    </span>
  );

  const statusPill = (active: boolean) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, letterSpacing: ".3px", padding: "4px 10px", borderRadius: 999, background: active ? "#eafaf0" : "#f5f5f4", color: active ? "#15803d" : "#a8a29e", border: `1px solid ${active ? "#bbf7d0" : "#e7e5e4"}` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: active ? "#22c55e" : "#d6d3d1" }} />
      {active ? "ACTIVE" : "PAUSED"}
    </span>
  );

  const sectionLabel = (icon: ReactNode, title: string, sub: string) => (
    <div style={{ padding: "18px 20px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ width: 34, height: 34, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#f5f5f4", color: "#111" }}>{icon}</span>
      <div>
        <h3 style={{ font: "800 14px Manrope", margin: 0 }}>{title}</h3>
        <p style={{ fontSize: 11.5, color: "#888", margin: "2px 0 0" }}>{sub}</p>
      </div>
    </div>
  );

  const CashCard = () => {
    if (!cash) return (
      <div style={{ padding: 18, color: "#71717a", fontSize: 12 }}>
        No cash-on-delivery method configured.
      </div>
    );
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#fde8e8", color: "#b91c1c" }}>
            <Banknote size={18} />
          </span>
          <div>
            <b style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>{cash.name} {chip("CASH")}</b>
            <small style={{ display: "block", color: "#888", fontSize: 11, marginTop: 2 }}>
              {cash.isActive ? "Offered as a payment method at checkout" : "Hidden from checkout while paused"}
            </small>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            title={cash.isActive ? "Pause Cash on Delivery" : "Activate Cash on Delivery"}
            onClick={() => toggleActive(cash)}
            data-role="cash-toggle-active"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 11, fontWeight: 700, border: `1px solid ${cash.isActive ? "#dcfce7" : "#e7e5e4"}`, background: cash.isActive ? "#f0fdf4" : "#fafaf9", color: cash.isActive ? "#15803d" : "#a8a29e", borderRadius: 8, cursor: "pointer" }}
          >
            <Power size={13} /> {cash.isActive ? "Pause" : "Activate"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="management">
      <input
        id="pm-icon-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: "none" }}
        onChange={onIconFile}
      />

      {/* Hero header */}
      <div className="pmHero" style={{ display: "flex", alignItems: "center", gap: 14, padding: "22px 24px", background: "#111", color: "#fff", borderRadius: 16, marginBottom: 18 }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#fff", color: "#111" }}>
          <Wallet size={22} />
        </span>
        <div style={{ flex: 1 }}>
          <h2 style={{ font: "800 20px Manrope", margin: 0 }}>Payments &amp; Transactions</h2>
          <p style={{ fontSize: 12, color: "#c2c2c2", margin: "3px 0 0" }}>
            Transport fees applied at checkout and the payment methods your customers can use.
          </p>
        </div>
        <button className="blackButton" onClick={() => setEditor({ mode: "create" })} data-role="add-network" style={{ background: "#fff", color: "#111" }}>
          <Plus size={16} /> Add Payment Network
        </button>
      </div>

      {banner && (
        <div role={banner.tone === "error" ? "alert" : "status"} style={{ padding: "10px 14px", background: banner.tone === "error" ? "#fef2f2" : "#eef8f1", color: banner.tone === "error" ? "#b91c1c" : "#018849", fontSize: 12, marginBottom: 14, border: `1px solid ${banner.tone === "error" ? "#fecaca" : "#d5efe0"}`, borderRadius: 8 }}>
          {banner.text}
        </div>
      )}

      {/* Live overview strip */}
      <div className="pmStats">
        {[
          { icon: <Truck size={16} />, label: "Dar es Salaam transport", value: formatTZS(darEsSalaamFeeTzs || 0), tint: "#e7eef8", ink: "#1e4e8c" },
          { icon: <MapPin size={16} />, label: "Outside Dar transport", value: formatTZS(outsideDarFeeTzs || 0), tint: "#f0f1e8", ink: "#575c2f" },
          { icon: <CreditCard size={16} />, label: "Payment methods", value: `${online.filter((m) => m.isActive).length + (cash?.isActive ? 1 : 0)} active`, tint: "#eafaf0", ink: "#15803d" },
        ].map((s, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 14, padding: "16px 18px", display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: 10, display: "inline-flex", alignItems: "center", justifyContent: "center", background: s.tint, color: s.ink }}>{s.icon}</span>
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".4px", color: "#a1a1aa", textTransform: "uppercase" }}>{s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#18181b", marginTop: 2 }}>{s.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Delivery & Checkout (moved from Platform Branding) */}
      <section style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 16, overflow: "hidden", marginBottom: 18 }}>
        {sectionLabel(<Truck size={16} />, "Delivery & checkout", "Transport fees are charged by the customer's chosen delivery location — the same amount regardless of online or cash payment.")}
        <div style={{ padding: "20px" }}>
          <div className="pmFees">
            <div>
              <label htmlFor="pm-fee-dar" style={{ display: "block", fontSize: 11.5, fontWeight: 700, marginBottom: 6, color: "#3f3f46" }}>Dar es Salaam transport fee</label>
              <div style={{ display: "flex", alignItems: "center", border: `1px solid ${deliveryUnsaved ? "#111" : "#e4e4e7"}`, borderRadius: 10, overflow: "hidden", background: "#fafafa" }}>
                <span style={{ padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#71717a", background: "#f4f4f5", borderRight: "1px solid #e4e4e7" }}>TZS</span>
                <input
                  id="pm-fee-dar"
                  value={delivery.dar}
                  onChange={(e) => { setDelivery({ ...delivery, dar: e.target.value.replace(/[^0-9]/g, "") }); setDeliveryUnsaved(true); }}
                  inputMode="numeric"
                  placeholder="e.g. 5000"
                  style={{ flex: 1, border: "none", padding: "10px 12px", fontSize: 14, fontWeight: 700, color: "#18181b", outline: "none", background: "transparent" }}
                />
              </div>
              <small style={{ display: "block", marginTop: 5, fontSize: 10.5, color: "#a1a1aa" }}>Applies to every delivery inside Dar es Salaam.</small>
            </div>
            <div>
              <label htmlFor="pm-fee-outside" style={{ display: "block", fontSize: 11.5, fontWeight: 700, marginBottom: 6, color: "#3f3f46" }}>Outside Dar es Salaam transport fee</label>
              <div style={{ display: "flex", alignItems: "center", border: `1px solid ${deliveryUnsaved ? "#111" : "#e4e4e7"}`, borderRadius: 10, overflow: "hidden", background: "#fafafa" }}>
                <span style={{ padding: "10px 12px", fontSize: 12, fontWeight: 700, color: "#71717a", background: "#f4f4f5", borderRight: "1px solid #e4e4e7" }}>TZS</span>
                <input
                  id="pm-fee-outside"
                  value={delivery.outside}
                  onChange={(e) => { setDelivery({ ...delivery, outside: e.target.value.replace(/[^0-9]/g, "") }); setDeliveryUnsaved(true); }}
                  inputMode="numeric"
                  placeholder="e.g. 10000"
                  style={{ flex: 1, border: "none", padding: "10px 12px", fontSize: 14, fontWeight: 700, color: "#18181b", outline: "none", background: "transparent" }}
                />
              </div>
              <small style={{ display: "block", marginTop: 5, fontSize: 10.5, color: "#a1a1aa" }}>Applies to deliveries anywhere else in Tanzania.</small>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label htmlFor="pm-cod-message" style={{ display: "block", fontSize: 11.5, fontWeight: 700, marginBottom: 6, color: "#3f3f46" }}>
              Cash on Delivery message <small style={{ fontWeight: 400, color: "#a1a1aa" }}>— shown when a customer selects Cash on Delivery at checkout. Leave blank to use the default wording.</small>
            </label>
            <textarea
              id="pm-cod-message"
              value={delivery.codMessage}
              onChange={(e) => { setDelivery({ ...delivery, codMessage: e.target.value }); setDeliveryUnsaved(true); }}
              maxLength={500}
              placeholder="Please pay the transport fee first using any of the payment numbers below. You will pay the remaining order amount after your parcel is delivered."
              style={{ width: "100%", border: "1px solid #e4e4e7", borderRadius: 10, padding: "10px 12px", fontSize: 13, minHeight: 74, fontFamily: "inherit", resize: "vertical", outline: "none", background: "#fafafa" }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
              <span style={{ fontSize: 11, color: "#a1a1aa" }}>
                {deliveryUnsaved ? "You have unsaved changes." : "Fees apply to both online and cash orders."}
              </span>
              <button
                type="button"
                className="blackButton"
                disabled={savingDelivery}
                onClick={saveDelivery}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                {savingDelivery ? "Saving…" : "Save delivery & checkout"}
              </button>
            </div>
            {deliveryError && <p role="alert" style={{ color: "#c00", fontSize: 12, marginTop: 8 }}>{deliveryError}</p>}
          </div>
        </div>
      </section>

      {/* Payment methods */}
      <div className="pmCols">
        <section style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 16, overflow: "hidden" }}>
          {sectionLabel(<Banknote size={16} />, "Cash on delivery", "Pay in cash when the order arrives.")}
          <CashCard />
          <div style={{ padding: "14px 20px", borderTop: "1px dashed #ececec", display: "flex", gap: 10, alignItems: "center", background: "#fafaf9" }}>
            <ShieldAlert size={15} style={{ color: "#b45309", flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: 11.5, color: "#71717a" }}>
              Cash on Delivery can't be removed — pause it to hide it from checkout. Its transport fee is set above under <b>Delivery &amp; checkout</b>.
            </p>
          </div>
        </section>

        <section style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 16, overflow: "hidden" }}>
          {sectionLabel(<Smartphone size={16} />, "Mobile money networks", "Online payment options customers can choose at checkout.")}

          {online.length === 0 ? (
            <div style={{ padding: "22px 20px", textAlign: "center" }}>
              <span style={{ display: "inline-flex", width: 44, height: 44, borderRadius: 12, background: "#f4f4f5", color: "#a1a1aa", alignItems: "center", justifyContent: "center", marginBottom: 10 }}><Smartphone size={20} /></span>
              <p style={{ margin: 0, fontSize: 12.5, color: "#71717a", fontWeight: 600 }}>No online networks yet</p>
              <p style={{ margin: "4px 0 14px", fontSize: 11.5, color: "#a1a1aa" }}>Add M-Pesa, Tigo Pesa, Airtel Money or similar to accept mobile money.</p>
              <button className="blackButton" onClick={() => setEditor({ mode: "create" })}><Plus size={14} /> Add your first network</button>
            </div>
          ) : (
            online.map((m, i) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 20px", borderTop: i === 0 ? "none" : "1px solid #f0f0f0" }}>
                <span style={{ width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: m.iconUrl ? "#fff" : "#e7eef8", color: "#1e4e8c", overflow: "hidden", border: "1px solid #e8e8e8" }}>
                  {m.iconUrl ? <img src={api.assetUrl(m.iconUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Smartphone size={17} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <b style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</b>
                    {statusPill(m.isActive)}
                  </div>
                  <small style={{ display: "block", color: "#888", fontSize: 11, marginTop: 2, }}>{m.paymentNumber ?? "—"}</small>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 10, color: "#a1a1aa", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>#{m.displayOrder}</span>
                  <button title="Move up" aria-label={`Move ${m.name} up`} onClick={() => move(-1, i)} disabled={i === 0}><ChevronUp size={15} /></button>
                  <button title="Move down" aria-label={`Move ${m.name} down`} onClick={() => move(1, i)} disabled={i === online.length - 1}><ChevronDown size={15} /></button>
                  <button title="Edit" aria-label={`Edit ${m.name}`} onClick={() => setEditor({ mode: "edit", id: m.id, kind: "ONLINE", name: m.name, paymentNumber: m.paymentNumber ?? "", instructions: m.instructions ?? "" })} data-role="edit-network"><Pencil size={14} /></button>
                  <button title={m.isActive ? "Pause" : "Activate"} aria-label={`${m.isActive ? "Pause" : "Activate"} ${m.name}`} data-role="toggle-network" onClick={() => toggleActive(m)} style={{ color: m.isActive ? "#16a34a" : "#9ca3af" }}><Power size={15} /></button>
                  <button title={m.iconUrl ? "Replace icon" : "Upload icon"} aria-label={`${m.iconUrl ? "Replace" : "Upload"} icon for ${m.name}`} onClick={() => triggerIconUpload(m)}><Plus size={15} /></button>
                  {m.iconUrl && <button title="Remove icon" aria-label={`Remove icon from ${m.name}`} onClick={() => removeIcon(m)}><X size={15} /></button>}
                  <button title="Remove" aria-label={`Remove ${m.name}`} onClick={() => remove(m)} style={{ color: "#e5484d" }}><Trash2 size={15} /></button>
                </div>
              </div>
            ))
          )}

          <div style={{ padding: "14px 20px", borderTop: "1px dashed #ececec", display: "flex", gap: 10, alignItems: "center", background: "#fafaf9" }}>
            <MessageSquareText size={15} style={{ color: "#1e4e8c", flexShrink: 0 }} />
            <p style={{ margin: 0, fontSize: 11.5, color: "#71717a" }}>
              Networks appear in this order at checkout — top is most preferred. Uploading an icon shows the network's logo; otherwise a generic phone chip is used.
            </p>
          </div>
        </section>
      </div>

      {editor && (
        <PaymentEditor
          key={editor.mode === "edit" ? editor.id : "new"}
          mode={editor.mode}
          initial={editor.mode === "edit" ? { id: editor.id, kind: editor.kind, name: editor.name, paymentNumber: editor.paymentNumber, instructions: editor.instructions } : { id: "", kind: "ONLINE", name: "", paymentNumber: "", instructions: "" }}
          busy={busy}
          onClose={() => setEditor(null)}
          onSave={saveEditor}
        />
      )}
    </div>
  );
}

function PaymentEditor({ mode, initial, busy, onClose, onSave }: {
  mode: "create" | "edit";
  initial: { id: string; kind: api.PaymentMethodKind; name: string; paymentNumber: string; instructions: string };
  busy: boolean;
  onClose: () => void;
  onSave: (i: { kind: api.PaymentMethodKind; name: string; paymentNumber?: string; instructions?: string | null }) => void;
}) {
  const [kind, setKind] = useState<api.PaymentMethodKind>(initial.kind);
  const [name, setName] = useState(initial.name);
  const [number, setNumber] = useState(initial.paymentNumber);
  const [instructions, setInstructions] = useState(initial.instructions);
  const [err, setErr] = useState<string | null>(null);

  const submit = () => {
    if (kind === "CASH" && mode === "create") { setErr("Cash On Delivery already exists — pause it from the payment methods list instead."); return; }
    if (!name.trim()) { setErr("Please enter a name."); return; }
    if (kind === "ONLINE" && !number.trim()) { setErr("Please enter the network's payment number."); return; }
    onSave({ kind, name, paymentNumber: number, instructions: instructions.trim() || null });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div style={{ background: "#fff", width: "100%", maxWidth: 460, borderRadius: 16, padding: 24, position: "relative" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 14, right: 14, border: "none", background: "none", cursor: "pointer", color: "#71717a" }}><X size={18} /></button>
        <h3 style={{ font: "800 18px Manrope", margin: "0 0 4px" }}>{mode === "edit" ? "Edit Payment Network" : "Add Payment Network"}</h3>
        <p style={{ fontSize: 11.5, color: "#888", margin: "0 0 18px" }}>{mode === "edit" ? "Update how this network appears to customers." : "Add a mobile-money network your customers can pay with."}</p>

        <div style={{ display: "grid", gap: 14 }}>
          {mode === "create" ? (
            <div style={{ display: "flex", gap: 8 }}>
              {(["ONLINE", "CASH"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  data-role="pm-kind"
                  data-kind={k}
                  onClick={() => setKind(k)}
                  style={{ flex: 1, padding: "10px 0", fontSize: 12, fontWeight: 700, cursor: "pointer", borderRadius: 10, border: `1px solid ${kind === k ? "#111" : "#e4e4e7"}`, background: kind === k ? "#111" : "#fff", color: kind === k ? "#fff" : "#3f3f46" }}
                  disabled={k === "CASH"}
                >
                  {k === "CASH" ? "Cash on Delivery" : "Online Network"}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#888" }}>Type:</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: kind === "CASH" ? "#fde8e8" : "#e7eef8", color: kind === "CASH" ? "#b91c1c" : "#1e4e8c" }}>
                {kind === "CASH" ? "CASH ON DELIVERY" : "ONLINE NETWORK"}
              </span>
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#3f3f46" }}>Name</label>
            <input data-role="pm-name" style={{ width: "100%", border: "1px solid #e4e4e7", borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none" }} value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "CASH" ? "Cash on Delivery" : "e.g. M-Pesa (Lipa Kwa Namba)"} />
          </div>

          {kind === "ONLINE" && (
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#3f3f46" }}>Payment number <small style={{ fontWeight: 400, color: "#a1a1aa" }}>(required)</small></label>
              <input data-role="pm-number" style={{ width: "100%", border: "1px solid #e4e4e7", borderRadius: 10, padding: "10px 12px", fontSize: 13, outline: "none" }} value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+255 7XX XXX XXX" />
            </div>
          )}

          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 600, marginBottom: 5, color: "#3f3f46" }}>
              Payment instructions <small style={{ fontWeight: 400, color: "#a1a1aa" }}>(optional — shown instead of the generic "send to the number above" hint)</small>
            </label>
            <textarea
              data-role="pm-instructions"
              style={{ width: "100%", border: "1px solid #e4e4e7", borderRadius: 10, padding: "10px 12px", fontSize: 12.5, minHeight: 64, fontFamily: "inherit", resize: "vertical", outline: "none" }}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              maxLength={500}
              placeholder="e.g. Include your order number as the payment reference."
            />
          </div>

          {err && <div style={{ color: "#c00", fontSize: 11.5 }}>{err}</div>}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button className="blackButton" style={{ flex: 1 }} disabled={busy} onClick={submit} data-role="pm-save">{busy ? "Saving..." : "Save"}</button>
          <button style={{ flex: 1, border: "1px solid #e4e4e7", background: "#fff", borderRadius: 10, padding: "11px 13px", fontSize: 11.5, fontWeight: 600, cursor: "pointer" }} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}