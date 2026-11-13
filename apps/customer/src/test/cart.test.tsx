// @vitest-environment jsdom
/**
 * Customer Cart Frontend Comprehensive Tests (Milestone 5B.2)
 *
 * Covers:
 * - Loading, empty cart, error & retry
 * - Protected `/cart` routing, OTP restoration, and session expiry
 * - Adding standalone items (PLP + PDP) & multi-variant selection enforcement (PDP)
 * - Exact decimal quantity stepping (`BigInt`) & precision validation without silent rounding
 * - Quantity update, item removal, clear cart confirmation dialog
 * - Duplicate submission protection & 409 version conflict refresh
 * - Unavailable product/variant, unserviceable area, and price drift display
 * - Milestone boundary compliance (GST-exclusive disclosure, no invented tax/delivery/checkout)
 * - Responsive Cart CSS & >= 44px touch target standards
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { App } from '../App.js';
import { stepExactQuantity, validateCartQuantity } from '../components/cart/cart-quantity.utils.js';
import {
  UserStatus,
  UserType,
  updateCartItemQuantitySchema,
  type IAuthUser,
  type ICartItemDto,
  type ICartSummaryDto,
  type IStorefrontCategorySummary,
  type IStorefrontMultiVariantProductCard,
  type IStorefrontProductDetailResponse,
  type IStorefrontStandaloneProductCard,
} from '@thehomez/shared-types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeCustomerUser(): IAuthUser {
  return {
    id: 'cust-cart-1',
    userType: UserType.CUSTOMER,
    phone: '+919876543210',
    status: UserStatus.ACTIVE,
    roles: [],
    permissions: [],
    createdAt: '2026-04-01T00:00:00.000Z',
    lastLoginAt: '2026-11-12T04:00:00.000Z',
  };
}

const sampleCategories: IStorefrontCategorySummary[] = [
  { id: 'cat-1', slug: 'cement', name: 'Cement & Concrete' },
];

const standaloneBagCard: IStorefrontStandaloneProductCard = {
  id: 'prod-cement',
  slug: 'ultratech-cement-50kg',
  title: 'UltraTech Cement 50kg',
  brand: 'UltraTech',
  hasVariants: false,
  sku: 'CEM-ULT-50',
  category: { id: 'cat-1', slug: 'cement', name: 'Cement & Concrete' },
  subcategory: { id: 'sub-1', slug: 'opc', name: 'OPC' },
  images: [],
  unit: {
    unitCode: 'BAG',
    quantityPrecision: 0,
    minOrderQuantity: '10',
    maxOrderQuantity: '500',
    stepIncrement: '5',
  },
  pricing: {
    customerSegment: 'B2C',
    pricePaise: 38000,
    mrpPaise: 42000,
    discountPercentage: 10,
    isRegionalOverride: false,
    hasVolumeTiers: false,
  },
  availability: {
    availabilityUnknown: false,
    isAvailable: true,
    serviceAreaId: 'area-1',
    minLeadTimeHours: 12,
    availablePartnerCount: 2,
  },
};

const multiVariantSteelCard: IStorefrontMultiVariantProductCard = {
  id: 'prod-steel',
  slug: 'tata-tiscon-rebar',
  title: 'Tata Tiscon 550D Rebar',
  brand: 'Tata Tiscon',
  hasVariants: true,
  variantCount: 2,
  category: { id: 'cat-2', slug: 'steel', name: 'Structural Steel' },
  subcategory: { id: 'sub-2', slug: 'tmt', name: 'TMT Bars' },
  images: [],
  priceRange: { minPricePaise: 6200000, maxPricePaise: 6400000, currency: 'INR' },
  availability: {
    availabilityUnknown: false,
    isAvailable: true,
    serviceAreaId: 'area-1',
    minLeadTimeHours: 24,
    availablePartnerCount: 1,
  },
};

const steelProductDetail: IStorefrontProductDetailResponse = {
  product: {
    id: 'prod-steel',
    slug: 'tata-tiscon-rebar',
    title: 'Tata Tiscon 550D Rebar',
    brand: 'Tata Tiscon',
    description: 'High strength TMT steel rebar.',
    hasVariants: true,
    sku: null,
    category: { id: 'cat-2', slug: 'steel', name: 'Structural Steel' },
    subcategory: { id: 'sub-2', slug: 'tmt', name: 'TMT Bars' },
    images: [],
    specifications: {},
    availability: {
      availabilityUnknown: false,
      isAvailable: true,
      serviceAreaId: 'area-1',
      minLeadTimeHours: 24,
      availablePartnerCount: 1,
    },
  },
  variants: [
    {
      id: 'var-12mm',
      sku: 'STL-TATA-12MM',
      title: '12mm Fe550D Bundle',
      attributes: { Diameter: '12mm', Grade: 'Fe550D' },
      images: [],
      unit: {
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '0.100',
        maxOrderQuantity: '25.000',
        stepIncrement: '0.200',
      },
      pricing: {
        customerSegment: 'B2C',
        pricePaise: 6200000,
        mrpPaise: 6500000,
        discountPercentage: 5,
        isRegionalOverride: false,
        hasVolumeTiers: false,
        b2bTiers: [],
      },
      availability: {
        availabilityUnknown: false,
        isAvailable: true,
        serviceAreaId: 'area-1',
        minLeadTimeHours: 24,
        availablePartnerCount: 1,
      },
    },
  ],
  localization: {
    pincode: '560001',
    isLocalized: true,
    isServiceable: true,
    serviceAreaId: 'area-1',
    serviceAreaName: 'Bengaluru Central',
  },
};

function makeCartItem(overrides: Partial<ICartItemDto> = {}): ICartItemDto {
  return {
    itemId: 'item-steel-1',
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
    quantity: '0.100',
    pricingTierApplied: null,
    tierMinQuantity: null,
    unitPricePaise: 6200000,
    lineSubtotalPaise: 620000,
    mrpSubtotalPaise: 650000,
    savingsPaise: 30000,
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
    cartId: 'cart-cust-1',
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
    hasUnacknowledgedPriceChanges: false,
    isValidForCheckout: items.length > 0 && items.every((i) => i.itemStatus === 'VALID'),
    updatedAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  };
}

function mockAuthSuccess(url: string, user = makeCustomerUser()): Response | null {
  if (url === '/api/v1/auth/refresh') {
    return jsonResponse({
      success: true,
      data: { tokens: { accessToken: 'cart-test-jwt', expiresIn: 900, tokenType: 'Bearer' } },
    });
  }
  if (url === '/api/v1/auth/me') {
    return jsonResponse({ success: true, data: { user } });
  }
  return null;
}

function mockPublicStorefront(url: string): Response | null {
  if (url.startsWith('/api/v1/categories')) {
    return jsonResponse({ success: true, data: { categories: sampleCategories } });
  }
  if (url.startsWith('/api/v1/storefront/products/tata-tiscon-rebar')) {
    return jsonResponse({ success: true, data: steelProductDetail });
  }
  if (url.startsWith('/api/v1/storefront/products')) {
    return jsonResponse({
      success: true,
      data: {
        items: [standaloneBagCard, multiVariantSteelCard],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      },
    });
  }
  return null;
}

describe('Customer Cart Frontend (Milestone 5B.2)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects unauthenticated /cart visitor to /login?redirect=%2Fcart and restores /cart after OTP verification', async () => {
    window.history.replaceState(null, '', '/cart');
    const user = makeCustomerUser();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse(
          { success: false, error: { code: 'VALIDATION_ERROR', message: 'Cookie required' } },
          400,
        );
      }
      if (url === '/api/v1/auth/otp/request') {
        return jsonResponse({
          success: true,
          data: { cooldownSeconds: 60, expiresInSeconds: 300, message: 'Sent' },
        });
      }
      if (url === '/api/v1/auth/otp/verify') {
        return jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'otp-jwt', expiresIn: 900, tokenType: 'Bearer' },
            user,
          },
        });
      }
      if (url === '/api/v1/cart') {
        return jsonResponse({ success: true, data: makeCartSummary({ items: [] }) });
      }
      const pub = mockPublicStorefront(url);
      if (pub) return pub;
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /Sign in with mobile number/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('?redirect=%2Fcart');

    fireEvent.change(screen.getByRole('textbox', { name: /Mobile number/i }), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    expect(await screen.findByLabelText(/Digit 1 of 6/i)).toBeInTheDocument();
    for (let i = 0; i < 6; i++) {
      fireEvent.change(screen.getByLabelText(`Digit ${i + 1} of 6`), {
        target: { value: String(i + 1) },
      });
    }
    fireEvent.click(screen.getByRole('button', { name: /Verify & Continue/i }));

    expect(await screen.findByRole('heading', { name: /Your cart is empty/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/cart');
  });

  it('shows loading skeleton then empty state, and recovers cleanly from initial API error via Retry', async () => {
    window.history.replaceState(null, '', '/cart');
    let cartAttempts = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const auth = mockAuthSuccess(url);
      if (auth) return auth;
      if (url === '/api/v1/cart') {
        cartAttempts += 1;
        await new Promise((r) => setTimeout(r, 15));
        if (cartAttempts === 1) {
          return jsonResponse(
            { success: false, error: { code: 'CART_UNAVAILABLE', message: 'Temporary database timeout' } },
            500,
          );
        }
        return jsonResponse({ success: true, data: makeCartSummary({ items: [] }) });
      }
      const pub = mockPublicStorefront(url);
      if (pub) return pub;
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /Shopping Cart/i })).toBeInTheDocument();
    expect(await screen.findByText(/Unable to load your cart/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Temporary database timeout/i).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: /Retry Loading Cart/i }));
    expect(await screen.findByRole('heading', { name: /Your cart is empty/i })).toBeInTheDocument();
    expect(cartAttempts).toBe(2);
  });

  it('performs exact BigInt decimal stepping without floating-point drift and blocks invalid precision edits', async () => {
    // 1. Direct exact math verification: 0.100 + 0.200 === "0.300" (never "0.30000000000000004")
    const decimalConstraints = {
      unitCode: 'TONNE',
      quantityPrecision: 3,
      minOrderQuantity: '0.100',
      maxOrderQuantity: '25.000',
      stepIncrement: '0.200',
    };
    expect(stepExactQuantity('0.100', decimalConstraints, 1)).toBe('0.300');
    expect(validateCartQuantity('0.3005', decimalConstraints).isValid).toBe(false);
    expect(
      validateCartQuantity('10.5', {
        unitCode: 'BAG',
        quantityPrecision: 0,
        minOrderQuantity: '10',
        maxOrderQuantity: '500',
        stepIncrement: '5',
      }).isValid,
    ).toBe(false);

    // 2. Full UI interaction on /cart
    window.history.replaceState(null, '', '/cart');
    let serverCart = makeCartSummary({ version: 2, items: [makeCartItem({ quantity: '0.100' })] });
    const patchBodies: string[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const auth = mockAuthSuccess(url);
      if (auth) return auth;
      if (url === '/api/v1/cart' && (!init?.method || init.method === 'GET')) {
        return jsonResponse({ success: true, data: serverCart });
      }
      if (url === '/api/v1/cart/items/item-steel-1' && init?.method === 'PATCH') {
        const bodyStr = String(init.body ?? '{}');
        patchBodies.push(bodyStr);
        const parsed = JSON.parse(bodyStr) as { quantity: string };
        serverCart = makeCartSummary({
          version: 3,
          items: [
            makeCartItem({
              quantity: parsed.quantity,
              lineSubtotalPaise: 1860000,
              mrpSubtotalPaise: 1950000,
              savingsPaise: 90000,
            }),
          ],
        });
        return jsonResponse({ success: true, data: serverCart });
      }
      const pub = mockPublicStorefront(url);
      if (pub) return pub;
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);

    const qtyInput = (await screen.findByLabelText(
      /Quantity for Tata Tiscon 550D Rebar in TONNE/i,
    )) as HTMLInputElement;
    expect(qtyInput.value).toBe('0.100');

    // Type excess decimal digits ("0.3005") -> shows error, Update stays disabled, no PATCH sent
    fireEvent.change(qtyInput, { target: { value: '0.3005' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/exceeds allowed precision of 3/i);
    const updateBtn = screen.getByRole('button', { name: /^Update$/i });
    expect(updateBtn).toBeDisabled();
    expect(patchBodies).toHaveLength(0);

    // Restore valid server value and step + (0.100 + 0.200 -> 0.300 exact!)
    fireEvent.change(qtyInput, { target: { value: '0.100' } });
    fireEvent.click(
      screen.getByRole('button', { name: /Increase quantity for Tata Tiscon 550D Rebar by 0.200 TONNE/i }),
    );

    await waitFor(() => {
      expect(patchBodies).toHaveLength(1);
    });
    const parsedPatchBody = updateCartItemQuantitySchema.parse(JSON.parse(patchBodies[0]!));
    expect(parsedPatchBody).toEqual({
      quantity: '0.300',
      expectedVersion: 2,
    });
    expect(await screen.findByText(/Cart quantity updated/i)).toBeInTheDocument();
  });

  it('prevents duplicate concurrent submissions, removes item, and clears cart via ClearCartDialog', async () => {
    window.history.replaceState(null, '', '/cart');
    let patchCount = 0;
    let deleteCount = 0;
    let clearCount = 0;
    let resolvePatch!: (res: Response) => void;

    const cementItem = makeCartItem({
      itemId: 'item-cement-1',
      productId: 'prod-cement',
      variantId: null,
      sku: 'CEM-ULT-50',
      title: 'UltraTech Cement 50kg',
      brand: 'UltraTech',
      slug: 'ultratech-cement-50kg',
      variantTitle: null,
      variantAttributes: {},
      unitCode: 'BAG',
      quantityPrecision: 0,
      minOrderQuantity: '10',
      maxOrderQuantity: '500',
      stepIncrement: '5',
      quantity: '10',
      unitPricePaise: 38000,
      lineSubtotalPaise: 380000,
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const auth = mockAuthSuccess(url);
      if (auth) return auth;
      if (url === '/api/v1/cart') {
        return jsonResponse({
          success: true,
          data: makeCartSummary({ version: 1, items: [makeCartItem(), cementItem] }),
        });
      }
      if (url === '/api/v1/cart/items/item-steel-1' && init?.method === 'PATCH') {
        patchCount += 1;
        return new Promise<Response>((resolve) => {
          resolvePatch = resolve;
        });
      }
      if (url.startsWith('/api/v1/cart/items/item-steel-1') && init?.method === 'DELETE') {
        deleteCount += 1;
        return jsonResponse({
          success: true,
          data: makeCartSummary({ version: 3, items: [cementItem] }),
        });
      }
      if (url === '/api/v1/cart/clear' && init?.method === 'POST') {
        clearCount += 1;
        return jsonResponse({
          success: true,
          data: makeCartSummary({ version: 4, items: [] }),
        });
      }
      const pub = mockPublicStorefront(url);
      if (pub) return pub;
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);

    const incBtn = await screen.findByRole('button', {
      name: /Increase quantity for Tata Tiscon 550D Rebar/i,
    });

    // Rapid double-click must trigger only one PATCH
    fireEvent.click(incBtn);
    fireEvent.click(incBtn);
    expect(incBtn).toBeDisabled();
    await waitFor(() => {
      expect(patchCount).toBe(1);
    });

    resolvePatch(
      jsonResponse({
        success: true,
        data: makeCartSummary({ version: 2, items: [makeCartItem({ quantity: '0.300' }), cementItem] }),
      }),
    );
    expect(await screen.findByText(/Cart quantity updated/i)).toBeInTheDocument();

    // Remove first item
    fireEvent.click(screen.getByRole('button', { name: /Remove Tata Tiscon 550D Rebar from cart/i }));
    expect(await screen.findByText(/Item removed from cart/i)).toBeInTheDocument();
    expect(deleteCount).toBe(1);

    // Clear cart dialog: cancel keeps items, confirm clears all
    fireEvent.click(screen.getByRole('button', { name: /^Clear Cart$/i }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/Clear All Cart Items\?/i);

    fireEvent.click(screen.getByRole('button', { name: /Keep Items/i }));
    expect(clearCount).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /^Clear Cart$/i }));
    const confirmBtn = screen
      .getAllByRole('button', { name: /^Clear Cart$/i })
      .find((el) => el.classList.contains('thz-btn-danger-solid'))!;
    fireEvent.click(confirmBtn);

    expect(await screen.findByRole('heading', { name: /Your cart is empty/i })).toBeInTheDocument();
    expect(clearCount).toBe(1);
  });

  it('connects PDP variant selection to Cart without auto-selecting variants', async () => {
    window.history.replaceState(null, '', '/products/tata-tiscon-rebar');
    const addedPayloads: Array<Record<string, unknown>> = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const auth = mockAuthSuccess(url);
      if (auth) return auth;
      if (url === '/api/v1/cart/items' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        addedPayloads.push(body);
        return jsonResponse({
          success: true,
          data: makeCartSummary({ version: 2, items: [makeCartItem()] }),
        });
      }
      if (url === '/api/v1/cart') {
        return jsonResponse({ success: true, data: makeCartSummary({ items: [makeCartItem()] }) });
      }
      const pub = mockPublicStorefront(url);
      if (pub) return pub;
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);

    // VariantSelector must remain neutral: disabled "Select an Option Above" before customer picks variant
    const selectOptionBtn = await screen.findByRole('button', { name: /Select an option to add to cart/i });
    expect(selectOptionBtn).toBeDisabled();
    expect(selectOptionBtn).toHaveTextContent(/Select an Option Above/i);

    // Explicitly pick 12mm variant
    fireEvent.click(screen.getByRole('radio', { name: /12mm Fe550D Bundle/i }));

    const addToCartBtn = screen.getByRole('button', { name: /Add Tata Tiscon 550D Rebar to Cart/i });
    expect(addToCartBtn).toBeEnabled();
    fireEvent.click(addToCartBtn);

    await waitFor(() => {
      expect(addedPayloads).toHaveLength(1);
    });
    expect(addedPayloads[0]).toEqual({
      productId: 'prod-steel',
      variantId: 'var-12mm',
      quantity: '0.100',
      mode: 'INCREMENT',
    });

    // Header badge updates & View Cart navigates cleanly
    expect(await screen.findByRole('button', { name: /Shopping Cart \(1 item\)/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /View Cart/i }));
    expect(await screen.findByRole('heading', { name: /Shopping Cart/i })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/cart');
  });

  it('connects PLP standalone ProductCard Add to Cart, keeps multi-variant PDP-only, and refreshes on 409 conflict', async () => {
    window.history.replaceState(null, '', '/products');
    const addedPayloads: Array<Record<string, unknown>> = [];
    let getCartCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const auth = mockAuthSuccess(url);
      if (auth) return auth;
      if (url === '/api/v1/cart/items' && init?.method === 'POST') {
        addedPayloads.push(JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>);
        return jsonResponse({
          success: true,
          data: makeCartSummary({
            version: 1,
            items: [
              makeCartItem({
                itemId: 'item-cement-1',
                productId: 'prod-cement',
                variantId: null,
                title: 'UltraTech Cement 50kg',
                slug: 'ultratech-cement-50kg',
                unitCode: 'BAG',
                quantityPrecision: 0,
                minOrderQuantity: '10',
                maxOrderQuantity: '500',
                stepIncrement: '5',
                quantity: '10',
                unitPricePaise: 38000,
                lineSubtotalPaise: 380000,
              }),
            ],
          }),
        });
      }
      if (url === '/api/v1/cart/items/item-cement-1' && init?.method === 'PATCH') {
        return jsonResponse(
          { success: false, error: { code: 'CART_VERSION_CONFLICT', message: 'Stale cart version' } },
          409,
        );
      }
      if (url === '/api/v1/cart') {
        getCartCount += 1;
        return jsonResponse({
          success: true,
          data: makeCartSummary({
            version: 5,
            items: [
              makeCartItem({
                itemId: 'item-cement-1',
                productId: 'prod-cement',
                variantId: null,
                title: 'UltraTech Cement 50kg',
                slug: 'ultratech-cement-50kg',
                unitCode: 'BAG',
                quantityPrecision: 0,
                minOrderQuantity: '10',
                maxOrderQuantity: '500',
                stepIncrement: '5',
                quantity: '15',
                unitPricePaise: 38000,
                lineSubtotalPaise: 570000,
              }),
            ],
          }),
        });
      }
      const pub = mockPublicStorefront(url);
      if (pub) return pub;
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);

    // Only 1 Add to Cart button exists on PLP (for standalone cement card, NOT multi-variant rebar card)
    const quickAddButtons = await screen.findAllByRole('button', { name: /Add 10 BAG to Cart/i });
    expect(quickAddButtons).toHaveLength(1);
    expect(screen.getByText('Tata Tiscon 550D Rebar')).toBeInTheDocument();

    fireEvent.click(quickAddButtons[0]!);
    await waitFor(() => {
      expect(addedPayloads).toHaveLength(1);
    });
    expect(addedPayloads[0]).toEqual({
      productId: 'prod-cement',
      variantId: null,
      quantity: '10',
      mode: 'INCREMENT',
    });

    fireEvent.click(await screen.findByRole('button', { name: /View Cart/i }));
    await screen.findByDisplayValue('10');

    // Step quantity + -> backend returns 409 CART_VERSION_CONFLICT -> frontend automatically re-hydrates server version 5 ('15')
    fireEvent.click(screen.getByRole('button', { name: /Increase quantity for UltraTech Cement 50kg/i }));
    expect(await screen.findByText(/Your cart changed in another tab or session/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(getCartCount).toBeGreaterThanOrEqual(2);
    });
    expect(await screen.findByDisplayValue('15')).toBeInTheDocument();
  });

  it('renders unavailable variant, price drift, GST-exclusive disclosure, and redirects on mid-session 401 expiry', async () => {
    window.history.replaceState(null, '', '/cart');
    let sessionExpired = false;

    const unavailableVariant = makeCartItem({
      itemId: 'item-bad-var',
      itemStatus: 'VARIANT_UNAVAILABLE',
      isValidForCheckout: false,
      statusMessage: 'This diameter option was discontinued by the manufacturer.',
      unitPricePaise: null,
      lineSubtotalPaise: null,
    });
    const driftedItem = makeCartItem({
      itemId: 'item-drift-1',
      priceDrift: {
        hasChanged: true,
        acknowledgedUnitPricePaise: 6000000,
        currentUnitPricePaise: 6200000,
        deltaPaise: 200000,
        direction: 'INCREASED',
      },
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        if (sessionExpired) {
          return jsonResponse(
            { success: false, error: { code: 'REFRESH_TOKEN_EXPIRED', message: 'Expired' } },
            401,
          );
        }
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user: makeCustomerUser() } });
      }
      if (url === '/api/v1/cart') {
        return jsonResponse({
          success: true,
          data: makeCartSummary({ items: [unavailableVariant, driftedItem] }),
        });
      }
      if (url.startsWith('/api/v1/cart/items/item-drift-1') && init?.method === 'DELETE') {
        sessionExpired = true;
        return jsonResponse(
          { success: false, error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'Expired' } },
          401,
        );
      }
      const pub = mockPublicStorefront(url);
      if (pub) return pub;
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);

    expect(await screen.findByText(/Selected Variant Unavailable:/i)).toBeInTheDocument();
    expect(
      screen.getByText(/This diameter option was discontinued by the manufacturer\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Unit price updated:/i)).toBeInTheDocument();
    expect(screen.getAllByText(/GST-exclusive/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/excludes delivery or unloading charges/i)).toBeInTheDocument();
    // Strictly no 5B.3 or 5B.4 checkout buttons rendered
    expect(screen.queryByRole('button', { name: /Proceed to Checkout/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Acknowledge Price/i })).not.toBeInTheDocument();

    // Triggering a mutation when access token & refresh cookie are expired redirects to /login?redirect=%2Fcart
    const removeButtons = screen.getAllByRole('button', { name: /Remove .* from cart/i });
    fireEvent.click(removeButtons[1]!);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
    });
    expect(window.location.search).toBe('?redirect=%2Fcart');
  });

  it('enforces >= 44px touch targets and responsive layout rules for Cart controls in customer.css', () => {
    const cssPath = path.resolve(__dirname, '../styles/customer.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toMatch(/\.thz-cart-header-btn\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/);
    expect(css).toMatch(/\.thz-card-add-btn\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/);
    expect(css).toMatch(/\.thz-cart-title-link\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/);
    expect(css).toMatch(/\.thz-btn-compact\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/);
    expect(css).toMatch(/\.thz-cart-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });

  it('renders Volume Tier badge when backend returns TIER_1 with tierMinQuantity', async () => {
    window.history.replaceState(null, '', '/cart');
    const serverCart = makeCartSummary({
      customerSegment: 'B2B',
      items: [
        makeCartItem({
          quantity: '10.000',
          pricingTierApplied: 'TIER_1',
          tierMinQuantity: '10.000',
        }),
      ],
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const auth = mockAuthSuccess(url);
      if (auth) return auth;
      if (url === '/api/v1/cart') {
        return jsonResponse({ success: true, data: serverCart });
      }
      const pub = mockPublicStorefront(url);
      if (pub) return pub;
      throw new Error(`Unexpected URL: ${url}`);
    });

    render(<App />);

    expect(await screen.findByText(/Volume Tier \(10\.000\+ TONNE\)/i)).toBeInTheDocument();
  });
});
