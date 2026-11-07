// @vitest-environment jsdom
/**
 * CategoryRail & Category Response Regression Tests (Workstream B / AC-DISCOV-14)
 *
 * Verifies:
 * - Backend envelope { success: true, data: { categories: [...] } } unpacking
 * - Category cards rendering and sorting by displayOrder
 * - Safe handling of empty/absent categories array
 * - Genuine API errors (4xx, 5xx) thrown and not masked
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CategoryRail } from '../components/catalog/CategoryRail.js';
import { StorefrontProvider } from '../context/StorefrontContext.js';
import { StorefrontClient, StorefrontApiError } from '../api/storefront-client.js';
import type { ICategoryTreeItem } from '@thehomez/shared-types';

describe('CategoryRail Component & StorefrontClient.getCategories Regression Tests', () => {
  const mockCategories: ICategoryTreeItem[] = [
    {
      id: 'cat-2',
      slug: 'structural-steel',
      name: 'Structural Steel',
      displayOrder: 2,
      parentId: null,
      level: 0,
      isActive: true,
      subcategories: [],
    },
    {
      id: 'cat-1',
      slug: 'cement-concrete',
      name: 'Cement & Concrete',
      displayOrder: 1,
      parentId: null,
      level: 0,
      isActive: true,
      subcategories: [],
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('StorefrontClient.getCategories() correctly unpacks { categories: [...] } backend envelope', async () => {
    const client = new StorefrontClient();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        data: {
          categories: mockCategories,
        },
      }),
    } as Response);

    const categories = await client.getCategories();
    expect(Array.isArray(categories)).toBe(true);
    expect(categories).toHaveLength(2);
    expect(categories[0]?.name).toBe('Structural Steel');
    expect(categories[1]?.name).toBe('Cement & Concrete');
  });

  it('StorefrontClient.getCategories() safely handles absent or invalid categories without crashing', async () => {
    const client = new StorefrontClient();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        data: {}, // categories property missing
      }),
    } as Response);

    const categories = await client.getCategories();
    expect(Array.isArray(categories)).toBe(true);
    expect(categories).toEqual([]);
  });

  it('StorefrontClient.getCategories() throws StorefrontApiError on HTTP 500 without hiding genuine errors', async () => {
    const client = new StorefrontClient();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Database query failed',
        },
      }),
    } as Response);

    await expect(client.getCategories()).rejects.toThrowError(StorefrontApiError);
  });

  it('CategoryRail renders categories sorted by displayOrder when backend returns envelope', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        data: {
          categories: mockCategories,
        },
      }),
    } as Response);

    render(
      <StorefrontProvider>
        <CategoryRail />
      </StorefrontProvider>,
    );

    // Initial skeleton loading state
    expect(screen.getByText('Explore Building Materials')).toBeInTheDocument();

    // Wait for categories to load
    await waitFor(() => {
      expect(screen.getByText('Cement & Concrete')).toBeInTheDocument();
      expect(screen.getByText('Structural Steel')).toBeInTheDocument();
    });

    // Check displayOrder: Cement & Concrete (order 1) must precede Structural Steel (order 2)
    const cards = screen.getAllByRole('button');
    expect(cards[0]).toHaveTextContent('Cement & Concrete');
    expect(cards[1]).toHaveTextContent('Structural Steel');
  });

  it('CategoryRail handles clicking a category and navigates to the category page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        data: {
          categories: mockCategories,
        },
      }),
    } as Response);

    render(
      <StorefrontProvider>
        <CategoryRail />
      </StorefrontProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Cement & Concrete')).toBeInTheDocument();
    });

    const cementCard = screen.getByText('Cement & Concrete');
    fireEvent.click(cementCard);

    // Verify browser URL updated to category route
    expect(window.location.search).toContain('category=cement-concrete');
  });
});
