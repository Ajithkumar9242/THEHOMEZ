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

describe('administrative product mutation client', () => {
  it('calls POST /products with JSON body on create', async () => {
    const mockProduct = { id: 'p1', title: 'Cement', brand: 'UltraTech', status: 'DRAFT' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ product: mockProduct })));

    const dto = {
      title: 'Cement',
      brand: 'UltraTech',
      categoryId: '507f1f77bcf86cd799439011',
      subcategoryId: '507f1f77bcf86cd799439012',
    };
    const result = await productClient.create(dto);
    expect(result).toEqual(mockProduct);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    );
  });

  it('calls PATCH /products/:id with JSON body on update', async () => {
    const mockProduct = { id: 'p1', title: 'Updated Title' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ product: mockProduct })));

    const dto = { title: 'Updated Title' };
    const result = await productClient.update('p1', dto);
    expect(result).toEqual(mockProduct);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products/p1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(dto),
      }),
    );
  });

  it('calls lifecycle endpoints (publish, deactivate, archive, deleteDraft) correctly', async () => {
    const mockProduct = { id: 'p1', title: 'Product' };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ product: { ...mockProduct, status: 'ACTIVE' } }))
        .mockResolvedValueOnce(response({ product: { ...mockProduct, status: 'INACTIVE' } }))
        .mockResolvedValueOnce(response({ product: { ...mockProduct, status: 'ARCHIVED' } }))
        .mockResolvedValueOnce(response({ message: 'Draft product deleted successfully' })),
    );

    const published = await productClient.publish('p1');
    expect(published.status).toBe('ACTIVE');
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/products/p1/publish',
      expect.objectContaining({ method: 'POST' }),
    );

    const deactivated = await productClient.deactivate('p1');
    expect(deactivated.status).toBe('INACTIVE');
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/products/p1/deactivate',
      expect.objectContaining({ method: 'POST' }),
    );

    const archived = await productClient.archive('p1');
    expect(archived.status).toBe('ARCHIVED');
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      '/api/v1/products/p1/archive',
      expect.objectContaining({ method: 'POST' }),
    );

    const deleted = await productClient.deleteDraft('p1');
    expect(deleted.message).toBe('Draft product deleted successfully');
    expect(fetch).toHaveBeenNthCalledWith(
      4,
      '/api/v1/products/p1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('preserves error codes on failed mutations', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response(
            { error: { code: 'CANNOT_PUBLISH_UNPRICED_PRODUCT', message: 'Missing B2C pricing' } },
            400,
          ),
        ),
    );

    await expect(productClient.publish('p1')).rejects.toMatchObject({
      status: 400,
      code: 'CANNOT_PUBLISH_UNPRICED_PRODUCT',
      message: 'Missing B2C pricing',
    });
  });
});

describe('administrative variant mutation client', () => {
  it('calls POST /products/:productId/variants with JSON body on create', async () => {
    const mockVariant = {
      id: 'v1',
      productId: 'p1',
      title: '12mm Bar',
      status: 'DRAFT',
      attributes: { diameter: '12mm' },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ variant: mockVariant }, 201)));

    const dto = {
      title: '12mm Bar',
      attributes: { diameter: '12mm' },
    };
    const result = await variantClient.create('p1', dto);
    expect(result).toEqual(mockVariant);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products/p1/variants',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(dto),
      }),
    );
  });

  it('calls PATCH /products/:productId/variants/:variantId with JSON body on update', async () => {
    const mockVariant = {
      id: 'v1',
      productId: 'p1',
      title: 'Updated 12mm Bar',
      status: 'DRAFT',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ variant: mockVariant })));

    const dto = { title: 'Updated 12mm Bar' };
    const result = await variantClient.update('p1', 'v1', dto);
    expect(result).toEqual(mockVariant);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/products/p1/variants/v1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify(dto),
      }),
    );
  });

  it('calls POST deactivate and archive endpoints correctly', async () => {
    const mockVariant = { id: 'v1', productId: 'p1', title: '12mm Bar' };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(response({ variant: { ...mockVariant, status: 'INACTIVE' } }))
        .mockResolvedValueOnce(response({ variant: { ...mockVariant, status: 'ARCHIVED' } })),
    );

    const deactivated = await variantClient.deactivate('p1', 'v1');
    expect(deactivated.status).toBe('INACTIVE');
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/v1/products/p1/variants/v1/deactivate',
      expect.objectContaining({ method: 'POST' }),
    );

    const archived = await variantClient.archive('p1', 'v1');
    expect(archived.status).toBe('ARCHIVED');
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/v1/products/p1/variants/v1/archive',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('propagates variant-specific error codes correctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          response(
            {
              error: {
                code: 'CANNOT_ACTIVATE_UNPRICED_VARIANT',
                message: 'Active global pricing required',
              },
            },
            400,
          ),
        )
        .mockResolvedValueOnce(
          response(
            {
              error: {
                code: 'DUPLICATE_VARIANT_ATTRIBUTES',
                message: 'Duplicate attributes found',
              },
            },
            409,
          ),
        ),
    );

    await expect(variantClient.update('p1', 'v1', { status: 'ACTIVE' })).rejects.toMatchObject({
      status: 400,
      code: 'CANNOT_ACTIVATE_UNPRICED_VARIANT',
    });

    await expect(
      variantClient.create('p1', { title: 'Dup', attributes: { size: '10mm' } }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'DUPLICATE_VARIANT_ATTRIBUTES',
    });
  });
});
