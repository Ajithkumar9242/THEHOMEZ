import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IAuthUser, ICartSummaryDto, ICartValidationResultDto, ICheckoutSessionDto, ICustomerAddressDto } from '@thehomez/shared-types';
import { parseLocationToRoute } from '../context/StorefrontContext.js';

const mocks = vi.hoisted(() => ({
  authorizedFetch: vi.fn(),
  navigateToCart: vi.fn(),
  navigateToAddresses: vi.fn(),
  navigateToUrl: vi.fn(),
}));
vi.mock('../context/AuthContext.js', () => ({ useAuth: () => ({ authorizedFetch: mocks.authorizedFetch, user: { id: 'user-1', phone: '+919876543210' } as IAuthUser }) }));
vi.mock('../context/StorefrontContext.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    useStorefront: () => ({ navigateToCart: mocks.navigateToCart, navigateToAddresses: mocks.navigateToAddresses, navigateToUrl: mocks.navigateToUrl }),
  };
});
import { CheckoutPreparationView } from '../views/CheckoutPreparationView.js';

const cart = (version = 4): ICartSummaryDto => ({
  cartId: 'cart-1', ownerType: 'USER', version, customerSegment: 'B2C', pincode: '560001', localizationState: 'SERVICEABLE', isServiceable: true,
  serviceArea: null, items: [{ itemId: 'item-1', productId: 'product-1', variantId: null, sku: 'SKU-1', title: 'Portland Cement', brand: 'Brand', slug: 'cement', imageUrl: null, variantTitle: null, variantAttributes: {}, unitCode: 'BAG', quantityPrecision: 0, minOrderQuantity: '1', maxOrderQuantity: null, stepIncrement: '1', quantity: '2', pricingTierApplied: null, tierMinQuantity: null, unitPricePaise: 25000, lineSubtotalPaise: 50000, mrpSubtotalPaise: null, savingsPaise: null, isServiceAreaOverride: false, acknowledgedUnitPricePaise: 25000, priceDrift: null, isAvailable: true, availabilityUnknown: false, minLeadTimeHours: 24, itemStatus: 'VALID', isValidForCheckout: true, addedAt: '2026-11-12T10:00:00.000Z' }],
  totalItemCount: 1, validItemCount: 1, materialSubtotalPaise: 50000, currency: 'INR', pricingBasis: 'GST_EXCLUSIVE_NET', pricingBasisDisclosure: 'GST_EXCLUSIVE_EXCLUDING_DELIVERY', hasBlockingIssues: false, hasUnacknowledgedPriceChanges: false, isValidForCheckout: true, updatedAt: '2026-11-12T10:00:00.000Z',
});
const address: ICustomerAddressDto = { id: 'address-1', label: 'Home', recipientName: 'A Customer', phone: '+919876543210', streetAddress: '10 Market Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560037', isDefault: true, isServiceable: true, serviceArea: null, createdAt: '2026-11-12T00:00:00.000Z', updatedAt: '2026-11-12T00:00:00.000Z' };
const validation = (overrides: Partial<ICartValidationResultDto> = {}): ICartValidationResultDto => ({ isValidForCheckout: true, evaluatedPincode: '560037', localizationState: 'SERVICEABLE', isServiceable: true, blockingReasons: [], priceChangedItems: [], cart: cart(), validationSnapshotId: 'snapshot-1', validationSnapshotExpiresAt: '2026-11-12T10:15:00.000Z', ...overrides });
const session: ICheckoutSessionDto = { sessionId: 'session-1', cartId: 'cart-1', cartVersion: 4, customerSegment: 'B2C', deliveryAddressSnapshot: { addressId: address.id, label: address.label, recipientName: address.recipientName, phone: address.phone, streetAddress: address.streetAddress, city: address.city, state: address.state, pincode: address.pincode }, serviceAreaSnapshot: { serviceAreaId: 'area-1', code: 'BLR', name: 'Bengaluru', city: 'Bengaluru', state: 'Karnataka' }, items: [{ productId: 'product-1', variantId: null, sku: 'SKU-1', title: 'Portland Cement', brand: 'Brand', unitCode: 'BAG', quantityPrecision: 0, quantity: '2', pricingTierApplied: 'STANDARD', tierMinQuantity: null, unitPricePaise: 25000, lineSubtotalPaise: 50000, mrpSubtotalPaise: null, savingsPaise: null, minLeadTimeHours: 24, isServiceAreaOverride: false }], materialSubtotalPaise: 50000, currency: 'INR', pricingBasis: 'GST_EXCLUSIVE_NET', deliveryFeeStatus: 'PENDING_DECISION_7', taxStatus: 'DEFERRED_PHASE_4', status: 'PREPARED', cartModifiedSincePrepare: false, expiresAt: '2099-11-12T20:15:00.000Z', createdAt: '2026-11-12T20:00:00.000Z', updatedAt: '2026-11-12T20:00:00.000Z' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }), { status, headers: { 'content-type': 'application/json' } });

describe('CheckoutPreparationView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/checkout/prepare');
    mocks.authorizedFetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/cart') return json(cart());
      if (path === '/customer/addresses') return json([address]);
      if (path === '/cart/validate') return json(validation());
      if (path === '/checkout/prepare') return json({ session, idempotentReplay: false }, 201);
      if (path === '/checkout/sessions/session-1') return json(session);
      throw new Error(`Unexpected ${init?.method} ${path}`);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('recognizes direct checkout preparation navigation', () => {
    expect(parseLocationToRoute('/checkout/prepare', '').view).toBe('checkout');
  });

  it('validates the selected address and prepares a server priced snapshot', async () => {
    render(<CheckoutPreparationView />);
    expect(await screen.findByRole('radio', { name: /Home · A Customer/ })).toBeChecked();
    expect(screen.getAllByText('+919876543210').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Validate or refresh readiness' }));
    expect(await screen.findByText('Serviceable to 560037.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Checkout Snapshot' }));
    expect(await screen.findByText(/Order placement and payment are not yet available/)).toBeInTheDocument();
    const validateCall = mocks.authorizedFetch.mock.calls.find((call) => call[0] === '/cart/validate');
    expect(JSON.parse(validateCall?.[1]?.body as string)).toEqual({ addressId: address.id, expectedVersion: 4 });
    const prepareCall = mocks.authorizedFetch.mock.calls.find((call) => call[0] === '/checkout/prepare');
    expect(JSON.parse(prepareCall?.[1]?.body as string)).toEqual({ addressId: address.id, expectedCartVersion: 4, validationSnapshotId: 'snapshot-1' });
    expect((prepareCall?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
    expect(screen.getByText(/Delivery charges are pending final logistics rules/)).toBeInTheDocument();
    expect(screen.getByText(/GST and other taxes are deferred/)).toBeInTheDocument();
    expect(screen.queryByText(/order confirmed|payment successful/i)).not.toBeInTheDocument();
  });

  it('restores a prepared session from a direct URL after refresh', async () => {
    window.history.replaceState(null, '', '/checkout/prepare?session=session-1');
    render(<CheckoutPreparationView />);
    expect(await screen.findByText(/Checkout snapshot: Prepared/)).toBeInTheDocument();
    expect(mocks.authorizedFetch).toHaveBeenCalledWith('/checkout/sessions/session-1', expect.anything());
    expect(mocks.authorizedFetch).not.toHaveBeenCalledWith('/checkout/prepare', expect.anything());
  });

  it('retains the same retry key when the page reloads during the same cart preparation', async () => {
    const first = render(<CheckoutPreparationView />);
    await screen.findByRole('radio', { name: /Home · A Customer/ });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Checkout Snapshot' }));
    await screen.findByText(/Order placement and payment are not yet available/);
    const firstCall = mocks.authorizedFetch.mock.calls.find((call) => call[0] === '/checkout/prepare');
    const firstKey = (firstCall?.[1]?.headers as Record<string, string>)['Idempotency-Key'];
    expect(firstKey).toBeTruthy();
    first.unmount();
    window.history.replaceState(null, '', '/checkout/prepare');

    render(<CheckoutPreparationView />);
    await screen.findByRole('radio', { name: /Home · A Customer/ });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Checkout Snapshot' }));
    await waitFor(() => expect(mocks.authorizedFetch.mock.calls.filter((call) => call[0] === '/checkout/prepare')).toHaveLength(2));
    const secondCall = mocks.authorizedFetch.mock.calls.filter((call) => call[0] === '/checkout/prepare')[1];
    expect((secondCall?.[1]?.headers as Record<string, string>)['Idempotency-Key']).toBe(firstKey);
  });

  it('never presents a superseded session as active', async () => {
    mocks.authorizedFetch.mockImplementation(async (path: string) => {
      if (path === '/cart') return json(cart());
      if (path === '/customer/addresses') return json([address]);
      if (path === '/checkout/sessions/session-1') return json({ ...session, status: 'SUPERSEDED' });
      throw new Error(path);
    });
    window.history.replaceState(null, '', '/checkout/prepare?session=session-1');
    render(<CheckoutPreparationView />);
    expect(await screen.findByText(/This checkout session is superseded and cannot be used as an active snapshot/)).toBeInTheDocument();
    expect(screen.queryByText(/Checkout snapshot: Prepared/)).not.toBeInTheDocument();
  });

  it('requires explicit review and sends the exact validation snapshot for price acknowledgement', async () => {
    const drift = { code: 'PRICE_CHANGED' as const, severity: 'WARNING' as const, itemId: 'item-1', message: 'Portland Cement price updated.', acknowledgedUnitPricePaise: 25000, currentUnitPricePaise: 28000 };
    mocks.authorizedFetch.mockImplementation(async (path: string) => {
      if (path === '/cart') return json(cart());
      if (path === '/customer/addresses') return json([address]);
      if (path === '/cart/validate') return json(validation({ isValidForCheckout: false, priceChangedItems: [drift] }));
      if (path === '/cart/acknowledge-prices') return json(cart(5));
      throw new Error(`Unexpected ${path}`);
    });
    render(<CheckoutPreparationView />);
    await screen.findByRole('radio', { name: /Home · A Customer/ });
    fireEvent.click(screen.getByRole('button', { name: 'Validate or refresh readiness' }));
    expect(await screen.findByText(/Previous ₹250.00 · Updated ₹280.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge reviewed prices' }));
    await waitFor(() => expect(mocks.authorizedFetch).toHaveBeenCalledWith('/cart/acknowledge-prices', expect.anything()));
    const ack = mocks.authorizedFetch.mock.calls.find((call) => call[0] === '/cart/acknowledge-prices');
    expect(JSON.parse(ack?.[1]?.body as string)).toEqual({ expectedVersion: 4, validationSnapshotId: 'snapshot-1' });
    expect(mocks.authorizedFetch).not.toHaveBeenCalledWith('/cart/location', expect.anything());
    expect(mocks.authorizedFetch).not.toHaveBeenCalledWith('/checkout/prepare', expect.anything());
  });

  it('prevents duplicate preparation submits while a request is pending', async () => {
    let resolvePrepare!: (response: Response) => void;
    mocks.authorizedFetch.mockImplementation(async (path: string) => {
      if (path === '/cart') return json(cart());
      if (path === '/customer/addresses') return json([address]);
      if (path === '/cart/validate') return json(validation());
      if (path === '/checkout/prepare') return new Promise<Response>((resolve) => { resolvePrepare = resolve; });
      throw new Error(path);
    });
    render(<CheckoutPreparationView />);
    await screen.findByRole('radio', { name: /Home · A Customer/ });
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Checkout Snapshot' }));
    const workingButtons = screen.getAllByRole('button', { name: 'Working…' });
    fireEvent.click(workingButtons[workingButtons.length - 1]!);
    await waitFor(() => expect(mocks.authorizedFetch.mock.calls.filter((call) => call[0] === '/checkout/prepare')).toHaveLength(1));
    resolvePrepare(json({ session, idempotentReplay: false }, 201));
    expect(await screen.findByText(/Checkout snapshot: Prepared/)).toBeInTheDocument();
  });
});
