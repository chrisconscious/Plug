import { Link } from "react-router-dom";
import * as api from "../../lib/api";
import { categoryIcon } from "../../lib/category-icons";

/**
 * THE shared PLUG category card — one design system for every "Shop by
 * Category" surface across the whole website (homepage, Women/Men
 * audiences, brand and lifestyle showcases). The homepage is the visual
 * reference; this component + the `.catCard*` classes in index.css are
 * the single source of truth so a size change in one place updates every
 * page (no page-local copy-and-paste CSS).
 *
 * Visual grammar (locked to the homepage reference):
 *   - a square 1:1 media tile — radius 16px, hairline border, soft
 *     background — showing the real category image when one exists,
 *     otherwise the category's inline icon;
 *   - the category name centered below the tile (13px desktop / 11px
 *     phone), plus an optional muted product-count caption.
 *
 * Responsive behavior lives in index.css on `.catRow` (the one-row
 * scroller) and `.catCard`: fixed 150px desktop tiles, fluid
 * `calc(25% - …)` width on phones so ~4 cards fit a row, single row that
 * never wraps. Scrolling is free (no snap) and the homepage rail layers a
 * very-slow autoplay on top — see useAutoScrollCarousel.
 */
export interface CategoryCardProps {
  /** Destination the card links to (category listing URL). */
  to: string;
  name: string;
  /** Real uploaded category image — shown when present. */
  imageUrl?: string | null;
  /** Icon-library key used as the fallback when no image exists. */
  iconKey?: string | null;
  /** Optional product count caption (e.g. "12 products"). */
  count?: number;
  /** Mark the card as an ARIA list item when rendered inside a `role="list"`. */
  listItem?: boolean;
}

export function CategoryCard({ to, name, imageUrl, iconKey, count, listItem = false }: CategoryCardProps) {
  const Icon = categoryIcon(iconKey);
  return (
    <Link
      to={to}
      className="catCard"
      data-card
      {...(listItem ? { role: "listitem" } : {})}
    >
      <span className="catCardMedia">
        {imageUrl ? (
          <img src={api.assetUrl(imageUrl)} alt="" loading="lazy" />
        ) : (
          <Icon size={40} strokeWidth={1.5} />
        )}
      </span>
      <span className="catCardName">{name}</span>
      {count != null && <span className="catCardCount">{count} product{count === 1 ? "" : "s"}</span>}
    </Link>
  );
}