import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ICreateServiceAreaDto,
  IServiceArea,
  IServiceAreaPartnerItem,
  IUpdateServiceAreaDto,
} from '@thehomez/shared-types';
import { ApiError, authApi, clearAccessToken } from '../../../services/api-client.js';
import { serviceAreaClient } from './service-area-client.js';

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
        tokens: { accessToken: 'memory-token', expiresIn: 900, tokenType: 'Bearer' },
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

const mockServiceArea: IServiceArea = {
  id: 'sa-blr-north',
  code: 'BLR-NORTH',
  name: 'Bengaluru North (Yelahanka)',
  city: 'Bengaluru',
  state: 'Karnataka',
  countryCode: 'IN',
  pincodes: ['560064'],
  deliveryRadiusKm: 20,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

afterEach(() => {
  clearAccessToken();
  vi.unstubAllGlobals();
});

describe('serviceAreaClient read operations (existing)', () => {
  it('sends only supported filters and pagination to the read-only list endpoint', async () => {
    const page = { items: [mockServiceArea], total: 1, page: 2, limit: 20, totalPages: 1 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(page)));

    await expect(
      serviceAreaClient.list({
        city: '  Bengaluru  ',
        state: 'Karnataka',
        isActive: false,
        page: 2,
        limit: 20,
      }),
    ).resolves.toEqual(page);

    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/service-areas?city=Bengaluru&state=Karnataka&isActive=false&page=2&limit=20',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reads a detail record from the existing ID endpoint and preserves API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(mockServiceArea))
        .mockResolvedValueOnce(
          json({ error: { code: 'SERVICE_AREA_NOT_FOUND', message: 'Missing' } }, 404),
        ),
    );

    await expect(serviceAreaClient.get('area /1')).resolves.toEqual(mockServiceArea);
    await expect(serviceAreaClient.get('missing')).rejects.toMatchObject({
      status: 404,
      code: 'SERVICE_AREA_NOT_FOUND',
    });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/service-areas/area%20%2F1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/service-areas/missing',
      expect.objectContaining({ method: 'GET' }),
    );
    for (const [, init] of (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls) {
      expect(init.method).toBe('GET');
    }
  });

  it('keeps 401 and 403 errors distinct', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, 401))
        .mockResolvedValueOnce(json({ error: { code: 'FORBIDDEN', message: 'Denied' } }, 403)),
    );

    await expect(serviceAreaClient.list()).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    await expect(serviceAreaClient.get('id')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(new ApiError('x', 401, 'UNAUTHORIZED').status).toBe(401);
  });
});

describe('serviceAreaClient create operations (SA-1)', () => {
  const createDto: ICreateServiceAreaDto = {
    code: 'BLR-NORTH',
    name: 'Bengaluru North (Yelahanka)',
    city: 'Bengaluru',
    state: 'Karnataka',
    countryCode: 'IN',
    pincodes: ['560064'],
    deliveryRadiusKm: 20,
    isActive: true,
  };

  it('sends POST to /api/v1/service-areas with exact DTO payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(mockServiceArea, 201)));

    const result = await serviceAreaClient.create(createDto);

    expect(result).toEqual(mockServiceArea);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/service-areas',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(createDto),
      }),
    );
  });

  it('supports abort signal on create', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      serviceAreaClient.create(createDto, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('preserves HTTP 400 validation errors on create', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'INVALID_PINCODE',
              message: 'Each PIN code must be a valid 6-digit Indian postal code starting with 1-9',
            },
          },
          400,
        ),
      ),
    );

    await expect(
      serviceAreaClient.create({ ...createDto, pincodes: ['056001'] }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PINCODE',
      message: 'Each PIN code must be a valid 6-digit Indian postal code starting with 1-9',
    });
  });

  it('preserves HTTP 403 forbidden error on create', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Missing required permission: service_area:write',
            },
          },
          403,
        ),
      ),
    );

    await expect(serviceAreaClient.create(createDto)).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('preserves HTTP 409 SERVICE_AREA_CODE_EXISTS conflict details on create', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'SERVICE_AREA_CODE_EXISTS',
              message: 'Service area with code "BLR-NORTH" already exists',
            },
          },
          409,
        ),
      ),
    );

    await expect(serviceAreaClient.create(createDto)).rejects.toMatchObject({
      status: 409,
      code: 'SERVICE_AREA_CODE_EXISTS',
      message: 'Service area with code "BLR-NORTH" already exists',
    });
  });

  it('preserves HTTP 409 PIN_COVERAGE_CONFLICT details on create', async () => {
    const conflictMessage =
      'PIN code coverage conflict: PIN(s) [560064] are already assigned to active service area "BLR-OLD". An active PIN code cannot be ambiguously assigned to multiple active service areas.';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'PIN_COVERAGE_CONFLICT',
              message: conflictMessage,
            },
          },
          409,
        ),
      ),
    );

    await expect(serviceAreaClient.create(createDto)).rejects.toMatchObject({
      status: 409,
      code: 'PIN_COVERAGE_CONFLICT',
      message: conflictMessage,
    });
  });
});

describe('serviceAreaClient update operations (SA-1)', () => {
  it('sends PATCH to /api/v1/service-areas/:id with partial DTO and URL-encodes id', async () => {
    const updatedArea: IServiceArea = { ...mockServiceArea, isActive: false };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(updatedArea, 200)));

    const partialDto: IUpdateServiceAreaDto = { isActive: false };
    const result = await serviceAreaClient.update('area /north', partialDto);

    expect(result).toEqual(updatedArea);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/service-areas/area%20%2Fnorth',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(partialDto),
      }),
    );
  });

  it('supports partial metadata, delivery radius, and PIN array updates', async () => {
    const updatedArea: IServiceArea = {
      ...mockServiceArea,
      name: 'Updated Hub',
      deliveryRadiusKm: 35,
      pincodes: ['560064', '560065'],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(updatedArea, 200)));

    const patchDto: IUpdateServiceAreaDto = {
      name: 'Updated Hub',
      deliveryRadiusKm: 35,
      pincodes: ['560064', '560065'],
    };
    const result = await serviceAreaClient.update('sa-blr-north', patchDto);

    expect(result).toEqual(updatedArea);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/service-areas/sa-blr-north',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(patchDto),
      }),
    );
  });

  it('supports abort signal on update', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      serviceAreaClient.update('sa-blr-north', { isActive: true }, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('preserves HTTP 400 validation error on update', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'INVALID_PAYLOAD',
              message: 'At least one field must be provided for update',
            },
          },
          400,
        ),
      ),
    );

    await expect(serviceAreaClient.update('sa-blr-north', {})).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PAYLOAD',
    });
  });

  it('preserves HTTP 403 forbidden error on update', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Missing required permission: service_area:write',
            },
          },
          403,
        ),
      ),
    );

    await expect(
      serviceAreaClient.update('sa-blr-north', { isActive: false }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('preserves HTTP 404 not found error on update', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'SERVICE_AREA_NOT_FOUND',
              message: 'Service area not found',
            },
          },
          404,
        ),
      ),
    );

    await expect(serviceAreaClient.update('nonexistent-id', { name: 'New' })).rejects.toMatchObject(
      {
        status: 404,
        code: 'SERVICE_AREA_NOT_FOUND',
      },
    );
  });

  it('preserves HTTP 409 PIN_COVERAGE_CONFLICT details on activation update', async () => {
    const conflictMessage =
      'PIN code coverage conflict: PIN(s) [560064] are already assigned to active service area "BLR-CENTRAL". An active PIN code cannot be ambiguously assigned to multiple active service areas.';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'PIN_COVERAGE_CONFLICT',
              message: conflictMessage,
            },
          },
          409,
        ),
      ),
    );

    await expect(
      serviceAreaClient.update('sa-blr-north', { isActive: true }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'PIN_COVERAGE_CONFLICT',
      message: conflictMessage,
    });
  });

  it('preserves HTTP 409 SERVICE_AREA_CODE_EXISTS details on code update', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'SERVICE_AREA_CODE_EXISTS',
              message: 'Service area with code "BLR-SOUTH" already exists',
            },
          },
          409,
        ),
      ),
    );

    await expect(
      serviceAreaClient.update('sa-blr-north', { code: 'BLR-SOUTH' }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'SERVICE_AREA_CODE_EXISTS',
      message: 'Service area with code "BLR-SOUTH" already exists',
    });
  });
});

describe('serviceAreaClient partner inspection operations (SA-1)', () => {
  const mockPartners: IServiceAreaPartnerItem[] = [
    {
      partnerId: 'partner-1',
      businessName: 'Alpha Building Supplies LLP',
      phone: '+919777700010',
      status: 'ACTIVE',
    },
    {
      partnerId: 'partner-2',
      businessName: 'Beta Trade Solutions Pvt Ltd',
      phone: '+919777700020',
      status: 'ACTIVE',
    },
  ];

  it('sends GET to /api/v1/service-areas/:id/partners and URL-encodes id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(mockPartners, 200)));

    const result = await serviceAreaClient.getPartners('area /north');

    expect(result).toEqual(mockPartners);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/service-areas/area%20%2Fnorth/partners',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('supports abort signal on getPartners', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      serviceAreaClient.getPartners('sa-blr-north', { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('preserves HTTP 403 forbidden error on partner inspection (e.g. missing PARTNER_READ)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'FORBIDDEN',
              message: 'Missing required permissions: service_area:read, partner:read',
            },
          },
          403,
        ),
      ),
    );

    await expect(serviceAreaClient.getPartners('sa-blr-north')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('preserves HTTP 404 not found error on partner inspection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            error: {
              code: 'SERVICE_AREA_NOT_FOUND',
              message: 'Service area not found',
            },
          },
          404,
        ),
      ),
    );

    await expect(serviceAreaClient.getPartners('nonexistent-id')).rejects.toMatchObject({
      status: 404,
      code: 'SERVICE_AREA_NOT_FOUND',
    });
  });
});

describe('serviceAreaClient authorization integration (SA-1)', () => {
  it('attaches Bearer token header when session is established', async () => {
    await establishMemorySession();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(mockServiceArea, 201)));

    const createDto: ICreateServiceAreaDto = {
      code: 'BLR-CENTRAL',
      name: 'Central Hub',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincodes: ['560001'],
    };

    await serviceAreaClient.create(createDto);

    const [, callInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(callInit?.method).toBe('POST');
    expect((callInit?.headers as Headers).get('authorization')).toBe('Bearer memory-token');
    expect((callInit?.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('attaches Bearer token header on update and getPartners calls', async () => {
    await establishMemorySession();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(mockServiceArea, 200))
        .mockResolvedValueOnce(json([], 200)),
    );

    await serviceAreaClient.update('sa-blr-north', { isActive: false });
    const [, patchInit] = vi.mocked(fetch).mock.calls[0]!;
    expect((patchInit?.headers as Headers).get('authorization')).toBe('Bearer memory-token');

    await serviceAreaClient.getPartners('sa-blr-north');
    const [, getInit] = vi.mocked(fetch).mock.calls[1]!;
    expect((getInit?.headers as Headers).get('authorization')).toBe('Bearer memory-token');
  });
});
