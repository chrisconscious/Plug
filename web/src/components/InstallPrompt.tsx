import { useEffect, useState } from 'react';
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
function useBodyClassWhenShown(shown: boolean): void {
  useEffect(() => {
    if (!shown) return;
    document.body.classList.add('install-prompt-visible');
    return () => document.body.classList.remove('install-prompt-visible');
  }, [shown]);
}

export function InstallPrompt() {
  const { pwaIconUrl, pwaInstallPromptEnabled, platformName } = usePlatformSettings();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  // Separate from the Chromium deferredPrompt path below — iOS has no
  // event to listen for, so eligibility here is just "is this iOS
  // Safari, not already installed, not dismissed, not on a suppressed
  // page" checked once on mount.
  const [showIosGuide, setShowIosGuide] = useState(false);
  // Separate from visible/showIosGuide: this only controls whether the
  // exit animation class is applied, so dismissal can play a smooth
  // slide-down-and-fade before the component actually unmounts, rather
  // than vanishing instantly the moment visible becomes false.
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!pwaInstallPromptEnabled) return;
    if (isStandalone() || recentlyDismissed() || isSuppressedPath(window.location.pathname)) return;
    if (isIosSafari()) setShowIosGuide(true);
  }, [pwaInstallPromptEnabled]);

  useEffect(() => {
    // Only Chromium-based browsers fire this — Safari/Firefox never do,
    // so this component simply never becomes eligible there, which is
    // exactly the "don't show a broken install button" requirement
    // rather than something needing separate browser-detection logic.
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      if (!pwaInstallPromptEnabled) return;
      if (isStandalone() || recentlyDismissed() || isSuppressedPath(window.location.pathname)) return;
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    // If installation completes through any path (this card, or the
    // browser's own address-bar install icon), stop offering it again.
    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [pwaInstallPromptEnabled]);

  // Must stay above the early return below — a hook called after a
  // conditional return is exactly the Rules-of-Hooks violation found
  // and fixed elsewhere this session (ProductDetail.tsx).
  useBodyClassWhenShown(showIosGuide || visible);

  if (!closing && !showIosGuide && (!visible || !deferredPrompt)) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setClosing(true);
    setTimeout(() => {
      setVisible(false);
      setShowIosGuide(false);
      setClosing(false);
    }, 220); // matches the CSS exit-animation duration below
  };

  const install = async () => {
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      // The real browser outcome — never assumed, never faked. Only a
      // genuine "accepted" gets the brief "Installed" success state;
      // a real dismissal in the native dialog just closes the card the
      // same way it always did, since nothing was actually installed.
      const choice = await deferredPrompt.userChoice;
      setInstalling(false);
      setDeferredPrompt(null);
      if (choice.outcome === 'accepted') {
        setJustInstalled(true);
        setTimeout(() => setVisible(false), 1500);
      } else {
        setVisible(false);
      }
    } catch {
      setInstalling(false);
      setVisible(false);
      setDeferredPrompt(null);
    }
  };

  return (
    <div
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
