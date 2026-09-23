import { useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { Link } from "react-router-dom";
import * as api from "../../lib/api";
import { formatTZS } from "../../lib/currency";
import { getProductUrl } from "../../lib/links";
import { isWishlisted, onWishlistChange, toggleWishlist } from "../../lib/wishlist";
import type { Product } from "../../lib/api";
import { PLACEHOLDER_IMG, resolveImage } from "../../lib/imagePlaceholder";

const COLOR_HEX: Record<string, string> = {
  black: "#151515",
  navy: "#1f2a44",
  white: "#f5f5f0",
  beige: "#d9c6a9",
  cream: "#f3ead9",
  grey: "#9b9b9b",
  gray: "#9b9b9b",
  charcoal: "#3c3c3c",
  brown: "#6f4e37",
  tan: "#c6a87c",
  cognac: "#9a463d",
  burgundy: "#6d2232",
  red: "#a83030",
  rose: "#d98a96",
  pink: "#e6a8c2",
  gold: "#c9a54a",
  silver: "#c0c0c8",
  blue: "#2f4f8f",
  olive: "#5f6d3f",
  green: "#3d6b4a",
  khaki: "#88764a",
  nude: "#d9b8a6",
  purple: "#7c246d",
};

/** Maps a variant color name (or "Default") to a hex swatch for the card dot. */
function swatch(color: string): string {
  const c = color.trim().toLowerCase();
  if (COLOR_HEX[c]) return COLOR_HEX[c];
  // Simple deterministic hash → stable pastel-ish hue so unknown names still
  // produce a distinguishable (but stable) indicator dot.
  let h = 0;
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) % 360;
  return `hsl(${h}, 45%, 55%)`;
}

function cardImage(img: api.ProductImage | undefined, name: string): string {
  return resolveImage(img?.url);
}

/** Broken-image safe <img>: swaps to the bundled placeholder on load error (no console spam). */
function SafeImg({ src, alt, className, draggable }: { src: string; alt: string; className?: string; draggable?: boolean }) {
  const [errored, setErrored] = useState(false);
  return (
    <img
      src={errored ? PLACEHOLDER_IMG : src}
      alt={alt}
      loading="lazy"
      draggable={draggable ?? false}
      onError={() => setErrored(true)}
      className={className}
    />
  );
}

/**
 * Unified premium product card — the single card used across Homepage, Shop,
 * Search, Category, Collection, Brand and Wishlist.
 *
 * Behavior:
 *  - Desktop: hover cross-fades to the second image (when it exists).
 *  - Mobile/touch: a swipeable gallery (dots shown when there are 2+ images).
 *  - Wishlist toggle (client-local, persisted to localStorage).
 *  - SALE / compare-at price badge when the product is discounted.
 *  - Color-dot indicators derived from the product's variant colors
 *    (indicator-only — this is NOT a per-color image/VIP switch).
 */
export function ProductCard({ product }: { product: Product }) {
  const images = product.images;
  const onSale = product.onSale;
  // A product with no purchasable variant at all — either it has zero
  // variants, or every variant is out of stock. The actual purchase is
  // already safely blocked at the detail page (disabled Add to
  // Cart/Buy Now) and independently re-validated server-side regardless
  // of what the frontend shows — this is purely about not letting the
  // LISTING look like a normal, purchasable product when it isn't.
  const soldOut = product.variants.length === 0 || !product.variants.some((v) => v.inStock);

  const [mobileIdx, setMobileIdx] = useState(0);
  const [wishlisted, setWishlisted] = useState(() => isWishlisted(product.slug));

  useEffect(() => onWishlistChange(() => setWishlisted(isWishlisted(product.slug))), [product.slug]);

  const galleryRef = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number; active: boolean }>({ x: 0, y: 0, active: false });
  const suppressNav = useRef(false);

  const primary = images[0];
  const secondary = images[1];

  const onPointerDown = (e: React.PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY, active: true };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!swipe.current.active) return;
    const dx = e.clientX - swipe.current.x;
    const dy = e.clientY - swipe.current.y;
    swipe.current.active = false;
    if (images.length < 2 || Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy)) return;
    // A real horizontal swipe: change image and swallow the following click so
    // the card does NOT navigate (a tap alone still navigates normally).
    suppressNav.current = true;
    window.setTimeout(() => { suppressNav.current = false; }, 350);
    if (dx < 0) setMobileIdx((i) => Math.min(images.length - 1, i + 1));
    else setMobileIdx((i) => Math.max(0, i - 1));
  };
  const onGalleryClick = (e: React.MouseEvent) => {
    if (suppressNav.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const colorDots = Array.from(new Set(product.variants.map((v) => v.color).filter((c) => c && c.toLowerCase() !== "default"))).slice(0, 4);

  const onWish = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleWishlist(product);
  };

  return (
    <Link to={getProductUrl(product.slug)} className="group block" aria-label={product.name}>
      <div
        ref={galleryRef}
        className="relative aspect-[3/4] overflow-hidden bg-neutral-100 touch-pan-y"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onGalleryClick}
      >
        {/* Mobile gallery: stacked slides translated by active index */}
        <div
          className={`flex h-full w-full${soldOut ? ' opacity-60' : ''}`}
          style={{ transform: `translateX(-${mobileIdx * 100}%)` }}
        >
          {(images.length ? images : [undefined as unknown as api.ProductImage]).map((img, i) => (
            <div key={img?.id ?? "fb"} className="h-full w-full shrink-0">
              <SafeImg
                src={cardImage(img, product.name)}
                alt={product.name}
                className="h-full w-full object-cover"
              />
            </div>
          ))}
        </div>

        {/* Desktop hover: second image cross-fades over the first */}
        {secondary && (
          <div className="absolute inset-0 hidden md:block opacity-0 transition-opacity duration-500 group-hover:opacity-100">
            <SafeImg
              src={cardImage(secondary, product.name)}
              alt={`${product.name} — alternate view`}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        {/* Badge — SOLD OUT takes priority over any sale/custom badge:
            availability is more important information than a promotion
            on a product the customer can't actually buy right now. */}
        {soldOut ? (
          <span className="absolute top-2.5 left-2.5 text-white text-[9px] font-bold tracking-widest px-2 py-1 bg-neutral-700">
            SOLD OUT
          </span>
        ) : (product.badgeText || onSale) && (
          <span
            className={`absolute top-2.5 left-2.5 text-white text-[9px] font-bold tracking-widest px-2 py-1 ${
              product.badgeText ? "bg-[#151515]" : "bg-red-600"
            }`}
          >
            {product.badgeText || "SALE"}
          </span>
        )}

        {/* Wishlist toggle */}
        <button
          type="button"
          onClick={onWish}
          aria-label={wishlisted ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          aria-pressed={wishlisted}
          className={`absolute top-2.5 right-2.5 p-2 rounded-full transition-colors ${
            wishlisted ? "bg-black text-white" : "bg-white/90 hover:bg-white"
          }`}
        >
          <Heart size={15} className={wishlisted ? "fill-white" : ""} />
        </button>

        {/* Mobile gallery dots */}
        {images.length > 1 && (
          <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5 md:hidden">
            {images.map((img, i) => (
              <span
                key={img.id}
                className={`h-1 rounded-full transition-all ${i === mobileIdx ? "w-4 bg-white" : "w-1.5 bg-white/60"}`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="pt-3">
        {product.brand?.name && (
          <p className="text-[10px] font-bold tracking-widest text-neutral-500 uppercase">{product.brand.name}</p>
        )}
        <h3 className="mt-1 text-sm font-semibold text-neutral-900 leading-snug line-clamp-2">{product.name}</h3>

        <div className="mt-1 flex items-baseline gap-2">
<b className="text-sm">{formatTZS(product.priceCents)}</b>
          {onSale && product.compareAtPriceCents != null && (
            <s style={{ color: '#6b7280', fontSize: '0.7em', marginLeft: 6 }}>
              {formatTZS(product.compareAtPriceCents)}
            </s>
          )}
          {onSale && product.discountPercent != null && (
            <span className="text-[10px] font-bold text-red-600">
              Save {product.discountPercent}%
            </span>
          )}
        </div>

        {/* Color-dot indicators (indicator-only — not a per-color switch) */}
        {colorDots.length > 0 && (
          <div
            className="mt-2 flex items-center gap-1"
            aria-label={`${colorDots.length} color${colorDots.length === 1 ? "" : "s"}`}
          >
            {colorDots.map((c) => (
              <span
                key={c}
                title={c}
                className="h-2.5 w-2.5 rounded-full border border-black/15"
                style={{ background: swatch(c) }}
              />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
