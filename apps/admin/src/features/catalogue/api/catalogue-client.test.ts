import { afterEach, describe, expect, it, vi } from 'vitest';
import { productClient } from './product-client.js';
import { variantClient } from './variant-client.js';
import { ApiError } from '../../../services/api-client.js';

function response(data: unknown, status = 200) {
  const payload = status >= 400 ? data : { success: true, data };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
afterEach(() => vi.unstubAllGlobals());

describe('read-only catalogue clients', () => {
  it('serializes only supported product filters and uses the list response metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(response({ items: [], total: 0, page: 2, limit: 20, totalPages: 1 })),
    );
    const result = await productClient.list({
      page: 2,
      limit: 20,
      status: 'ACTIVE',
      categoryId: 'cat',
      subcategoryId: 'sub',
      brand: 'Acme',
      search: 'brick',
    });
    expect(result).toMatchObject({ total: 0, page: 2, limit: 20, totalPages: 1 });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products?page=2&limit=20&status=ACTIVE&categoryId=cat&subcategoryId=sub&brand=Acme&search=brick',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('uses nested variant endpoints and preserves API errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ variants: [] }))
        .mockResolvedValueOnce(
          response({ error: { code: 'VARIANT_NOT_FOUND', message: 'Missing' } }, 404),
        ),
    );
    expect(await variantClient.list('parent')).toEqual([]);
    await expect(variantClient.get('parent', 'other')).rejects.toMatchObject({
      status: 404,
      code: 'VARIANT_NOT_FOUND',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/products/parent/variants',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/products/parent/variants/other',
      expect.objectContaining({ method: 'GET' }),
    );
    for (const [, init] of (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls)
      expect(init.method).toBe('GET');
  });

  it('preserves authentication and authorization statuses for the read API', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, 401),
        )
        .mockResolvedValueOnce(response({ error: { code: 'FORBIDDEN', message: 'Denied' } }, 403)),
    );
    await expect(productClient.list({})).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    await expect(productClient.list({})).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls)
      expect(init.method).toBe('GET');
    expect(new ApiError('x', 401, 'UNAUTHORIZED').status).toBe(401);
  });
});
