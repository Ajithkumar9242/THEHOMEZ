// @vitest-environment jsdom
/**
 * Customer Cart Validation & Price Acknowledgement Tests (Milestone 5B.3)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  UserStatus,
  UserType,
  type IAuthUser,
  type ICartItemDto,
  type ICartSummaryDto,
  type ICartValidationResultDto,
  type ICustomerAddressDto,
} from '@thehomez/shared-types';
import { App } from '../App.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeCustomerUser(): IAuthUser {
  return {
    id: 'cust-5b3-1',
    phone: '+919876543210',
    email: 'buyer@thehomez.in',
    userType: UserType.CUSTOMER,
    status: UserStatus.ACTIVE,
    roles: ['CUSTOMER'],
    permissions: [],
    createdAt: '2026-11-12T00:00:00.000Z',
  };
}

function makeCartItem(overrides: Partial<ICartItemDto> = {}): ICartItemDto {
  return {
    itemId: '67331a000000000000000101',
    productId: 'prod-steel',
    variantId: 'var-12mm',
    sku: 'STL-TATA-12MM',
    title: 'Tata Tiscon 550D Rebar',
    brand: 'Tata Tiscon',
    slug: 'tata-tiscon-rebar',
    imageUrl: null,
    variantTitle: '12mm Fe550D Bundle',
    variantAttributes: { Diameter: '12mm' },
    unitCode: 'TONNE',
    quantityPrecision: 3,
    minOrderQuantity: '0.100',
    maxOrderQuantity: '25.000',
    stepIncrement: '0.200',
    quantity: '1.000',
    pricingTierApplied: null,
    tierMinQuantity: null,
    unitPricePaise: 6200000,
    lineSubtotalPaise: 6200000,
    mrpSubtotalPaise: 6500000,
    savingsPaise: 300000,
    isServiceAreaOverride: false,
    acknowledgedUnitPricePaise: 6200000,
    priceDrift: null,
    isAvailable: true,
    availabilityUnknown: false,
    minLeadTimeHours: 24,
    itemStatus: 'VALID',
    isValidForCheckout: true,
    addedAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  };
}

function makeCartSummary(overrides: Partial<ICartSummaryDto> = {}): ICartSummaryDto {
  const items = overrides.items ?? [];
  return {
    cartId: 'cart-cust-5b3',
    ownerType: 'USER',
    version: 1,
    customerSegment: 'B2C',
    pincode: '560001',
    localizationState: 'SERVICEABLE',
    isServiceable: true,
    serviceArea: {
      id: 'area-1',
      code: 'BLR-CENTRAL',
      name: 'Bengaluru Central',
      city: 'Bengaluru',
      state: 'Karnataka',
    },
    items,
    totalItemCount: items.length,
    validItemCount: items.filter((i) => i.itemStatus === 'VALID').length,
    materialSubtotalPaise: items.reduce((sum, i) => sum + (i.lineSubtotalPaise ?? 0), 0),
    currency: 'INR',
    pricingBasis: 'GST_EXCLUSIVE_NET',
    pricingBasisDisclosure: 'GST_EXCLUSIVE_EXCLUDING_DELIVERY',
    hasBlockingIssues: items.some((i) => i.itemStatus !== 'VALID'),
    hasUnacknowledgedPriceChanges: items.some((i) => Boolean(i.priceDrift?.hasChanged)),
    isValidForCheckout:
      items.length > 0 &&
      items.every((i) => i.itemStatus === 'VALID' && !i.priceDrift?.hasChanged),
    updatedAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  };
}

function makeValidationResult(
  cart: ICartSummaryDto,
  overrides: Partial<ICartValidationResultDto> = {},
): ICartValidationResultDto {
  return {
    isValidForCheckout: cart.isValidForCheckout,
    validationSnapshotId: `snapshot-${cart.version}`,
    validationSnapshotExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    evaluatedPincode: cart.pincode,
    localizationState: cart.localizationState,
    isServiceable: cart.isServiceable,
    blockingReasons: [],
    priceChangedItems: [],
    cart,
    ...overrides,
  };
}

function makeSavedAddress(overrides: Partial<ICustomerAddressDto> = {}): ICustomerAddressDto {
  return {
    id: '67331a000000000000000201',
    label: 'Whitefield Site Gate 2',
    recipientName: 'Vikram Rao',
    phone: '+919876543210',
    streetAddress: 'Plot 14, EPIP Zone, Whitefield',
    landmark: 'Gate 2',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560037',
    isDefault: true,
    isServiceable: true,
    serviceArea: null,
    createdAt: '2026-11-12T08:00:00.000Z',
    updatedAt: '2026-11-12T08:00:00.000Z',
    ...overrides,
  };
}

function mockAuthSuccess(url: string, user = makeCustomerUser()): Response | null {
  if (url === '/api/v1/auth/refresh') {
    return jsonResponse({
      success: true,
      data: { tokens: { accessToken: 'cart-val-jwt', expiresIn: 900, tokenType: 'Bearer' } },
    });
  }
  if (url === '/api/v1/auth/me') {
    return jsonResponse({ success: true, data: { user } });
  }
  return null;
}

describe('Customer Cart Validation & Price Acknowledgement (Milestone 5B.3)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/cart');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requires a current validation snapshot before showing price acknowledgement as actionable', async () => {
    const drifted = makeCartItem({
      priceDrift: { hasChanged: true, acknowledgedUnitPricePaise: 6200000,
        currentUnitPricePaise: 6300000, deltaPaise: 100000, direction: 'INCREASED' },
    });
    const cart = makeCartSummary({ items: [drifted] });
    const acknowledge = vi.fn();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const authRes = mockAuthSuccess(url);
      if (authRes) return authRes;
      if (url === '/api/v1/cart') return jsonResponse({ success: true, data: cart });
      if (url === '/api/v1/cart/acknowledge-prices') {
        acknowledge();
        return jsonResponse({ success: true, data: cart });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);
    await screen.findByText('Tata Tiscon 550D Rebar');
    expect(screen.getByText('Not Validated Yet')).toBeInTheDocument();
    expect(await screen.findByText(/Validate the cart to create a current snapshot/i)).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Accept Updated Price' })) {
      expect(button).toBeDisabled();
    }
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it('disables acknowledgement when the server validation snapshot is already expired', async () => {
    const item = makeCartItem({
      priceDrift: { hasChanged: true, acknowledgedUnitPricePaise: 6200000,
        currentUnitPricePaise: 6300000, deltaPaise: 100000, direction: 'INCREASED' },
    });
    const cart = makeCartSummary({ items: [item] });
    const expiredValidation = makeValidationResult(cart, {
      validationSnapshotExpiresAt: new Date(Date.now() - 1000).toISOString(),
      isValidForCheckout: false,
      priceChangedItems: [{ code: 'PRICE_CHANGED', severity: 'WARNING', itemId: item.itemId,
        productId: item.productId, variantId: item.variantId, message: 'Material price changed.',
        acknowledgedUnitPricePaise: 6200000, currentUnitPricePaise: 6300000 }],
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const authRes = mockAuthSuccess(url);
      if (authRes) return authRes;
      if (url === '/api/v1/cart') return jsonResponse({ success: true, data: cart });
      if (url === '/api/v1/cart/validate') return jsonResponse({ success: true, data: expiredValidation });
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);
    await screen.findByText('Tata Tiscon 550D Rebar');
    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart Now' }));
    expect(await screen.findByText(/Re-validate the cart before acknowledging/i)).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Accept Updated Price' })) {
      expect(button).toBeDisabled();
    }
  });

  it('validates cart cleanly and shows evaluated PIN, service area, and Validated state', async () => {
    const item = makeCartItem();
    const cart = makeCartSummary({ items: [item], version: 2 });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const authRes = mockAuthSuccess(url);
      if (authRes) return authRes;
      if (url === '/api/v1/cart') {
        return jsonResponse({ success: true, data: cart });
      }
      if (url === '/api/v1/cart/validate') {
        return jsonResponse({ success: true, data: makeValidationResult(cart) });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);

    await screen.findByText('Tata Tiscon 550D Rebar');
    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart' }));

    expect(
      await screen.findByText(/Cart Validated — All items are available and prices are current\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Bengaluru, Karnataka/i)).toBeInTheDocument();

    const validateCalls = fetchSpy.mock.calls.filter(([u]) => u === '/api/v1/cart/validate');
    expect(validateCalls).toHaveLength(1);
    expect(JSON.parse(String(validateCalls[0]?.[1]?.body))).toEqual({ expectedVersion: 2 });
  });

  it('displays blocking issues for unserviceable PIN, unavailable product/variant, and unpriced/OOS items', async () => {
    const item1 = makeCartItem({
      itemId: '67331a000000000000000101',
      itemStatus: 'VARIANT_UNAVAILABLE',
      isValidForCheckout: false,
      isAvailable: false,
    });
    const item2 = makeCartItem({
      itemId: '67331a000000000000000102',
      title: 'ACC Gold Cement',
      sku: 'CEM-ACC-50KG',
      variantTitle: null,
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      stepIncrement: '5',
      quantity: '10',
      itemStatus: 'OUT_OF_STOCK_IN_AREA',
      isValidForCheckout: false,
      isAvailable: false,
    });
    const cart = makeCartSummary({
      items: [item1, item2],
      pincode: '599999',
      localizationState: 'UNSERVICEABLE',
      isServiceable: false,
      serviceArea: null,
      hasBlockingIssues: true,
      isValidForCheckout: false,
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const authRes = mockAuthSuccess(url);
      if (authRes) return authRes;
      if (url === '/api/v1/cart') {
        return jsonResponse({ success: true, data: cart });
      }
      if (url === '/api/v1/cart/validate') {
        return jsonResponse({
          success: true,
          data: makeValidationResult(cart, {
            isValidForCheckout: false,
            blockingReasons: [
              {
                code: 'PINCODE_UNSERVICEABLE',
                severity: 'BLOCKING',
                itemId: null,
                message: 'PIN 599999 is outside our current delivery service areas.',
              },
              {
                code: 'VARIANT_UNAVAILABLE',
                severity: 'BLOCKING',
                itemId: item1.itemId,
                productId: item1.productId,
                variantId: item1.variantId,
                message: '12mm Fe550D Bundle is no longer active.',
              },
              {
                code: 'OUT_OF_STOCK_IN_AREA',
                severity: 'BLOCKING',
                itemId: item2.itemId,
                productId: item2.productId,
                variantId: null,
                message: 'ACC Gold Cement is out of stock for PIN 599999.',
              },
            ],
          }),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);
    await screen.findByText('Tata Tiscon 550D Rebar');
    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart' }));

    expect(await screen.findByText(/Blocking Issues \(3\)/i)).toBeInTheDocument();
    expect(
      screen.getByText(/PIN 599999 is outside our current delivery service areas\./i),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/12mm Fe550D Bundle is no longer active\./i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ACC Gold Cement is out of stock for PIN 599999\./i).length).toBeGreaterThan(0);
    expect(
      screen.queryByText(/Cart Validated — All items are available/i),
    ).not.toBeInTheDocument();
  });

  it('distinguishes price increases vs decreases, supports selective and bulk acknowledgement, and requires fresh validation', async () => {
    const steelIncreased = makeCartItem({
      itemId: '67331a000000000000000101',
      title: 'Tata Tiscon 550D Rebar',
      unitPricePaise: 6500000,
      acknowledgedUnitPricePaise: 6200000,
      priceDrift: {
        acknowledgedUnitPricePaise: 6200000,
        currentUnitPricePaise: 6500000,
        deltaPaise: 300000,
        direction: 'INCREASED',
        hasChanged: true,
      },
    });
    const cementDecreased = makeCartItem({
      itemId: '67331a000000000000000102',
      title: 'UltraTech OPC 53 Grade Cement',
      sku: 'CEM-ULT-53',
      variantTitle: null,
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      stepIncrement: '5',
      quantity: '10',
      unitPricePaise: 38000,
      lineSubtotalPaise: 380000,
      acknowledgedUnitPricePaise: 40000,
      priceDrift: {
        acknowledgedUnitPricePaise: 40000,
        currentUnitPricePaise: 38000,
        deltaPaise: -2000,
        direction: 'DECREASED',
        hasChanged: true,
      },
    });

    const initialCart = makeCartSummary({
      version: 3,
      items: [steelIncreased, cementDecreased],
    });
    const afterSelectiveCart = makeCartSummary({
      version: 4,
      items: [
        { ...steelIncreased, acknowledgedUnitPricePaise: 6500000, priceDrift: null },
        cementDecreased,
      ],
    });
    const afterAllAckCart = makeCartSummary({
      version: 5,
      items: [
        { ...steelIncreased, acknowledgedUnitPricePaise: 6500000, priceDrift: null },
        { ...cementDecreased, acknowledgedUnitPricePaise: 38000, priceDrift: null },
      ],
    });

    let currentCart = initialCart;
    const ackPayloads: unknown[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const authRes = mockAuthSuccess(url);
      if (authRes) return authRes;
      if (url === '/api/v1/cart') {
        return jsonResponse({ success: true, data: currentCart });
      }
      if (url === '/api/v1/cart/validate') {
        const changed = currentCart.items
          .filter((i) => i.priceDrift?.hasChanged)
          .map((i) => ({
            code: 'PRICE_CHANGED' as const,
            severity: 'WARNING' as const,
            itemId: i.itemId,
            productId: i.productId,
            variantId: i.variantId,
            message: `${i.title} unit price changed.`,
            acknowledgedUnitPricePaise: i.priceDrift!.acknowledgedUnitPricePaise,
            currentUnitPricePaise: i.priceDrift!.currentUnitPricePaise,
          }));
        return jsonResponse({
          success: true,
          data: makeValidationResult(currentCart, {
            isValidForCheckout: changed.length === 0,
            priceChangedItems: changed,
          }),
        });
      }
      if (url === '/api/v1/cart/acknowledge-prices') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        ackPayloads.push(body);
        if (Array.isArray(body.itemIds) && body.itemIds.length === 1) {
          currentCart = afterSelectiveCart;
        } else {
          currentCart = afterAllAckCart;
        }
        return jsonResponse({ success: true, data: currentCart });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);
    await screen.findByText('Tata Tiscon 550D Rebar');

    // Run validation first
    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart' }));
    expect(await screen.findByText('Price Updates Detected')).toBeInTheDocument();
    expect(screen.getAllByText(/Price Increased \(\+₹3,000\.00\)/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Price Decreased \(-₹20\.00\)/i).length).toBeGreaterThan(0);

    // Selectively acknowledge only the first item inside the validation panel
    const priceRegion = screen.getByRole('region', {
      name: /Price changes requiring acknowledgement/i,
    });
    const acceptButtons = within(priceRegion).getAllByRole('button', {
      name: 'Accept Updated Price',
    });
    fireEvent.click(acceptButtons[0]!);

    expect(
      await screen.findByText(/Updated price accepted for this item\. Run Validate Cart to confirm cart readiness\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your cart was updated\./i),
    ).toBeInTheDocument();

    // A successful acknowledgement consumes its validation snapshot; revalidate
    // before acknowledging the remaining changed item.
    fireEvent.click(screen.getByRole('button', { name: 'Re-validate Cart' }));
    expect(await screen.findByText('Price Updates Detected')).toBeInTheDocument();

    // Acknowledge remaining item using the fresh snapshot
    fireEvent.click(screen.getByRole('button', { name: 'Accept All Price Updates' }));
    expect(
      await screen.findByText(/Updated prices accepted\. Run Validate Cart to confirm cart readiness\./i),
    ).toBeInTheDocument();

    // Re-validate after all prices acknowledged -> Validated!
    fireEvent.click(screen.getByRole('button', { name: 'Re-validate Cart' }));
    expect(
      await screen.findByText(/Cart Validated — All items are available and prices are current\./i),
    ).toBeInTheDocument();

    expect(ackPayloads).toEqual([
      { itemIds: [steelIncreased.itemId], expectedVersion: 3, validationSnapshotId: 'snapshot-3' },
      { expectedVersion: 4, validationSnapshotId: 'snapshot-4' },
    ]);
  });

  it('supports validation via saved customer address (sending addressId only) and ephemeral PIN without overwriting cart PIN', async () => {
    const item = makeCartItem();
    const cart = makeCartSummary({ items: [item], pincode: '560001', version: 7 });
    const savedAddress = makeSavedAddress({ id: '67331a000000000000000201', pincode: '560037' });
    const validateBodies: unknown[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const authRes = mockAuthSuccess(url);
      if (authRes) return authRes;
      if (url === '/api/v1/cart') {
        return jsonResponse({ success: true, data: cart });
      }
      if (url === '/api/v1/customer/addresses') {
        return jsonResponse({ success: true, data: [savedAddress] });
      }
      if (url === '/api/v1/cart/validate') {
        const body = JSON.parse(String(init?.body ?? '{}'));
        validateBodies.push(body);
        const evalPin = body.addressId ? '560037' : body.pincode ?? '560001';
        return jsonResponse({
          success: true,
          data: makeValidationResult(
            {
              ...cart,
              pincode: evalPin,
              serviceArea: {
                id: 'area-2',
                code: 'BLR-EAST',
                name: 'Bengaluru East',
                city: 'Bengaluru',
                state: 'Karnataka',
              },
            },
            { evaluatedPincode: evalPin },
          ),
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);
    await screen.findByText('Tata Tiscon 550D Rebar');

    // Switch to Saved Site Address mode
    fireEvent.click(screen.getByRole('radio', { name: /Saved Site Address/i }));
    await screen.findByLabelText('Select Saved Site Address');
    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart' }));

    expect(await screen.findByText(/Evaluated PIN:/i)).toBeInTheDocument();
    expect(screen.getByText(/Active cart PIN remains 560001/i)).toBeInTheDocument();

    // Switch to Check Another PIN mode -> invalid PIN guard then valid 6-digit PIN
    fireEvent.click(screen.getByRole('radio', { name: /Check Another PIN/i }));
    const pinInput = screen.getByLabelText('6-Digit Delivery PIN Code');
    fireEvent.change(pinInput, { target: { value: '5600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart' }));
    expect(
      await screen.findByText(/Enter a valid 6-digit Indian PIN code/i),
    ).toBeInTheDocument();

    fireEvent.change(pinInput, { target: { value: '560103' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart' }));
    await screen.findByText(/560103/);

    // Verify addressId and pincode were NEVER sent together
    expect(validateBodies).toEqual([
      { addressId: '67331a000000000000000201', expectedVersion: 7 },
      { pincode: '560103', expectedVersion: 7 },
    ]);
  });

  it('keeps the active cart PIN unchanged when acknowledging a price reviewed for a saved address', async () => {
    const oldItem = makeCartItem({
      variantId: null,
      unitCode: 'BAG',
      quantityPrecision: 0,
      quantity: '10',
      unitPricePaise: 39000,
      lineSubtotalPaise: 390000,
      acknowledgedUnitPricePaise: 39000,
      priceDrift: { hasChanged: true, acknowledgedUnitPricePaise: 39000,
        currentUnitPricePaise: 38000, deltaPaise: -1000, direction: 'DECREASED' },
    });
    const initialCart = makeCartSummary({ items: [oldItem], pincode: null,
      localizationState: 'UNLOCALIZED', isServiceable: null, serviceArea: null });
    const savedAddress = makeSavedAddress({ id: '67331a000000000000000301', pincode: '560037' });
    const regionalItem = { ...oldItem, unitPricePaise: 38000, lineSubtotalPaise: 380000,
      priceDrift: { hasChanged: true, acknowledgedUnitPricePaise: 39000,
        currentUnitPricePaise: 38000, deltaPaise: -1000, direction: 'DECREASED' as const } };
    const regionalCart = makeCartSummary({ ...initialCart, version: 1, pincode: '560037',
      localizationState: 'SERVICEABLE', isServiceable: true,
      serviceArea: { id: 'area-2', code: 'BLR-EAST', name: 'Bengaluru East', city: 'Bengaluru', state: 'Karnataka' },
      items: [regionalItem] });
    const acknowledgedCart = makeCartSummary({ ...regionalCart, version: 2,
      items: [{ ...regionalItem, acknowledgedUnitPricePaise: 38000, priceDrift: null }] });
    const ackPayloads: unknown[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const authRes = mockAuthSuccess(url);
      if (authRes) return authRes;
      if (url === '/api/v1/cart') return jsonResponse({ success: true, data: initialCart });
      if (url === '/api/v1/customer/addresses') return jsonResponse({ success: true, data: [savedAddress] });
      if (url === '/api/v1/cart/validate') return jsonResponse({ success: true, data: makeValidationResult(regionalCart, {
        validationSnapshotId: '67331a000000000000000302', evaluatedPincode: savedAddress.pincode,
        isValidForCheckout: false,
        priceChangedItems: [{ code: 'PRICE_CHANGED', severity: 'WARNING', itemId: oldItem.itemId,
          productId: oldItem.productId, variantId: null, message: 'Material price changed.',
          acknowledgedUnitPricePaise: 39000, currentUnitPricePaise: 38000 }],
      }) });
      if (url === '/api/v1/cart/acknowledge-prices') {
        ackPayloads.push(JSON.parse(String(init?.body ?? '{}')));
        return jsonResponse({ success: true, data: acknowledgedCart });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);
    await screen.findByText('Tata Tiscon 550D Rebar');
    fireEvent.click(screen.getByRole('radio', { name: /Saved Site Address/i }));
    await screen.findByLabelText('Select Saved Site Address');
    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart' }));
    expect(await screen.findByText('Price Updates Detected')).toBeInTheDocument();
    const priceRegion = screen.getByRole('region', { name: /Price changes requiring acknowledgement/i });
    fireEvent.click(within(priceRegion).getByRole('button', { name: 'Accept Updated Price' }));
    expect(await screen.findByText(/Updated price accepted for this item/i)).toBeInTheDocument();

    expect(screen.getByText(/No delivery PIN set/i)).toBeInTheDocument();
    expect(ackPayloads).toEqual([{ itemIds: [oldItem.itemId], expectedVersion: 1,
      validationSnapshotId: '67331a000000000000000302' }]);
  });

  it('invalidates previous validation result when cart quantity is mutated', async () => {
    const item = makeCartItem({ quantity: '1.000', stepIncrement: '0.500' });
    const cartV1 = makeCartSummary({ items: [item], version: 1 });
    const cartV2 = makeCartSummary({
      items: [{ ...item, quantity: '1.500', lineSubtotalPaise: 9300000 }],
      version: 2,
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const authRes = mockAuthSuccess(url);
      if (authRes) return authRes;
      if (url === '/api/v1/cart') {
        return jsonResponse({ success: true, data: cartV1 });
      }
      if (url === '/api/v1/cart/validate') {
        return jsonResponse({ success: true, data: makeValidationResult(cartV1) });
      }
      if (url.startsWith('/api/v1/cart/items/')) {
        return jsonResponse({ success: true, data: cartV2 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);
    await screen.findByText('Tata Tiscon 550D Rebar');

    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart' }));
    await screen.findByText(/Cart Validated — All items are available/i);

    fireEvent.click(screen.getByRole('button', { name: /Increase quantity/i }));
    await waitFor(() => {
      expect(
        screen.queryByText(/Cart Validated — All items are available/i),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Re-validation required:/i)).toBeInTheDocument();
  });

  it('recovers cleanly from 409 CART_VERSION_CONFLICT and prevents duplicate validation submits', async () => {
    const item = makeCartItem();
    const cartV1 = makeCartSummary({ items: [item], version: 1 });
    const cartV2 = makeCartSummary({ items: [item], version: 2 });

    let getCount = 0;
    let resolveValidate!: (value: Response) => void;
    const validatePromise = new Promise<Response>((resolve) => {
      resolveValidate = resolve;
    });
    let validateCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const authRes = mockAuthSuccess(url);
      if (authRes) return authRes;
      if (url === '/api/v1/cart') {
        getCount += 1;
        return jsonResponse({ success: true, data: getCount === 1 ? cartV1 : cartV2 });
      }
      if (url === '/api/v1/cart/validate') {
        validateCount += 1;
        return validatePromise;
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);
    await screen.findByText('Tata Tiscon 550D Rebar');

    const validateBtn = screen.getByRole('button', { name: 'Validate Cart' });
    // Rapid double click while in flight -> only 1 POST issued
    fireEvent.click(validateBtn);
    fireEvent.click(validateBtn);
    await waitFor(() => {
      expect(validateCount).toBe(1);
    });
    for (const btn of screen.getAllByRole('button', { name: 'Validating Cart…' })) {
      expect(btn).toBeDisabled();
    }

    // Resolve with 409 CART_VERSION_CONFLICT -> refreshes GET /cart to version 2
    resolveValidate(
      jsonResponse(
        {
          success: false,
          error: { code: 'CART_VERSION_CONFLICT', message: 'Cart updated elsewhere' },
        },
        409,
      ),
    );

    expect(
      await screen.findByText(/Your cart changed in another tab or session/i),
    ).toBeInTheDocument();
    expect(getCount).toBe(2);
  });

  it('handles 429 rate limit cleanly and redirects to login on 401 session expiration during validation', async () => {
    const item = makeCartItem();
    const cart = makeCartSummary({ items: [item], version: 1 });
    let validateAttempt = 0;
    let isLoggedOut = false;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        if (isLoggedOut) {
          return jsonResponse(
            { success: false, error: { code: 'UNAUTHORIZED', message: 'Expired' } },
            401,
          );
        }
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'cart-val-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user: makeCustomerUser() } });
      }
      if (url === '/api/v1/cart') {
        return jsonResponse({ success: true, data: cart });
      }
      if (url === '/api/v1/cart/validate') {
        validateAttempt += 1;
        if (validateAttempt === 1) {
          return jsonResponse(
            {
              success: false,
              error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down' },
            },
            429,
          );
        }
        isLoggedOut = true;
        return new Response(null, { status: 401 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);
    await screen.findByText('Tata Tiscon 550D Rebar');

    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart' }));
    expect(
      await screen.findByText(/Too many cart requests in a short time/i),
    ).toBeInTheDocument();

    // Second attempt triggers 401 -> redirects to /login?redirect=%2Fcart
    fireEvent.click(screen.getByRole('button', { name: 'Validate Cart' }));
    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
    });
  });
});
