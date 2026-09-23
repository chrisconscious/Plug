import { useEffect, useRef, useState } from 'react';
import { Share2, Copy, Check, MessageCircle, Mail } from 'lucide-react';

interface ShareButtonProps {
  /** Absolute URL to share — must be the specific item's own URL, never a generic fallback. */
  url: string;
  title: string;
  /** Short one-line message, e.g. "Check out this product on PLUG: Product Name". */
  text: string;
}

/**
 * Prioritizes the device's native share sheet (navigator.share) — this is
 * what actually surfaces WhatsApp/Messages/Email/every other installed
 * app the OS knows about, which a hand-built menu can never fully match.
 * Only falls back to a small custom menu (Copy Link / WhatsApp / Email)
 * on browsers/devices that don't support it (mainly desktop browsers).
 */
export function ShareButton({ url, title, text }: ShareButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!menuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [menuOpen]);

  const handleShare = async () => {
    if (canNativeShare) {
      try {
        await navigator.share({ title, text, url });
      } catch {
        // AbortError when the person just closes the native share sheet —
        // not a real failure, nothing to show the customer for this.
      }
      return;
    }
    setMenuOpen((v) => !v);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => { setCopied(false); setMenuOpen(false); }, 1500);
    } catch {
      /* clipboard unavailable — the link remains visible/selectable in the address bar */
    }
  };

  return (
    <div className="shareWrap" ref={menuRef}>
      <button type="button" className="shareBtn" onClick={handleShare} aria-haspopup={canNativeShare ? undefined : 'menu'} aria-expanded={canNativeShare ? undefined : menuOpen}>
        <Share2 size={15} />
        <span>Share</span>
      </button>
      {!canNativeShare && menuOpen && (
        <div className="shareMenu" role="menu">
          <button type="button" role="menuitem" className="shareMenuItem" onClick={copyLink}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            <span>{copied ? 'Product link copied' : 'Copy Link'}</span>
          </button>
          <a
            role="menuitem"
            className="shareMenuItem"
            href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMenuOpen(false)}
          >
            <MessageCircle size={15} />
            <span>WhatsApp</span>
          </a>
          <a
            role="menuitem"
            className="shareMenuItem"
            href={`mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${text}\n${url}`)}`}
            onClick={() => setMenuOpen(false)}
          >
            <Mail size={15} />
            <span>Email</span>
          </a>
        </div>
      )}
    </div>
  );
}
