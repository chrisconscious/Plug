import {
  Box,
  Briefcase,
  Crown,
  Dumbbell,
  Footprints,
  Gem,
  Glasses,
  Shirt,
  ShoppingBag,
  Sparkles,
  Watch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The fixed icon set available in the Admin category picker. Each icon maps to
 * the small key stored in `categories.icon` (an identifier string — NOT a photo
 * and NOT a URL). These are inline lucide-react vector SVGs, so they are tiny
 * and need no storage/upload flow.
 */
export const CATEGORY_ICON_CHOICES: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: "box", label: "Box", Icon: Box },
  { key: "shirt", label: "Shirt", Icon: Shirt },
  { key: "shopping-bag", label: "Bag", Icon: ShoppingBag },
  { key: "footprints", label: "Shoes / Footprints", Icon: Footprints },
  { key: "gem", label: "Jewelry", Icon: Gem },
  { key: "glasses", label: "Sunglasses", Icon: Glasses },
  { key: "watch", label: "Watch / Belt", Icon: Watch },
  { key: "crown", label: "Hat", Icon: Crown },
  { key: "sparkles", label: "Accessories", Icon: Sparkles },
  { key: "dumbbell", label: "Activewear", Icon: Dumbbell },
  { key: "briefcase", label: "Backpacks", Icon: Briefcase },
];

const FALLBACK_ICON = Box;

/** Resolve a stored icon key to its lucide component; unknown keys fall back to Box. */
export function categoryIcon(key?: string | null): LucideIcon {
  if (!key) return FALLBACK_ICON;
  const found = CATEGORY_ICON_CHOICES.find((c) => c.key === key);
  return found ? found.Icon : FALLBACK_ICON;
}
