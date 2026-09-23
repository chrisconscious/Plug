import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

/**
 * "EXPLORE ALL / VIEW ALL →" — the shared, understated text CTA used by every
 * homepage shelf that has more content than the viewport can show at once.
 *
 * Deliberately NOT a big button: a tracked uppercase label with a baseline
 * hairline and a corner arrow reads as secondary navigation next to the big
 * section title (so the heading stays dominant). Callers gate rendering on
 * their own API data — the link is only ever in the DOM when something more
 * actually exists to explore.
 */
export function ExploreAllLink({
  to,
  label = "EXPLORE ALL",
  className = "",
}: {
  to: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      className={`group inline-flex items-center gap-1.5 border-b border-black pb-1 text-[11px] font-bold tracking-widest text-black/75 whitespace-nowrap transition-colors hover:text-black focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black md:text-xs ${className}`}
    >
      <span>{label}</span>
      <ArrowUpRight
        size={13}
        aria-hidden="true"
        className="translate-y-px transition-transform duration-200 group-hover:translate-x-1 group-hover:-translate-y-1"
      />
    </Link>
  );
}

/**
 * Smartphone placement of the same CTA: a full-width, right-aligned row
 * directly under the carousel with a real ~44px touch column. Visible and
 * tappable in one thumb, it never competes with the heading or the swipe,
 * and takes minimal vertical space.
 */
export function ExploreMoreRow({
  to,
  label = "EXPLORE ALL",
  className = "",
}: {
  to: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`flex min-h-[44px] w-full items-center justify-end md:hidden ${className}`}>
      <ExploreAllLink to={to} label={label} />
    </div>
  );
}