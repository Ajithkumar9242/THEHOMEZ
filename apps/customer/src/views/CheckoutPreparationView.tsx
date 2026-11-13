import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ICheckoutSessionDto, ICustomerAddressDto, ICartValidationResultDto } from '@thehomez/shared-types';
import { AddressClient } from '../api/address-client.js';
import { CartClient, CartApiError } from '../api/cart-client.js';
import { CheckoutApiError, CheckoutClient } from '../api/checkout-client.js';
import { useAuth } from '../context/AuthContext.js';
import { useStorefront } from '../context/StorefrontContext.js';

const money = (paise: number | null) => paise == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
const RETRY_KEY_STORAGE = 'thehomez.checkout.prepare-retry';
type StoredRetry = { fingerprint: string; key: string };

export const CheckoutPreparationView: React.FC = () => {
  const { authorizedFetch, user } = useAuth();
  const { navigateToCart, navigateToAddresses, navigateToUrl } = useStorefront();
  const addresses = useMemo(() => new AddressClient({ fetchWithAuth: authorizedFetch }), [authorizedFetch]);
  const cartApi = useMemo(() => new CartClient({ fetchWithAuth: authorizedFetch }), [authorizedFetch]);
  const checkout = useMemo(() => new CheckoutClient({ fetchWithAuth: authorizedFetch }), [authorizedFetch]);
  const [savedAddresses, setSavedAddresses] = useState<ICustomerAddressDto[]>([]);
  const [cart, setCart] = useState<ICartValidationResultDto['cart'] | null>(null);
  const [validation, setValidation] = useState<ICartValidationResultDto | null>(null);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [session, setSession] = useState<ICheckoutSessionDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const keyRef = useRef<{ payload: string; key: string } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshCartAndAddresses = useCallback(async () => {
    const [freshCart, freshAddresses] = await Promise.all([cartApi.getCart(), addresses.listAddresses()]);
    setCart(freshCart);
    setSavedAddresses(freshAddresses);
    setSelectedAddress((current) => current && freshAddresses.some((a) => a.id === current)
      ? current : (freshAddresses.find((a) => a.isDefault) ?? freshAddresses[0])?.id ?? '');
  }, [addresses, cartApi]);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      setLoading(true); setError('');
      try {
        const params = new URLSearchParams(window.location.search);
        const sessionId = params.get('session');
        const [freshCart, freshAddresses, restored] = await Promise.all([
          cartApi.getCart(), addresses.listAddresses(), sessionId ? checkout.getSession(sessionId) : Promise.resolve(null),
        ]);
        if (!active) return;
        setCart(freshCart); setSavedAddresses(freshAddresses);
        const selected = restored?.deliveryAddressSnapshot.addressId ?? (freshAddresses.find((a) => a.isDefault) ?? freshAddresses[0])?.id ?? '';
        setSelectedAddress(selected);
        if (restored) {
          setSession(restored);
          setNotice(restored.status === 'PREPARED' ? 'Prepared checkout snapshot restored.' : 'This checkout session is no longer active.');
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof CheckoutApiError && err.status === 410) {
          setNotice('That checkout session has expired. Prepare a new snapshot when your cart is ready.');
          void refreshCartAndAddresses().catch((refreshErr) => setError(messageFor(refreshErr)));
        } else if (err instanceof CheckoutApiError && err.status === 404) {
          setNotice('That checkout session could not be found. Review your cart and prepare a new snapshot.');
          void refreshCartAndAddresses().catch((refreshErr) => setError(messageFor(refreshErr)));
        } else setError(messageFor(err));
      } finally { if (active) setLoading(false); }
    };
    void initialize();
    return () => { active = false; };
  }, [addresses, cartApi, checkout, refreshCartAndAddresses]);

  const selected = savedAddresses.find((a) => a.id === selectedAddress);

  const validateForAddress = async () => {
    if (!selected) throw new Error('Select a saved delivery address first.');
    const result = await cartApi.validateCart({ addressId: selected.id, ...(cart ? { expectedVersion: cart.version } : {}) });
    setCart(result.cart); setValidation(result);
    setSession(null);
    return result;
  };

  const handleValidate = async () => {
    if (busy || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await validateForAddress();
      setNotice(result.isServiceable ? 'Delivery serviceability checked for this address.' : 'This cart is not currently serviceable to the selected address.');
    } catch (err) { setError(messageFor(err)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const handleAcknowledge = async () => {
    if (busy || inFlight.current || !validation?.validationSnapshotId || !selected) return;
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await cartApi.acknowledgePrices({ expectedVersion: validation.cart.version, validationSnapshotId: validation.validationSnapshotId });
      setValidation(null);
      await refreshCartAndAddresses();
      setNotice('Updated material prices acknowledged. Validate again to create a fresh checkout snapshot.');
    } catch (err) { setError(messageFor(err)); if (err instanceof CartApiError && err.status === 409) await refreshCartAndAddresses().catch(() => undefined); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const handlePrepare = async () => {
    if (busy || inFlight.current || !selected) return;
    if (session && !activeSession) {
      keyRef.current = null;
      try { sessionStorage.removeItem(RETRY_KEY_STORAGE); } catch { /* Storage is optional. */ }
    }
    inFlight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const ready = validation?.validationSnapshotId && validation.evaluatedPincode === selected.pincode
        ? validation : await validateForAddress();
      if (!ready.isValidForCheckout || !ready.validationSnapshotId) {
        setNotice(ready.priceChangedItems.length ? 'Review and explicitly acknowledge the updated prices below, then validate again.' : 'Resolve the cart validation issues below before preparing checkout.');
        return;
      }
      const body = { addressId: selected.id, expectedCartVersion: ready.cart.version, validationSnapshotId: ready.validationSnapshotId };
      // Backend request identity binds the saved address and cart version; the fresh
      // validation snapshot is proof for this attempt but does not change its payload.
      const fingerprint = JSON.stringify({ addressId: body.addressId, expectedCartVersion: body.expectedCartVersion });
      if (!keyRef.current || keyRef.current.payload !== fingerprint) {
        let stored: StoredRetry | null = null;
        try { stored = JSON.parse(sessionStorage.getItem(RETRY_KEY_STORAGE) ?? 'null') as StoredRetry | null; } catch { stored = null; }
        const key = stored?.fingerprint === fingerprint ? stored.key : checkout.createIdempotencyKey();
        keyRef.current = { payload: fingerprint, key };
        try { sessionStorage.setItem(RETRY_KEY_STORAGE, JSON.stringify({ fingerprint, key } satisfies StoredRetry)); } catch { /* Private browsing may disable session storage; in-memory retry remains available. */ }
      }
      const response = await checkout.prepare(body, keyRef.current.key);
      setSession(response.session); setNotice(response.idempotentReplay ? 'Active checkout snapshot restored.' : 'Checkout readiness verified. Order placement and payment are not yet available.');
      navigateToUrl(`/checkout/prepare?session=${encodeURIComponent(response.session.sessionId)}`, { replace: true });
    } catch (err) {
      if (err instanceof CheckoutApiError && err.code === 'PRICE_DRIFT_UNACKNOWLEDGED') {
        setNotice('Prices changed. Review the updated details below and explicitly acknowledge them before continuing.');
        try { await validateForAddress(); } catch (validationErr) { setError(messageFor(validationErr)); }
      } else if (err instanceof CheckoutApiError && err.status === 409) {
        keyRef.current = null;
        try { sessionStorage.removeItem(RETRY_KEY_STORAGE); } catch { /* Storage is optional. */ }
        setError(err.code === 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH'
          ? 'This retry key is no longer valid for the current request. Validate the cart again to start a new preparation attempt.'
          : 'The cart changed while preparing checkout. Reload the cart and validate again.');
        await refreshCartAndAddresses().catch(() => undefined);
      } else if (err instanceof CheckoutApiError && err.status === 410) {
        keyRef.current = null; setSession(null); setError('The checkout snapshot expired. Validate the cart and prepare a new one.');
        try { sessionStorage.removeItem(RETRY_KEY_STORAGE); } catch { /* Storage is optional. */ }
      } else setError(messageFor(err));
    } finally { inFlight.current = false; setBusy(false); }
  };

  const activeSession = session?.status === 'PREPARED' && new Date(session.expiresAt).getTime() > nowMs;
  const driftRows = validation?.priceChangedItems ?? [];

  if (loading) return <section className="thz-checkout-page" role="status" aria-live="polite">Loading checkout preparation…</section>;
  return (
    <section className="thz-checkout-page" aria-labelledby="thz-checkout-title">
      <nav className="thz-breadcrumbs" aria-label="Breadcrumb"><button type="button" className="thz-breadcrumb-btn" onClick={navigateToCart}>Shopping Cart</button><span aria-hidden="true">/</span><span aria-current="page">Checkout Preparation</span></nav>
      <header className="thz-checkout-header"><h1 id="thz-checkout-title">Checkout Preparation</h1><p>Review your identity, delivery destination and validated materials.</p></header>
      {error && <div className="thz-account-error-banner" role="alert">{error}</div>}
      {notice && <div className="thz-account-notice success" role="status" aria-live="polite">{notice}</div>}
      <div className="thz-checkout-grid">
        <div className="thz-checkout-main">
          <section className="thz-checkout-card" aria-labelledby="thz-checkout-customer"><h2 id="thz-checkout-customer">Customer</h2><p><strong>Signed-in customer</strong></p><p>{user?.phone}</p></section>
          <section className="thz-checkout-card" aria-labelledby="thz-checkout-address"><h2 id="thz-checkout-address">Delivery address</h2>
            {savedAddresses.length === 0 ? <><p>No saved delivery addresses are available.</p><button type="button" className="thz-btn-secondary" onClick={navigateToAddresses}>Add a delivery address</button></> : <fieldset className="thz-checkout-address-list"><legend className="thz-visually-hidden">Choose a delivery address</legend>{savedAddresses.map((address) => <label className="thz-checkout-address-option" key={address.id}><input type="radio" name="checkout-address" value={address.id} checked={selectedAddress === address.id} onChange={() => { setSelectedAddress(address.id); setValidation(null); setSession(null); keyRef.current = null; }} /><span><strong>{address.label} · {address.recipientName}</strong><span>{address.streetAddress}{address.landmark ? `, ${address.landmark}` : ''}</span><span>{address.city}, {address.state} {address.pincode}</span><span>{address.phone}</span></span></label>)}</fieldset>}
            {validation && <p className="thz-checkout-serviceability" role="status">{validation.isServiceable ? `Serviceable to ${validation.evaluatedPincode}.` : `Not serviceable to ${validation.evaluatedPincode ?? selected?.pincode ?? 'this address'}.`}</p>}
          </section>
          <section className="thz-checkout-card" aria-labelledby="thz-checkout-items"><h2 id="thz-checkout-items">Validated cart</h2>
            {!cart?.items.length ? <p>Your cart is empty. <button type="button" className="thz-breadcrumb-btn" onClick={navigateToCart}>Return to cart</button></p> : (session?.items ?? cart.items).map((item) => <div className="thz-checkout-line" key={item.productId + (item.variantId ?? '')}><div><strong>{item.title}</strong><span>{item.quantity} {item.unitCode} × {money(item.unitPricePaise)}</span></div><strong>{money(item.lineSubtotalPaise)}</strong></div>)}
            {driftRows.length > 0 && <div className="thz-checkout-drift" role="alert"><h3>Material prices have changed</h3><p>Review these server supplied updates. Acknowledging applies only to the reviewed validation and delivery address.</p>{driftRows.map((row, index) => <p key={`${row.itemId ?? index}-${index}`}>{row.message}{row.acknowledgedUnitPricePaise != null && row.currentUnitPricePaise != null ? ` Previous ${money(row.acknowledgedUnitPricePaise)} · Updated ${money(row.currentUnitPricePaise)}` : ''}</p>)}<button type="button" className="thz-btn-primary" disabled={busy || !validation?.validationSnapshotId} onClick={() => void handleAcknowledge()}>Acknowledge reviewed prices</button></div>}
          </section>
        </div>
        <aside className="thz-checkout-card thz-checkout-summary" aria-label="Checkout summary">
          <h2>Preparation summary</h2><div className="thz-checkout-total"><span>Material subtotal</span><strong>{money(activeSession ? session!.materialSubtotalPaise : (validation?.cart.materialSubtotalPaise ?? cart?.materialSubtotalPaise ?? 0))}</strong></div>
          <p>Material prices are GST-exclusive net pricing.</p><p>Delivery charges are pending final logistics rules.</p><p>GST and other taxes are deferred and are not calculated here.</p>
          {activeSession && <div className="thz-checkout-session" role="status"><strong>Checkout snapshot: Prepared</strong><span>Expires {new Date(session!.expiresAt).toLocaleString()}</span>{session!.cartModifiedSincePrepare && <span>Your cart has changed since this snapshot.</span>}</div>}
          {session && !activeSession && <p role="status">This checkout session is {session.status.toLowerCase()} and cannot be used as an active snapshot.</p>}
          <button type="button" className="thz-btn-secondary" disabled={busy || !selected} onClick={() => void handleValidate()}>{busy ? 'Working…' : 'Validate or refresh readiness'}</button>
          <button type="button" className="thz-btn-primary" disabled={busy || !selected || !cart?.items.length || driftRows.length > 0} onClick={() => void handlePrepare()}>{activeSession ? 'Refresh Checkout Snapshot' : 'Prepare Checkout Snapshot'}</button>
          <button type="button" className="thz-btn-secondary" onClick={navigateToCart}>Return to Cart</button>
          <p className="thz-checkout-boundary">Checkout readiness verified. Order placement and payment are not yet available.</p>
        </aside>
      </div>
    </section>
  );
};

function messageFor(error: unknown): string {
  if (error instanceof CheckoutApiError || error instanceof CartApiError || error instanceof Error) return error.message;
  return 'Unable to load checkout preparation. Please try again.';
}
