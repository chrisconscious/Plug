import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Truck, Lock, Minus, Plus, ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import * as api from '../lib/api';
import { setCartCountFromItems } from '../lib/cartCount';
import { formatTZS } from '../lib/currency';
import { PLACEHOLDER_IMG, resolveImage } from '../lib/imagePlaceholder';
import { StoreHeader } from '../components/shop/StoreHeader';
import { ProductCard } from '../components/shop/ProductCard';
import { ShareButton } from '../components/ShareButton';
import { BrandMark } from '../components/shop/BrandMark';
import { useAuth } from '../lib/AuthContext';
import { loginUrl } from '../lib/returnTo';
import { getBrandUrl, getProductUrl } from '../lib/links';
import { sortSizeStrings } from '../lib/shop';

const slugify = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
const API_COLORS: Record<string, string> = {
  black: '#151515', navy: '#1f2a44', white: '#f5f5f0', beige: '#d9c6a9', cream: '#f3ead9',
  grey: '#9b9b9b', gray: '#9b9b9b', charcoal: '#3c3c3c', brown: '#6f4e37', tan: '#c6a87c',
  cognac: '#9a463d', burgundy: '#6d2232', red: '#a83030', rose: '#d98a96', pink: '#e6a8c2',
  gold: '#c9a54a', silver: '#c0c0c8', blue: '#2f4f8f', olive: '#5f6d3f', green: '#3d6b4a',
  khaki: '#88764a', nude: '#d9b8a6', purple: '#7c246d',
};
const apiColor = (name: string): string => API_COLORS[name.toLowerCase()] ?? '#888';
const NO_IMAGES: api.ProductImage[] = [];

function ProductDetail() {
  const params = useParams();
  const nav = useNavigate();
  const slug = (params.id ?? '').toLowerCase();
  const [searchParams, setSearchParams] = useSearchParams();
  const { status: authStatus } = useAuth();
  const [prod, setProd] = useState<api.Product | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [imageIdx, setImageIdx] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [recs, setRecs] = useState<api.Product[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [accordion, setAccordion] = useState<api.AccordionSection[]>([]);
  const [openAccordion, setOpenAccordion] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerScale, setViewerScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const panDragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const images = prod?.images ?? NO_IMAGES;

  // Dynamic per-product meta tags — this is a client-rendered SPA with no
  // server-side rendering, so this won't reach crawlers that don't
  // execute JS, but it's the best available way (without adding SSR) to
  // give the browser tab, and any share/preview mechanism that DOES read
  // live DOM state, the actual product's title and image rather than the
  // site-wide generic ones. Restored on unmount so navigating to a
  // different page never leaves a stale product's title/image behind.
  useEffect(() => {
    if (!prod) return;
    const previousTitle = document.title;
    document.title = `${prod.name} | PLUG`;

    const ensureMeta = (property: string): HTMLMetaElement => {
      let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute('property', property);
        document.head.appendChild(el);
      }
      return el;
    };
    const image = images[0]?.url ? resolveImage(images[0].url) : PLACEHOLDER_IMG;
    const absoluteImage = image.startsWith('http') ? image : `${window.location.origin}${image}`;
    const ogTitle = ensureMeta('og:title');
    const ogDescription = ensureMeta('og:description');
    const ogImage = ensureMeta('og:image');
    const ogUrl = ensureMeta('og:url');
    const prevOg = { title: ogTitle.content, description: ogDescription.content, image: ogImage.content, url: ogUrl.content };
    ogTitle.content = prod.name;
    ogDescription.content = prod.shortDescription || `${prod.name} — ${formatTZS(prod.priceCents)} at PLUG.`;
    ogImage.content = absoluteImage;
    ogUrl.content = `${window.location.origin}${getProductUrl(prod.slug)}`;

    return () => {
      document.title = previousTitle;
      ogTitle.content = prevOg.title;
      ogDescription.content = prevOg.description;
      ogImage.content = prevOg.image;
      ogUrl.content = prevOg.url;
    };
  }, [prod, images]);

  const imageCount = images.length;

  // Picture zoom + slide helpers. Swipe/drag and the fullscreen viewer are
  // plain pointer handlers — no dependency needed.
  const moveImage = useCallback((d: number) => {
    if (imageCount <= 1) return;
    setImageIdx((i) => (i + d + imageCount) % imageCount);
  }, [imageCount]);

  const resetZoom = () => { setViewerScale(1); setPan({ x: 0, y: 0 }); };
  const openViewer = () => { resetZoom(); setViewerOpen(true); };
  const closeViewer = () => setViewerOpen(false);
  const zoomBy = (f: number) => { setViewerScale((s) => Math.min(4, Math.max(1, +(s * f).toFixed(2)))); setPan({ x: 0, y: 0 }); };
  const toggleZoom = () => {
    setViewerScale((s) => (s > 1 ? 1 : 2.5));
    setPan({ x: 0, y: 0 });
  };

  const mainPointerDown = (e: React.PointerEvent) => { swipeRef.current = { x: e.clientX, y: e.clientY }; };
  const mainPointerUp = (e: React.PointerEvent) => {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (imageCount > 1) moveImage(dx < 0 ? 1 : -1);
    } else if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && imageCount > 0) {
      openViewer();
    }
  };
  const mainPointerCancel = () => { swipeRef.current = null; };

  const stagePointerDown = (e: React.PointerEvent) => {
    if (viewerScale <= 1) return;
    panDragRef.current = { startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* pointer capture is best-effort */ }
  };
  const stagePointerMove = (e: React.PointerEvent) => {
    const d = panDragRef.current;
    if (!d || viewerScale <= 1 || !stageRef.current) return;
    const s = viewerScale;
    const hb = (stageRef.current.clientWidth * (s - 1)) / 2;
    const vb = (stageRef.current.clientHeight * (s - 1)) / 2;
    setPan({
      x: Math.min(hb, Math.max(-hb, d.baseX + (e.clientX - d.startX))),
      y: Math.min(vb, Math.max(-vb, d.baseY + (e.clientY - d.startY))),
    });
  };
  const stagePointerUp = () => { panDragRef.current = null; };

  // Arrow keys slide the picture rail; Escape closes the viewer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && viewerOpen) { setViewerOpen(false); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (imageCount > 1) { e.preventDefault(); moveImage(e.key === 'ArrowLeft' ? -1 : 1); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerOpen, imageCount, moveImage]);

  // Lock the page scroll while the fullscreen viewer is open.
  useEffect(() => {
    if (!viewerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [viewerOpen]);

  const loadProduct = () => {
    let on = true;
    setProd(null); setNotFound(false); setLoadError(false); setImageIdx(0); setSize(null); setColor(null); setFeedback('');
    api.getProductBySlug(slug).then((r) => {
      if (!on) return;
      setProd(r.product);
    }).catch((e) => {
      if (!on) return;
      if (e instanceof api.ApiError && e.status === 404) {
        setNotFound(true);
      } else {
        // A network/server failure is NOT the same as "this product
        // doesn't exist" — showing the 404 page for a temporary glitch
        // would send a customer away from a real product with no way
        // back short of guessing the URL again.
        setLoadError(true);
      }
    });
    return () => { on = false; };
  };
  useEffect(loadProduct, [slug]);

  /** This product with a specific variant + quantity preselected (used as a sign-in return destination). */
  const selectionUrl = (variantId: string) =>
    `/product/${encodeURIComponent(prod?.slug ?? slug)}?variant=${encodeURIComponent(variantId)}&qty=${qty}`;

  // Restore a selection carried in the URL (?variant=<id>&qty=<n>) — e.g. the
  // customer tried Add to Cart while signed out and has just signed in. Only
  // an in-stock variant of THIS product is restored; the params are then
  // dropped from the URL so a refresh doesn't keep re-applying them.
  useEffect(() => {
    if (!prod) return;
    const variantId = searchParams.get('variant');
    if (!variantId) return;
    const v = prod.variants.find((x) => x.id === variantId && x.inStock);
    if (v) {
      if (v.color && v.color.toLowerCase() !== 'default') setColor(v.color);
      setSize(v.size);
      const q = Number(searchParams.get('qty'));
      if (Number.isInteger(q) && q >= 1) setQty(Math.min(20, q));
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prod]);

  useEffect(() => {
    if (!prod) return;
    let on = true;
    api.listProducts({ category: prod.category?.slug ?? undefined, page: 1, pageSize: 4 })
      .then((r) => on && setRecs(r.items.filter((x) => x.slug !== prod.slug)))
      .catch(() => on && setRecs([]));
    return () => { on = false; };
  }, [prod]);

  useEffect(() => {
    let on = true;
    api.listAccordionSections()
      .then((r) => on && setAccordion(r.sections))
      .catch(() => on && setAccordion([]));
    return () => { on = false; };
  }, []);

  // ---- Variant availability matrix (color × size), driven purely by the
  // per-variant inStock flags the API derives from live stock. Nothing here
  // knows about specific colors or sizes — any value an admin creates works.
  const variants = prod?.variants ?? [];
  const hasVariants = variants.length > 0;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const distinctColors: string[] = Array.from(
    new Map(variants.filter((v) => v.color && !same(v.color, 'default')).map((v) => [v.color.toLowerCase(), v.color])).values()
  );
  const multiColor = distinctColors.length > 1;
  // Single-color products preselect that color; colorless ("Default")
  // products skip color entirely.
  const selectedColor: string | null = color ?? (distinctColors.length === 1 ? distinctColors[0] : null);
  const needsColor = distinctColors.length > 0;
  /** Any variant matching the given color and/or size with stock left. */
  const hasStock = (c: string | null, sz: string | null) =>
    variants.some((v) => (!c || same(v.color, c)) && (!sz || same(v.size, sz)) && v.inStock);
  const colorSoldOut = (c: string) => !hasStock(c, null);
  // A color is selectable when it still has stock — in the chosen size, if
  // one is chosen (e.g. picking M leaves only the colors that have M).
  const colorAvailable = (c: string) => hasStock(c, size);
  // Sizes shown: those that exist for the chosen color, or every size of the
  // product before a color is picked (so a customer can start from size).
  const sizeSource = selectedColor ? variants.filter((v) => same(v.color, selectedColor)) : variants;
  const sizeOptions: string[] = sortSizeStrings(
    Array.from(new Map(sizeSource.map((v) => [v.size.toLowerCase(), v.size])).values())
  );
  const sizeAvailable = (sz: string) => hasStock(selectedColor, sz);
  const selectedVariant =
    size && (selectedColor || !needsColor)
      ? variants.find((v) => (!selectedColor || same(v.color, selectedColor)) && same(v.size, size) && v.inStock)
      : undefined;
  const productSoldOut = prod ? api.isSoldOut(prod) : false;

  const pickColor = (c: string) => {
    setFeedback('');
    if (color && same(color, c)) { setColor(null); return; } // tap again to clear
    if (!colorAvailable(c)) return; // never selectable — no stock in this (color, size)
    setColor(c);
  };
  const pickSize = (sz: string) => {
    setFeedback('');
    if (size && same(size, sz)) { setSize(null); return; } // tap again to clear
    if (!sizeAvailable(sz)) return;
    setSize(sz);
  };

  const addToCart = async () => {
    if (!selectedVariant) {
      setFeedback(needsColor && !selectedColor ? (size ? 'Select a color.' : 'Select a color and a size.') : 'Select a size.');
      return;
    }
    // No client-side isAuthed() pre-check here: the local flag only tracks
    // the short-lived access token TTL, not the real (much longer) session,
    // so it can say "logged out" while a valid refresh token would have
    // silently renewed the session. api.addToCart() already retries once
    // via a transparent refresh on 401 (see request() in lib/api.ts) —
    // only a *real* 401 after that retry should send the user to /login.
    setBusy(true); setFeedback('');
    try { const r = await api.addToCart(selectedVariant.id, qty); setCartCountFromItems(r.cart.items ?? []); setFeedback('Added to cart ✓'); nav('/cart'); }
    catch (e) {
      if (e instanceof api.ApiError && e.status === 401) {
        // Sign in, then come back to THIS product with the same color, size
        // and quantity already selected (restored by the effect above).
        setFeedback('Please sign in to add items to your cart.');
        nav(loginUrl(selectionUrl(selectedVariant.id)));
      }
      else setFeedback(e instanceof api.ApiError ? e.message : 'Could not add to cart');
    }
    finally { setBusy(false); }
  };

  // BUY IT NOW is a checkout for THIS product ONLY — it must never include
  // the rest of the customer's cart, and it must never add to / touch that
  // cart (the backend enforces both: /checkout/direct only snapshots this
  // item, and the order's items are passed explicitly rather than read
  // from the cart). It simply routes to the same checkout page in its
  // buy-now mode; the checkout page handles the sign-in gate itself.
  const buyItNow = () => {
    if (!selectedVariant) {
      setFeedback(needsColor && !selectedColor ? (size ? 'Select a color.' : 'Select a color and a size.') : 'Select a size.');
      return;
    }
    setFeedback('');
    const checkoutUrl = `/checkout?buyNow=${encodeURIComponent(selectedVariant.id)}&qty=${qty}`;
    // Known signed-out → straight to sign-in, returning to this exact
    // checkout. (Checkout also enforces this itself for any other path in.)
    nav(authStatus === 'unauthenticated' ? loginUrl(checkoutUrl) : checkoutUrl);
  };

  if (loadError) {
    return (
      <div>
        <StoreHeader />
        <main style={{ textAlign: 'center', padding: '80px 20px' }}>
          <h1>SOMETHING WENT WRONG</h1>
          <p>We couldn't load this product right now.</p>
          <button type="button" className="blackButton" onClick={loadProduct}>RETRY</button>
        </main>
      </div>
    );
  }

  if (notFound) {
    return (
      <div>
        <StoreHeader />
        <main style={{ textAlign: 'center', padding: '80px 20px' }}>
          <h1>PRODUCT NOT FOUND</h1>
          <p>We couldn't find that product.</p>
          <Link to="/shop" className="blackButton">BACK TO SHOP</Link>
        </main>
      </div>
    );
  }

  const mainImg = images[imageIdx] ? resolveImage(images[imageIdx].url) : PLACEHOLDER_IMG;
  const onSale = prod?.onSale ?? false;

  // A single customer-facing description — short and long copy are no
  // longer shown as two separate paragraphs on the storefront.
  // Only the admin's own text — never an invented fallback description.
  const description = [...new Set([prod?.shortDescription, prod?.fullDescription].filter(Boolean))].join(" ");

  return (
    <div>
      <StoreHeader />
      <main className="detail">
        <div className="thumbs">
          {(images.length ? images : [{ url: PLACEHOLDER_IMG } as api.ProductImage]).map((img, i) => (
            <img key={img.id ?? i} src={resolveImage(img.url)} alt={prod?.name ?? ''} onClick={() => setImageIdx(images[i] ? i : 0)} />
          ))}
        </div>
        <div className="detailImage">
          {imageCount > 1 && (
            <>
              <button type="button" className="slideBtn slidePrev" aria-label="Previous picture" onPointerDown={(e) => e.stopPropagation()} onClick={() => moveImage(-1)}><ChevronLeft size={22} /></button>
              <button type="button" className="slideBtn slideNext" aria-label="Next picture" onPointerDown={(e) => e.stopPropagation()} onClick={() => moveImage(1)}><ChevronRight size={22} /></button>
              <span className="imgCount">{imageIdx + 1} / {imageCount}</span>
            </>
          )}
          {imageCount > 0 && (
            <button type="button" className="zoomBtn" aria-label="Zoom into picture" onPointerDown={(e) => e.stopPropagation()} onClick={openViewer}><ZoomIn size={15} /> ZOOM</button>
          )}
          <img
            src={mainImg}
            alt={prod?.name ?? ''}
            onPointerDown={mainPointerDown}
            onPointerUp={mainPointerUp}
            onPointerCancel={mainPointerCancel}
            style={{ touchAction: 'pan-y', cursor: imageCount > 0 ? 'zoom-in' : 'default' }}
          />
        </div>
        {prod ? (
          <section className="detailInfo">
            <div className="breadcrumb">HOME / {prod.category?.name ? prod.category.name.toUpperCase() : 'SHOP'}</div>
            {prod.brand?.name ? (
              <Link to={getBrandUrl(prod.brand.slug || slugify(prod.brand.name))} className="productBrandRow detailBrand">
                {prod.brand.logo?.url ? <BrandMark brand={prod.brand} className="productBrandLogo detailLogo" alt="" fallback="" /> : null}
                <span>{prod.brand.name.toUpperCase()}</span>
              </Link>
            ) : null}
            <h1>{prod.name}</h1>
            {(prod.badgeText || prod.offerLabel) ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '6px 0 10px' }}>
                {prod.badgeText && <span style={{ background: '#151515', color: '#fff', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', padding: '4px 10px' }}>{prod.badgeText}</span>}
                {prod.offerLabel && <span style={{ background: '#f1f1f1', color: '#151515', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', padding: '4px 10px' }}>{prod.offerLabel}</span>}
              </div>
            ) : null}
            <div className="detailPriceRow">
              <h2>
                {formatTZS(prod.priceCents)}
                {onSale && prod.compareAtPriceCents != null && <s style={{ color: '#999', fontSize: '0.7em', marginLeft: 10 }}>{formatTZS(prod.compareAtPriceCents)}</s>}
                {onSale && prod.discountPercent != null && <span style={{ color: '#c00', fontSize: '0.5em', fontWeight: 800, marginLeft: 10 }}>Save {prod.discountPercent}%</span>}
              </h2>
              <ShareButton
                url={`${window.location.origin}${getProductUrl(prod.slug)}`}
                title={prod.name}
                text={`Check out this product on PLUG: ${prod.name}`}
              />
            </div>
            {description ? <p>{description}</p> : null}
            {productSoldOut ? <p className="pdpSoldOut" role="status">SOLD OUT</p> : null}
            {multiColor ? (
              <>
                <h4>COLOR: {color ? color.toUpperCase() : 'SELECT'}</h4>
                <div className="colorDots">
                  {distinctColors.map((c) => {
                    const available = colorAvailable(c);
                    const selected = !!color && same(color, c);
                    const why = colorSoldOut(c) ? 'sold out' : `not available in ${size}`;
                    return (
                      <button
                        key={c}
                        type="button"
                        title={available ? c : `${c} — ${why}`}
                        aria-label={`Color ${c}${available ? '' : `, ${why}`}`}
                        aria-pressed={selected}
                        aria-disabled={!available && !selected}
                        disabled={!available && !selected}
                        className={`vSwatch ${selected ? 'vSwatch--active' : ''} ${available ? '' : 'vSwatch--soldOut'}`}
                        style={{ background: apiColor(c) }}
                        onClick={() => pickColor(c)}
                      />
                    );
                  })}
                </div>
              </>
            ) : null}
            {hasVariants ? (
              <>
                <div className="sizeTitle"><h4>SELECT SIZE</h4></div>
                {sizeOptions.length > 0 ? (
                  <>
                    <div className="sizes">
                      {sizeOptions.map((sz) => {
                        const available = sizeAvailable(sz);
                        const selected = !!size && same(size, sz);
                        return (
                          <button
                            key={sz}
                            type="button"
                            title={available ? sz : `${sz} — sold out${selectedColor ? ` in ${selectedColor}` : ''}`}
                            aria-label={`Size ${sz}${available ? '' : ', sold out'}`}
                            aria-pressed={selected}
                            className={`${selected ? 'selected' : ''} ${available ? '' : 'out'}`}
                            disabled={!available && !selected}
                            aria-disabled={!available && !selected}
                            onClick={() => pickSize(sz)}
                          >
                            {sz}
                          </button>
                        );
                      })}
                    </div>
                    {selectedVariant?.lowStock ? <p className="lowStockNote">Low stock — only a few left.</p> : null}
                  </>
                ) : (
                  <p className="selHint">No sizes available for this color.</p>
                )}
                <div className="sizeTitle" style={{ marginTop: 12 }}><h4>QUANTITY</h4></div>
                <div className="qty" style={{ maxWidth: 120, marginBottom: 18 }}>
                  <button onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-disabled={qty <= 1}><Minus /></button>
                  <span>{qty}</span>
                  <button onClick={() => setQty((q) => Math.min(20, q + 1))} disabled={qty >= 20} aria-disabled={qty >= 20}><Plus /></button>
                </div>
                <button className="blackButton" disabled={busy || !selectedVariant} onClick={addToCart}>{productSoldOut ? 'SOLD OUT' : 'ADD TO CART'}</button>
                <button className="outlineButton" disabled={busy || !selectedVariant} onClick={buyItNow}>BUY IT NOW</button>
                {!selectedVariant ? (
                  <p className="selHint">
                    {productSoldOut
                      ? 'Every size and color is sold out right now — check back soon.'
                      : needsColor && !selectedColor
                      ? size ? 'Now select a color.' : 'Select a color and a size.'
                      : 'Select a size.'}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="selHint" style={{ fontWeight: 700 }}>This product is currently unavailable.</p>
            )}
            {feedback && <p style={{ color: '#c00', fontSize: 12, marginTop: 10 }}>{feedback}</p>}
            <div className="serviceRow"><span><Truck /> Free shipping</span><span>↻ Easy returns</span><span><Lock /> Secure payment</span></div>
            <div className="pAccordion">
              {accordion.map((s) => (
                <div className="pAccordionItem" key={s.id}>
                  <button type="button" className="accordion" onClick={() => setOpenAccordion(openAccordion === s.id ? null : s.id)} aria-expanded={openAccordion === s.id}>
                    {s.title}<Plus size={15} className={openAccordion === s.id ? 'open' : ''} />
                  </button>
                  {openAccordion === s.id && <div className="accordionBody">{s.body}</div>}
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="detailInfo"><p>Loading…</p></section>
        )}
      </main>
      {recs.length > 0 && (
        <section className="recommend"><h2>YOU MAY ALSO LIKE</h2><div className="productGrid">{recs.map((p) => <ProductCard key={p.id} product={p} />)}</div></section>
      )}
      {viewerOpen && (
        <div className="viewer" role="dialog" aria-modal="true" aria-label="Product picture viewer">
          <button type="button" className="viewerClose" aria-label="Close viewer" onClick={closeViewer}><X size={20} /></button>
          {imageCount > 1 && (
            <>
              <button type="button" className="viewerNav viewerPrev" aria-label="Previous picture" onClick={() => moveImage(-1)}><ChevronLeft size={28} /></button>
              <button type="button" className="viewerNav viewerNext" aria-label="Next picture" onClick={() => moveImage(1)}><ChevronRight size={28} /></button>
              <span className="viewerCount">{imageIdx + 1} / {imageCount}</span>
            </>
          )}
          <div
            ref={stageRef}
            className="viewerStage"
            onPointerDown={stagePointerDown}
            onPointerMove={stagePointerMove}
            onPointerUp={stagePointerUp}
            onPointerCancel={stagePointerUp}
            onDoubleClick={toggleZoom}
            style={{ touchAction: 'none' }}
          >
            <img
              src={mainImg}
              alt={prod?.name ?? ''}
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${viewerScale})` }}
            />
          </div>
          <div className="viewerTools">
            <button type="button" aria-label="Zoom out" disabled={viewerScale <= 1} onClick={() => zoomBy(1 / 1.5)}><ZoomOut size={16} /></button>
            <span className="viewerScaleLabel">{Math.round(viewerScale * 10) / 10}×</span>
            <button type="button" aria-label="Zoom in" disabled={viewerScale >= 4} onClick={() => zoomBy(1.5)}><ZoomIn size={16} /></button>
            <button type="button" aria-label="Reset zoom" disabled={viewerScale === 1 && pan.x === 0 && pan.y === 0} onClick={resetZoom}><Maximize2 size={15} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProductDetail;
