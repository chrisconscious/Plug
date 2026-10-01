import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { X, Share, Download, Check } from 'lucide-react';
import { usePlatformSettings } from '../lib/PlatformSettingsContext';
import * as api from '../lib/api';

/**
 * Not a standard DOM type — this event is a Chromium-only, non-standard
 * extension with no entry in TypeScript's built-in DOM lib, so it has to
 * be declared here rather than imported.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'plug_install_dismissed_at';
// Session-based, not a long-term cooldown: per the explicit instruction
// this was built to, the prompt should reappear every time the
// customer opens the site — several times across visits — and stop
// PERMANENTLY only once actually installed (isStandalone() below
// becomes true then, which is a real, durable state change, unlike a
// dismissal). sessionStorage naturally clears when the tab/browser
// session ends, so a dismiss only suppresses it for the REST OF THIS
// VISIT (avoiding it popping right back up after being closed), not
// future ones.

// Pages where showing an install card would compete with something more
// important the customer is actively doing — matches this feature's own
// "never interrupt shopping" requirement.
const SUPPRESSED_PATH_PREFIXES = ['/checkout', '/login', '/register', '/reset-password', '/forgot-password', '/verify-email', '/admin', '/super-admin'];

function isStandalone(): boolean {
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari's own non-standard flag for "already added to home screen".
  if ((window.navigator as unknown as { standalone?: boolean }).standalone) return true;
  return false;
}

/**
 * iOS Safari never fires beforeinstallprompt at all — not "needs an
 * extra tap," genuinely never. Without this check, the entire
 * component silently does nothing for every iPhone user, which is a
 * real gap: it isn't that iOS users see a worse prompt, they see none.
 * There's no programmatic install API on iOS (Apple doesn't expose
 * one), so the actual action is guiding the customer through Safari's
 * own Share -> "Add to Home Screen" — lighter-weight than Chrome's
 * install dialog (a shortcut icon, not a permission-gated app install),
 * which is the closest real equivalent to a plain "shortcut" on this
 * platform.
 */
function isIosSafari(): boolean {
  const ua = window.navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return isIos && isSafari;
}

function recentlyDismissed(): boolean {
  // sessionStorage, not localStorage — this dismissal only holds for the
  // current visit; a fresh visit (new tab, new session) has no entry
  // here at all, so the prompt is eligible again automatically.
  return sessionStorage.getItem(DISMISS_KEY) === '1';
}

function isSuppressedPath(pathname: string): boolean {
  return SUPPRESSED_PATH_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Toggles a class on <body> while this card is visible, so the
 * independently-mounted floating WhatsApp button (FloatingWhatsAppButton.tsx)
 * can shift itself out of the way via CSS — the two components have no
 * shared state otherwise, and this is the lowest-risk way to coordinate
 * two separately-mounted floating UI elements without introducing a new
 * shared context just for this. Cleans up on every change and on unmount,
 * so the class never gets stuck on if this card unmounts while visible.
 */
function useBodyClassWhenShown(shown: boolean, cardRef: React.RefObject<HTMLDivElement>): void {
  useEffect(() => {
    if (!shown) return;
    const body = document.body;
    body.classList.add('install-prompt-visible');
    // How far the card's top edge sits above the bottom of the viewport, so
    // the WhatsApp button can park just above it whatever the card's real
    // height (title length, safe-area insets, screen size) instead of a
    // fixed guess that left it covering the card's close button.
    const measure = () => {
      const card = cardRef.current;
      if (card) body.style.setProperty('--install-card-clearance', `${Math.ceil(window.innerHeight - card.getBoundingClientRect().top)}px`);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    const card = cardRef.current;
    if (ro && card) ro.observe(card);
    // The card slides up into place as it appears; measure its final position too.
    card?.addEventListener('animationend', measure);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      card?.removeEventListener('animationend', measure);
      window.removeEventListener('resize', measure);
      body.classList.remove('install-prompt-visible');
      body.style.removeProperty('--install-card-clearance');
    };
  }, [shown, cardRef]);
}

export function InstallPrompt() {
  const { pwaIconUrl, pwaInstallPromptEnabled, platformName } = usePlatformSettings();
  const { pathname } = useLocation();
  // The browser's install event, held until the customer presses Install.
  // It can be used for exactly one prompt(), so it is cleared after use.
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(recentlyDismissed);
  const [installing, setInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  // iOS has no install event to listen for, so eligibility there is just
  // "iOS Safari and not already on the home screen", checked once.
  const [iosEligible] = useState(() => isIosSafari() && !isStandalone());
  // Only controls the exit-animation class, so dismissal can play a smooth
  // slide-down-and-fade before the card actually unmounts.
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    // Only Chromium-based browsers fire this — Safari/Firefox never do, so
    // the Install button simply never appears there (no broken button).
    const onBeforeInstallPrompt = (event: Event) => {
      // Take over from the browser's own install offer ONLY when this card is
      // going to offer installation instead. Calling preventDefault() and then
      // never calling prompt() leaves the visitor with no install offer at
      // all, and is what makes Chrome log "Banner not shown:
      // beforeinstallpromptevent.preventDefault() called".
      if (!pwaInstallPromptEnabled || isStandalone() || recentlyDismissed()) return;
      event.preventDefault();
      // Kept even while on a page where the card is hidden (checkout,
      // sign-in…): the card appears as soon as the customer moves on to a
      // regular page, instead of the one event of this page load being lost.
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    // If installation completes through any path (this card, or the
    // browser's own address-bar install icon), stop offering it again.
    const onInstalled = () => setDeferredPrompt(null);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [pwaInstallPromptEnabled]);

  const allowedHere = pwaInstallPromptEnabled && !dismissed && !isSuppressedPath(pathname);
  const showInstall = allowedHere && (!!deferredPrompt || justInstalled);
  const showIosGuide = allowedHere && !showInstall && iosEligible;

  // Must stay above the early return below (Rules of Hooks).
  const cardRef = useRef<HTMLDivElement>(null);
  useBodyClassWhenShown(showIosGuide || showInstall, cardRef);

  if (!closing && !showIosGuide && !showInstall) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setClosing(true);
    setTimeout(() => {
      setDismissed(true);
      setClosing(false);
    }, 220); // matches the CSS exit-animation duration
  };

  const install = async () => {
    const event = deferredPrompt;
    if (!event) return;
    setInstalling(true);
    try {
      await event.prompt();
      // The real browser outcome — never assumed. Only a genuine "accepted"
      // gets the brief "Installed" state; a dismissal in the native dialog
      // just closes the card, since nothing was installed.
      const choice = await event.userChoice;
      if (choice.outcome === 'accepted') {
        setJustInstalled(true);
        setTimeout(() => setJustInstalled(false), 1500);
      }
    } catch {
      /* the browser refused to show the dialog; nothing was installed */
    } finally {
      // prompt() can only be called once per event: never offer it again.
      setInstalling(false);
      setDeferredPrompt(null);
    }
  };

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="install-prompt-title"
      className={`installCard${closing ? ' installCard--closing' : ''}`}
    >
      <button type="button" className="installCardClose" onClick={dismiss} aria-label="Close install prompt">
        <X size={14} />
      </button>

      <div className="installCardHeader">
        <div className="installCardIcon">
          {pwaIconUrl ? (
            <img src={api.assetUrl(pwaIconUrl) ?? pwaIconUrl} alt="" />
          ) : (
            <span aria-hidden="true">{platformName.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="installCardBody">
          <p id="install-prompt-title" className="installCardTitle">
            {showIosGuide ? `Add ${platformName} to Home Screen` : `Install ${platformName}`}
          </p>
          {showIosGuide ? (
            <p className="installCardDesc">
              Tap <Share size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> then "Add to Home Screen".
            </p>
          ) : (
            <p className="installCardDesc">Get the full {platformName} experience.</p>
          )}
        </div>
      </div>

      {!showIosGuide && (
        <button
          type="button"
          className={`installCardCta${justInstalled ? ' installCardCta--done' : ''}`}
          onClick={install}
          disabled={installing || justInstalled}
        >
          {justInstalled ? (
            <><Check size={16} /> Installed</>
          ) : installing ? (
            'Installing…'
          ) : (
            <><Download size={16} /> Install</>
          )}
        </button>
      )}
    </div>
  );
}
