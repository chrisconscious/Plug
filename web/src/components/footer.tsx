"use client";

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePlatformSettings } from "../lib/PlatformSettingsContext";
import * as api from "../lib/api";
import { BrandLogo } from "./BrandLogo";
import { whatsappHref } from "../lib/contactLinks";

/**
 * Minimal, consistent stroke-based icons for the six footer contact
 * channels — built as inline SVGs rather than importing brand icons from
 * lucide-react, since that library's bundled icon set can vary by
 * version and TikTok/WhatsApp marks in particular aren't reliably
 * included in generic icon libraries. This guarantees one consistent
 * visual style (matching this project's existing 1.75px-stroke line-icon
 * look) regardless of what's actually installed.
 */
const CONTACT_ICONS: Record<api.FooterPlatform, React.ReactNode> = {
  instagram: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3v10.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M15 3c0 2.5 2 4.5 4.5 4.5" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 9h3V6h-3c-1.7 0-3 1.3-3 3v2H8v3h3v6h3v-6h3l1-3h-4V9c0-.6.4-1 1-1Z" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 4h3.2l1.5 4.5-2 1.5a11 11 0 0 0 5.3 5.3l1.5-2 4.5 1.5V18a2 2 0 0 1-2 2C10.5 20 4 13.5 4 6a2 2 0 0 1 .5-2Z" />
    </svg>
  ),
  whatsapp: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 18.5 4 20l1.6-3.9A8 8 0 1 1 9.5 19L6 18.5Z" />
      <path d="M8.5 9.5c0 3.5 2.5 6 6 6 .8 0 1-.6.7-1.3l-.6-1.3c-.2-.4-.6-.5-1-.3l-.9.5a4.5 4.5 0 0 1-2.8-2.8l.5-.9c.2-.4.1-.8-.3-1l-1.3-.6c-.7-.3-1.3-.1-1.3.7Z" fill="currentColor" stroke="none" />
    </svg>
  ),
  email: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  ),
};

const CONTACT_LABELS: Record<api.FooterPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  phone: "Call us",
  whatsapp: "WhatsApp",
  email: "Email us",
};

/**
 * Accessible name for each contact channel (used for both `aria-label`
 * and `title`). The three direct channels carry the platform name so a
 * screen-reader user hears exactly who they are contacting ("Call PLUG",
 * "Contact PLUG on WhatsApp", "Email PLUG"); the social platforms are
 * already unambiguous on their own.
 */
function contactLabel(platform: api.FooterPlatform, platformName: string): string {
  if (platform === "phone") return `Call ${platformName}`;
  if (platform === "whatsapp") return `Contact ${platformName} on WhatsApp`;
  if (platform === "email") return `Email ${platformName}`;
  return CONTACT_LABELS[platform];
}

function contactHref(link: api.FooterContactLink): string {
  const v = link.value ?? "";
  if (link.platform === "phone") return `tel:${v.replace(/[^\d+]/g, "")}`;
  if (link.platform === "email") return `mailto:${v}`;
  if (link.platform === "whatsapp") return whatsappHref(v);
  return v; // instagram / tiktok / facebook are already full URLs
}

/**
 * Complete rebuild — brand-first-at-the-bottom structure per the current
 * redesign brief, not the earlier top-of-footer brand block. Hierarchy:
 * nav columns -> social/contact icons -> divider -> uploaded wordmark ->
 * copyright BELOW it. The wordmark reuses the EXISTING platform-settings
 * logo (already has full Superadmin upload/replace/preview support from
 * earlier work) rather than a second, duplicate "footer logo" upload
 * system — this is the same image already used by the header.
 *
 * Legal column (Privacy/Terms/Cookies) is deliberately omitted: no such
 * pages exist in this project yet, and this whole project's standing
 * rule is to never link to a destination that doesn't actually exist.
 * Add it back once real policy pages exist.
 *
 * Contact icons only ever render for a channel that is BOTH active and
 * has a real configured value — the backend's own query already filters
 * to exactly that, so there's nothing to filter again here; an
 * unconfigured/disabled channel simply isn't in the list at all.
 */
export function Footer() {
  const { platformName } = usePlatformSettings();
  const [links, setLinks] = useState<api.FooterContactLink[]>([]);
  const year = new Date().getFullYear();

  useEffect(() => {
    let mounted = true;
    api.listFooterContactLinks()
      .then((r) => { if (mounted) setLinks(r.links); })
      .catch(() => { /* footer contact row is decorative — never blocks the page */ });
    return () => { mounted = false; };
  }, []);

  // Defense-in-depth on top of the backend's own active+valued filtering:
  // even if the API ever returned a disabled or empty channel, it must not
  // render a dead icon (§10 of the footer spec).
  const visibleLinks = links.filter(
    (link) => link.active && (link.value ?? "").trim() !== ""
  );

  return (
    <footer className="w-full bg-[#111] text-[#e8e8e8] pt-16 pb-10">
      <div className="max-w-[1200px] mx-auto px-5">
        {/* Navigation */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-10 pb-12">
          <div className="flex flex-col gap-5">
            <h5 className="text-[11px] font-bold uppercase tracking-[.2em] text-[#c9a35a]/80">Shop</h5>
            <ul className="flex flex-col gap-3 text-[13.5px] text-white/65">
              <li><Link to="/shop?gender=women" className="inline-block hover:text-white transition-colors">Women</Link></li>
              <li><Link to="/shop?gender=men" className="inline-block hover:text-white transition-colors">Men</Link></li>
              <li><Link to="/shop?sale=true" className="inline-block hover:text-white transition-colors">Sale</Link></li>
              <li><Link to="/brands" className="inline-block hover:text-white transition-colors">Brands</Link></li>
            </ul>
          </div>
          <div className="flex flex-col gap-5">
            <h5 className="text-[11px] font-bold uppercase tracking-[.2em] text-[#c9a35a]/80">Customer</h5>
            <ul className="flex flex-col gap-3 text-[13.5px] text-white/65">
              <li><Link to="/orders" className="inline-block hover:text-white transition-colors">My Orders</Link></li>
              <li><Link to="/wishlist" className="inline-block hover:text-white transition-colors">Wishlist</Link></li>
              <li><Link to="/profile" className="inline-block hover:text-white transition-colors">My Account</Link></li>
              <li><Link to="/cart" className="inline-block hover:text-white transition-colors">Cart</Link></li>
            </ul>
          </div>
          <div className="flex flex-col gap-5">
            <h5 className="text-[11px] font-bold uppercase tracking-[.2em] text-[#c9a35a]/80">Explore</h5>
            <ul className="flex flex-col gap-3 text-[13.5px] text-white/65">
              <li><Link to="/shop" className="inline-block hover:text-white transition-colors">Shop All</Link></li>
            </ul>
          </div>
        </div>

        {/* Follow / Contact icons (only for channels that are active AND valued) */}
        {visibleLinks.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3 pb-10 border-t border-white/[0.08] pt-10">
            {visibleLinks.map((link) => (
              <a
                key={link.platform}
                href={contactHref(link)}
                target={link.platform === "phone" || link.platform === "email" ? undefined : "_blank"}
                rel={link.platform === "phone" || link.platform === "email" ? undefined : "noopener noreferrer"}
                aria-label={contactLabel(link.platform, platformName)}
                title={contactLabel(link.platform, platformName)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors hover:border-white/40 hover:text-white"
              >
                <span className="h-[18px] w-[18px]">{CONTACT_ICONS[link.platform]}</span>
              </a>
            ))}
          </div>
        )}

        {/* Wordmark, then copyright directly beneath it */}
        <div className="flex flex-col items-center gap-5 pb-2 border-t border-white/[0.08] pt-10">
          <Link to="/" aria-label={`${platformName} home`} className="plug-brand-link inline-flex items-center rounded-sm">
            <BrandLogo variant="footer" />
          </Link>
          <p className="text-[11px] text-white/35 tracking-[.02em] text-center">
            © {year} {platformName.toUpperCase()}. All rights reserved. | Designed in Tanzania. Delivering Worldwide
          </p>
        </div>
      </div>
    </footer>
  );
}
