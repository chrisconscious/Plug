"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Pencil,
  Plus,
  Trash2,
  X,
  Video,
} from "lucide-react";
import {
  listAdminHeroSlides,
  createAdminHeroSlide,
  updateAdminHeroSlide,
  deleteAdminHeroSlide,
  reorderAdminHeroSlides,
  uploadHeroImage,
  removeHeroImage,
  uploadHeroVideo,
  removeHeroVideo,
  type HeroSlide,
  type HeroSlideDraft,
  type HeroType,
} from "../../lib/api";
import { resolveImage } from "../../lib/imagePlaceholder";

const HERO_TYPES: { value: HeroType; label: string; hint: string }[] = [
  { value: "promotional", label: "Promotional", hint: "Big product CTA banner" },
  { value: "lifestyle", label: "Lifestyle", hint: "Clean editorial, left-aligned" },
  { value: "editorial", label: "Editorial", hint: "Magazine typographic centerpiece" },
];

type SlideStatus = "live" | "scheduled" | "expired" | "hidden";

function slideStatus(s: HeroSlide): SlideStatus {
  const now = Date.now();
  const start = s.startDate ? new Date(s.startDate).getTime() : null;
  const end = s.endDate ? new Date(s.endDate).getTime() : null;
  if (!s.isActive) return "hidden";
  if (start && now < start) return "scheduled";
  if (end && now > end) return "expired";
  return "live";
}

const STATUS_META: Record<SlideStatus, { label: string; color: string }> = {
  live: { label: "Live", color: "#16a34a" },
  scheduled: { label: "Scheduled", color: "#d97706" },
  expired: { label: "Expired", color: "#94a3b8" },
  hidden: { label: "Hidden", color: "#64748b" },
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function HeroContentPage() {
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ mode: "create" | "edit"; slide: HeroSlide | null } | null>(null);

  const refresh = useCallback(async () => {
    const r = await listAdminHeroSlides();
    setSlides(r.slides);
  }, []);

  const loadSlides = useCallback(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    listAdminHeroSlides()
      .then((r) => {
        if (!mounted) return;
        setSlides(r.slides);
        setLoading(false);
      })
      .catch((e) => {
        if (!mounted) return;
        setError(e?.message ?? "Could not load hero advertisements.");
        setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  useEffect(loadSlides, [loadSlides]);

  const onReorder = async (id: string, dir: number) => {
    try {
      const ordered = slides.map((s) => s.id);
      const i = ordered.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ordered.length) return;
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      const r = await reorderAdminHeroSlides(ordered);
      setSlides(r.slides);
    } catch (e) {
      setNotice(`Reorder failed: ${(e as Error)?.message ?? "unknown error"}`);
    }
  };

  const onDelete = async (s: HeroSlide) => {
    if (!window.confirm(`Delete "${s.headline}"? This also removes its image.`)) return;
    try {
      await deleteAdminHeroSlide(s.id);
      setSlides((prev) => prev.filter((x) => x.id !== s.id));
      setNotice("Hero advertisement deleted.");
    } catch (e) {
      setNotice(`Delete failed: ${(e as Error)?.message ?? "unknown error"}`);
    }
  };

  const dismissError = () => setError(null);

  return (
    <div style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <div className="pageTitle">
        <div>
          <h1>Homepage Hero Carousel</h1>
          <p style={{ color: '#71717a', fontSize: 13, marginTop: 4 }}>
            Manage the fading hero slides shown at the top of the storefront. Only Live slides are public.
          </p>
        </div>
        <button className="blackButton" onClick={() => setEditor({ mode: "create", slide: null })}>
          <Plus size={16} style={{ verticalAlign: -3, marginRight: 6 }} /> Add New Slide
        </button>
      </div>

      {error && (
        <div style={{ padding: 14, borderRadius: 8, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", marginBottom: 16 }}>
          {error}
          <button onClick={loadSlides} style={{ marginLeft: 12, textDecoration: "underline" }}>Retry</button>
          <button onClick={dismissError} style={{ marginLeft: 12, textDecoration: "underline" }}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div style={{ padding: 12, borderRadius: 8, border: "1px solid #d1d5db", background: "#f8fafc", color: "#334155", marginBottom: 16 }}>
          {notice}
          <button onClick={() => setNotice(null)} style={{ marginLeft: 12, textDecoration: "underline" }}>Dismiss</button>
        </div>
      )}

      {loading ? (
        <p style={{ color: "#71717a", fontSize: 14, padding: 40, textAlign: "center" }}>Loading hero advertisements…</p>
      ) : slides.length === 0 ? (
        <div style={{ padding: 48, textAlign: "center", border: "1px dashed #d1d5db", borderRadius: 12, color: "#71717a" }}>
          <ImageIcon size={32} style={{ margin: "0 auto 12px", display: "block", opacity: 0.5 }} />
          <p style={{ fontWeight: 700, color: "#374151", marginBottom: 6 }}>No hero slides yet</p>
          <p style={{ fontSize: 13 }}>Create your first campaign to make it appear on the homepage.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {slides.map((s, i) => {
            const st = slideStatus(s);
            const meta = STATUS_META[st];
            return (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  padding: 12,
                  background: "#fff",
                }}
              >
                <div
                  style={{
                    width: 96,
                    height: 56,
                    borderRadius: 8,
                    overflow: "hidden",
                    flexShrink: 0,
                    background: "#eef0f2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                  }}
                >
                  {s.imageUrl ? (
                    <img src={resolveImage(s.imageUrl)} alt={s.headline || s.campaignLabel || "Hero slide image"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <ImageIcon size={20} style={{ opacity: 0.4 }} />
                  )}
                  {s.videoUrl && (
                    <span
                      title="This slide has a background video"
                      style={{
                        position: "absolute",
                        bottom: 4,
                        right: 4,
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: "rgba(0,0,0,.65)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Video size={11} />
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: "1px solid #e5e7eb",
                      }}
                    >
                      {s.heroType}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{meta.label}</span>
                    <span style={{ fontSize: 11, color: "#9ca3af" }}>Order {s.displayOrder}</span>
                  </div>
                  <p style={{ fontWeight: 700, margin: "4px 0 0", color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.headline || "—"}
                  </p>
                  <p style={{ fontSize: 12, color: "#6b7280", margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {s.campaignLabel}
                  </p>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button title="Move up" onClick={() => onReorder(s.id, -1)} disabled={i === 0} className="iconBtn" style={i === 0 ? { opacity: 0.3, cursor: "not-allowed" } : undefined}>
                    <ChevronUp size={16} />
                  </button>
                  <button title="Move down" onClick={() => onReorder(s.id, 1)} disabled={i === slides.length - 1} className="iconBtn" style={i === slides.length - 1 ? { opacity: 0.3, cursor: "not-allowed" } : undefined}>
                    <ChevronDown size={16} />
                  </button>
                  <button title="Edit" onClick={() => setEditor({ mode: "edit", slide: s })} className="iconBtn">
                    <Pencil size={16} />
                  </button>
                  <button title="Delete" onClick={() => onDelete(s)} className="iconBtn" style={{ color: "#b91c1c" }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editor && (
        <HeroEditor
          mode={editor.mode}
          slide={editor.slide}
          nextOrder={slides.length}
          onClose={() => setEditor(null)}
          onSaved={async (updates, wasNew) => {
            if (wasNew) await refresh();
            else if (updates) {
              setSlides((prev) => prev.map((x) => (x.id === updates.id ? updates : x)));
            }
            setEditor(null);
          }}
        />
      )}
    </div>
  );
}

function HeroEditor({
  mode,
  slide,
  nextOrder,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  slide: HeroSlide | null;
  nextOrder: number;
  onClose: () => void;
  onSaved: (updates: HeroSlide | null, wasNew: boolean) => void;
}) {
  const [campaignLabel, setCampaignLabel] = useState(slide?.campaignLabel ?? "");
  const [headline, setHeadline] = useState(slide?.headline ?? "");
  const [description, setDescription] = useState(slide?.description ?? "");
  const [ctaText, setCtaText] = useState(slide?.ctaText ?? "");
  const [ctaUrl, setCtaUrl] = useState(slide?.ctaUrl ?? "");
  const [cta2Text, setCta2Text] = useState(slide?.cta2Text ?? "");
  const [cta2Url, setCta2Url] = useState(slide?.cta2Url ?? "");
  const [badgeText, setBadgeText] = useState(slide?.badgeText ?? "");
  const [editorialText, setEditorialText] = useState(slide?.editorialText ?? "");
  const [heroType, setHeroType] = useState<HeroType>(slide?.heroType ?? "promotional");
  const [isActive, setIsActive] = useState(slide?.isActive ?? false);
  const [startDate, setStartDate] = useState(toLocalInput(slide?.startDate ?? null));
  const [endDate, setEndDate] = useState(toLocalInput(slide?.endDate ?? null));
  const [imageUrl, setImageUrl] = useState(slide?.imageUrl ?? "");
  const [videoUrl, setVideoUrl] = useState(slide?.videoUrl ?? "");
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const buildDraft = (): HeroSlideDraft => ({
    campaignLabel,
    headline,
    description,
    ctaText,
    ctaUrl,
    cta2Text: cta2Text.trim() || null,
    cta2Url: cta2Url.trim() || null,
    badgeText: badgeText || undefined,
    editorialText: editorialText || undefined,
    heroType,
    displayOrder: slide?.displayOrder ?? nextOrder,
    isActive,
    startDate: fromLocalInput(startDate),
    endDate: fromLocalInput(endDate),
    imageUrl: imageUrl || undefined,
  });

  const save = async () => {
    setErr(null);
    if (!campaignLabel.trim()) { setErr("Campaign label is required."); return; }
    if (!headline.trim()) { setErr("Headline is required."); return; }
    if (!description.trim()) { setErr("Description is required."); return; }
    if (!ctaText.trim()) { setErr("CTA text is required."); return; }
    if (!ctaUrl.trim()) { setErr("CTA link is required."); return; }
    if (!!cta2Text.trim() !== !!cta2Url.trim()) { setErr("Provide both a label and a link for the second button, or leave both blank."); return; }
    if (isActive && !file && !imageUrl) { setErr("An active hero must have an image — add one before activating this slide."); return; }

    try {
      setSaving(true);

      if (mode === "create") {
        // Create as a draft so a real id exists, then attach the image, then
        // publish if the admin requested an active slide and one is present.
        const created = await createAdminHeroSlide({ ...buildDraft(), isActive: false, imageUrl: undefined });
        if (file) await uploadHeroImage(created.slide.id, file);
        if (videoFile) await uploadHeroVideo(created.slide.id, videoFile);
        let final = created.slide;
        if (isActive && (file || imageUrl)) {
          final = (await updateAdminHeroSlide(created.slide.id, { isActive: true })).slide;
        }
        onSaved(final, true);
      } else {
        if (!slide) return;
        let final = slide;
        if (file) final = (await uploadHeroImage(slide.id, file)).slide;
        if (videoFile) final = (await uploadHeroVideo(slide.id, videoFile)).slide;
        final = (await updateAdminHeroSlide(slide.id, buildDraft())).slide;
        onSaved(final, false);
      }
    } catch (e) {
      setErr((e as Error)?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const removeImage = async () => {
    if (!slide) return;
    try {
      const r = await removeHeroImage(slide.id);
      setImageUrl("");
      setFile(null);
      setErr(null);
      onSaved(r.slide, false);
    } catch (e) {
      setErr((e as Error)?.message ?? "Remove failed. Deactivate the slide before removing its image.");
    }
  };

  const removeVideo = async () => {
    if (!slide) return;
    try {
      const r = await removeHeroVideo(slide.id);
      setVideoUrl("");
      setVideoFile(null);
      setErr(null);
      onSaved(r.slide, false);
    } catch (e) {
      setErr((e as Error)?.message ?? "Remove failed.");
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 11px",
    border: "1px solid #d1d5db",
    borderRadius: 8,
    fontSize: 13,
    background: "#fff",
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 700, color: "#374151", marginBottom: 5, letterSpacing: ".04em" };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 16,
          width: "min(680px, 100%)",
          maxHeight: "90vh",
          overflowY: "auto",
          padding: 24,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>
            {mode === "create" ? "New Hero Slide" : "Edit Hero Slide"}
          </h2>
          <button onClick={onClose} className="iconBtn" aria-label="Close"><X size={18} /></button>
        </div>

        {err && (
          <div style={{ padding: 12, borderRadius: 8, border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", marginBottom: 14, fontSize: 13 }}>
            {err}
          </div>
        )}

        {/* Image */}
        <div style={{ marginBottom: 18 }}>
          <span style={labelStyle}>Hero Image</span>
          <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
            <div
              style={{
                width: 220,
                height: 128,
                borderRadius: 10,
                border: "1px dashed #d1d5db",
                background: "#f8fafc",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {file ? (
                <img src={URL.createObjectURL(file)} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : imageUrl ? (
                <img src={resolveImage(imageUrl)} alt="Hero preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ color: "#9ca3af", fontSize: 12, textAlign: "center", padding: 8 }}>No image yet</span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={{ fontSize: 12, cursor: "pointer" }}>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: "none" }}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <span className="blackButton" style={{ display: "inline-block", cursor: "pointer" }}>
                  {file ? "Choose another" : imageUrl ? "Replace image" : "Upload image"}
                </span>
              </label>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>PNG, JPEG or WebP</span>
              {imageUrl && mode === "edit" && (
                <button onClick={removeImage} style={{ fontSize: 12, color: "#b91c1c", textAlign: "left", cursor: "pointer", padding: 0 }}>
                  Remove image
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, marginTop: 14 }}>
            <div
              style={{
                width: 96,
                height: 128,
                borderRadius: 10,
                border: "1px dashed #d1d5db",
                background: "#f8fafc",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {videoFile ? (
                <video src={URL.createObjectURL(videoFile)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : videoUrl ? (
                <video src={resolveImage(videoUrl)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <span style={{ color: "#9ca3af", fontSize: 12, textAlign: "center", padding: 8 }}>No video (image-only slide)</span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>Background video (optional)</span>
              <label style={{ fontSize: 12, cursor: "pointer" }}>
                <input
                  type="file"
                  accept="video/mp4,video/webm"
                  style={{ display: "none" }}
                  onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
                />
                <span className="blackButton" style={{ display: "inline-block", cursor: "pointer" }}>
                  {videoFile ? "Choose another" : videoUrl ? "Replace video" : "Upload video"}
                </span>
              </label>
              <span style={{ fontSize: 11, color: "#9ca3af" }}>
                MP4 or WebM, up to 40MB. The image above is always shown as the poster/fallback — a video is optional.
              </span>
              {videoUrl && mode === "edit" && (
                <button onClick={removeVideo} style={{ fontSize: 12, color: "#b91c1c", textAlign: "left", cursor: "pointer", padding: 0 }}>
                  Remove video
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <span style={labelStyle}>Campaign label</span>
            <input style={inputStyle} value={campaignLabel} onChange={(e) => setCampaignLabel(e.target.value)} placeholder="e.g. SS25 Collection" />
          </div>
          <div>
            <span style={labelStyle}>Headline</span>
            <input style={inputStyle} value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. The Season's New Arrivals" />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <span style={labelStyle}>Description</span>
          <textarea style={{ ...inputStyle, minHeight: 64, resize: "vertical" }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short supporting copy for the slide" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          <div>
            <span style={labelStyle}>CTA text</span>
            <input style={inputStyle} value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="e.g. Shop Now" />
          </div>
          <div>
            <span style={labelStyle}>CTA link</span>
            <input style={inputStyle} value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} placeholder="/shop?collection=new" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          <div>
            <span style={labelStyle}>Second button text <small style={{ fontWeight: 400, color: "#888" }}>(optional — e.g. for a Men/Women choice slide)</small></span>
            <input style={inputStyle} value={cta2Text} onChange={(e) => setCta2Text(e.target.value)} placeholder="e.g. Shop Women" />
          </div>
          <div>
            <span style={labelStyle}>Second button link <small style={{ fontWeight: 400, color: "#888" }}>(required if the text above is set)</small></span>
            <input style={inputStyle} value={cta2Url} onChange={(e) => setCta2Url(e.target.value)} placeholder="/category/women" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          <div>
            <span style={labelStyle}>Badge text</span>
            <input style={inputStyle} value={badgeText} onChange={(e) => setBadgeText(e.target.value)} placeholder="e.g. New Season (optional)" />
          </div>
          <div>
            <span style={labelStyle}>Editorial text</span>
            <input style={inputStyle} value={editorialText} onChange={(e) => setEditorialText(e.target.value)} placeholder="Magazine caption (editorial only)" />
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <span style={labelStyle}>Hero type</span>
          <div style={{ display: "flex", gap: 8 }}>
            {HERO_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setHeroType(t.value)}
                style={{
                  flex: 1,
                  padding: "10px 8px",
                  borderRadius: 8,
                  border: heroType === t.value ? "2px solid #111" : "1px solid #d1d5db",
                  background: heroType === t.value ? "#f4f4f5" : "#fff",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {t.label}
                <span style={{ display: "block", fontSize: 10, fontWeight: 400, color: "#6b7280", marginTop: 2 }}>{t.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
          <div>
            <span style={labelStyle}>Start date</span>
            <input type="datetime-local" style={inputStyle} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <span style={labelStyle}>End date</span>
            <input type="datetime-local" style={inputStyle} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Publish (show on homepage) — requires an image
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
          <button className="iconBtn" onClick={onClose} disabled={saving} style={{ border: "1px solid #d1d5db", borderRadius: 8, padding: "10px 16px", fontSize: 13 }}>
            Cancel
          </button>
          <button className="blackButton" onClick={save} disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create Slide" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
