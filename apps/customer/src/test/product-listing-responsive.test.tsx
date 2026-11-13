// @vitest-environment jsdom
/**
 * ProductListingView Responsive Layout & Styling Tests (Workstream B)
 *
 * Verifies:
 * - PLP grid responsive class .thz-plp-layout
 * - Mobile media query collapsing sidebar and product grid to single column (1fr)
 * - Desktop two-column grid definition preservation
 * - Breadcrumb touch targets and removal of sub-44px inline overrides
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import { ProductListingView } from '../views/ProductListingView.js';
import { StorefrontProvider, useStorefront } from '../context/StorefrontContext.js';

describe('ProductListingView Responsive Layout & Touch Target Verification (Workstream B)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        success: true,
        data: {
          items: [],
          pagination: {
            total: 0,
            page: 1,
            limit: 20,
            totalPages: 1,
            hasNextPage: false,
            hasPrevPage: false,
          },
          facets: {
            brands: [],
          },
        },
      }),
    } as Response);
  });

  it('declares responsive .thz-plp-layout class with desktop grid and mobile media query', () => {
    const plpPath = path.resolve(__dirname, '../views/ProductListingView.tsx');
    const plpContent = fs.readFileSync(plpPath, 'utf8');

    // Verify .thz-plp-layout declaration
    expect(plpContent).toContain('.thz-plp-layout');
    expect(plpContent).toContain('<div className="thz-plp-layout">');

    // Verify desktop two-column grid
    expect(plpContent).toMatch(/grid-template-columns:\s*minmax\(240px,\s*280px\)\s*1fr;/);

    // Verify mobile media query collapsing to 1fr
    expect(plpContent).toMatch(/@media\s*\(max-width:\s*768px\)\s*\{/);
    expect(plpContent).toMatch(/grid-template-columns:\s*1fr;/);

    // Verify that the old fixed inline style is gone
    expect(plpContent).not.toMatch(
      /style=\{\{\s*display:\s*['"]grid['"],\s*gridTemplateColumns:\s*['"]minmax\(240px,\s*280px\)\s*1fr['"]/,
    );
  });

  it('renders .thz-plp-layout container element in DOM', async () => {
    const { container } = render(
      <StorefrontProvider>
        <ProductListingView />
      </StorefrontProvider>,
    );

    await waitFor(() => {
      const plpLayout = container.querySelector('.thz-plp-layout');
      expect(plpLayout).toBeInTheDocument();
    });
  });

  it('keeps applied search filters in the URL without adding a history entry', async () => {
    window.history.replaceState(null, '', '/search?q=tmt&category=steel');
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const pushState = vi.spyOn(window.history, 'pushState');

    render(
      <StorefrontProvider>
        <ProductListingView />
      </StorefrontProvider>,
    );

    fireEvent.change(screen.getByLabelText('Brand'), { target: { value: 'Tata' } });
    fireEvent.change(screen.getByLabelText('Minimum price in rupees'), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText('Maximum price in rupees'), {
      target: { value: '90' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));

    await waitFor(() => {
      const params = new URLSearchParams(window.location.search);
      expect(window.location.pathname).toBe('/search');
      expect(params.get('q')).toBe('tmt');
      expect(params.get('category')).toBe('steel');
      expect(params.get('brand')).toBe('Tata');
      expect(params.get('minPricePaise')).toBe('1200');
      expect(params.get('maxPricePaise')).toBe('9000');
    });

    expect(replaceState).toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
  });

  it('applies restored catalogue page and filters to the initial API request', async () => {
    window.history.replaceState(
      null,
      '',
      '/products?category=steel&subcategory=tmt-bars&brand=Tata&minPricePaise=1200&maxPricePaise=9000&sort=price_asc&page=3',
    );
    const fetchSpy = vi.mocked(globalThis.fetch);

    render(
      <StorefrontProvider>
        <ProductListingView />
      </StorefrontProvider>,
    );

    await waitFor(() => {
      const requestUrl = String(fetchSpy.mock.calls[0]?.[0]);
      const params = new URL(requestUrl, window.location.origin).searchParams;
      expect(requestUrl).toContain('/storefront/products?');
      expect(params.get('category')).toBe('steel');
      expect(params.get('subcategory')).toBe('tmt-bars');
      expect(params.get('brand')).toBe('Tata');
      expect(params.get('minPricePaise')).toBe('1200');
      expect(params.get('maxPricePaise')).toBe('9000');
      expect(params.get('sort')).toBe('price_asc');
      expect(params.get('page')).toBe('3');
    });

    const params = new URLSearchParams(window.location.search);
    expect(params.get('page')).toBe('3');
  });

  it('defers an in-stock request until a PIN is available, then applies it with that PIN', async () => {
    window.history.replaceState(null, '', '/search?q=tmt&inStockOnly=true');
    const fetchSpy = vi.mocked(globalThis.fetch);
    const PinSetter = () => {
      const { setPincodeResult } = useStorefront();
      return (
        <button type="button" onClick={() => setPincodeResult('560091', true)}>
          Set test PIN
        </button>
      );
    };

    render(
      <StorefrontProvider>
        <PinSetter />
        <ProductListingView />
      </StorefrontProvider>,
    );

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const unlocalizedUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]), window.location.origin);
    expect(unlocalizedUrl.searchParams.get('inStockOnly')).toBeNull();
    expect(screen.getByLabelText('In-Stock Only')).toBeChecked();
    expect(screen.getByLabelText('In-Stock Only')).toBeDisabled();
    expect(new URLSearchParams(window.location.search).get('inStockOnly')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Set test PIN' }));
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(1));
    const localizedUrl = new URL(
      String(fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1]?.[0]),
      window.location.origin,
    );
    expect(localizedUrl.searchParams.get('pincode')).toBe('560091');
    expect(localizedUrl.searchParams.get('inStockOnly')).toBe('true');
  });

  it('verifies breadcrumbs use .thz-breadcrumb-btn and enforce accessible touch targets', () => {
    const plpPath = path.resolve(__dirname, '../views/ProductListingView.tsx');
    const plpContent = fs.readFileSync(plpPath, 'utf8');

    // Breadcrumb navigation uses .thz-breadcrumb-nav and .thz-breadcrumb-btn
    expect(plpContent).toContain('className="thz-breadcrumb-nav"');
    expect(plpContent).toContain('className="thz-breadcrumb-btn"');

    // No collapsed padding: 0 inline breadcrumb overrides
    expect(plpContent).not.toMatch(/padding:\s*0/);
  });

  it('verifies unserviceable Change PIN button has no sub-44px minHeight override', () => {
    const plpPath = path.resolve(__dirname, '../views/ProductListingView.tsx');
    const plpContent = fs.readFileSync(plpPath, 'utf8');

    // No minHeight: '36px'
    expect(plpContent).not.toMatch(/minHeight:\s*['"]3[0-9]px['"]/);
  });
});
