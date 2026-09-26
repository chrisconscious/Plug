import type { Role } from "../rbac";

export type User = {
  id: string;
  email: string | null;
  phoneNumber: string | null;
  fullName: string | null;
  passwordHash: string;
  role: Role;
  disabled: boolean;
  emailVerified: boolean;
  totpSecret: string | null;
  mfaEnabled: boolean;
  createdAt: string;
};

export type Address = {
  id: string;
  userId: string;
  label: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  phone?: string;
  /** Optional because Omit<Address, "id" | "userId"> is also used as the shape of an order's shipping-address SNAPSHOT (orders.repo.ts), which has no meaningful "default" concept. Address-book rows (addresses.repo.ts) always set this to a real true/false. */
  isDefault?: boolean;
};

export type Category = { id: string; slug: string; name: string; parentId?: string | null; imageUrl?: string | null; icon: string; active: boolean; displayOrder: number };

export type GenderAudience = { code: string; name: string };

/**
 * A single "Shop by Lifestyle" taxonomy entry (migration 0019). Lifestyle =
 * "where/when you wear it" (e.g. Campus Life, Night Out); it is deliberately
 * separate from Category ("what it is"). Image bytes live outside Postgres;
 * this row keeps the public URL plus the validated upload metadata.
 */
export type Lifestyle = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  heroImageUrl: string | null;
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Count of active products assigned to this lifestyle (public/admin listing). */
  productCount?: number;
};

export type LifestyleRow = {
  id: string;
  slug: string;
  name: string;
  short_description: string | null;
  hero_image_url: string | null;
  storage_key: string | null;
  content_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  active: boolean;
  display_order: number;
  created_at: Date | string;
  updated_at: Date | string;
};

/** Light lifestyle projection attached to a serialized Product (its memberships). */
export type ProductLifestyleRef = {
  id: string;
  slug: string;
  name: string;
};

export type Brand = {
  id: string;
  slug: string;
  name: string;
  active: boolean;
  displayOrder: number;
  /** Populated on the public/admin listing with the logo metadata, if any. */
  logo?: BrandLogo | null;
  /** The large lifestyle/campaign photo used by the storefront Shop by Brand cards (migration 0045) — distinct from the small logo mark above. */
  campaignImage?: BrandCampaignImage | null;
  /** Count of active products sold under this brand (admin listing only). */
  productCount?: number;
};

export type BrandLogo = {
  id: string;
  brandId: string;
  storageKey: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
  /** Presentation hint (migration 0054): "light" logos get a dark treatment on light surfaces. */
  tone?: "light" | "dark" | null;
};

/** Same shape as BrandLogo (deliberately) — see migration 0045's header for why this is a separate table/type rather than reusing BrandLogo. */
export type BrandCampaignImage = {
  id: string;
  brandId: string;
  storageKey: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
};
export type HeroType = "promotional" | "lifestyle" | "editorial";

/**
 * A single homepage hero advertisement (carousel slide). Content fields are
 * admin-editable; composition/layout are system-controlled via `heroType`.
 * Image bytes are stored outside Postgres (see src/lib/storage); this row
 * keeps the public URL plus, when uploaded through the validated pipeline,
 * the storage key and magic-byte-sniffed content type/dimensions.
 */
/** Storefront "Shop by brands" marquee autoplay speed — see migration 0020. */
export type BrandSectionSpeed = "slow" | "medium" | "fast";

export type HeroSlide = {
  id: string;
  campaignLabel: string;
  headline: string;
  description: string;
  ctaText: string;
  ctaUrl: string;
  cta2Text: string | null;
  cta2Url: string | null;
  badgeText: string | null;
  editorialText: string | null;
  heroType: HeroType;
  imageUrl: string;
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  videoUrl: string | null;
  videoStorageKey: string | null;
  videoContentType: string | null;
  videoSizeBytes: number | null;
  displayOrder: number;
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * A single payment path offered at checkout. `CASH` rows carry the flat
 * transport/delivery fee (`feeCents`); `ONLINE` rows are mobile-money networks
 * with a `paymentNumber` the customer is told to pay into. All rows are managed
 * by Super Admins via the `payment_methods.manage` permission.
 */
export type PaymentMethodKind = "CASH" | "ONLINE";

export type PaymentMethod = {
  id: string;
  kind: PaymentMethodKind;
  name: string;
  paymentNumber: string | null;
  feeCents: number;
  feeTzs: number;
  isActive: boolean;
  displayOrder: number;
  iconUrl: string | null;
  instructions: string | null;
  createdAt: string;
  updatedAt: string;
};


export type ProductImage = {
  id: string;
  productId: string;
  url: string;
  position: number;
  altText: string | null;
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
};

export type Product = {
  id: string;
  slug: string;
  name: string;
  brandId: string;
  categoryId: string;
  priceCents: number; // integer minor units, server-authoritative
  images: ProductImage[];
  active: boolean;
  compareAtPriceCents?: number | null; // set on sale items
  gender?: string | null; // women | men | unisex | null  (LEGACY single-column — see 0011; the join table is authoritative)
  genderAudiences?: GenderAudience[]; // authoritative audience set (from product_gender_audiences)
  lifestyles?: ProductLifestyleRef[]; // assigned lifestyles (from product_lifestyles, migration 0019)
  tags?: string[]; // collections: new | trending | campus | ...
  sku?: string | null;
  shortDescription?: string | null;
  fullDescription?: string | null;
  badgeText?: string | null;
  offerLabel?: string | null;
  offerStartDate?: string | null; // ISO date (yyyy-mm-dd)
  offerEndDate?: string | null; // ISO date (yyyy-mm-dd)
  publishedAt?: string | null; // first time the product went live (migration 0053)
  archivedAt?: string | null; // set while the product is archived ("deleted")
  createdAt?: string;
  updatedAt?: string;
};

export type ProductVariant = {
  id: string;
  productId: string;
  size: string;
  color: string;
  stockQty: number;
  sku?: string | null;
};

export type CartItem = {
  id: string;
  userId: string;
  variantId: string;
  quantity: number;
};

export type WishlistItem = { id: string; userId: string; productId: string };

export type OrderStatus = "PENDING" | "PAID" | "SHIPPED" | "DELIVERED" | "CANCELLED";

export type OrderItem = {
  productId: string;
  variantId: string;
  nameSnapshot: string;
  brandSnapshot: string;
  size: string;
  color: string;
  unitPriceCentsSnapshot: number;
  quantity: number;
  lineTotalCents: number;
};

/**
 * MONEY MODEL — read this before touching any *Cents or *Tzs field.
 *
 * Every money amount in this codebase — every `*Cents` field, `Cents`
 * branded type (lib/money.ts), and database `*_cents` column — holds a
 * whole TZS (Tanzanian Shilling) amount, NOT real cents. There are no
 * fractional subunits anywhere in this system.
 *
 * Why the name says "cents" when it means TZS: this app originally used
 * a USD-cents model. Migration 0042 switched the actual unit to whole
 * TZS, but did NOT rename every existing column/field to match — a
 * live rename of database columns and every call site referencing them
 * is a materially riskier change than documenting the discrepancy
 * clearly (see docs/DATABASE.md and this file's own header). So the
 * naming is historical, not descriptive; treat every "cents" you see
 * here as "TZS" instead.
 *
 * Below, `transportFeeCents` and `transportFeeTzs` (and `totalCents` /
 * `totalTzs`) are the SAME value under two names — the *Cents fields
 * are the original naming this type has always used; the *Tzs fields
 * were added later specifically to give frontend code an honestly-named
 * field to read instead of a "cents" field that isn't cents. Both are
 * populated from the same source and are never expected to diverge;
 * this isn't two competing totals, just two labels for one number.
 */
export type Order = {
  id: string;
  userId: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  shippingAddressSnapshot: Omit<Address, "id" | "userId">;
  paymentMethodKind: PaymentMethodKind | null;
  paymentMethodName: string | null;
  paymentNumber: string | null;
  transportFeeCents: number;
  transportFeeTzs: number;
  totalTzs: number;
  transportPaymentNumber: string | null;
  transportPaymentName: string | null;
  deliveryLocation: "dar_es_salaam" | "outside_dar" | null;
  createdAt: string;
};

export type Session = {
  id: string;
  userId: string;
  revoked: boolean;
  createdAt: string;
  expiresAt: string;
};

export type AuditEvent = {
  id: string;
  actorId: string;
  actorRole: Role;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

/** A single admin-defined option within an attribute group (e.g. "Baggy" under "Fit"). */
export type AttributeOption = {
  id: string;
  attributeGroupId: string;
  name: string;
  slug: string;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * An admin-defined product characteristic dimension (e.g. "Fit", "Neckline").
 * See migration 0033's header comment for why this is "attribute", not
 * "filter" — this codebase's existing vocabulary already uses "filter" for
 * the separate size/color/brand/price system in product-filter.repo.ts.
 */
export type AttributeGroup = {
  id: string;
  name: string;
  slug: string;
  selectionType: "multi_select" | "single_select";
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Category ids this group is assigned to — present on admin reads, not always populated. */
  categoryIds?: string[];
  /** Present when the group's options were loaded alongside it (e.g. the storefront's per-category query). */
  options?: AttributeOption[];
};

/** A header announcement bar message (migration 0034). */
export type Announcement = {
  id: string;
  message: string;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** A globally admin-managed accordion section shown on every product detail page (migration 0040). */
export type ProductAccordionSection = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};
