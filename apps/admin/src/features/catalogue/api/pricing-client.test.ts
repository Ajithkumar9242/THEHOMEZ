import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { IPriceHistory, IProductPricing, MoneyPaise } from '@thehomez/shared-types';
import { authApi, clearAccessToken } from '../../../services/api-client.js';
import {
  pricingClient,
  type SetPricingPayload,
  type SetRegionalPricingPayload,
} from './pricing-client.js';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(status >= 400 ? payload : { success: true, data: payload }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function establishMemorySession(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(
      json({
        tokens: { accessToken: 'memory-pricing-token', expiresIn: 900, tokenType: 'Bearer' },
        user: {
          id: 'staff-1',
          phone: '+910000000000',
          userType: 'STAFF',
          status: 'ACTIVE',
          roles: [],
          permissions: [],
          createdAt: new Date().toISOString(),
        },
      }),
    ),
  );
  await authApi.loginWithPassword('admin@example.test', 'development-test-password');
}

const mockProductPricing: IProductPricing = {
  id: 'price-101',
  productId: 'prod-001',
  variantId: null,
  serviceAreaId: null,
  pricingScope: 'STANDALONE_GLOBAL',
  currency: 'INR',
  b2cPricePaise: 45050 as MoneyPaise, // ₹450.50 in integer paise
  b2cMrpPaise: 50000 as MoneyPaise, // ₹500.00
  b2bPricePaise: 42000 as MoneyPaise, // ₹420.00
  b2bTiers: [
    { minQuantity: '10.000', pricePaise: 40000 as MoneyPaise },
    { minQuantity: '50.000', pricePaise: 38000 as MoneyPaise },
  ],
  isActive: true,
  version: 2,
  createdBy: 'staff-admin-1',
  updatedBy: 'staff-admin-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const mockVariantPricing: IProductPricing = {
  ...mockProductPricing,
  id: 'price-102',
  variantId: 'var-001',
  pricingScope: 'VARIANT_GLOBAL',
  version: 1,
};

const mockPriceHistoryItem: IPriceHistory = {
  id: 'hist-001',
  pricingId: 'price-101',
  productId: 'prod-001',
  variantId: null,
  serviceAreaId: null,
  pricingScope: 'STANDALONE_GLOBAL',
  action: 'UPDATED',
  previousB2cPricePaise: 48000 as MoneyPaise,
  newB2cPricePaise: 45050 as MoneyPaise,
  previousB2cMrpPaise: 50000 as MoneyPaise,
  newB2cMrpPaise: 50000 as MoneyPaise,
  previousB2bPricePaise: 44000 as MoneyPaise,
  newB2bPricePaise: 42000 as MoneyPaise,
  previousTiers: [],
  newTiers: [{ minQuantity: '10.000', pricePaise: 40000 as MoneyPaise }],
  changeReason: 'Vendor cost renegotiation discount',
  changedBy: 'staff-admin-1',
  createdAt: '2026-01-02T00:00:00.000Z',
};

afterEach(() => {
  clearAccessToken();
  vi.unstubAllGlobals();
});

describe('pricingClient read operations (existing)', () => {
  it('reads standalone product records using only the approved GET path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ items: [mockProductPricing] })));

    const result = await pricingClient.getProductPricing('p/1');

    expect(result).toEqual([mockProductPricing]);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products/p%2F1/pricing',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('scopes variant reads to both product and variant and supports only serviceAreaId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ items: [mockVariantPricing] })));
    const controller = new AbortController();

    const result = await pricingClient.getVariantPricing('p1', 'v1', {
      serviceAreaId: 'area-1',
      signal: controller.signal,
    });

    expect(result).toEqual([mockVariantPricing]);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products/p1/variants/v1/pricing?serviceAreaId=area-1',
      expect.objectContaining({ method: 'GET', signal: controller.signal }),
    );
  });
});

describe('pricingClient.setProductPricing', () => {
  const validDto: SetPricingPayload = {
    b2cPricePaise: 45050 as MoneyPaise,
    b2cMrpPaise: 50000 as MoneyPaise,
    b2bPricePaise: 42000 as MoneyPaise,
    b2bTiers: [
      { minQuantity: '10.000', pricePaise: 40000 as MoneyPaise },
      { minQuantity: '50.000', pricePaise: 38000 as MoneyPaise },
    ],
    changeReason: 'Commercial wholesale rate update',
    expectedVersion: 1,
  };

  it('mutates standalone product pricing via PUT with encoded path and valid JSON body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ pricing: mockProductPricing })));
    const controller = new AbortController();

    const result = await pricingClient.setProductPricing('prod/001', validDto, {
      signal: controller.signal,
    });

    expect(result).toEqual(mockProductPricing);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products/prod%2F001/pricing',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(validDto),
        signal: controller.signal,
      }),
    );
  });

  it('preserves exact integer paise values and canonical decimal quantities without conversion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ pricing: mockProductPricing })));

    await pricingClient.setProductPricing('prod-001', validDto);

    const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).toBeDefined();
    const parsedBody = JSON.parse(callArgs![1].body as string);

    // Verify money remains safe integer paise
    expect(parsedBody.b2cPricePaise).toBe(45050);
    expect(Number.isInteger(parsedBody.b2cPricePaise)).toBe(true);
    expect(parsedBody.b2cMrpPaise).toBe(50000);
    expect(parsedBody.b2bPricePaise).toBe(42000);

    // Verify quantity remains canonical decimal string
    expect(parsedBody.b2bTiers[0].minQuantity).toBe('10.000');
    expect(typeof parsedBody.b2bTiers[0].minQuantity).toBe('string');
    expect(parsedBody.b2bTiers[0].pricePaise).toBe(40000);

    // Verify mandatory changeReason and expectedVersion
    expect(parsedBody.changeReason).toBe('Commercial wholesale rate update');
    expect(parsedBody.expectedVersion).toBe(1);
  });

  it('transmits Authorization header when session is active', async () => {
    await establishMemorySession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ pricing: mockProductPricing })));

    await pricingClient.setProductPricing('prod-001', validDto);

    const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs).toBeDefined();
    const headers = callArgs![1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer memory-pricing-token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('propagates 400 validation failure as ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Monetary value must be an integer in paise',
            },
          },
          400,
        ),
      ),
    );

    await expect(pricingClient.setProductPricing('prod-001', validDto)).rejects.toMatchObject({
      name: 'ApiError',
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Monetary value must be an integer in paise',
    });
  });

  it('propagates 401 unauthenticated as ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401),
        ),
    );

    await expect(pricingClient.setProductPricing('prod-001', validDto)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('propagates 403 insufficient permission (PRICING_WRITE) as ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json(
            { error: { code: 'FORBIDDEN', message: 'Access denied: requires pricing:write' } },
            403,
          ),
        ),
    );

    await expect(pricingClient.setProductPricing('prod-001', validDto)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('propagates 404 product not found as ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } }, 404),
        ),
    );

    await expect(pricingClient.setProductPricing('prod-missing', validDto)).rejects.toMatchObject({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('propagates 409 optimistic concurrency conflict as ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'OPTIMISTIC_CONCURRENCY_CONFLICT',
              message:
                'Pricing record was modified concurrently. Expected version: 1, current version: 2',
            },
          },
          409,
        ),
      ),
    );

    await expect(pricingClient.setProductPricing('prod-001', validDto)).rejects.toMatchObject({
      status: 409,
      code: 'OPTIMISTIC_CONCURRENCY_CONFLICT',
      message: expect.stringContaining('Pricing record was modified concurrently'),
    });
  });

  it('propagates 500 unexpected server error as ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Database failure' } }, 500),
        ),
    );

    await expect(pricingClient.setProductPricing('prod-001', validDto)).rejects.toMatchObject({
      status: 500,
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});

describe('pricingClient.setVariantPricing', () => {
  const variantDto: SetPricingPayload = {
    b2cPricePaise: 35000 as MoneyPaise,
    b2cMrpPaise: 40000 as MoneyPaise,
    changeReason: 'Variant introduction pricing',
  };

  it('mutates variant pricing via PUT with encoded product and variant IDs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ pricing: mockVariantPricing })));
    const controller = new AbortController();

    const result = await pricingClient.setVariantPricing('prod/1', 'var/1', variantDto, {
      signal: controller.signal,
    });

    expect(result).toEqual(mockVariantPricing);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products/prod%2F1/variants/var%2F1/pricing',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(variantDto),
        signal: controller.signal,
      }),
    );
  });

  it('propagates 404 variant not found as ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ error: { code: 'VARIANT_NOT_FOUND', message: 'Variant not found' } }, 404),
        ),
    );

    await expect(
      pricingClient.setVariantPricing('prod-001', 'var-missing', variantDto),
    ).rejects.toMatchObject({
      status: 404,
      code: 'VARIANT_NOT_FOUND',
    });
  });

  it('propagates 409 concurrency conflict on variant pricing as ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'OPTIMISTIC_CONCURRENCY_CONFLICT',
              message: 'Version mismatch on variant pricing',
            },
          },
          409,
        ),
      ),
    );

    await expect(
      pricingClient.setVariantPricing('prod-001', 'var-001', {
        ...variantDto,
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'OPTIMISTIC_CONCURRENCY_CONFLICT',
    });
  });
});

describe('pricingClient.getPricingHistory', () => {
  const mockHistoryPage = {
    items: [mockPriceHistoryItem],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  };

  it('retrieves pricing history for a product without extra query parameters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(mockHistoryPage)));

    const result = await pricingClient.getPricingHistory('prod/001');

    expect(result).toEqual(mockHistoryPage);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products/prod%2F001/pricing/history',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('encodes query parameters including variantId, page, and limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(mockHistoryPage)));
    const controller = new AbortController();

    const result = await pricingClient.getPricingHistory('prod-001', {
      variantId: 'var-001',
      page: 2,
      limit: 10,
      signal: controller.signal,
    });

    expect(result).toEqual(mockHistoryPage);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products/prod-001/pricing/history?variantId=var-001&page=2&limit=10',
      expect.objectContaining({ method: 'GET', signal: controller.signal }),
    );
  });

  it('preserves history audit fields and integer paise values in items', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(mockHistoryPage)));

    const result = await pricingClient.getPricingHistory('prod-001');

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item).toBeDefined();
    expect(item!.action).toBe('UPDATED');
    expect(item!.previousB2cPricePaise).toBe(48000);
    expect(item!.newB2cPricePaise).toBe(45050);
    expect(item!.changeReason).toBe('Vendor cost renegotiation discount');
    expect(item!.newTiers[0]!.minQuantity).toBe('10.000');
    expect(item!.newTiers[0]!.pricePaise).toBe(40000);
  });

  it('propagates 403 insufficient permission (PRICING_READ) on history retrieval', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json(
            { error: { code: 'FORBIDDEN', message: 'Access denied: requires pricing:read' } },
            403,
          ),
        ),
    );

    await expect(pricingClient.getPricingHistory('prod-001')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('propagates 404 product not found on history retrieval', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found' } }, 404),
        ),
    );

    await expect(pricingClient.getPricingHistory('prod-missing')).rejects.toMatchObject({
      status: 404,
      code: 'PRODUCT_NOT_FOUND',
    });
  });
});

describe('pricingClient regional operations (Stage P-3A)', () => {
  const mockRegionalProductPricing: IProductPricing = {
    id: 'price-regional-101',
    productId: 'prod-001',
    variantId: null,
    serviceAreaId: 'area-south-01',
    pricingScope: 'STANDALONE_REGIONAL',
    currency: 'INR',
    b2cPricePaise: 48000 as MoneyPaise,
    b2cMrpPaise: 52000 as MoneyPaise,
    b2bPricePaise: 44000 as MoneyPaise,
    b2bTiers: [
      { minQuantity: '20.000', pricePaise: 42000 as MoneyPaise },
      { minQuantity: '100.000', pricePaise: 39000 as MoneyPaise },
    ],
    isActive: true,
    version: 3,
    createdBy: 'staff-admin-1',
    updatedBy: 'staff-admin-1',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
  };

  const mockRegionalVariantPricing: IProductPricing = {
    ...mockRegionalProductPricing,
    id: 'price-regional-102',
    variantId: 'var-001',
    pricingScope: 'VARIANT_REGIONAL',
    version: 2,
  };

  const validRegionalDto: SetRegionalPricingPayload = {
    serviceAreaId: 'area-south-01',
    b2cPricePaise: 48000 as MoneyPaise,
    b2cMrpPaise: 52000 as MoneyPaise,
    b2bPricePaise: 44000 as MoneyPaise,
    b2bTiers: [
      { minQuantity: '20.000', pricePaise: 42000 as MoneyPaise },
      { minQuantity: '100.000', pricePaise: 39000 as MoneyPaise },
    ],
    allowB2bExceedsB2c: false,
    changeReason: 'Regional monsoon freight adjustment',
    expectedVersion: 2,
  };

  describe('Contract 1: Standalone regional pricing PUT', () => {
    it('sends PUT to the correct standalone product URL and includes serviceAreaId in payload', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalProductPricing })),
      );
      const controller = new AbortController();

      const result = await pricingClient.setProductRegionalPricing('prod/001', validRegionalDto, {
        signal: controller.signal,
      });

      expect(result).toEqual(mockRegionalProductPricing);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod%2F001/pricing',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(validRegionalDto),
          signal: controller.signal,
        }),
      );

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);
      expect(parsedBody.serviceAreaId).toBe('area-south-01');
    });

    it('supports regional pricing via generic setProductPricing when serviceAreaId is supplied', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalProductPricing })),
      );

      const result = await pricingClient.setProductPricing('prod-001', validRegionalDto);

      expect(result).toEqual(mockRegionalProductPricing);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod-001/pricing',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(validRegionalDto),
        }),
      );
    });
  });

  describe('Contract 2: Variant regional pricing PUT', () => {
    it('sends PUT to the correct variant URL and includes serviceAreaId in payload', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalVariantPricing })),
      );
      const controller = new AbortController();

      const result = await pricingClient.setVariantRegionalPricing(
        'prod/001',
        'var/001',
        validRegionalDto,
        { signal: controller.signal },
      );

      expect(result).toEqual(mockRegionalVariantPricing);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod%2F001/variants/var%2F001/pricing',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(validRegionalDto),
          signal: controller.signal,
        }),
      );

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);
      expect(parsedBody.serviceAreaId).toBe('area-south-01');
    });

    it('supports variant regional pricing via generic setVariantPricing when serviceAreaId is supplied', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalVariantPricing })),
      );

      const result = await pricingClient.setVariantPricing('prod-001', 'var-001', validRegionalDto);

      expect(result).toEqual(mockRegionalVariantPricing);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod-001/variants/var-001/pricing',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(validRegionalDto),
        }),
      );
    });
  });

  describe('Contract 3: Regional GET filtering encodes serviceAreaId correctly', () => {
    it('filters standalone pricing by serviceAreaId with correct query parameter encoding', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ items: [mockRegionalProductPricing] })),
      );

      const result = await pricingClient.getProductPricing('prod-001', {
        serviceAreaId: 'area-south-01',
      });

      expect(result).toEqual([mockRegionalProductPricing]);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod-001/pricing?serviceAreaId=area-south-01',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('filters variant pricing by serviceAreaId with correct query parameter encoding', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ items: [mockRegionalVariantPricing] })),
      );

      const result = await pricingClient.getVariantPricing('prod-001', 'var-001', {
        serviceAreaId: 'area-south-01',
      });

      expect(result).toEqual([mockRegionalVariantPricing]);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod-001/variants/var-001/pricing?serviceAreaId=area-south-01',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('correctly encodes special characters in serviceAreaId query parameter', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ items: [] })));

      await pricingClient.getProductPricing('prod-001', {
        serviceAreaId: 'area south/zone 1',
      });

      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod-001/pricing?serviceAreaId=area+south%2Fzone+1',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('Contract 4: Expected version is passed on update', () => {
    it('transmits expectedVersion as safe integer for regional standalone updates', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalProductPricing })),
      );

      await pricingClient.setProductRegionalPricing('prod-001', {
        ...validRegionalDto,
        expectedVersion: 3,
      });

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);
      expect(parsedBody.expectedVersion).toBe(3);
      expect(Number.isInteger(parsedBody.expectedVersion)).toBe(true);
    });

    it('transmits expectedVersion = 0 when targeting initial revision', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalProductPricing })),
      );

      await pricingClient.setVariantRegionalPricing('prod-001', 'var-001', {
        ...validRegionalDto,
        expectedVersion: 0,
      });

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);
      expect(parsedBody.expectedVersion).toBe(0);
    });
  });

  describe('Contract 5: Change reason is preserved', () => {
    it('preserves change reason verbatim in standalone regional PUT', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalProductPricing })),
      );
      const reason = 'Mandatory logistics fuel surcharge update for coastal region';

      await pricingClient.setProductRegionalPricing('prod-001', {
        ...validRegionalDto,
        changeReason: reason,
      });

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);
      expect(parsedBody.changeReason).toBe(reason);
    });

    it('preserves change reason verbatim in variant regional PUT', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalVariantPricing })),
      );
      const reason = 'Regional variant promotional discount';

      await pricingClient.setVariantRegionalPricing('prod-001', 'var-001', {
        ...validRegionalDto,
        changeReason: reason,
      });

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);
      expect(parsedBody.changeReason).toBe(reason);
    });
  });

  describe('Contract 6: Paise values remain integer values', () => {
    it('ensures b2c, MRP, b2b baseline, and tier rates remain exact integers in payload', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalProductPricing })),
      );

      await pricingClient.setProductRegionalPricing('prod-001', validRegionalDto);

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);

      expect(parsedBody.b2cPricePaise).toBe(48000);
      expect(Number.isInteger(parsedBody.b2cPricePaise)).toBe(true);

      expect(parsedBody.b2cMrpPaise).toBe(52000);
      expect(Number.isInteger(parsedBody.b2cMrpPaise)).toBe(true);

      expect(parsedBody.b2bPricePaise).toBe(44000);
      expect(Number.isInteger(parsedBody.b2bPricePaise)).toBe(true);

      expect(parsedBody.b2bTiers[0].pricePaise).toBe(42000);
      expect(Number.isInteger(parsedBody.b2bTiers[0].pricePaise)).toBe(true);

      expect(parsedBody.b2bTiers[1].pricePaise).toBe(39000);
      expect(Number.isInteger(parsedBody.b2bTiers[1].pricePaise)).toBe(true);
    });
  });

  describe('Contract 7: Quantity values remain exact decimal strings', () => {
    it('ensures volume tier minQuantity values remain exact decimal strings', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalProductPricing })),
      );

      await pricingClient.setProductRegionalPricing('prod-001', validRegionalDto);

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);

      expect(parsedBody.b2bTiers[0].minQuantity).toBe('20.000');
      expect(typeof parsedBody.b2bTiers[0].minQuantity).toBe('string');

      expect(parsedBody.b2bTiers[1].minQuantity).toBe('100.000');
      expect(typeof parsedBody.b2bTiers[1].minQuantity).toBe('string');
    });
  });

  describe('Contract 8: allowB2bExceedsB2c is preserved', () => {
    it('transmits allowB2bExceedsB2c: true when clearance override is specified', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalProductPricing })),
      );

      await pricingClient.setProductRegionalPricing('prod-001', {
        ...validRegionalDto,
        allowB2bExceedsB2c: true,
      });

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);
      expect(parsedBody.allowB2bExceedsB2c).toBe(true);
    });

    it('transmits allowB2bExceedsB2c: false when normal commercial pricing applies', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(json({ pricing: mockRegionalProductPricing })),
      );

      await pricingClient.setProductRegionalPricing('prod-001', {
        ...validRegionalDto,
        allowB2bExceedsB2c: false,
      });

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);
      expect(parsedBody.allowB2bExceedsB2c).toBe(false);
    });
  });

  describe('Contract 9: HTTP 400, 403, 404, and 409 error handling consistency', () => {
    it('propagates 400 SERVICE_AREA_INACTIVE as ApiError', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json(
              { error: { code: 'SERVICE_AREA_INACTIVE', message: 'Service area is inactive' } },
              400,
            ),
          ),
      );

      await expect(
        pricingClient.setProductRegionalPricing('prod-001', validRegionalDto),
      ).rejects.toMatchObject({
        name: 'ApiError',
        status: 400,
        code: 'SERVICE_AREA_INACTIVE',
        message: 'Service area is inactive',
      });
    });

    it('propagates 403 FORBIDDEN insufficient privileges as ApiError', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          json(
            {
              error: {
                code: 'FORBIDDEN',
                message: "Insufficient privileges: actor lacks required permission 'pricing:write'",
              },
            },
            403,
          ),
        ),
      );

      await expect(
        pricingClient.setProductRegionalPricing('prod-001', validRegionalDto),
      ).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });
    });

    it('propagates 404 SERVICE_AREA_NOT_FOUND as ApiError', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json(
              { error: { code: 'SERVICE_AREA_NOT_FOUND', message: 'Service area not found' } },
              404,
            ),
          ),
      );

      await expect(
        pricingClient.setProductRegionalPricing('prod-001', validRegionalDto),
      ).rejects.toMatchObject({
        status: 404,
        code: 'SERVICE_AREA_NOT_FOUND',
      });
    });

    it('propagates 409 PRICING_CONCURRENCY_CONFLICT as ApiError on regional conflict', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          json(
            {
              error: {
                code: 'PRICING_CONCURRENCY_CONFLICT',
                message:
                  'Pricing record was modified concurrently. Expected version: 2, current version: 3',
              },
            },
            409,
          ),
        ),
      );

      await expect(
        pricingClient.setProductRegionalPricing('prod-001', validRegionalDto),
      ).rejects.toMatchObject({
        status: 409,
        code: 'PRICING_CONCURRENCY_CONFLICT',
        message: expect.stringContaining('Pricing record was modified concurrently'),
      });
    });

    it('propagates errors consistently for variant regional pricing PUT', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json(
              { error: { code: 'SERVICE_AREA_NOT_FOUND', message: 'Service area not found' } },
              404,
            ),
          ),
      );

      await expect(
        pricingClient.setVariantRegionalPricing('prod-001', 'var-001', validRegionalDto),
      ).rejects.toMatchObject({
        status: 404,
        code: 'SERVICE_AREA_NOT_FOUND',
      });
    });
  });

  describe('Contract 10: Existing global pricing requests continue working without serviceAreaId', () => {
    it('setProductPricing without serviceAreaId targets global pricing without serviceAreaId property', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ pricing: mockProductPricing })));

      const globalPayload: SetPricingPayload = {
        b2cPricePaise: 45050 as MoneyPaise,
        changeReason: 'Global rate adjustment',
      };

      await pricingClient.setProductPricing('prod-001', globalPayload);

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);
      expect(parsedBody.serviceAreaId).toBeUndefined();
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod-001/pricing',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('setVariantPricing without serviceAreaId targets global pricing without serviceAreaId property', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ pricing: mockVariantPricing })));

      const globalPayload: SetPricingPayload = {
        b2cPricePaise: 35000 as MoneyPaise,
        changeReason: 'Global variant pricing',
      };

      await pricingClient.setVariantPricing('prod-001', 'var-001', globalPayload);

      const callArgs = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      const parsedBody = JSON.parse(callArgs![1].body as string);
      expect(parsedBody.serviceAreaId).toBeUndefined();
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod-001/variants/var-001/pricing',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    it('getProductPricing without query arguments requests all records without query string', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(json({ items: [mockProductPricing, mockRegionalProductPricing] })),
      );

      const result = await pricingClient.getProductPricing('prod-001');

      expect(result).toHaveLength(2);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod-001/pricing',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('getVariantPricing without query arguments requests all variant records without query string', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(json({ items: [mockVariantPricing, mockRegionalVariantPricing] })),
      );

      const result = await pricingClient.getVariantPricing('prod-001', 'var-001');

      expect(result).toHaveLength(2);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/products/prod-001/variants/var-001/pricing',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('Contract 11: Runtime & compile-time safety guardrails', () => {
    it('throws synchronously if setProductRegionalPricing is called with empty or whitespace serviceAreaId', async () => {
      const invalidDto = {
        ...validRegionalDto,
        serviceAreaId: '',
      };

      await expect(pricingClient.setProductRegionalPricing('prod-001', invalidDto)).rejects.toThrow(
        'serviceAreaId must be a non-empty string for regional pricing',
      );

      await expect(
        pricingClient.setProductRegionalPricing('prod-001', {
          ...validRegionalDto,
          serviceAreaId: '   ',
        }),
      ).rejects.toThrow('serviceAreaId must be a non-empty string for regional pricing');
    });

    it('throws synchronously if setVariantRegionalPricing is called with empty or whitespace serviceAreaId', async () => {
      await expect(
        pricingClient.setVariantRegionalPricing('prod-001', 'var-001', {
          ...validRegionalDto,
          serviceAreaId: '',
        }),
      ).rejects.toThrow('serviceAreaId must be a non-empty string for regional pricing');
    });

    it('validates TypeScript compile-time type invariants', () => {
      // SetRegionalPricingPayload must have a non-optional string serviceAreaId
      expectTypeOf<SetRegionalPricingPayload['serviceAreaId']>().toBeString();
      expectTypeOf<SetRegionalPricingPayload>().toMatchTypeOf<SetPricingPayload>();

      // Generic SetPricingPayload allows optional/nullable serviceAreaId
      expectTypeOf<SetPricingPayload['serviceAreaId']>().toMatchTypeOf<string | null | undefined>();

      // Methods return Promise<IProductPricing>
      expectTypeOf(pricingClient.setProductRegionalPricing).toBeFunction();
      expectTypeOf(pricingClient.setVariantRegionalPricing).toBeFunction();
    });
  });
});
