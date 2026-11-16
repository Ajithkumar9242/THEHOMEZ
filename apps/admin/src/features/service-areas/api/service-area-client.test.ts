import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../services/api-client.js';
import { serviceAreaClient } from './service-area-client.js';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(status >= 400 ? payload : { success: true, data: payload }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('serviceAreaClient', () => {
  it('sends only supported filters and pagination to the read-only list endpoint', async () => {
    const page = { items: [], total: 0, page: 2, limit: 20, totalPages: 1 };
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
    const area = {
      id: 'area /1',
      code: 'BLR',
      name: 'Central',
      city: 'Bengaluru',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: [],
      isActive: true,
      createdAt: '',
      updatedAt: '',
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(area))
        .mockResolvedValueOnce(
          json({ error: { code: 'SERVICE_AREA_NOT_FOUND', message: 'Missing' } }, 404),
        ),
    );
    await expect(serviceAreaClient.get('area /1')).resolves.toEqual(area);
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
    for (const [, init] of (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls)
      expect(init.method).toBe('GET');
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
