/**
 * Storage instances for each media category (brand logos, product images,
 * hero images, lifestyle images) — each scoped to its own subdirectory
 * (local disk) or key prefix (S3), so uploads across categories never
 * collide.
 *
 * All four are backed by ONE StorageProvider implementation, chosen by
 * `STORAGE_PROVIDER` (see config.ts / .env.example) — "local" (dev-only,
 * see local-disk-provider.ts for why) or "s3" (production-safe, works
 * across multiple instances). Business logic (the domain services, and
 * MediaService — see media.service.ts) only ever sees the
 * `BrandLogoStorage`/etc. type aliases below, never which concrete
 * provider is behind them.
 *
 * Historical note: this file used to define 4 separate, identical
 * interfaces (BrandLogoStorage/ProductImageStorage/HeroImageStorage/
 * LifestyleImageStorage) and one LocalDiskStorage class directly. That's
 * now consolidated into the single `StorageProvider` interface
 * (provider.ts) — these four names are kept as type aliases purely so the
 * existing call sites (catalog.service.ts, hero.service.ts,
 * lifestyles.service.ts) don't need to change their imports.
 */
import { resolve } from "path";
import { config } from "../config";
import type { StorageProvider } from "./provider";
import { LocalDiskStorageProvider } from "./local-disk-provider";
import { S3StorageProvider } from "./s3-provider";
import type { BrandLogo, ProductImage } from "../db/types";

export type { StoredObject, StorageProvider } from "./provider";
export type BrandLogoStorage = StorageProvider;
export type ProductImageStorage = StorageProvider;
export type HeroImageStorage = StorageProvider;
export type LifestyleImageStorage = StorageProvider;

/** Absolute directory for a given upload subdirectory (local-disk provider only). */
function resolveLocalDir(subdir: string): string {
  const base = config.uploads.dir || resolve(process.cwd(), "public", "uploads");
  return resolve(base, subdir);
}

/** Builds one category's StorageProvider instance from the configured provider type. */
function buildProvider(category: { subdir: string; publicPath: string }): StorageProvider {
  if (config.storage.provider === "s3") {
    const s3 = config.storage.s3;
    return new S3StorageProvider({
      bucket: s3.bucket,
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      accessKeyId: s3.accessKeyId,
      secretAccessKey: s3.secretAccessKey,
      publicBaseUrl: s3.publicBaseUrl,
      keyPrefix: s3.keyPrefix ? `${s3.keyPrefix}/${category.subdir}` : category.subdir,
    });
  }
  return new LocalDiskStorageProvider({
    dir: resolveLocalDir(category.subdir),
    publicPath: category.publicPath,
  });
}

/** Brand logos live under public/uploads/brands/ mapped to /uploads/brands/ (or the S3 equivalent prefix). */
export const brandLogoStorage: BrandLogoStorage = buildProvider({ subdir: "brands", publicPath: "/uploads/brands" });

/** Large lifestyle/campaign photo per brand (migration 0045) — a separate subdirectory from the small logo mark above, since they're visually and semantically distinct assets. */
export const brandCampaignImageStorage: StorageProvider = buildProvider({ subdir: "brand-campaigns", publicPath: "/uploads/brand-campaigns" });

/** Product images live under public/uploads/products/ mapped to /uploads/products/ (or the S3 equivalent prefix). */
export const productImageStorage: ProductImageStorage = buildProvider({ subdir: "products", publicPath: "/uploads/products" });

/** Hero advertisement images live under public/uploads/heroes/ (or the S3 equivalent prefix). */
export const heroImageStorage: HeroImageStorage = buildProvider({ subdir: "heroes", publicPath: "/uploads/heroes" });
export const heroVideoStorage: StorageProvider = buildProvider({ subdir: "hero-videos", publicPath: "/uploads/hero-videos" });

/** Lifestyle hero images live under public/uploads/lifestyles/ (or the S3 equivalent prefix). */
export const lifestyleImageStorage: LifestyleImageStorage = buildProvider({ subdir: "lifestyles", publicPath: "/uploads/lifestyles" });

/** Platform branding assets (logo, favicon) live under public/uploads/branding/ (or the S3 equivalent prefix). */
export const platformBrandingStorage: StorageProvider = buildProvider({ subdir: "branding", publicPath: "/uploads/branding" });

/** Category storefront card images live under public/uploads/categories/ (or the S3 equivalent prefix). */
export const categoryImageStorage: StorageProvider = buildProvider({ subdir: "categories", publicPath: "/uploads/categories" });

/** Payment method icons live under public/uploads/payment-icons/ (or the S3 equivalent prefix). */
export const paymentMethodIconStorage: StorageProvider = buildProvider({ subdir: "payment-icons", publicPath: "/uploads/payment-icons" });

/** Auth page background images live under public/uploads/auth-page/ (or the S3 equivalent prefix). */
export const authPageStorage: StorageProvider = buildProvider({ subdir: "auth-page", publicPath: "/uploads/auth-page" });

/** Builds a brand-logo record for persistence from a put result + validated image info. */
export function toBrandLogoRow(input: {
  id: string;
  brandId: string;
  stored: { storageKey: string; url: string };
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
}): BrandLogo {
  return {
    id: input.id,
    brandId: input.brandId,
    storageKey: input.stored.storageKey,
    url: input.stored.url,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    width: input.width,
    height: input.height,
    createdAt: "",
    updatedAt: "",
  };
}

/** Builds a product-image record for persistence from a put result + validated image info. */
export function toProductImageRow(input: {
  id: string;
  url: string;
  storageKey: string;
  contentType: string;
  sizeBytes: number;
  width: number;
  height: number;
}): ProductImage {
  return {
    id: input.id,
    productId: "",
    url: input.url,
    position: 0,
    altText: null,
    storageKey: input.storageKey,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    width: input.width,
    height: input.height,
    createdAt: "",
  };
}
