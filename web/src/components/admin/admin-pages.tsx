"use client";

import { useCallback, useEffect, useMemo, useState, useRef, useId, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Filter, Download, X, Check, ShieldAlert, Image, ImagePlus, ImageMinus, ImageOff, Pencil, Eye, EyeOff, Trash2 } from "lucide-react";
import * as api from "../../lib/api";
import { formatTZS } from "../../lib/currency";
import { listBrands, listCategories } from "../../lib/api";
import { CATEGORY_ICON_CHOICES, categoryIcon } from "../../lib/category-icons";
import { HeroContentPage } from "./hero-content";
import { PaymentMethodsPage } from "./payment-methods";
import { LifestyleManagementPage } from "./lifestyle-content";
import { MfaSettingsPage } from "./mfa-settings";
import { AdminPermissionsEditor } from "./admin-permissions-editor";
import { ProductManagementTable } from "./product-management";
import { BrandMark } from "../shop/BrandMark";
import { redirectToLoginExpired } from "../../lib/returnTo";
import { userMessage } from "../../lib/errors";
import { ORDER_STATUS_LABEL } from "../../lib/orderStatus";

export type AdminRow = {
  id: string;
  primary: string;
  sub?: string;
  status: string;
  statusTone?: "ok" | "warn" | "err";
  meta?: string;
  raw?: unknown;
};

type PageKind = "products" | "admins" | "users" | "orders" | "activity" | "inventory" | "catalog" | "generic" | "customers";

function kindFor(title: string): PageKind {
  if (title.includes("Product Management") || title.includes("Products")) return "products";
  if (title.includes("Admin") || title.toLowerCase().includes("admin management")) return "admins";
  if (title.toLowerCase().includes("catalog") || title.toLowerCase().includes("categories")) return "catalog";
  if (title.includes("User") || title.includes("Customer")) return "users";
  if (title.includes("Orders")) return "orders";
  if (title.includes("Activity")) return "activity";
  if (title.includes("Inventory")) return "inventory";
  return "generic";
}

function toCSV(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

// Mirrors the backend slugify (catalog.service.ts) so the client-side duplicate
// check computes the exact slug the server will generate when none is given.
function slugifyCatalog(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Parses a TZS amount typed by an admin ("25000", "25,000", "25 000",
 * "TZS 25,000", "25000.00") into a whole number. Returns undefined for
 * anything that isn't a non-negative whole amount, so callers can show a
 * clear message instead of silently sending 0 or NaN.
 */
function parseTzsAmount(raw: string | undefined): number | undefined {
  const cleaned = (raw ?? "").replace(/tzs|tsh/gi, "").replace(/[\s,]/g, "").replace(/\.0+$/, "");
  if (!/^\d+$/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Turns an API error into one readable line, including the per-field reasons the backend sends with "Validation failed.". */
function describeApiError(e: unknown, fallback: string): string {
  return userMessage(e, fallback);
}

// Any admin API call that answers 401 means the session is no longer valid
// (access token expired and refresh couldn't recover it). Redirect the user to
// sign back in with a clear note instead of leaving a bare failed action.
type BannerTone = "ok" | "error";

function handleAuthError(e: unknown, _setBanner: (m: string, tone?: BannerTone) => void): boolean {
  if (e instanceof api.ApiError && e.status === 401) {
    api.logout().catch(() => {});
    redirectToLoginExpired();
    return true;
  }
  return false;
}

type AddForm = {
  open: boolean;
  fields: { name: string; label: string; kind: "text" | "password" | "email" | "select" | "check" | "icon"; options?: string[] }[];
};

export function FunctionalManagementPage({ title, desc, withHeroOverride = false, withPaymentsOverride = false, withLifestylesOverride = false, withMfaOverride = false, superRole = true }: { title: string; desc: string; withHeroOverride?: boolean; withPaymentsOverride?: boolean; withLifestylesOverride?: boolean; withMfaOverride?: boolean; superRole?: boolean }) {
  // Homepage hero management is a first-class, database-backed tool instead of
  // the generic demo table. Content editing is SUPER_ADMIN-only (RBAC
  // `content.manage`); standard admins get an explicit permission notice.
  // These dedicated pages are chosen here, in a hook-free wrapper, so the
  // generic table below always calls the same hooks in the same order
  // (Rules of Hooks) — an early return inside it used to skip later hooks.
  if (withLifestylesOverride) {
    if (!superRole) {
      return (
        <div style={{ padding: 48, textAlign: "center", border: "1px dashed #d1d5db", borderRadius: 12, color: "#71717a", fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
          <ShieldAlert size={32} style={{ margin: "0 auto 12px", display: "block", opacity: 0.5 }} />
          <p style={{ fontWeight: 700, color: "#374151", marginBottom: 6 }}>Requires Super Admin access</p>
          <p style={{ fontSize: 13 }}>Managing lifestyles is restricted to Super Admins.</p>
        </div>
      );
    }
    return <LifestyleManagementPage />;
  }
  if (withMfaOverride) {
    // Unlike hero/payments/lifestyle content, MFA is each admin's OWN
    // account security — available to Admin and Super Admin alike, not
    // gated to superRole.
    return <MfaSettingsPage />;
  }
  if (withHeroOverride) {
    if (!superRole) {
      return (
        <div style={{ padding: 48, textAlign: "center", border: "1px dashed #d1d5db", borderRadius: 12, color: "#71717a", fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
          <ShieldAlert size={32} style={{ margin: "0 auto 12px", display: "block", opacity: 0.5 }} />
          <p style={{ fontWeight: 700, color: "#374151", marginBottom: 6 }}>Requires Super Admin access</p>
          <p style={{ fontSize: 13 }}>Editing homepage content is restricted to Super Admins.</p>
        </div>
      );
    }
    return <HeroContentPage />;
  }
  if (withPaymentsOverride) {
    if (!superRole) {
      return (
        <div style={{ padding: 48, textAlign: "center", border: "1px dashed #d1d5db", borderRadius: 12, color: "#71717a", fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
          <ShieldAlert size={32} style={{ margin: "0 auto 12px", display: "block", opacity: 0.5 }} />
          <p style={{ fontWeight: 700, color: "#374151", marginBottom: 6 }}>Requires Super Admin access</p>
          <p style={{ fontSize: 13 }}>Managing payment methods is restricted to Super Admins.</p>
        </div>
      );
    }
    return <PaymentMethodsPage />;
  }
  return <GenericManagementPage title={title} desc={desc} superRole={superRole} />;
}

function GenericManagementPage({ title, desc, superRole }: { title: string; desc: string; superRole: boolean }) {
  const kind = kindFor(title);
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notImplemented, setNotImplemented] = useState(false);
  const [add, setAdd] = useState<AddForm>({ open: false, fields: [] });
  const [productReload, setProductReload] = useState(0);
  // Every success AND failure in the backoffice lands in this one banner, so it
  // carries a tone: failures render red (role="alert"), never as a green success.
  const [bannerState, setBannerState] = useState<{ text: string; tone: BannerTone } | null>(null);
  const setBanner = useCallback((text: string, tone: BannerTone = "ok") => setBannerState(text ? { text, tone } : null), []);
  const banner = bannerState?.text ?? "";
  // One timer per message: a new message restarts it, so an older action's
  // timer can never wipe a newer message (e.g. the reason a delete was refused).
  // Failures stay up until the next message (longer, so they can be read).
  useEffect(() => {
    if (!bannerState) return;
    const t = setTimeout(() => setBanner(""), bannerState.tone === "error" ? 15000 : 6000);
    return () => clearTimeout(t);
  }, [bannerState, setBanner]);
  const [catalogData, setCatalogData] = useState<{ brands: AdminRow[]; categories: AdminRow[] }>({ brands: [], categories: [] });
  const [catalogToAdd, setCatalogToAdd] = useState<"brand" | "category" | null>(null);
  const [editingBrand, setEditingBrand] = useState<api.Brand | null>(null);
  const [editingCategory, setEditingCategory] = useState<api.Category | null>(null);
  const [editingProduct, setEditingProduct] = useState<api.Product | null>(null);
  const [permsAdmin, setPermsAdmin] = useState<api.AdminUser | null>(null);

  // Live brand/category data for the Add Product form: kept in a ref (not
  // localStorage) so it can never go stale across tabs/sessions, and
  // refetched fresh every time the Add Product modal is opened (see the
  // "Add New" button below) rather than only once per page load.
  const catalogOptionsRef = useRef<{ brands: api.Brand[]; categories: api.Category[] }>({ brands: [], categories: [] });

  // Create-product attribute picker: when the Add Product dialog's category
  // select changes we load that category's attribute groups (via slug) and
  // render their options so the new product can be tagged right at creation.
  const [createAttrGroups, setCreateAttrGroups] = useState<api.AttributeGroup[]>([]);
  const [createAttrSelected, setCreateAttrSelected] = useState<string[]>([]);
  const lastCreateCategory = useRef("");

  const handleCreateCategoryChange = (d: Record<string, string>) => {
    if (kind !== "products") return;
    const catName = (d.categoryId ?? "").trim();
    if (catName === lastCreateCategory.current) return;
    lastCreateCategory.current = catName;
    setCreateAttrGroups([]);
    setCreateAttrSelected([]);
    if (!catName) return;
    const cat = catalogOptionsRef.current.categories.find((c) => c.name === catName);
    if (!cat?.slug) return;
    api.listCategoryAttributes(cat.slug, { fresh: true }).then((r) => setCreateAttrGroups(r.groups)).catch(() => setCreateAttrGroups([]));
  };


  // ---- Brand logo manager state (lives here so both create & edit flows, and
  // the modal, can share it; server-side magic-byte validation is authoritative) ----
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoRemove, setLogoRemove] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoFieldExisting = !!editingBrand?.logo?.url;

  const resetLogo = () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(null); setLogoPreview(null); setLogoRemove(false); setLogoError(null);
  };

  const handleLogoSelect = (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    const ok = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
    if (!ok) { setLogoError("Please choose a PNG, JPG or WebP image."); return; }
    if (file.size > 5 * 1024 * 1024) { setLogoError("Image must be 5 MB or smaller."); return; }
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(file); setLogoRemove(false);
    setLogoPreview(URL.createObjectURL(file));
  };

  const handleLogoRemoveClick = () => {
    if (!logoFile && !logoFieldExisting) return;
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(null); setLogoPreview(null); setLogoRemove(true);
  };

  // ---- Data loading ----
  const load = async () => {
    setLoading(true); setError(null); setNotImplemented(false);
    try {
      switch (kind) {
        case "products": {
          // The product list itself is loaded (search/filter/sort/paged) by
          // ProductManagementTable; this only prepares the create form.
          const [br, ca] = await Promise.all([listBrands(), listCategories()]);
          setRows([]);
          setProductReload((n) => n + 1);
          catalogOptionsRef.current = { brands: br.brands, categories: ca.categories };
          setAdd({ open: false, fields: [
            { name: "name", label: "Product name", kind: "text" },
            { name: "slug", label: "Slug (url-key)", kind: "text" },
            { name: "brandId", label: "Brand", kind: "select", options: br.brands.map((b) => b.name) },
            { name: "categoryId", label: "Category", kind: "select", options: ca.categories.map((c) => c.name) },
            { name: "priceCents", label: "Price (TZS)", kind: "text" },
            { name: "compareAtPriceCents", label: "Compare-at (TZS, for sales)", kind: "text" },
            { name: "badgeText", label: "Badge (e.g. NEW)", kind: "text" },
            { name: "offerLabel", label: "Offer label (e.g. Spring 30%)", kind: "text" },
            { name: "offerStartDate", label: "Offer start (YYYY-MM-DD)", kind: "text" },
            { name: "offerEndDate", label: "Offer end (YYYY-MM-DD)", kind: "text" },
            { name: "sku", label: "SKU (optional, unique)", kind: "text" },
            { name: "shortDescription", label: "Short description", kind: "text" },
            { name: "fullDescription", label: "Full description", kind: "text" },
            { name: "genderAudiences", label: "Gender / Audience", kind: "check", options: ["Women", "Men", "Unisex"] },
            { name: "tags", label: "Collection tags (comma-separated, e.g. premium, new) — drives homepage featured sections", kind: "text" },
          ] });
          break;
        }
        case "admins": {
          const r = await api.listAdmins();
          setRows(r.admins.map((a) => ({
            id: a.id,
            primary: a.email,
            status: a.role === "SUPER_ADMIN" ? "Super Admin" : "Admin",
            statusTone: a.role === "SUPER_ADMIN" ? "ok" : "warn",
            meta: a.disabled ? "Suspended" : "Active",
            raw: a,
          })));
          setAdd({ open: false, fields: [
            { name: "email", label: "Email", kind: "email" },
            { name: "password", label: "Password (10+ characters, upper & lower case, a number)", kind: "password" },
            { name: "role", label: "Role", kind: "select", options: ["ADMIN", "SUPER_ADMIN"] },
            { name: "actorPassword", label: "Your current password (to confirm)", kind: "password" },
          ] });
          break;
        }
        case "users": {
          const r = await api.listAdminUsers();
          setRows(r.users.map((u) => ({
            id: u.id,
            primary: u.fullName || u.email || u.phoneNumber || "—",
            sub: [u.phoneNumber, u.email, u.role === "CUSTOMER" ? null : u.role].filter(Boolean).join(" · "),
            status: u.disabled ? "Disabled" : "Active",
            statusTone: u.disabled ? "err" : "ok",
            meta: `${u.orderCount ?? 0} orders`,
            raw: u,
          })));
          break;
        }
        case "orders": {
          const r = await api.listAdminOrders();
          setRows(r.orders.map((o) => ({
            id: o.id,
            primary: `#${o.id.slice(0, 8).toUpperCase()}`,
            sub: `${new Date(o.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${o.items?.length ?? 0} item${o.items?.length === 1 ? "" : "s"}${o.shippingAddressSnapshot?.city ? ` · ${o.shippingAddressSnapshot.city}` : ""}`,
            status: ORDER_STATUS_LABEL[o.status] ?? o.status,
            statusTone: o.status === "CANCELLED" ? "err" : o.status === "DELIVERED" ? "ok" : "warn",
            meta: formatTZS(o.totalTzs ?? o.totalCents ?? 0),
            raw: o,
          })));
          break;
        }
        case "activity": {
          const r = await api.listActivityLogs(200);
          setRows(r.events.map((e) => ({
            id: e.id,
            primary: e.action,
            sub: `${e.targetType} ${e.targetId ? '#' + e.targetId.slice(0, 8) : ''}`,
            status: e.actorRole,
            meta: new Date(e.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
            raw: e,
          })));
          break;
        }
        case "catalog": {
          const [br, ca] = await Promise.all([api.listAdminBrands(), api.listAdminCategories()]);
          setCatalogData({
            brands: br.brands.map((b) => ({ id: b.id, primary: b.name, sub: `/` + b.slug, status: b.active ? "Active" : "Inactive", statusTone: (b.active ? "ok" : "warn") as "ok" | "warn", meta: b.logo ? "Logo ✓" : "No logo", raw: b })),
            categories: ca.categories.map((c) => ({ id: c.id, primary: c.name, sub: `/` + c.slug, status: c.active ? "Active" : "Inactive", statusTone: (c.active ? "ok" : "warn") as "ok" | "warn", meta: c.imageUrl ? "Image ✓" : "No image", raw: c })),
          });
          break;
        }
        default: {
          // Pages with no backend module yet: Promotions/Coupons, Reports,
          // and System Settings show an honest placeholder instead of
          // fabricated records that look like real data. (Customers,
          // Roles, and Profile/Account are NOT in this list — despite an
          // earlier version of this comment claiming otherwise, they're
          // already wired: Customers/Roles route through kindFor's
          // "users" case or Backoffice's own dedicated dispatch, and
          // Profile/Account routes through withMfaOverride above. A
          // stale comment claiming otherwise is exactly the kind of
          // "documentation lies about what's implemented" this was
          // caught and corrected against.)
          setNotImplemented(true);
          setRows([]);
        }
      }
    } catch (e) {
      setError(userMessage(e, "Could not load data"));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load();   }, [kind]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.primary} ${r.sub ?? ''} ${r.status} ${r.meta ?? ''}`.toLowerCase().includes(q));
  }, [rows, query]);

  const handleAddSubmit = async (formData: Record<string, string>) => {
    try {
      let msg = "";
      if (kind === "products") {
        const brands = catalogOptionsRef.current.brands;
        const cats = catalogOptionsRef.current.categories;
        const brandId = brands.find((b) => b.name === formData.brandId)?.id ?? "";
        const categoryId = cats.find((c) => c.name === formData.categoryId)?.id ?? "";
        // Catch every input the backend would reject *before* POSTing, with a
        // message naming the field, instead of a generic "Validation failed.".
        const fail = (message: string) => {
          setBanner(message, "error");
        };
        if (!(formData.name ?? "").trim()) return fail("Enter a product name.");
        if (!brandId) return fail("Select a brand for the product.");
        if (!categoryId) return fail("Select a category for the product.");
        const price = parseTzsAmount(formData.priceCents);
        if (price == null) return fail("Enter the price as a whole number of TZS, e.g. 25000 or 25,000.");
        const compareAt = (formData.compareAtPriceCents ?? "").trim() !== "" ? parseTzsAmount(formData.compareAtPriceCents) : null;
        if (compareAt === undefined) return fail("Enter the compare-at price as a whole number of TZS, or leave it empty.");
        if (compareAt != null && compareAt < price) return fail("The compare-at price must be greater than the selling price.");
        for (const [key, label] of [["offerStartDate", "Offer start"], ["offerEndDate", "Offer end"]] as const) {
          const v = (formData[key] ?? "").trim();
          if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return fail(`${label} date must look like 2026-12-31, or be left empty.`);
        }
        // Skip empty optional fields entirely on create so the DB defaults win.
        const norm = (v: string | undefined) => (v != null && v.trim() !== "" ? v.trim() : undefined);
        // The backend requires at least one gender/audience on create. Validate
        // before POSTing so an empty selection never fires a 400 (same pattern
        // the admins/catalog branches use below).
        const genderAudiences = (formData.genderAudiences ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (genderAudiences.length === 0) {
          setBanner("Select at least one gender / audience (Women, Men or Unisex) for the product.", "error");
          return;
        }
        const tags = (formData.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        let attrWarning = "";
        const created = await api.createAdminProduct({
          // Always send a clean URL-safe slug (the server also normalizes it
          // and adds a suffix if taken). Never omit it: an API build from
          // before slug became optional rejects a missing slug with a
          // generic "Validation failed.".
          slug: slugifyCatalog(formData.slug || formData.name) || "product",
          name: formData.name.trim(),
          brandId,
          categoryId,
          priceCents: price,
          genderAudiences,
          compareAtPriceCents: compareAt ?? undefined,
          badgeText: norm(formData.badgeText),
          offerLabel: norm(formData.offerLabel),
          offerStartDate: norm(formData.offerStartDate),
          offerEndDate: norm(formData.offerEndDate),
          sku: norm(formData.sku),
          shortDescription: norm(formData.shortDescription),
          fullDescription: norm(formData.fullDescription),
          // Omit when empty rather than sending [] — older API builds reject
          // an empty tags array on create.
          tags: tags.length > 0 ? tags : undefined,
        });
        // The category's attributes were picked in the same dialog — persist the
        // selections onto the fresh product now (empty list = clear/none). A
        // failure here must never undo an already-created product.
        if (created?.product?.id && created.product.id) {
          try {
            await api.setProductAttributeValues(created.product.id, createAttrSelected);
          } catch (e) {
            // The product exists; say plainly that its attributes did not save.
            attrWarning = ` Its attributes could not be saved (${userMessage(e, "please try again")}) — set them in the editor.`;
          }
        }
        msg = "Product created as a draft — now add images and color/size stock, then tick Published." + attrWarning;
        if (created?.product?.id) {
          // Continue straight into the editor so the admin can add images and
          // variants and publish, instead of hunting for the new draft.
          api.getAdminProduct(created.product.id).then((r) => setEditingProduct(r.product)).catch(() => undefined);
        }
      } else if (kind === "admins") {
        const email = (formData.email ?? "").trim().toLowerCase();
        const password = formData.password ?? "";
        // Validate before POSTing so we never fire a request the backend will
        // reject with a 400 validation error (empty/invalid input). Keeps the
        // console free of spurious 400 "Failed to load resource" noise.
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setBanner("Enter a valid email address.", "error");
          return;
        }
        // Same rule the server enforces (api/src/lib/validate.ts isStrongPassword).
        const missing = [
          password.length < 10 && "at least 10 characters",
          !/[a-z]/.test(password) && "a lowercase letter",
          !/[A-Z]/.test(password) && "an uppercase letter",
          !/[0-9]/.test(password) && "a number",
        ].filter(Boolean) as string[];
        if (missing.length > 0) {
          setBanner(`The new admin's password needs ${missing.join(", ")}.`, "error");
          return;
        }
        if (!formData.actorPassword) {
          setBanner("Enter your current password to confirm this action.", "error");
          return;
        }
        if (!formData.role || (formData.role !== "ADMIN" && formData.role !== "SUPER_ADMIN")) {
          setBanner("Select a role for the new admin.", "error");
          return;
        }
        await api.createAdmin({
          email,
          password,
          role: formData.role as "ADMIN" | "SUPER_ADMIN",
          actorPassword: formData.actorPassword,
        });
        msg = "Admin created ✓";
      } else if (kind === "catalog") {
        if (editingBrand) {
          // Tone override only when changed and no new logo is being uploaded
          // (a fresh upload is re-analyzed automatically).
          const pickedTone = (Object.entries(LOGO_TONE_LABELS).find(([, label]) => label === formData.logoTone)?.[0] ?? null) as "auto" | "light" | "dark" | null;
          const toneChanged = !!editingBrand.logo && !logoFile && pickedTone != null && formData.logoTone !== logoToneLabel(editingBrand);
          const { brand } = await api.updateAdminBrand(editingBrand.id, {
            name: formData.name || undefined,
            slug: formData.slug || undefined,
            active: formData.active ? formData.active === "Active" : undefined,
            logoTone: toneChanged ? pickedTone! : undefined,
          });
          if (logoFile) await api.uploadBrandLogo(brand.id, logoFile);
          else if (logoRemove) await api.removeBrandLogo(brand.id);
          msg = "Brand updated ✓";
        } else if (catalogToAdd === "category") {
          if (editingCategory) {
            await api.updateAdminCategory(editingCategory.id, {
              name: formData.name || undefined,
              slug: formData.slug || undefined,
              active: formData.active !== undefined ? formData.active === "Active" : undefined,
              displayOrder: formData.displayOrder ? Number(formData.displayOrder) : undefined,
              icon: formData.icon && formData.icon !== editingCategory.icon ? formData.icon : undefined,
            });
            msg = "Category updated ✓";
          } else {
            await api.createAdminCategory({ name: formData.name, slug: formData.slug || undefined, icon: (formData.icon || "box") });
            msg = "Category created ✓";
          }
        } else {
          // Prevent hitting the backend's duplicate-slug 409: check the loaded
          // brand list for an identical name or generated slug before POSTing.
          const wantName = (formData.name ?? "").trim().toLowerCase();
          const wantSlug = slugifyCatalog(formData.slug || formData.name || "") || "brand";
          const dupe = catalogData.brands.find((b) => {
            const raw = b.raw as api.Brand | undefined;
            return (
              `${b.primary ?? ""}`.trim().toLowerCase() === wantName ||
              (raw?.slug ? raw.slug.trim().toLowerCase() : "") === wantSlug
            );
          });
          if (dupe) {
            const raw = dupe.raw as api.Brand | undefined;
            setBanner(`A brand named "${dupe.primary}" (slug /${raw?.slug ?? ""}) already exists. Edit that brand instead of creating a duplicate.`, "error");
            return;
          }
          const { brand } = await api.createAdminBrand({ name: formData.name, slug: formData.slug || undefined });
          if (logoFile) await api.uploadBrandLogo(brand.id, logoFile);
          msg = "Brand created ✓";
        }
      }
      setBanner(msg);
      setAdd({ ...add, open: false });
      setCatalogToAdd(null);
      setEditingBrand(null);
      setEditingCategory(null);
      resetLogo();
      await load();
    } catch (e) {
      if (handleAuthError(e, setBanner)) return; // session expired -> redirect to login
      setBanner(describeApiError(e, "Could not save"), "error");
    }
  };

  const handleOrderStatus = async (r: AdminRow, next: string) => {
    try {
      await api.updateOrderStatus(r.id, next as api.AdminOrder["status"]);
      setBanner(`${r.primary} → ${ORDER_STATUS_LABEL[next as api.AdminOrder["status"]] ?? next}`);
      await load();
    } catch (e) {
      if (handleAuthError(e, setBanner)) return;
      setBanner(userMessage(e, "Could not update order status"), "error");
    }
  };

  const handleAdminToggle = async (r: AdminRow, action: "disable" | "role") => {
    const a = r.raw as api.AdminUser;
    const actionLabel = action === "disable" ? (a.disabled ? "re-activate" : "suspend") : "change the role of";
    const actorPassword = window.prompt(`Enter your current password to confirm: ${actionLabel} ${a.email}`);
    if (!actorPassword) return; // cancelled — do nothing, do not proceed with an empty confirmation
    try {
      if (action === "disable") await api.setAdminDisabled(a.id, !a.disabled, actorPassword);
      else await api.changeAdminRole(a.id, a.role === "SUPER_ADMIN" ? "ADMIN" : "SUPER_ADMIN", actorPassword);
      setBanner(action === "disable"
        ? `${a.email} ${a.disabled ? "re-activated" : "suspended"}`
        : `${a.email} role → ${a.role === "SUPER_ADMIN" ? "ADMIN" : "SUPER_ADMIN"}`);
      await load();
    } catch (e) {
      if (handleAuthError(e, setBanner)) return;
      setBanner(userMessage(e, "Could not update admin"), "error");
    }
  };

  const handleExport = () => {
    const rows2: (string | number)[][] = [[title.toUpperCase()], ["Item", "Detail", "Status", "Meta"]];
    filtered.forEach((r) => rows2.push([r.primary, r.sub ?? "", r.status, r.meta ?? ""]));
    const blob = new Blob([toCSV(rows2)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`; a.click();
    URL.revokeObjectURL(url);
    setBanner("Exported ✓");
  };

  const handleEditBrand = (brand: api.Brand) => {
    setEditingBrand(brand);
    setCatalogToAdd(null);
    resetLogo();
    setAdd({
      open: true,
      fields: [
        { name: "name", label: "Brand name", kind: "text" },
        { name: "slug", label: "Slug (URL key, optional)", kind: "text" },
        { name: "active", label: "Status", kind: "select", options: ["Active", "Inactive"] },
        ...(brand.logo ? [{ name: "logoTone", label: "Logo tone (how the logo is shown on light backgrounds)", kind: "select" as const, options: Object.values(LOGO_TONE_LABELS) }] : []),
      ],
    });
  };

  const handleUploadLogo = async (brand: api.Brand, file: File) => {
    try {
      await api.uploadBrandLogo(brand.id, file);
      setBanner("Logo uploaded ✓");
      await load();
    } catch (e) {
      if (handleAuthError(e, setBanner)) return; // session expired -> redirect to login
      setBanner(userMessage(e, "Upload failed"), "error");
    }
  };

  const handleRemoveLogo = async (brand: api.Brand) => {
    try {
      await api.removeBrandLogo(brand.id);
      setBanner("Logo removed ✓");
      await load();
    } catch (e) {
      if (handleAuthError(e, setBanner)) return; // session expired -> redirect to login
      setBanner(userMessage(e, "Could not remove logo"), "error");
    }
  };

  const handleUploadCampaignImage = async (brand: api.Brand, file: File) => {
    try {
      await api.uploadBrandCampaignImage(brand.id, file);
      setBanner("Campaign image uploaded ✓");
      await load();
    } catch (e) {
      if (handleAuthError(e, setBanner)) return;
      setBanner(userMessage(e, "Upload failed"), "error");
    }
  };

  const handleRemoveCampaignImage = async (brand: api.Brand) => {
    try {
      await api.removeBrandCampaignImage(brand.id);
      setBanner("Campaign image removed ✓");
      await load();
    } catch (e) {
      if (handleAuthError(e, setBanner)) return;
      setBanner(userMessage(e, "Could not remove campaign image"), "error");
    }
  };

  const handleEditCategory = (category: api.Category) => {
    setEditingCategory(category);
    setCatalogToAdd("category");
    setAdd({
      open: true,
      fields: [
        { name: "name", label: "Category name", kind: "text" },
        { name: "slug", label: "Slug (URL key, optional)", kind: "text" },
        { name: "displayOrder", label: "Display order (lower shows first)", kind: "text" },
        { name: "active", label: "Status", kind: "select", options: ["Active", "Inactive"] },
        { name: "icon", label: "Icon (small icon-library key, not a photo)", kind: "icon" },
      ],
    });
  };

  const handleUploadCategoryImage = async (category: api.Category, file: File) => {
    try {
      await api.uploadAdminCategoryImage(category.id, file);
      setBanner("Category image uploaded ✓");
      await load();
    } catch (e) {
      if (handleAuthError(e, setBanner)) return;
      setBanner(userMessage(e, "Upload failed"), "error");
    }
  };

  const handleRemoveCategoryImage = async (category: api.Category) => {
    try {
      await api.removeAdminCategoryImage(category.id);
      setBanner("Category image removed ✓");
      await load();
    } catch (e) {
      if (handleAuthError(e, setBanner)) return;
      setBanner(userMessage(e, "Could not remove image"), "error");
    }
  };

  const canAdd = kind === "products" || kind === "admins";

  // Refresh the Brand/Category dropdown options (and the id-lookup used on
  // submit) right before the Add Product form opens, so a brand/category
  // created a moment ago — in this tab or another — is always there. Other
  // "kind"s have no such dependency and just open immediately.
  const openAddForm = async () => {
    if (kind === "products") {
      try {
        const [br, ca] = await Promise.all([listBrands(), listCategories()]);
        catalogOptionsRef.current = { brands: br.brands, categories: ca.categories };
        setAdd((cur) => ({
          ...cur,
          open: true,
          fields: cur.fields.map((f) =>
            f.name === "brandId" ? { ...f, options: br.brands.map((b) => b.name) }
            : f.name === "categoryId" ? { ...f, options: ca.categories.map((c) => c.name) }
            : f
          ),
        }));
        return;
      } catch {
        // Fall back to whatever was loaded last, rather than blocking the
        // form entirely on a transient network hiccup.
      }
    }
    setAdd((cur) => ({ ...cur, open: true }));
  };


  return (
    <div className="management">
      <div className="managementHero">
        <div className="moduleIcon"><span style={{ fontSize: 22 }}>◈</span></div>
        <div><h2>Manage {title}</h2><p>{desc}</p></div>
        {canAdd && (
          <button className="blackButton" onClick={openAddForm}><Plus size={16} /> Add New</button>
        )}
      </div>

      {bannerState && (
        <div role={bannerState.tone === "error" ? "alert" : "status"} data-tone={bannerState.tone} style={{ padding: '10px 14px', background: bannerState.tone === "error" ? '#fef2f2' : '#eef8f1', color: bannerState.tone === "error" ? '#b91c1c' : '#018849', fontSize: 12, marginBottom: 14, border: `1px solid ${bannerState.tone === "error" ? '#fecaca' : '#d5efe0'}` }}>{bannerState.text}</div>
      )}

      {kind === "catalog" ? (
        <>
          <BrandCarouselSpeedSetting />
          <CatalogPanels
            loading={loading}
            error={error}
            load={load}
            query={query}
            setQuery={setQuery}
            brands={catalogData.brands}
            categories={catalogData.categories}
            onSetActive={async (section, id, active) => {
              try {
                if (section === "category") await api.updateAdminCategory(id, { active });
                else await api.updateAdminBrand(id, { active });
                setBanner(`${section === "category" ? "Category" : "Brand"} ${active ? "activated" : "deactivated"}`);
                await load(); // show exactly what the server now holds
              } catch (e) {
                if (handleAuthError(e, setBanner)) return;
                setBanner(userMessage(e, `Could not ${active ? "activate" : "deactivate"} it.`), "error");
              }
            }}
            onDelete={async (section, row) => {
              if (!window.confirm(`Delete ${section} "${row.primary}" permanently? This can't be undone.`)) return;
              try {
                if (section === "category") await api.deleteAdminCategory(row.id);
                else await api.deleteAdminBrand(row.id);
                setBanner(`${section === "category" ? "Category" : "Brand"} "${row.primary}" deleted`);
                await load();
              } catch (e) {
                if (handleAuthError(e, setBanner)) return;
                setBanner(userMessage(e, "Could not delete it."), "error");
              }
            }}
            onAdd={(section) => {
              setCatalogToAdd(section);
              setEditingBrand(null);
              setEditingCategory(null);
              resetLogo();
              setAdd({
                open: true,
                fields: [
                  { name: "name", label: `${section === "category" ? "Category" : "Brand"} name`, kind: "text" },
                  { name: "slug", label: "Slug (URL key, optional)", kind: "text" },
                  ...(section === "category"
                    ? [{ name: "icon", label: "Icon (small icon-library key, not a photo)", kind: "icon" as const }]
                    : []),
                ],
              });
            }}
            onEditBrand={handleEditBrand}
            onUploadLogo={handleUploadLogo}
            onRemoveLogo={handleRemoveLogo}
            onUploadCampaignImage={handleUploadCampaignImage}
            onRemoveCampaignImage={handleRemoveCampaignImage}
            onEditCategory={handleEditCategory}
            onUploadCategoryImage={handleUploadCategoryImage}
            onRemoveCategoryImage={handleRemoveCategoryImage}
          />
        </>
      ) : notImplemented ? (
        <div style={{ padding: 56, textAlign: 'center', border: '1px dashed #d1d5db', borderRadius: 12, color: '#71717a', fontFamily: 'ui-sans-serif, system-ui, sans-serif', background: '#fff' }}>
          <p style={{ fontWeight: 700, color: '#374151', marginBottom: 6 }}>This module is not wired up yet</p>
          <p style={{ fontSize: 13 }}>There is no backend endpoint for "{title}" yet, so no real data can be shown here.</p>
        </div>
      ) : kind === "products" ? (
        <ProductManagementTable
          reloadKey={productReload}
          canAdd={canAdd}
          onAdd={() => { setCreateAttrGroups([]); setCreateAttrSelected([]); lastCreateCategory.current = ""; setAdd({ ...add, open: true }); }}
          onEdit={(p) => {
            // Always edit the freshest server copy (stock may have changed since the list loaded).
            api.getAdminProduct(p.id).then((r) => setEditingProduct(r.product)).catch(() => setEditingProduct(p));
          }}
          setBanner={setBanner}
        />
      ) : (
        <CatalogManagementTable
          title={title}
          query={query}
          setQuery={setQuery}
          loading={loading}
          filtered={filtered}
          handleExport={handleExport}
          handleAdd={() => { setCreateAttrGroups([]); setCreateAttrSelected([]); lastCreateCategory.current = ""; setAdd({ ...add, open: true }); }}
          canAdd={canAdd}
          viewHref={kind === "orders" ? (r) => `/admin/orders/${r.id}` : undefined}
          extra={kind === "orders" ? (r) => <OrderStatusActions r={r} onChange={handleOrderStatus} /> : kind === "admins" ? (r) => <AdminToggleActions r={r} onToggle={handleAdminToggle} onPermissions={(row) => setPermsAdmin(row.raw as api.AdminUser)} /> : undefined}
        />
      )}

      {add.open && (
        <AddModal
          fields={add.fields}
          initial={
            editingBrand
              ? { name: editingBrand.name, slug: editingBrand.slug, active: editingBrand.active ? "Active" : "Inactive", ...(editingBrand.logo ? { logoTone: logoToneLabel(editingBrand) } : {}) }
              : editingCategory
              ? { name: editingCategory.name, slug: editingCategory.slug, displayOrder: String(editingCategory.displayOrder), active: editingCategory.active ? "Active" : "Inactive", icon: editingCategory.icon ?? "box" }
              : undefined
          }
          title={editingBrand ? "Edit Brand" : editingCategory ? "Edit Category" : kind === "admins" ? "Add New Admin" : kind === "products" ? "Add New Product" : kind === "catalog" ? (catalogToAdd === "category" ? "Add New Category" : "Add New Brand") : "Add New"}
          onClose={() => { setAdd({ ...add, open: false }); setCatalogToAdd(null); setEditingBrand(null); setEditingCategory(null); resetLogo(); }}
          onSubmit={handleAddSubmit}
          onDataChange={handleCreateCategoryChange}
          extra={kind === "products" && createAttrGroups.length > 0 ? (
            <div style={{ borderTop: '1px solid #e8e8e8', paddingTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Product attributes</div>
              <div style={{ fontSize: 10, color: '#999', marginBottom: 8 }}>Set by this product's category — assigned on creation.</div>
              {createAttrGroups.map((group) => (
                <div key={group.id} style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: '#555' }}>
                    {group.name} <small style={{ color: '#888', fontWeight: 400 }}>({group.selectionType === 'single_select' ? 'choose one' : 'choose any that apply'})</small>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {(group.options ?? []).map((opt) => {
                      const checked = createAttrSelected.includes(opt.id);
                      const groupOptionIds = (group.options ?? []).map((o) => o.id);
                      return (
                        <label
                          key={opt.id}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${checked ? '#111' : '#d3d3d3'}`, background: checked ? '#111' : '#fff', color: checked ? '#fff' : '#333', padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                        >
                          <input
                            type={group.selectionType === 'single_select' ? 'radio' : 'checkbox'}
                            name={group.selectionType === 'single_select' ? `create-attr-${group.id}` : undefined}
                            checked={checked}
                            onChange={() => {
                              setCreateAttrSelected((cur) => {
                                if (group.selectionType === 'single_select') {
                                  return [...cur.filter((id) => !groupOptionIds.includes(id)), opt.id];
                                }
                                return checked ? cur.filter((id) => id !== opt.id) : [...cur, opt.id];
                              });
                            }}
                          />
                          {opt.name}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : undefined}
          logoSection={kind === "catalog" && catalogToAdd !== "category" ? (
            <BrandLogoField
              preview={logoPreview}
              existingUrl={editingBrand?.logo?.url ?? null}
              removed={logoRemove}
              error={logoError}
              onSelect={handleLogoSelect}
              onRemove={handleLogoRemoveClick}
            />
          ) : undefined}
        />
      )}

      {editingProduct && (
        <ProductEditorModal
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={async () => { setProductReload((n) => n + 1); }}
        />
      )}

      {permsAdmin && (
        <AdminPermissionsEditor
          admin={{ id: permsAdmin.id, email: permsAdmin.email, role: permsAdmin.role, disabled: permsAdmin.disabled }}
          onClose={() => setPermsAdmin(null)}
          onSaved={async () => { setPermsAdmin(null); await load(); }}
        />
      )}
    </div>
  );
}

function CatalogManagementTable({ title, query, setQuery, loading, filtered, handleExport, handleAdd, canAdd, viewHref, extra }: {
  title: string;
  query: string;
  setQuery: (q: string) => void;
  loading: boolean;
  filtered: AdminRow[];
  handleExport: () => void;
  handleAdd: () => void;
  canAdd: boolean;
  /** Where a row's "View" opens (e.g. the order page). Rows without a detail page show no View button. */
  viewHref?: (r: AdminRow) => string;
  extra?: (r: AdminRow) => ReactNode;
}) {
  return (
    <>
      <div className="managementToolbar">
        <div className="searchBox"><Search size={16} /><input placeholder={`Search ${title.toLowerCase()}...`} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <button onClick={handleExport}><Download size={16} /> Export</button>
        {canAdd && <button className="blackButton" onClick={handleAdd}><Plus size={16} /> Add New</button>}
      </div>

      <div className={`tableCard${extra || viewHref ? " wideActions" : ""}`}>
        <div className="tableHead"><span>NAME / REFERENCE</span><span>STATUS</span><span>META</span><span>ACTIONS</span></div>
        {loading ? (
          <div className="tableRow"><div className="rowPrimary"><span>Loading…</span></div></div>
        ) : filtered.length === 0 ? (
          <div className="tableRow"><div className="rowPrimary"><span>No {title.toLowerCase()} found{query ? " for that search" : ""}.</span></div></div>
        ) : (
          filtered.map((r, i) => (
            <div className="tableRow" key={r.id || i}>
              <div className="rowPrimary"><div className="miniThumb">{i + 1}</div><div><b>{r.primary}</b>{r.sub ? <small style={{ display: 'block', color: '#888', fontSize: 11 }}>{r.sub}</small> : null}</div></div>
              <span className={`status ${r.statusTone === 'warn' ? 'warning' : r.statusTone === 'err' ? 'danger' : ''}`}>{r.status}</span>
              <span>{r.meta ?? ''}</span>
              <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                {extra?.(r)}
                {viewHref && <Link to={viewHref(r)} title="View details" aria-label={`View ${r.primary}`} className="tableIconLink"><Eye size={15} /></Link>}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}


/** Moves the API allows from each status (orders.repo VALID_TRANSITIONS). */
const NEXT_ORDER_STATUSES: Record<api.AdminOrder["status"], api.AdminOrder["status"][]> = {
  PENDING: ["PAID", "CANCELLED"],
  PAID: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

function OrderStatusActions({ r, onChange }: { r: AdminRow; onChange: (r: AdminRow, next: string) => void }) {
  const current = ((r.raw as api.AdminOrder)?.status ?? "PENDING") as api.AdminOrder["status"];
  const next = NEXT_ORDER_STATUSES[current] ?? [];
  if (next.length === 0) return null;
  return (
    <select
      title="Change order status"
      aria-label={`Change status of order ${r.primary}`}
      value=""
      onChange={(e) => {
        const to = e.target.value;
        if (!to) return;
        if (to === "CANCELLED" && !window.confirm(`Cancel order ${r.primary}? Its items go back into stock.`)) return;
        onChange(r, to);
      }}
      style={{ padding: "3px 6px", fontSize: 11, border: "1px solid #ddd", borderRadius: 4, background: "#fff", maxWidth: 110 }}
    >
      <option value="">Move to…</option>
      {next.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
    </select>
  );
}

/**
 * How fast the homepage "Shop by Brand" logo rail auto-scrolls. The storefront
 * reads this setting (components/brand-carousel.tsx → GET /settings/brand-section),
 * so it needs a place to be changed: saved to homepage_brand_settings through
 * PATCH /admin/settings/brand-section (brands.manage).
 */
function BrandCarouselSpeedSetting() {
  const [speed, setSpeed] = useState<api.BrandSectionSpeed | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  useEffect(() => {
    api.getBrandSectionSettings({ fresh: true }).then((r) => setSpeed(r.speed)).catch(() => setState("error"));
  }, []);
  const change = async (next: api.BrandSectionSpeed) => {
    const prev = speed;
    setSpeed(next); setState("saving");
    try {
      const r = await api.updateBrandSectionSettings(next);
      setSpeed(r.speed); setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setSpeed(prev); setState("error");
      setMessage(userMessage(e, "Could not save the carousel speed."));
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, fontSize: 12 }} data-role="brand-speed">
      <label htmlFor="brand-speed">Homepage brand carousel speed</label>
      <select id="brand-speed" value={speed ?? ""} disabled={speed === null || state === "saving"} onChange={(e) => change(e.target.value as api.BrandSectionSpeed)} style={{ border: "1px solid #ddd", padding: "6px 8px", fontSize: 12 }}>
        {speed === null && <option value="">Loading…</option>}
        <option value="slow">Slow</option>
        <option value="medium">Medium</option>
        <option value="fast">Fast</option>
      </select>
      {state === "saved" && <span style={{ color: "#166534" }}>Saved</span>}
      {state === "error" && <span role="alert" style={{ color: "#b91c1c" }}>{message || "Couldn't load the current speed."}</span>}
    </div>
  );
}

function AdminToggleActions({ r, onToggle, onPermissions }: { r: AdminRow; onToggle: (r: AdminRow, action: "disable" | "role") => void; onPermissions?: (r: AdminRow) => void }) {
  const a = r.raw as api.AdminUser;
  return (
    <>
      <button title={a.disabled ? "Re-activate" : "Suspend"} aria-label={`${a.disabled ? "Re-activate" : "Suspend"} ${a.email}`} onClick={() => onToggle(r, "disable")}>{a.disabled ? "↻" : "⊘"}</button>
      <button title="Toggle role (ADMIN / SUPER_ADMIN)" aria-label={`Make ${a.email} ${a.role === "SUPER_ADMIN" ? "an Admin" : "a Super Admin"}`} onClick={() => onToggle(r, "role")}>{a.role === "SUPER_ADMIN" ? "▼" : "▲"}</button>
      {a.role === "ADMIN" && onPermissions && (
        <button title={`Grant or revoke permissions for ${a.email}`} aria-label={`Permissions for ${a.email}`} onClick={() => onPermissions(r)}>⚿</button>
      )}
    </>
  );
}

function CatalogPanels({ loading, error, load, query, setQuery, brands, categories, onAdd, onSetActive, onDelete, onEditBrand, onUploadLogo, onRemoveLogo, onUploadCampaignImage, onRemoveCampaignImage, onEditCategory, onUploadCategoryImage, onRemoveCategoryImage }: {
  loading: boolean;
  error: string | null;
  load: () => void;
  query: string;
  setQuery: (q: string) => void;
  brands: AdminRow[];
  categories: AdminRow[];
  onAdd: (section: "brand" | "category") => void;
  onSetActive: (section: "brand" | "category", id: string, active: boolean) => void;
  onDelete: (section: "brand" | "category", row: AdminRow) => void;
  onEditBrand: (brand: api.Brand) => void;
  onUploadLogo: (brand: api.Brand, file: File) => void;
  onRemoveLogo: (brand: api.Brand) => void;
  onUploadCampaignImage: (brand: api.Brand, file: File) => void;
  onRemoveCampaignImage: (brand: api.Brand) => void;
  onEditCategory: (category: api.Category) => void;
  onUploadCategoryImage: (category: api.Category, file: File) => void;
  onRemoveCategoryImage: (category: api.Category) => void;
}) {
  const q = query.trim().toLowerCase();
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "no-image">("all");
  const filterRows = (rows: AdminRow[], kind: "brand" | "category") => rows.filter((r) => {
    if (q && !`${r.primary} ${r.sub ?? ''}`.toLowerCase().includes(q)) return false;
    const raw = r.raw as (api.Brand & api.Category) | undefined;
    if (statusFilter === "active") return !!raw?.active;
    if (statusFilter === "inactive") return !raw?.active;
    if (statusFilter === "no-image") return kind === "brand" ? !raw?.logo : !raw?.imageUrl;
    return true;
  });

  const [uploadTarget, setUploadTarget] = useState<api.Brand | null>(null);
  const [campaignImageTarget, setCampaignImageTarget] = useState<api.Brand | null>(null);
  const [categoryImageTarget, setCategoryImageTarget] = useState<api.Category | null>(null);

  const triggerUpload = (brand: api.Brand) => {
    setUploadTarget(brand);
    // Defer so the listener sees the updated target.
    requestAnimationFrame(() => {
      const el = document.getElementById("brand-logo-input") as HTMLInputElement | null;
      if (el) el.click();
    });
  };

  const onLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadTarget) onUploadLogo(uploadTarget, file);
    e.target.value = "";
    setUploadTarget(null);
  };

  const triggerCampaignImageUpload = (brand: api.Brand) => {
    setCampaignImageTarget(brand);
    requestAnimationFrame(() => {
      const el = document.getElementById("brand-campaign-image-input") as HTMLInputElement | null;
      if (el) el.click();
    });
  };

  const onCampaignImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && campaignImageTarget) onUploadCampaignImage(campaignImageTarget, file);
    e.target.value = "";
    setCampaignImageTarget(null);
  };

  const triggerCategoryImageUpload = (category: api.Category) => {
    setCategoryImageTarget(category);
    requestAnimationFrame(() => {
      const el = document.getElementById("category-image-input") as HTMLInputElement | null;
      if (el) el.click();
    });
  };

  const onCategoryImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && categoryImageTarget) onUploadCategoryImage(categoryImageTarget, file);
    e.target.value = "";
    setCategoryImageTarget(null);
  };

  const Panel = ({ label, rows }: { label: string; rows: AdminRow[] }) => (
    <div className="tableCard" style={{ flex: 1 }}>
      <div className="managementToolbar" style={{ justifyContent: 'space-between', marginBottom: 0 }}>
        <b style={{ fontSize: 13, padding: '12px 18px' }}>{label} <small style={{ color: '#888', fontWeight: 400 }}>({rows.length})</small></b>
        <button className="blackButton" onClick={() => onAdd(label === "Brands" ? "brand" : "category")}><Plus size={16} /> Add {label === "Brands" ? "Brand" : "Category"}</button>
      </div>
      {loading ? (
        <div className="tableRow"><div className="rowPrimary"><span>Loading…</span></div></div>
      ) : error ? (
        <div className="tableRow"><div className="rowPrimary" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
          <span style={{ color: '#c00' }}>{error}</span>
          <button className="blackButton" onClick={load}>RETRY</button>
        </div></div>
      ) : rows.length === 0 ? (
        <div className="tableRow"><div className="rowPrimary"><span>No {label.toLowerCase()} found.</span></div></div>
      ) : (
        rows.map((r, i) => (
          <div className="tableRow catalogRow" key={r.id || i} style={{ alignItems: 'center' }}>
            <div className="rowPrimary">
              {label === "Brands" ? (
                <BrandLogoThumb brand={r.raw as api.Brand} />
              ) : (r.raw as api.Category)?.imageUrl ? (
                <img src={api.assetUrl((r.raw as api.Category).imageUrl!)} alt="" className="miniThumb" style={{ objectFit: 'cover' }} />
              ) : (
                <div className="miniThumb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
                  {(() => { const Icon = categoryIcon((r.raw as api.Category)?.icon); return <Icon size={18} strokeWidth={1.6} />; })()}
                </div>
              )}
              <div>
                <b>{r.primary}</b>
                {r.sub ? <small style={{ display: 'block', color: '#888', fontSize: 11 }}>{r.sub}</small> : null}
                {label === "Brands" && (r.raw as api.Brand)?.productCount != null ? (
                  <small style={{ display: 'block', color: '#018849', fontSize: 11 }}>{(r.raw as api.Brand).productCount} products</small>
                ) : null}
              </div>
            </div>
            <span className="status">{r.status}</span>
            <span>{r.meta ?? ''}</span>
            {label === "Brands" ? (
              <>
                <span className="catalogActions">
                  <button title="Edit brand" aria-label={`Edit brand ${r.primary}`} onClick={() => onEditBrand(r.raw as api.Brand)}><Pencil size={15} /></button>
                  <button title={(r.raw as api.Brand)?.logo ? "Replace logo" : "Upload logo"} aria-label={`${(r.raw as api.Brand)?.logo ? "Replace" : "Upload"} logo for ${r.primary}`} onClick={() => triggerUpload(r.raw as api.Brand)}><ImagePlus size={15} /></button>
                  {(r.raw as api.Brand)?.logo && (
                    <button title="Remove logo" aria-label={`Remove logo from ${r.primary}`} onClick={() => onRemoveLogo(r.raw as api.Brand)}><ImageMinus size={15} /></button>
                  )}
                  <button title={(r.raw as api.Brand)?.campaignImage ? "Replace campaign image" : "Upload campaign image"} aria-label={`${(r.raw as api.Brand)?.campaignImage ? "Replace" : "Upload"} campaign image for ${r.primary}`} onClick={() => triggerCampaignImageUpload(r.raw as api.Brand)}><Image size={15} /></button>
                  {(r.raw as api.Brand)?.campaignImage && (
                    <button title="Remove campaign image" aria-label={`Remove campaign image from ${r.primary}`} onClick={() => onRemoveCampaignImage(r.raw as api.Brand)}><ImageOff size={15} /></button>
                  )}
                  <button title={(r.raw as api.Brand)?.active ? "Deactivate brand (hide from the store)" : "Activate brand"} aria-label={`${(r.raw as api.Brand)?.active ? "Deactivate" : "Activate"} brand ${r.primary}`} onClick={() => onSetActive("brand", r.id, !(r.raw as api.Brand)?.active)}>{(r.raw as api.Brand)?.active ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  <button title="Delete brand" aria-label={`Delete brand ${r.primary}`} onClick={() => onDelete("brand", r)}><Trash2 size={15} /></button>
                </span>
              </>
            ) : (
              <>
                <span className="catalogActions">
                  <button title="Edit category" aria-label={`Edit category ${r.primary}`} onClick={() => onEditCategory(r.raw as api.Category)}><Pencil size={15} /></button>
                  <button title={(r.raw as api.Category)?.imageUrl ? "Replace image" : "Upload image"} aria-label={`${(r.raw as api.Category)?.imageUrl ? "Replace" : "Upload"} image for ${r.primary}`} onClick={() => triggerCategoryImageUpload(r.raw as api.Category)}><ImagePlus size={15} /></button>
                  {(r.raw as api.Category)?.imageUrl && (
                    <button title="Remove image" aria-label={`Remove image from ${r.primary}`} onClick={() => onRemoveCategoryImage(r.raw as api.Category)}><ImageMinus size={15} /></button>
                  )}
                  <button title={(r.raw as api.Category)?.active ? "Deactivate category (hide from the store)" : "Activate category"} aria-label={`${(r.raw as api.Category)?.active ? "Deactivate" : "Activate"} category ${r.primary}`} onClick={() => onSetActive("category", r.id, !(r.raw as api.Category)?.active)}>{(r.raw as api.Category)?.active ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                  <button title="Delete category" aria-label={`Delete category ${r.primary}`} onClick={() => onDelete("category", r)}><Trash2 size={15} /></button>
                </span>
              </>
            )}
          </div>
        ))
      )}
    </div>
  );

  return (
    <div>
      {/* One hidden picker per upload kind (they used to be repeated in every
          row, all sharing the same id). The row buttons set the target first. */}
      <input id="brand-logo-input" type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onLogoFile} />
      <input id="brand-campaign-image-input" type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onCampaignImageFile} />
      <input id="category-image-input" type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={onCategoryImageFile} />
      <div className="managementToolbar">
        <div className="searchBox"><Search size={16} /><input placeholder="Search brands & categories..." value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #ddd', background: '#fff', padding: '0 10px', fontSize: 11 }}>
          <Filter size={16} aria-hidden="true" />
          <select aria-label="Filter brands and categories" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} style={{ border: 0, background: 'transparent', padding: '10px 0', fontSize: 11 }}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="no-image">Missing logo / image</option>
          </select>
        </label>
      </div>
      <div className="catalogPanels">
        <Panel label="Brands" rows={filterRows(brands, "brand")} />
        <Panel label="Categories" rows={filterRows(categories, "category")} />
      </div>
    </div>
  );
}

const LOGO_TONE_LABELS = {
  auto: "Auto-detect (recommended)",
  light: "Light / white logo — shown dark on light backgrounds",
  dark: "Dark logo — shown as uploaded",
} as const;

function logoToneLabel(brand: api.Brand): string {
  const tone = brand.logo?.tone;
  return tone === "light" ? LOGO_TONE_LABELS.light : tone === "dark" ? LOGO_TONE_LABELS.dark : LOGO_TONE_LABELS.auto;
}

/** Admin preview = exactly what the storefront shows (same BrandMark + tone treatment). */
function BrandLogoThumb({ brand }: { brand: api.Brand }) {
  if (brand.logo?.url) {
    return (
      <div title={brand.logo.tone === "light" ? "Light logo — shown dark on the storefront" : undefined} style={{ width: 40, height: 40, borderRadius: 6, overflow: 'hidden', border: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f2ee', padding: 3 }}>
        <BrandMark brand={brand} className="adminBrandThumbImg" />
      </div>
    );
  }
  return <div className="miniThumb">{brand.name?.[0]?.toUpperCase() ?? "?"}</div>;
}

function AddModal({ fields, title, onClose, onSubmit, initial, logoSection, onDataChange, extra }: {
  fields: { name: string; label: string; kind: "text" | "password" | "email" | "select" | "check" | "icon"; options?: string[] }[];
  title: string;
  onClose: () => void;
  onSubmit: (d: Record<string, string>) => void;
  initial?: Record<string, string>;
  logoSection?: React.ReactNode;
  onDataChange?: (d: Record<string, string>) => void;
  extra?: React.ReactNode;
}) {
  const [data, setData] = useState<Record<string, string>>(initial ?? {});
  const [checkErr, setCheckErr] = useState<Record<string, boolean>>({});
  const titleId = useId();
  const fieldId = (name: string) => `${titleId}-f-${name}`; // ties each label to its control
  const dialogRef = useRef<HTMLDivElement>(null);

  const patch = (field: string, value: string) => {
    const nxt = { ...data, [field]: value };
    setData(nxt);
    onDataChange?.(nxt);
  };

  useEffect(() => {
    // Move focus into the dialog when it opens — without this, focus
    // stays wherever it was on the page behind the modal, which is both
    // confusing for a screen-reader user (announcements keep coming from
    // the hidden page) and means keyboard Tab starts from an arbitrary
    // point rather than the dialog itself.
    dialogRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const toggleCheck = (field: string, value: string) => {
    setData((d) => {
      const cur = (d[field] ?? "").split(",").filter(Boolean);
      const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
      const nxt = { ...d, [field]: next.join(",") };
      onDataChange?.(nxt);
      return nxt;
    });
    setCheckErr((e) => ({ ...e, [field]: false }));
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ background: '#fff', width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto', padding: 22, position: 'relative' }}
      >
        <button onClick={onClose} aria-label="Close dialog" style={{ position: 'absolute', top: 12, right: 12, border: 'none', background: 'none', cursor: 'pointer' }}><X size={18} /></button>
        <h3 id={titleId} style={{ font: '800 18px Manrope', margin: '0 0 16px' }}>{title}</h3>
        {logoSection}
        <div style={{ display: 'grid', gap: 12, marginTop: logoSection ? 14 : 0 }}>
          {fields.map((f) => (
            <div key={f.name}>
              <label htmlFor={f.kind === "check" || f.kind === "icon" ? undefined : fieldId(f.name)} style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>{f.label}</label>
              {f.kind === "select" ? (
                <select id={fieldId(f.name)} style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={data[f.name] ?? ''} onChange={(e) => patch(f.name, e.target.value)}>
                  <option value="">Select…</option>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.kind === "icon" ? (
                <div data-role="icon-picker" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {CATEGORY_ICON_CHOICES.map((c) => {
                    const current = data[f.name] ?? "";
                    const selected = current ? current === c.key : c.key === "box";
                    const I = c.Icon;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        data-role="category-icon"
                        data-icon={c.key}
                        onClick={() => patch(f.name, c.key)}
                        style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 66, padding: '8px 4px', border: `1px solid ${selected ? '#111' : '#d3d3d3'}`, background: selected ? '#111' : '#fff', color: selected ? '#fff' : '#333', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}
                      >
                        <I size={20} strokeWidth={1.6} />
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              ) : f.kind === "check" ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(f.options ?? []).map((o) => {
                    const checked = (data[f.name] ?? "").split(",").includes(o);
                    return (
                      <label
                        key={o}
                        data-role="audience-check"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${checked ? '#111' : '#d3d3d3'}`, background: checked ? '#111' : '#fff', color: checked ? '#fff' : '#333', padding: '7px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                      >
                        <input
                          type="checkbox"
                          style={{ accentColor: '#111' }}
                          checked={checked}
                          onChange={() => toggleCheck(f.name, o)}
                        />
                        {o}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <input
                  id={fieldId(f.name)}
                  type={f.kind === "password" ? "password" : f.kind === "email" ? "email" : "text"}
                  autoComplete={f.kind === "password" ? (f.name === "actorPassword" ? "current-password" : "new-password") : undefined}
                  style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }}
                  value={data[f.name] ?? ''}
                  onChange={(e) => patch(f.name, e.target.value)}
                />
              )}
              {checkErr[f.name] && <div style={{ color: '#c00', fontSize: 11, marginTop: 4 }}>Select at least one.</div>}
            </div>
          ))}
          {extra}
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button
            className="blackButton"
            style={{ flex: 1 }}
            onClick={() => {
              // Enforce "at least one audience" for check fields before submit.
              for (const f of fields) {
                if (f.kind === "check" && !(data[f.name] ?? "").split(",").filter(Boolean).length) {
                  setCheckErr((e) => ({ ...e, [f.name]: true }));
                  return;
                }
              }
              onSubmit(data);
            }}
          >Save</button>
          <button style={{ flex: 1, border: '1px solid #ddd', background: '#fff', padding: '10px 13px', fontSize: 11 }} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function BrandLogoField({ preview, existingUrl, removed, error, onSelect, onRemove }: {
  preview: string | null;
  existingUrl: string | null;
  removed: boolean;
  error: string | null;
  onSelect: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  const shown = preview ?? (existingUrl && !removed ? existingUrl : null);
  return (
    <div style={{ border: `1px dashed ${error ? '#e5484d' : '#d3d3d3'}`, borderRadius: 10, padding: 18, textAlign: 'center', background: '#fafafa' }}>
      <div style={{ width: 92, height: 92, margin: '0 auto 12px', borderRadius: 10, border: '1px solid #e5e5e5', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', fontSize: 26, fontWeight: 800, color: '#cfcfcf', fontFamily: 'Manrope' }}>
        {shown ? <img src={shown} alt="Brand logo preview" style={{ width: '86%', height: '86%', objectFit: 'contain' }} /> : '—'}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#555', marginBottom: 4 }}>Brand Logo</div>
      <div style={{ fontSize: 10, color: '#999', marginBottom: 12 }}>PNG, JPG or WebP · max 5 MB</div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        <label className="blackButton" style={{ cursor: 'pointer', fontSize: 12, padding: '9px 14px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} /> {existingUrl && !removed && !preview ? 'Change Logo' : 'Upload Logo'}
          <input data-role="brand-logo-input" type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => { onSelect(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {(existingUrl && !removed && !preview) && (
          <button type="button" style={{ border: '1px solid #ddd', background: '#fff', padding: '9px 14px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={onRemove}>
            <X size={14} /> Remove Logo
          </button>
        )}
      </div>
      {error && <div style={{ color: '#c00', fontSize: 11, marginTop: 10 }}>{error}</div>}
    </div>
  );
}

export function ProductEditorModal({ product, onClose, onSaved }: {
  product: api.Product;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(product.name);
  const [slug, setSlug] = useState(product.slug);
  const [brandId, setBrandId] = useState(product.brand?.id ?? "");
  const [categoryId, setCategoryId] = useState(product.category?.id ?? "");
  const [brandOptions, setBrandOptions] = useState<api.Brand[]>(product.brand ? [product.brand] : []);
  const [categoryOptions, setCategoryOptions] = useState<api.Category[]>(product.category ? [product.category] : []);
  const [price, setPrice] = useState(String(product.priceCents));
  const [compareAt, setCompareAt] = useState(product.compareAtPriceCents != null ? String(product.compareAtPriceCents) : "");
  const [active, setActive] = useState(product.active);
  const [audiences, setAudiences] = useState<string[]>((product.genderAudiences ?? []).map((a) => a.code));
  const [audienceErr, setAudienceErr] = useState(false);
  const [lifestyleOptions, setLifestyleOptions] = useState<api.Lifestyle[]>([]);
  const [selectedLifestyleIds, setSelectedLifestyleIds] = useState<string[]>((product.lifestyles ?? []).map((l) => l.id));
  const [attributeGroups, setAttributeGroups] = useState<api.AttributeGroup[]>([]);
  const [selectedAttributeOptionIds, setSelectedAttributeOptionIds] = useState<string[]>([]);
  const [images, setImages] = useState<api.ProductImage[]>(product.images ?? []);
  const [sku, setSku] = useState(product.sku ?? "");
  const [shortDescription, setShortDescription] = useState(product.shortDescription ?? "");
  const [fullDescription, setFullDescription] = useState(product.fullDescription ?? "");
  const [badgeText, setBadgeText] = useState(product.badgeText ?? "");
  const [offerLabel, setOfferLabel] = useState(product.offerLabel ?? "");
  const [offerStart, setOfferStart] = useState(product.offerStartDate ?? "");
  const [offerEnd, setOfferEnd] = useState(product.offerEndDate ?? "");
  const [tags, setTags] = useState((product.tags ?? []).join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<api.ProductImage | null>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  // ---- Variant matrix (color × size × stock) ----
  type VariantDraft = { key: string; id?: string; size: string; color: string; stockQty: string; sku: string };
  const [variantRows, setVariantRows] = useState<VariantDraft[]>(
    (product.variants ?? []).map((v) => ({
      key: v.id,
      id: v.id,
      size: v.size,
      color: v.color,
      stockQty: String(v.stockQty ?? 0),
      sku: v.sku ?? "",
    }))
  );
  const [draft, setDraft] = useState({ color: "", size: "", stockQty: "0", sku: "" });
  const [variantsError, setVariantsError] = useState<string | null>(null);

  // Brand / category are editable (moving a product re-files it on every
  // brand, category and filter page automatically — they're all queries).
  useEffect(() => {
    let alive = true;
    Promise.all([api.listAdminBrands(), api.listAdminCategories()])
      .then(([b, c]) => { if (alive) { setBrandOptions(b.brands); setCategoryOptions(c.categories); } })
      .catch(() => { /* keep the current brand/category as the only option */ });
    return () => { alive = false; };
  }, []);

  const updateRow = (key: string, field: 'stockQty' | 'sku', value: string) => {
    setVariantsError(null);
    setVariantRows((cur) => cur.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  const removeRow = (key: string) => {
    setVariantsError(null);
    setVariantRows((cur) => cur.filter((r) => r.key !== key));
  };

  const addVariantRow = () => {
    const color = draft.color.trim();
    const size = draft.size.trim();
    if (!color || !size) { setVariantsError("Enter both a color and a size to add a variant."); return; }
    const dup = variantRows.some((r) => r.color.trim().toLowerCase() === color.toLowerCase() && r.size.trim().toLowerCase() === size.toLowerCase());
    if (dup) { setVariantsError(`Color "${color}" / size "${size}" already exists.`); return; }
    setVariantRows((cur) => [...cur, { key: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`, size, color, stockQty: draft.stockQty.trim() || "0", sku: draft.sku }]);
    setDraft({ color: "", size: "", stockQty: "0", sku: "" });
    setVariantsError(null);
  };

  const refresh = async () => {
    try { const r = await api.listProductImages(product.id); setImages(r.images); }
    catch (e) { setError(userMessage(e, "Could not load images")); }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const r = await api.listProductImages(product.id); if (alive) setImages(r.images); }
      catch (e) { if (alive) setError(userMessage(e, "Could not load images")); }
      try { const rl = await api.listAdminLifestyles(); if (alive) setLifestyleOptions(rl.items); }
      catch { /* lifestyle membership is optional — never block the editor on it */ }
      if (product.category?.slug) {
        try {
          const [ag, pav] = await Promise.all([
            api.listCategoryAttributes(product.category.slug, { fresh: true }),
            api.getProductAttributeOptionIds(product.id),
          ]);
          const groups = ag.groups.map((g) => ({ ...g, options: [...(g.options ?? [])] }));
          // The storefront list omits inactive groups/options. If this product
          // still carries one, load it from the admin endpoints and show it
          // (marked inactive) so it can be unticked — otherwise it could never
          // be removed, and the group/option could never be deleted.
          const shown = new Set(groups.flatMap((g) => g.options.map((o) => o.id)));
          const hidden = pav.optionIds.filter((id) => !shown.has(id));
          if (hidden.length > 0) {
            // Every group, not just this category's: a product moved to another
            // category keeps its old values until they are unticked here.
            for (const g of (await api.listAdminAttributeGroups()).groups) {
              const opts = (await api.listAttributeOptions(g.id)).options.filter((o) => hidden.includes(o.id));
              if (opts.length === 0) continue;
              const existing = groups.find((x) => x.id === g.id);
              if (existing) existing.options.push(...opts);
              else groups.push({ ...g, options: opts });
            }
          }
          if (alive) { setAttributeGroups(groups); setSelectedAttributeOptionIds(pav.optionIds); }
        } catch { /* attribute assignment is optional — never block the editor on it */ }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const saveFields = async () => {
    if (audiences.length === 0) { setAudienceErr(true); return; }
    setBusy(true); setError(null);
    // Empty optional fields are sent as null so they explicitly clear the row;
    // PATCH semantics distinguish omitted (undefined) from cleared (null).
    const trimOrNull = (v: string) => (v.trim() !== "" ? v.trim() : null);
    const parsedPrice = parseTzsAmount(price);
    const parsedCompareAt = compareAt.trim() !== "" ? parseTzsAmount(compareAt) : null;
    if (parsedPrice == null || parsedCompareAt === undefined) {
      setError("Enter prices as whole numbers of TZS, e.g. 25000 or 25,000.");
      setBusy(false);
      return;
    }
    if (!name.trim()) { setError("Enter a product name."); setBusy(false); return; }
    // A blank or non-whole stock value must never be saved as 0 by accident.
    const badStock = variantRows.find((r) => !/^\d+$/.test(r.stockQty.trim()));
    if (badStock) {
      setVariantsError(`Enter the stock for ${badStock.color} / ${badStock.size} as a whole number (0 or more).`);
      setError("Fix the highlighted stock quantity before saving.");
      setBusy(false);
      return;
    }
    try {
      // Variants first: publishing is validated server-side against the
      // SAVED variants/images, so a product published in the same save as
      // its first variants must have those variants stored already.
      await api.updateProductVariants(
        product.id,
        variantRows.map((r) => ({
          id: r.id ?? null,
          size: r.size.trim(),
          color: r.color.trim(),
          stockQty: Number(r.stockQty.trim()),
          sku: r.sku.trim() || null,
        }))
      );
      await api.updateAdminProduct(product.id, {
        name: name.trim(),
        slug: slug.trim() && slug.trim() !== product.slug ? slug.trim() : undefined,
        brandId: brandId && brandId !== product.brand?.id ? brandId : undefined,
        categoryId: categoryId && categoryId !== product.category?.id ? categoryId : undefined,
        priceCents: parsedPrice,
        active,
        genderAudiences: audiences,
        lifestyleIds: selectedLifestyleIds,
        compareAtPriceCents: parsedCompareAt,
        badgeText: trimOrNull(badgeText),
        offerLabel: trimOrNull(offerLabel),
        offerStartDate: trimOrNull(offerStart),
        offerEndDate: trimOrNull(offerEnd),
        sku: trimOrNull(sku),
        shortDescription: trimOrNull(shortDescription),
        fullDescription: trimOrNull(fullDescription),
        tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
      });
      if (attributeGroups.length > 0) {
        await api.setProductAttributeValues(product.id, selectedAttributeOptionIds);
      }
      await onSaved();
      onClose();
    } catch (e) {
      setError(describeApiError(e, "Could not save"));
    } finally { setBusy(false); }
  };

  const onUploadFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadBusy(true); setError(null);
    try { await api.uploadProductImage(product.id, file); await refresh(); }
    catch (e) { setError(userMessage(e, "Upload failed")); }
    finally { setUploadBusy(false); }
  };

  const moveImage = async (idx: number, dir: number) => {
    const next = [...images];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setImages(next);
    try { await api.reorderProductImages(product.id, next.map((i) => i.id)); await refresh(); }
    catch (e) { setError(userMessage(e, "Reorder failed")); }
  };

  const onReplaceFile = async (file: File | undefined) => {
    const img = replaceTarget;
    setReplaceTarget(null);
    if (!file || !img) return;
    setBusy(true); setError(null);
    try { await api.replaceProductImage(img.id, file); await refresh(); }
    catch (e) { setError(userMessage(e, "Replace failed")); }
    finally { setBusy(false); }
  };

  const removeImage = async (img: api.ProductImage) => {
    setBusy(true); setError(null);
    try { await api.deleteProductImage(img.id); await refresh(); }
    catch (e) { setError(userMessage(e, "Delete failed")); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#fff', width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto', padding: 24, position: 'relative' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 14, right: 14, border: 'none', background: 'none', cursor: 'pointer' }}><X size={20} /></button>
        <h3 style={{ font: '800 20px Manrope', margin: '0 0 6px' }}>Edit Product</h3>
        <p style={{ fontSize: 11, color: '#777', margin: '0 0 18px' }}>
          {product.archivedAt ? 'Archived' : product.active ? 'Live on the storefront' : 'Draft — not visible to customers'}
          {product.createdAt ? ` · Created ${new Date(product.createdAt).toLocaleDateString()}` : ''}
          {product.publishedAt ? ` · First published ${new Date(product.publishedAt).toLocaleDateString()}` : ''}
          {product.updatedAt ? ` · Updated ${new Date(product.updatedAt).toLocaleString()}` : ''}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Product name</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Price (TZS)</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Brand</label>
            <select data-role="edit-brand" style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12, background: '#fff' }} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
              {brandOptions.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active === false ? ' (inactive)' : ''}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Category</label>
            <select data-role="edit-category" style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12, background: '#fff' }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              {categoryOptions.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active === false ? ' (inactive)' : ''}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Slug (product URL)</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={slug} onChange={(e) => setSlug(e.target.value)} />
            <small style={{ fontSize: 10, color: '#999' }}>Letters, numbers and dashes — e.g. classic-oversized-tee. Changing it changes the product link.</small>
          </div>
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4, cursor: 'pointer' }}>
          <input data-role="edit-published" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Published — visible on the storefront
        </label>
        <p style={{ fontSize: 10, color: '#999', margin: '0 0 18px' }}>Publishing needs at least one image and one color/size variant. Newly published products appear first in THE LATEST DROP.</p>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Pricing &amp; Offer <small style={{ color: '#888', fontWeight: 400 }}>(sale = compare-at above price, within the window)</small></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 8 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Compare-at price (TZS)</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={compareAt} onChange={(e) => setCompareAt(e.target.value)} placeholder="Leave empty for no sale" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Offer window start (YYYY-MM-DD)</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={offerStart} onChange={(e) => setOfferStart(e.target.value)} placeholder="Empty = no lower bound" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Offer window end (YYYY-MM-DD)</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={offerEnd} onChange={(e) => setOfferEnd(e.target.value)} placeholder="Empty = no upper bound" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Collection tags (comma-separated)</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. premium, new — drives homepage featured sections" />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
            {(() => {
              const p = Number(price);
              const c = compareAt.trim() !== "" ? Number(compareAt) : NaN;
              if (Number.isFinite(p) && p > 0 && Number.isFinite(c) && c > p) {
                return <span style={{ background: '#10231b', color: '#fff', fontSize: 11, fontWeight: 700, padding: '7px 12px', borderRadius: 5 }}>Save {Math.floor((100 * (c - p)) / c)}%</span>;
              }
              return <span style={{ color: '#999', fontSize: 11, fontStyle: 'italic' }}>Not on sale</span>;
            })()}
          </div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Merchandising</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>SKU (unique)</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={sku} onChange={(e) => setSku(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Badge</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={badgeText} onChange={(e) => setBadgeText(e.target.value)} placeholder="e.g. NEW" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Offer label</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={offerLabel} onChange={(e) => setOfferLabel(e.target.value)} placeholder="e.g. Spring 30%" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Short description</label>
            <input style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12 }} value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} placeholder="One-line lede" />
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, marginBottom: 4, color: '#555' }}>Full description</label>
          <textarea style={{ width: '100%', border: '1px solid #ddd', padding: '9px 10px', fontSize: 12, minHeight: 72, resize: 'vertical' }} value={fullDescription} onChange={(e) => setFullDescription(e.target.value)} placeholder="Long-form product body (plain text)" />
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
          Gender / Audience <small style={{ color: '#888', fontWeight: 400 }}>(select at least one — a product can belong to several)</small>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
          {[["women", "Women"], ["men", "Men"], ["unisex", "Unisex"]].map(([code, label]) => {
            const checked = audiences.includes(code);
            return (
              <label
                key={code}
                data-role="product-audience"
                data-audience={code}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${checked ? '#111' : '#d3d3d3'}`, background: checked ? '#111' : '#fff', color: checked ? '#fff' : '#333', padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
              >
                <input type="checkbox" data-role="product-audience-box" data-audience={code} checked={checked} onChange={() => {
                  setAudienceErr(false);
                  setAudiences((cur) => checked ? cur.filter((c) => c !== code) : [...cur, code]);
                }} />
                {label}
              </label>
            );
          })}
        </div>
        {audienceErr && <div style={{ color: '#c00', fontSize: 11, marginBottom: 12 }}>Select at least one gender/audience.</div>}

        {lifestyleOptions.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
              Shop by Lifestyle <small style={{ color: '#888', fontWeight: 400 }}>(optional — a product can belong to several; one product is never duplicated)</small>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
              {lifestyleOptions.map((l) => {
                const checked = selectedLifestyleIds.includes(l.id);
                return (
                  <label
                    key={l.id}
                    data-role="product-lifestyle"
                    data-lifestyle={l.slug}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${checked ? '#111' : '#d3d3d3'}`, background: checked ? '#111' : '#fff', color: checked ? '#fff' : '#333', padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  >
                    <input type="checkbox" data-role="product-lifestyle-box" data-lifestyle={l.slug} checked={checked} onChange={() => {
                      setSelectedLifestyleIds((cur) => checked ? cur.filter((x) => x !== l.id) : [...cur, l.id]);
                    }} />
                    {l.name}
                  </label>
                );
              })}
            </div>
          </>
        )}

        {attributeGroups.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            {attributeGroups.map((group) => (
              <div key={group.id} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  {group.name} <small style={{ color: '#888', fontWeight: 400 }}>({group.selectionType === 'single_select' ? 'choose one' : 'choose any that apply'}){group.active === false ? ' · inactive, hidden from shoppers' : ''}</small>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(group.options ?? []).map((opt) => {
                    const checked = selectedAttributeOptionIds.includes(opt.id);
                    const groupOptionIds = (group.options ?? []).map((o) => o.id);
                    return (
                      <label
                        key={opt.id}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${checked ? '#111' : '#d3d3d3'}`, background: checked ? '#111' : '#fff', color: checked ? '#fff' : '#333', padding: '8px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                      >
                        <input
                          type={group.selectionType === 'single_select' ? 'radio' : 'checkbox'}
                          name={group.selectionType === 'single_select' ? `attr-group-${group.id}` : undefined}
                          checked={checked}
                          onChange={() => {
                            setSelectedAttributeOptionIds((cur) => {
                              if (group.selectionType === 'single_select') {
                                // Only one option from THIS group at a time — drop every other
                                // option belonging to this group before adding the new one.
                                return [...cur.filter((id) => !groupOptionIds.includes(id)), opt.id];
                              }
                              return checked ? cur.filter((id) => id !== opt.id) : [...cur, opt.id];
                            });
                          }}
                        />
                        {opt.name}{opt.active === false ? ' (inactive)' : ''}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          Variants <small style={{ color: '#888', fontWeight: 400 }}>(color + size + stock; stock 0 disables it on the storefront)</small>
        </div>
        <div className="vMatrix" style={{ marginBottom: 14 }}>
          {variantRows.length === 0 ? (
            <p style={{ color: '#999', fontSize: 11, margin: 0 }}>No variants — the product will show as unavailable until you add at least one color/size combination.</p>
          ) : (
            variantRows.map((r) => (
              <div className="vMatrixRow" key={r.key}>
                <span className="vMatrixNames" title="Immutable key for existing variants">{r.color}</span>
                <span className="vMatrixNames" title="Immutable key for existing variants">{r.size}</span>
                <input type="number" min={0} value={r.stockQty} aria-label={`Stock for ${r.color} ${r.size}`} onChange={(e) => updateRow(r.key, 'stockQty', e.target.value)} />
                <input value={r.sku} aria-label={`SKU for ${r.color} ${r.size}`} placeholder="SKU (optional)" onChange={(e) => updateRow(r.key, 'sku', e.target.value)} />
                <button type="button" className="rmBtn" title="Remove this variant" onClick={() => removeRow(r.key)}><X size={15} /></button>
              </div>
            ))
          )}
          <div className="vMatrixFoot">
            <input value={draft.color} placeholder="Color (e.g. Black)" aria-label="New color" onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))} />
            <input value={draft.size} placeholder="Size (e.g. M / 42)" aria-label="New size" onChange={(e) => setDraft((d) => ({ ...d, size: e.target.value }))} />
            <input type="number" min={0} value={draft.stockQty} aria-label="New stock" onChange={(e) => setDraft((d) => ({ ...d, stockQty: e.target.value }))} />
            <input value={draft.sku} placeholder="SKU (optional)" aria-label="New variant SKU" onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))} />
          </div>
          <button type="button" className="vMatrixAdd" onClick={addVariantRow}>+ Add color/size row</button>
        </div>
        {variantsError && <div style={{ color: '#c00', fontSize: 11, marginBottom: 12 }}>{variantsError}</div>}

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Product Images <small style={{ color: '#888', fontWeight: 400 }}>(first = primary)</small></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12, marginBottom: 14 }}>
          {(images.length ? images : []).map((img, i) => (
            <div key={img.id} style={{ border: '1px solid #e5e5e5', borderRadius: 8, overflow: 'hidden', position: 'relative', background: '#fafafa' }}>
              <div style={{ aspectRatio: '3/4', overflow: 'hidden', background: '#eee' }}>
                <img src={api.assetUrl(img.url) ?? undefined} alt={i === 0 ? "Product image 1 (primary)" : `Product image ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              {i === 0 && <span style={{ position: 'absolute', top: 6, left: 6, background: '#151515', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>PRIMARY</span>}
              <div style={{ display: 'flex', gap: 6, padding: 6 }}>
                <button type="button" title="Move earlier" style={{ flex: 1, border: '1px solid #ddd', background: '#fff', fontSize: 12, cursor: 'pointer' }} onClick={() => moveImage(i, -1)}>▲</button>
                <button type="button" title="Move later" style={{ flex: 1, border: '1px solid #ddd', background: '#fff', fontSize: 12, cursor: 'pointer' }} onClick={() => moveImage(i, 1)}>▼</button>
                <button type="button" title="Replace" style={{ flex: 1, border: '1px solid #ddd', background: '#fff', fontSize: 10, cursor: 'pointer' }} onClick={() => { setReplaceTarget(img); requestAnimationFrame(() => replaceRef.current?.click()); }}>RPL</button>
                <button type="button" title="Delete" style={{ flex: 1, border: '1px solid #e5c8c8', background: '#fff', color: '#c00', fontSize: 12, cursor: 'pointer' }} onClick={() => removeImage(img)}>✕</button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            disabled={uploadBusy}
            style={{ aspectRatio: '3/4', border: '1px dashed #ccc', background: '#fafafa', color: '#555', fontSize: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Plus size={20} /> {uploadBusy ? "Uploading…" : "Upload"}
          </button>
        </div>
        <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => { onUploadFile(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={replaceRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => { onReplaceFile(e.target.files?.[0]); e.target.value = ""; }} />

        {error && (
          <div style={{ color: '#c00', fontSize: 11, marginBottom: 12 }}>
            {error} <button type="button" onClick={refresh} style={{ marginLeft: 8, textDecoration: 'underline', color: '#c00', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, padding: 0 }}>Retry</button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="blackButton" disabled={busy} onClick={saveFields}>{busy ? "Saving…" : "Save Changes"}</button>
          <button style={{ flex: 1, border: '1px solid #ddd', background: '#fff', padding: '10px 13px', fontSize: 11 }} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const GENERIC_SEED_REMOVED = true;
