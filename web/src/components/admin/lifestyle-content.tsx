"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  listAdminLifestyles,
  createAdminLifestyle,
  updateAdminLifestyle,
  deleteAdminLifestyle,
  uploadLifestyleHero,
  removeLifestyleHero,
  type Lifestyle,
} from "../../lib/api";
import { resolveImage } from "../../lib/imagePlaceholder";

/**
 * "Shop by Lifestyle" taxonomy management (SUPER_ADMIN only, RBAC
 * `lifestyles.manage`). Real database rows + real hero image uploads. The
 * server enforces the activation invariant (a lifestyle needs a hero image to
 * go live) and blocks deleting a lifestyle that still has products assigned —
 * both come back as friendly toasts with the exact server message.
 */

type Toast = { id: number; kind: "ok" | "err"; msg: string };

export function LifestyleManagementPage() {
  const [lifestyles, setLifestyles] = useState<Lifestyle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; lifestyle: Lifestyle | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lifestyle | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, kind, msg }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);

  const refresh = useCallback(async () => {
    const r = await listAdminLifestyles();
    setLifestyles(r.items);
  }, []);

  useEffect(() => {
    let mounted = true;
    listAdminLifestyles()
      .then((r) => {
        if (!mounted) return;
        setLifestyles(r.items);
        setLoading(false);
      })
      .catch((e) => {
        if (!mounted) return;
        setLoadError((e as Error)?.message ?? "Could not load lifestyles.");
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const sorted = useMemo(
    () => [...lifestyles].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0)),
    [lifestyles]
  );
  const activeCount = useMemo(() => lifestyles.filter((l) => l.active).length, [lifestyles]);
  const totalProducts = useMemo(() => lifestyles.reduce((s, l) => s + (l.productCount ?? 0), 0), [lifestyles]);

  const toggleActive = async (l: Lifestyle) => {
    if (busyId) return;
    const prev = l.active ?? false;
    setBusyId(l.id);
    setLifestyles((prevList) => prevList.map((x) => (x.id === l.id ? { ...x, active: !prev } : x)));
    try {
      const r = await updateAdminLifestyle(l.id, { active: !prev });
      setLifestyles((prevList) => prevList.map((x) => (x.id === l.id ? r.lifestyle : x)));
      toast(r.lifestyle.active ? `“${l.name}” is now live on the storefront.` : `“${l.name}” is now a draft.`);
    } catch (e) {
      setLifestyles((prevList) => prevList.map((x) => (x.id === l.id ? { ...x, active: prev } : x)));
      toast((e as Error)?.message ?? "Could not update status.", "err");
    } finally {
      setBusyId(null);
    }
  };

  const move = async (i: number, dir: 1 | -1) => {
    if (busyId) return;
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const a = sorted[i];
    const b = sorted[j];
    const aOrder = a.displayOrder ?? 0;
    const bOrder = b.displayOrder ?? 0;
    setBusyId(a.id);
    // Optimistic swap of the local order, then reconcile with the server.
    setLifestyles((prevList) =>
      prevList.map((x) => (x.id === a.id ? { ...x, displayOrder: bOrder } : x.id === b.id ? { ...x, displayOrder: aOrder } : x))
    );
    try {
      const ra = await updateAdminLifestyle(b.id, { displayOrder: aOrder });
      const rb = await updateAdminLifestyle(a.id, { displayOrder: bOrder });
      setLifestyles((prevList) =>
        prevList.map((x) => (x.id === rb.lifestyle.id ? rb.lifestyle : x.id === ra.lifestyle.id ? ra.lifestyle : x))
      );
    } catch (e) {
      await refresh().catch(() => {});
      toast(`Reorder failed: ${(e as Error)?.message ?? "unknown error"}`, "err");
    } finally {
      setBusyId(null);
    }
  };

  const runDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteAdminLifestyle(deleteTarget.id);
      setLifestyles((prevList) => prevList.filter((x) => x.id !== deleteTarget.id));
      toast(`Lifestyle “${deleteTarget.name}” deleted. Products in it stay in the catalog.`);
      setDeleteTarget(null);
    } catch (e) {
      toast(`Delete blocked: ${(e as Error)?.message ?? "unknown error"}`, "err");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

  return (
    <div className="lsadm management">
      {/* Strong page header */}
      <div className="lsadm-header">
        <div>
          <p className="lsadm-eyebrow">Storefront taxonomy</p>
          <h1 className="lsadm-title">Shop by Lifestyle</h1>
          <p className="lsadm-sub">
            Curated edits shown on the homepage. Each lifestyle needs a real hero image to be published; deleting one
            is blocked while products are assigned to it.
          </p>
        </div>
        <div className="lsadm-head-actions">
          <button className="blackButton" onClick={() => setEditor({ mode: "create", lifestyle: null })}>
            <Plus size={15} style={{ verticalAlign: -2, marginRight: 6 }} /> Add Lifestyle
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="lsadm-stats">
        <div className="lsadm-stat">
          <span className="lsadm-stat-ic">
            <ImageIcon size={16} />
          </span>
          <span>
            <b>{lifestyles.length}</b>
            <span>Lifestyles</span>
          </span>
        </div>
        <div className="lsadm-stat">
          <span className="lsadm-stat-ic">
            <CheckCircle2 size={16} />
          </span>
          <span>
            <b>{activeCount}</b>
            <span>Live on storefront</span>
          </span>
        </div>
        <div className="lsadm-stat">
          <span className="lsadm-stat-ic">
            <Upload size={16} />
          </span>
          <span>
            <b>{totalProducts}</b>
            <span>Products linked</span>
          </span>
        </div>
      </div>

      {loadError ? (
        <div className="lsadm-error" style={{ marginTop: 16 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>{loadError}</span>
          <button
            onClick={() => {
              setLoading(true);
              setLoadError(null);
              refresh().then(() => setLoading(false)).catch((e) => setLoadError((e as Error)?.message ?? "Could not load.")).finally(() => setLoading(false));
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="lsadm-panel">
          <div className="lsadm-toolbar">
            <div>
              <h3>All lifestyles</h3>
              <p>
                Display order runs top-to-bottom; lower numbers appear first on the homepage.
              </p>
            </div>
            <span className="lsadm-count" style={{ fontSize: 12, color: "#9ca3af" }}>
              {sorted.length} total
            </span>
          </div>

          {loading ? (
            <div role="status" aria-label="Loading lifestyles">
              {Array.from({ length: 5 }).map((_, i) => (
                <div className="lsadm-skeleton" key={i}>
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="lsadm-empty">
              <ImageIcon size={34} style={{ opacity: 0.4 }} />
              <b>No lifestyles yet</b>
              <p>
                Create your first edit — add a hero image and publish it to appear in “Shop by Lifestyle” on the
                homepage.
              </p>
              <button className="blackButton" onClick={() => setEditor({ mode: "create", lifestyle: null })}>
                <Plus size={15} style={{ verticalAlign: -2, marginRight: 6 }} /> Add Lifestyle
              </button>
            </div>
          ) : (
            <div className="lsadm-table">
              <div className="lsadm-thead">
                <span>Lifestyle</span>
                <span>Status</span>
                <span>Display order</span>
                <span>Products</span>
                <span>Updated</span>
                <span style={{ textAlign: "right" }}>Actions</span>
              </div>
              {sorted.map((l, i) => (
                <div className="lsadm-trow" key={l.id}>
                  {/* Lifestyle */}
                  <div className="lsadm-item">
                    <span className="lsadm-thumb">
                      {l.heroImageUrl ? (
                        <img src={resolveImage(l.heroImageUrl)} alt={l.name || "Lifestyle hero image"} loading="lazy" />
                      ) : (
                        <span className="lsadm-thumb-missing">
                          <ImageIcon size={16} />
                        </span>
                      )}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span className="lsadm-name">{l.name}</span>
                      <span className="lsadm-slug">/{l.slug}</span>
                      {l.active && !l.heroImageUrl ? (
                        <span className="lsadm-warn">
                          <AlertTriangle size={11} /> Needs a hero image
                        </span>
                      ) : null}
                    </span>
                  </div>

                  {/* Status */}
                  <div className="lsadm-item">
                    <span className={`lsadm-pill ${l.active ? "on" : "off"}`}>
                      <span className="dot" />
                      {l.active ? "Live" : "Draft"}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={l.active ?? false}
                      aria-label={`${l.active ? "Unpublish" : "Publish"} ${l.name}`}
                      className={`lsadm-switch ${l.active ? "on" : ""}`}
                      onClick={() => toggleActive(l)}
                      disabled={busyId !== null}
                    />
                  </div>

                  {/* Display order */}
                  <div className="lsadm-order">
                    <span className="lsadm-order-num">{l.displayOrder ?? 0}</span>
                    <span className="lsadm-stepper">
                      <button
                        type="button"
                        aria-label={`Move ${l.name} up`}
                        onClick={() => move(i, -1)}
                        disabled={busyId !== null || i === 0}
                      >
                        <ChevronUp size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${l.name} down`}
                        onClick={() => move(i, 1)}
                        disabled={busyId !== null || i === sorted.length - 1}
                      >
                        <ChevronDown size={14} />
                      </button>
                    </span>
                  </div>

                  {/* Products */}
                  <div>
                    <span className="lsadm-count">{l.productCount ?? 0}</span>
                    <span className="lsadm-count-sub">
                      {l.productCount === 1 ? "product" : "products"} linked
                    </span>
                  </div>

                  {/* Updated */}
                  <span className="lsadm-date">{formatDate(l.updatedAt)}</span>

                  {/* Actions */}
                  <div className="lsadm-actions" style={{ justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="lsadm-ghost"
                      onClick={() => setEditor({ mode: "edit", lifestyle: l })}
                    >
                      <Pencil size={13} /> Edit
                    </button>
                    <button
                      type="button"
                      className="lsadm-ghost danger"
                      onClick={() => setDeleteTarget(l)}
                      disabled={busyId !== null}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {editor && (
        <LifestyleEditor
          mode={editor.mode}
          lifestyle={editor.lifestyle}
          nextOrder={Math.max(0, ...lifestyles.map((l) => l.displayOrder ?? 0)) + 1}
          onClose={() => setEditor(null)}
          onSaved={async (updates, wasNew) => {
            if (wasNew) {
              await refresh().catch(() => {});
              toast(`Lifestyle “${updates?.name ?? ""}” created.`);
            } else if (updates) {
              setLifestyles((prev) => prev.map((x) => (x.id === updates.id ? updates : x)));
              toast(`Lifestyle “${updates.name}” saved.`);
            }
            setEditor(null);
          }}
        />
      )}

      {/* Delete confirmation — deleting never touches the products themselves. */}
      {deleteTarget && (
        <div className="lsadm-modal" onMouseDown={(e) => e.target === e.currentTarget && !deleting && setDeleteTarget(null)}>
          <div className="lsadm-modal-card" style={{ width: 440 }}>
            <div className="lsadm-modal-head">
              <div>
                <h3 className="lsadm-modal-title">Delete “{deleteTarget.name}”?</h3>
                <p className="lsadm-modal-sub">
                  Products stay in the catalog — only the lifestyle and its links are removed. If products are still
                  assigned, the server blocks the deletion.
                </p>
              </div>
              <button className="iconBtn" aria-label="Close" onClick={() => !deleting && setDeleteTarget(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="lsadm-modal-foot">
              <button className="lsadm-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="lsadm-ghost danger" onClick={runDelete} disabled={deleting}>
                {deleting ? <span className="lsadm-spin dark" /> : null}
                {deleting ? "Deleting…" : "Delete lifestyle"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="lsadm-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div className={`lsadm-toast ${t.kind}`} key={t.id}>
            {t.kind === "ok" ? <CheckCircle2 size={16} style={{ marginTop: 1 }} /> : <AlertTriangle size={16} style={{ marginTop: 1 }} />}
            <span>{t.msg}</span>
            <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LifestyleEditor({
  mode,
  lifestyle,
  nextOrder,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  lifestyle: Lifestyle | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: (updates: Lifestyle | null, wasNew: boolean) => void;
}) {
  const [name, setName] = useState(lifestyle?.name ?? "");
  const [slug, setSlug] = useState(lifestyle?.slug ?? "");
  const [shortDescription, setShortDescription] = useState(lifestyle?.shortDescription ?? "");
  const [displayOrder, setDisplayOrder] = useState(String(lifestyle?.displayOrder ?? nextOrder));
  const [active, setActive] = useState(lifestyle?.active ?? false);
  const [imageUrl, setImageUrl] = useState(lifestyle?.heroImageUrl ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(lifestyle?.heroImageUrl ? resolveImage(lifestyle.heroImageUrl) : null);
  const [over, setOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const objUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving && !uploading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
    };
  }, [onClose, saving, uploading]);

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) {
      setErr("Only PNG, JPEG or WebP images are allowed.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setErr("Image is too large — keep it under 10 MB.");
      return;
    }
    if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
    const url = URL.createObjectURL(f);
    objUrlRef.current = url;
    setErr(null);
    setFile(f);
    setPreview(url);
  };

  const removeImage = async () => {
    if (!lifestyle) return;
    try {
      const r = await removeLifestyleHero(lifestyle.id);
      setImageUrl("");
      setFile(null);
      if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
      objUrlRef.current = null;
      setPreview(null);
      setErr(null);
      onSaved(r.lifestyle, false);
    } catch (e) {
      setErr((e as Error)?.message ?? "Remove failed. Deactivate the lifestyle before removing its image.");
    }
  };

  const save = async () => {
    setErr(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setErr("Lifestyle name is required.");
      return;
    }
    if (active && !file && !imageUrl) {
      setErr("Publishing requires a hero image — upload one or save as a draft.");
      return;
    }

    const patch = {
      name: trimmed,
      slug: slug.trim() || undefined,
      shortDescription: shortDescription.trim() !== "" ? shortDescription.trim() : undefined,
      displayOrder: Number(displayOrder) || 0,
    };

    try {
      if (mode === "create") {
        setSaving(true);
        // Create as a draft so a real id exists, attach the hero, then publish
        // only if the admin asked for it AND a real image is present.
        const created = await createAdminLifestyle({ ...patch, active: false });
        let final = created.lifestyle;
        if (file) {
          setUploading(true);
          final = (await uploadLifestyleHero(created.lifestyle.id, file)).lifestyle;
        }
        if (active) final = (await updateAdminLifestyle(created.lifestyle.id, { active: true })).lifestyle;
        onSaved(final, true);
      } else {
        if (!lifestyle) return;
        setSaving(true);
        let final = (await updateAdminLifestyle(lifestyle.id, { ...patch, active })).lifestyle;
        if (file) {
          setUploading(true);
          final = (await uploadLifestyleHero(lifestyle.id, file)).lifestyle;
        }
        onSaved(final, false);
      }
    } catch (e) {
      setErr((e as Error)?.message ?? "Save failed.");
    } finally {
      setUploading(false);
      setSaving(false);
    }
  };

  const busy = saving || uploading;

  return (
    <div className="lsadm-modal" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="lsadm-modal-card" role="dialog" aria-modal="true" aria-label={mode === "create" ? "New lifestyle" : "Edit lifestyle"}>
        <div className="lsadm-modal-head">
          <div>
            <h3 className="lsadm-modal-title">{mode === "create" ? "New lifestyle" : `Edit — ${lifestyle?.name ?? ""}`}</h3>
            <p className="lsadm-modal-sub">
              {mode === "create"
                ? "Created as a draft; keep it unpublished until a hero image is ready."
                : "Changes take effect on the storefront immediately."}
            </p>
          </div>
          <button className="iconBtn" aria-label="Close" onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className="lsadm-modal-body">
          {err && (
            <div className="lsadm-error">
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span>{err}</span>
            </div>
          )}

          {/* Hero image — drag & drop, browse, preview, replace */}
          <div className="lsadm-field">
            <span className="lsadm-label">Hero image (required to publish)</span>
            <div
              className={`lsadm-dropzone ${over ? "over" : ""} ${preview ? "has-img" : ""}`}
              style={{ aspectRatio: "21 / 9" }}
              onClick={() => !busy && fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                if (!busy) pickFile(e.dataTransfer.files?.[0]);
              }}
              role="button"
              tabIndex={0}
              aria-label="Upload or replace lifestyle hero image"
            >
              {preview ? <img src={preview} alt="Hero preview" /> : null}
              {busy ? (
                <span className="lsadm-drop-overlay">
                  <span className="lsadm-spin dark" />
                  {uploading ? "Uploading image…" : "Saving…"}
                </span>
              ) : (
                <span className="lsadm-dropzone-hint">
                  <Upload size={20} style={{ color: "#9ca3af" }} />
                  <b>{file ? "Replace preview" : imageUrl ? "Replace image" : "Drop image here or browse"}</b>
                  <span>PNG, JPEG or WebP · landscape recommended · up to 10 MB</span>
                </span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: "none" }}
                onChange={(e) => {
                  pickFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            {preview && mode === "edit" && !file ? (
              <button
                type="button"
                onClick={removeImage}
                disabled={busy}
                style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", background: "none", border: 0, cursor: busy ? "default" : "pointer", padding: 0 }}
              >
                Remove image
              </button>
            ) : null}
          </div>

          <div className="lsadm-grid2">
            <div className="lsadm-field">
              <span className="lsadm-label">Name</span>
              <input className="lsadm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Campus Life" disabled={busy} />
            </div>
            <div className="lsadm-field">
              <span className="lsadm-label">Slug (URL key)</span>
              <input className="lsadm-input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto from name" disabled={busy} />
            </div>
          </div>

          <div className="lsadm-field">
            <span className="lsadm-label">Short description</span>
            <textarea
              className="lsadm-input lsadm-textarea"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="One-line description shown on the storefront (optional)"
              disabled={busy}
            />
          </div>

          <div className="lsadm-grid2">
            <div className="lsadm-field">
              <span className="lsadm-label">Display order (lower = earlier)</span>
              <input
                className="lsadm-input"
                type="number"
                min={0}
                value={displayOrder}
                onChange={(e) => setDisplayOrder(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="lsadm-field">
              <span className="lsadm-label">Status</span>
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: busy ? "default" : "pointer" }}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={active}
                  className={`lsadm-switch ${active ? "on" : ""}`}
                  onClick={() => setActive((a) => !a)}
                  disabled={busy}
                  style={{ cursor: busy ? "default" : "pointer" }}
                />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#3f3f3b" }}>
                  {active ? "Live on storefront" : "Draft"}
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="lsadm-modal-foot">
          <span className="lsadm-modal-sub" style={{ margin: 0 }}>
            {mode === "edit" && lifestyle?.heroImageUrl && file
              ? "A new image will replace the current one on save."
              : ""}
          </span>
          <span className="spacer" />
          <button className="lsadm-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="blackButton" onClick={save} disabled={busy}>
            {busy ? <span className="lsadm-spin" /> : null}
            {uploading ? "Uploading…" : saving ? "Saving…" : mode === "create" ? "Create lifestyle" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}