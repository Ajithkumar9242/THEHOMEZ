import { afterEach, describe, expect, it, vi } from 'vitest';
import { authApi, clearAccessToken, ApiError } from '../../../services/api-client.js';
import { categoryClient } from './category-client.js';

const treePayload = {
  success: true,
  data: {
    categories: [
      {
        id: 'root-1',
        slug: 'materials',
        name: 'Materials',
        parentId: null,
        level: 0,
        displayOrder: 1,
        isActive: true,
        subcategories: [],
      },
    ],
  },
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function establishMemorySession() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(
      json({
        success: true,
        data: {
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
        },
      }),
    ),
  );
  await authApi.loginWithPassword('admin@example.test', 'development-test-password');
}

afterEach(() => {
  clearAccessToken();
  vi.unstubAllGlobals();
});

describe('categoryClient', () => {
  it('loads the persisted category tree from the existing GET endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(treePayload)));
    const result = await categoryClient.getTree({ includeInactive: false });
    expect(result.categories[0]?.name).toBe('Materials');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/categories',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('requests inactive categories only through the supported query parameter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(treePayload)));
    await categoryClient.getTree({ includeInactive: true });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/categories?includeInactive=true',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('loads category detail by encoded slug and returns the shared DTO', async () => {
    const detail = {
      category: {
        id: 'c1',
        slug: 'building-materials',
        name: 'Building materials',
        parentId: null,
        level: 0,
        displayOrder: 2,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      parent: null,
      subcategories: [],
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ success: true, data: detail })));
    const result = await categoryClient.getDetails('building materials', {
      includeInactive: false,
    });
    expect(result.category.slug).toBe('building-materials');
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/categories/building%20materials',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('does not retry or sign out on 403', async () => {
    await establishMemorySession();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } }, 403),
        ),
    );
    await expect(categoryClient.getTree({ includeInactive: false })).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves 401 distinctly and attempts one refresh when a session exists', async () => {
    await establishMemorySession();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Expired' } }, 401),
        )
        .mockResolvedValueOnce(
          json(
            { success: false, error: { code: 'UNAUTHORIZED', message: 'Expired refresh' } },
            401,
          ),
        ),
    );
    await expect(categoryClient.getTree({ includeInactive: false })).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports 404 and server errors without converting them to empty results', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json(
            { success: false, error: { code: 'CATEGORY_NOT_FOUND', message: 'Not found' } },
            404,
          ),
        )
        .mockResolvedValueOnce(
          json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unavailable' } }, 503),
        ),
    );
    await expect(
      categoryClient.getDetails('missing', { includeInactive: false }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(categoryClient.getTree({ includeInactive: false })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('preserves an API validation status when returned', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        json(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid category request' },
          },
          422,
        ),
      ),
    );
    await expect(categoryClient.getTree({ includeInactive: false })).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('maps network failures and preserves request cancellation', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError('offline'))
        .mockRejectedValueOnce(new DOMException('aborted', 'AbortError')),
    );
    await expect(categoryClient.getTree({ includeInactive: false })).rejects.toBeInstanceOf(
      ApiError,
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      categoryClient.getTree({ includeInactive: false, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('creates a category via POST /api/v1/categories with auth and returns created category', async () => {
    await establishMemorySession();
    const created = {
      id: 'cat-new',
      slug: 'structural-steel',
      name: 'Structural Steel',
      parentId: null,
      level: 0,
      displayOrder: 2,
      isActive: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ success: true, data: { category: created } }, 201)),
    );

    const payload = {
      name: 'Structural Steel',
      slug: 'structural-steel',
      parentId: null,
      displayOrder: 2,
      isActive: true,
    };
    const result = await categoryClient.create(payload);
    expect(result.category.id).toBe('cat-new');
    expect(result.category.name).toBe('Structural Steel');
    const [callUrl, callInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(callUrl).toBe('/api/v1/categories');
    expect(callInit?.method).toBe('POST');
    expect(callInit?.body).toBe(JSON.stringify(payload));
    expect((callInit?.headers as Headers).get('authorization')).toBe('Bearer memory-token');
    expect((callInit?.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('updates a category via PATCH /api/v1/categories/:id', async () => {
    await establishMemorySession();
    const updated = {
      id: 'cat-1',
      slug: 'updated-slug',
      name: 'Updated Name',
      parentId: null,
      level: 0,
      displayOrder: 5,
      isActive: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(json({ success: true, data: { category: updated } }, 200)),
    );

    const patchPayload = { name: 'Updated Name', displayOrder: 5, isActive: false };
    const result = await categoryClient.update('cat-1', patchPayload);
    expect(result.category.name).toBe('Updated Name');
    const [callUrl, callInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(callUrl).toBe('/api/v1/categories/cat-1');
    expect(callInit?.method).toBe('PATCH');
    expect(callInit?.body).toBe(JSON.stringify(patchPayload));
    expect((callInit?.headers as Headers).get('authorization')).toBe('Bearer memory-token');
    expect((callInit?.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('deletes a category via DELETE /api/v1/categories/:id', async () => {
    await establishMemorySession();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          json({ success: true, data: { message: 'Category deleted successfully' } }, 200),
        ),
    );

    const result = await categoryClient.delete('cat-1');
    expect(result.message).toBe('Category deleted successfully');
    const [callUrl, callInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(callUrl).toBe('/api/v1/categories/cat-1');
    expect(callInit?.method).toBe('DELETE');
    expect((callInit?.headers as Headers).get('authorization')).toBe('Bearer memory-token');
  });
});

describe('slugify utility', () => {
  it('converts titles into clean kebab-case URL slugs', async () => {
    const { slugify } = await import('./category-client.js');
    expect(slugify('Building Materials')).toBe('building-materials');
    expect(slugify('  TMT Bars & Rods! ')).toBe('tmt-bars-rods');
    expect(slugify('Pumps---Valves')).toBe('pumps-valves');
    expect(slugify('CEMENT')).toBe('cement');
  });
});
