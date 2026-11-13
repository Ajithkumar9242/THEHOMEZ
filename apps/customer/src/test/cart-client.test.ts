// @vitest-environment jsdom
/**
 * CartClient API Integration & Contract Tests (Milestone 5B.2)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CartClient, CartApiError } from '../api/cart-client.js';
import type { ICartSummaryDto } from '@thehomez/shared-types';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeCartSummary(overrides: Partial<ICartSummaryDto> = {}): ICartSummaryDto {
  return {
    cartId: 'cart-1',
    ownerType: 'USER',
    version: 3,
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
    items: [],
    totalItemCount: 0,
    validItemCount: 0,
    materialSubtotalPaise: 0,
    currency: 'INR',
    pricingBasis: 'GST_EXCLUSIVE_NET',
    pricingBasisDisclosure: 'GST_EXCLUSIVE_EXCLUDING_DELIVERY',
    hasBlockingIssues: false,
    hasUnacknowledgedPriceChanges: false,
    isValidForCheckout: false,
    updatedAt: '2026-11-12T10:00:00.000Z',
    ...overrides,
  };
}

describe('CartClient', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('calls GET /cart through fetchWithAuth and unwraps backend envelope', async () => {
    const summary = makeCartSummary({ version: 5 });
    const fetchWithAuth = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: summary }));
    const client = new CartClient({ fetchWithAuth });

    const res = await client.getCart();
    expect(res).toEqual(summary);
    expect(fetchWithAuth).toHaveBeenCalledWith(
      '/cart',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Accept: 'application/json' }),
      }),
    );
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('calls POST /cart/items with exact decimal quantity string and expectedVersion', async () => {
    const summary = makeCartSummary({ version: 4, totalItemCount: 1 });
    const fetchWithAuth = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: summary }));
    const client = new CartClient({ fetchWithAuth });

    const res = await client.addItem({
      productId: 'prod-steel',
      variantId: 'var-12mm',
      quantity: '2.500',
      mode: 'INCREMENT',
      pincode: '560001',
      expectedVersion: 3,
    });

    expect(res.version).toBe(4);
    expect(fetchWithAuth).toHaveBeenCalledWith(
      '/cart/items',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          productId: 'prod-steel',
          variantId: 'var-12mm',
          quantity: '2.500',
          mode: 'INCREMENT',
          pincode: '560001',
          expectedVersion: 3,
        }),
      }),
    );
  });

  it('calls PATCH /cart/items/:itemId and surfaces 409 CART_VERSION_CONFLICT cleanly', async () => {
    const fetchWithAuth = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: makeCartSummary({ version: 6 }) }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: {
              code: 'CART_VERSION_CONFLICT',
              message: 'Cart version mismatch',
            },
          },
          409,
        ),
      );
    const client = new CartClient({ fetchWithAuth });

    const ok = await client.updateItemQuantity('item/1', { quantity: '0.300', expectedVersion: 5 });
    expect(ok.version).toBe(6);
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      1,
      '/cart/items/item%2F1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ quantity: '0.300', expectedVersion: 5 }),
      }),
    );

    await expect(
      client.updateItemQuantity('item/1', { quantity: '0.400', expectedVersion: 5 }),
    ).rejects.toMatchObject({
      name: 'CartApiError',
      code: 'CART_VERSION_CONFLICT',
      status: 409,
      message: 'Cart version mismatch',
    });
  });

  it('calls DELETE /cart/items/:itemId with optional expectedVersion query parameter', async () => {
    const fetchWithAuth = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: makeCartSummary({ version: 7 }) }));
    const client = new CartClient({ fetchWithAuth });

    await client.removeItem('item-abc', 6);
    expect(fetchWithAuth).toHaveBeenCalledWith(
      '/cart/items/item-abc?expectedVersion=6',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('calls PATCH /cart/location and POST /cart/clear', async () => {
    const fetchWithAuth = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: makeCartSummary({ pincode: null }) }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: makeCartSummary({ items: [] }) }));
    const client = new CartClient({ fetchWithAuth });

    await client.updateLocation({ pincode: null, expectedVersion: 2 });
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      1,
      '/cart/location',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ pincode: null, expectedVersion: 2 }),
      }),
    );

    await client.clearCart(3);
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      2,
      '/cart/clear',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 3 }),
      }),
    );
  });

  it('throws CartApiError with NETWORK_ERROR on network failure and handles 401 session expiry', async () => {
    const networkFailClient = new CartClient({
      fetchWithAuth: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    });
    await expect(networkFailClient.getCart()).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });

    const expiredClient = new CartClient({
      fetchWithAuth: vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    });
    await expect(expiredClient.getCart()).rejects.toBeInstanceOf(CartApiError);
  });

  it('calls POST /cart/validate with optional pincode or addressId and expectedVersion', async () => {
    const mockResult = {
      isValidForCheckout: true,
      evaluatedPincode: '560037',
      localizationState: 'LOCALIZED_SERVICEABLE',
      isServiceable: true,
      blockingReasons: [],
      priceChangedItems: [],
      cart: {
        cartId: 'cart-1',
        status: 'ACTIVE',
        customerSegment: 'B2C',
        pincode: '560037',
        localizationState: 'LOCALIZED_SERVICEABLE',
        isServiceable: true,
        serviceArea: null,
        version: 4,
        items: [],
        totalItemCount: 0,
        validItemCount: 0,
        materialSubtotalPaise: 0,
        currency: 'INR',
        pricingBasis: 'GST_EXCLUSIVE_NET',
        pricingBasisDisclosure: 'GST_EXCLUSIVE_EXCLUDING_DELIVERY',
        hasBlockingIssues: false,
        hasUnacknowledgedPriceChanges: false,
        isValidForCheckout: true,
        updatedAt: '2026-11-12T10:00:00.000Z',
      },
    };
    const fetchWithAuth = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: mockResult }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const client = new CartClient({ fetchWithAuth });

    const res1 = await client.validateCart({ addressId: 'addr-1', expectedVersion: 4 });
    expect(res1.evaluatedPincode).toBe('560037');
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      1,
      '/cart/validate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ addressId: 'addr-1', expectedVersion: 4 }),
      }),
    );

    await client.validateCart({ pincode: '560001', expectedVersion: 4 });
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      2,
      '/cart/validate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ pincode: '560001', expectedVersion: 4 }),
      }),
    );
  });

  it('calls POST /cart/acknowledge-prices for selective itemIds or full cart and maps 409/429 errors', async () => {
    const fetchWithAuth = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { version: 5, items: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { version: 6, items: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'CART_VERSION_CONFLICT', message: 'Version mismatch' },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 429 }),
      );

    const client = new CartClient({ fetchWithAuth });

    await client.acknowledgePrices({ itemIds: ['item-1'], expectedVersion: 4 });
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      1,
      '/cart/acknowledge-prices',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ itemIds: ['item-1'], expectedVersion: 4 }),
      }),
    );

    await client.acknowledgePrices({ expectedVersion: 5 });
    expect(fetchWithAuth).toHaveBeenNthCalledWith(
      2,
      '/cart/acknowledge-prices',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 5 }),
      }),
    );

    await expect(client.acknowledgePrices({ expectedVersion: 5 })).rejects.toMatchObject({
      code: 'CART_VERSION_CONFLICT',
      status: 409,
    });

    await expect(client.validateCart({ expectedVersion: 5 })).rejects.toMatchObject({
      code: 'HTTP_429',
      status: 429,
    });
  });
});
