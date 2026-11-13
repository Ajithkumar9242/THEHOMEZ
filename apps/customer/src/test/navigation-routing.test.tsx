// @vitest-environment jsdom
/**
 * Browser URL Synchronization & History API Routing Tests (Workstream B)
 *
 * Verifies:
 * - Direct loading of product detail URLs (/products/:slug, /storefront/products/:slug)
 * - Page refresh on a PDP URL retaining PDP state
 * - Browser Back and Forward (popstate event synchronization)
 * - Graceful handling of invalid paths and unknown product slugs
 * - History API pushState synchronization on navigation actions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import {
  StorefrontProvider,
  useStorefront,
  parseLocationToRoute,
} from '../context/StorefrontContext.js';
import { App } from '../App.js';

describe('Browser URL Synchronization & Navigation (Workstream B)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    // Reset path back to root
    window.history.replaceState(null, '', '/');
  });

  describe('parseLocationToRoute() pure function', () => {
    it('parses PDP URL /products/:slug correctly', () => {
      const route = parseLocationToRoute('/products/tata-tiscon-550d-tmt-bars', '');
      expect(route.view).toBe('pdp');
      expect(route.productSlug).toBe('tata-tiscon-550d-tmt-bars');
      expect(route.searchQuery).toBe('');
    });

    it('parses PDP URL /storefront/products/:slug correctly', () => {
      const route = parseLocationToRoute('/storefront/products/ultratech-super-cement-50kg', '');
      expect(route.view).toBe('pdp');
      expect(route.productSlug).toBe('ultratech-super-cement-50kg');
    });

    it('parses category URL /category/:slug and /categories/:slug', () => {
      const route1 = parseLocationToRoute('/category/structural-steel', '');
      expect(route1.view).toBe('plp');
      expect(route1.filters.category).toBe('structural-steel');

      const route2 = parseLocationToRoute('/categories/cement-concrete', '');
      expect(route2.view).toBe('plp');
      expect(route2.filters.category).toBe('cement-concrete');
    });

    it('parses search URL /search?q=tmt', () => {
      const route = parseLocationToRoute('/search', '?q=tmt');
      expect(route.view).toBe('plp');
      expect(route.searchQuery).toBe('tmt');
    });

    it('parses catalogue URL /products with filters', () => {
      const route = parseLocationToRoute(
        '/products',
        '?category=steel&brand=Tata&sort=price_asc&page=2',
      );
      expect(route.view).toBe('plp');
      expect(route.filters.category).toBe('steel');
      expect(route.filters.brand).toBe('Tata');
      expect(route.filters.sort).toBe('price_asc');
      expect(route.filters.page).toBe(2);
    });

    it('restores all supported discovery filters from catalogue and search URLs', () => {
      const catalogue = parseLocationToRoute(
        '/products',
        '?category=steel&subcategory=tmt-bars&brand=Tata&minPricePaise=1200&maxPricePaise=9000&inStockOnly=true&sort=price_asc&page=3',
      );
      expect(catalogue.filters).toMatchObject({
        category: 'steel',
        subcategory: 'tmt-bars',
        brand: 'Tata',
        minPricePaise: 1200,
        maxPricePaise: 9000,
        inStockOnly: true,
        sort: 'price_asc',
        page: 3,
      });

      const search = parseLocationToRoute(
        '/search',
        '?q=tmt&brand=Tata&minPricePaise=1200&maxPricePaise=9000&inStockOnly=true&sort=price_desc&page=2',
      );
      expect(search.searchQuery).toBe('tmt');
      expect(search.filters).toMatchObject({
        brand: 'Tata',
        minPricePaise: 1200,
        maxPricePaise: 9000,
        inStockOnly: true,
        sort: 'price_desc',
        page: 2,
      });
    });

    it('ignores malformed discovery filter values in URLs', () => {
      const route = parseLocationToRoute(
        '/products',
        '?minPricePaise=1.5&maxPricePaise=999999999999999999999&sort=unsupported&page=-1',
      );
      expect(route.filters).toEqual({ page: 1 });

      const invertedRange = parseLocationToRoute(
        '/products',
        '?minPricePaise=9000&maxPricePaise=1200',
      );
      expect(invertedRange.filters).toEqual({ page: 1 });
    });

    it('defaults unknown or invalid paths gracefully to home', () => {
      const route1 = parseLocationToRoute('/some/invalid/404/path', '');
      expect(route1.view).toBe('home');
      expect(route1.productSlug).toBeNull();

      const route2 = parseLocationToRoute('/', '');
      expect(route2.view).toBe('home');
    });
  });

  describe('Direct loading and refresh of product detail URLs', () => {
    it('supports direct loading of a product detail URL', () => {
      window.history.replaceState(null, '', '/products/tata-tiscon-550d-tmt-bars');

      const ConsumerComponent = () => {
        const { currentView, selectedProductSlug } = useStorefront();
        return (
          <div>
            <span data-testid="view">{currentView}</span>
            <span data-testid="slug">{selectedProductSlug}</span>
          </div>
        );
      };

      render(
        <StorefrontProvider>
          <ConsumerComponent />
        </StorefrontProvider>,
      );

      expect(screen.getByTestId('view')).toHaveTextContent('pdp');
      expect(screen.getByTestId('slug')).toHaveTextContent('tata-tiscon-550d-tmt-bars');
    });

    it('supports refreshing on a PDP URL without resetting to home', () => {
      window.history.replaceState(null, '', '/products/ultratech-super-cement-50kg');

      const ConsumerComponent = () => {
        const { currentView, selectedProductSlug } = useStorefront();
        return (
          <div>
            <span data-testid="view">{currentView}</span>
            <span data-testid="slug">{selectedProductSlug}</span>
          </div>
        );
      };

      // Simulates first load
      const { unmount } = render(
        <StorefrontProvider>
          <ConsumerComponent />
        </StorefrontProvider>,
      );

      expect(screen.getByTestId('view')).toHaveTextContent('pdp');

      // Unmount and re-render (simulating F5 page refresh at the same URL)
      unmount();

      render(
        <StorefrontProvider>
          <ConsumerComponent />
        </StorefrontProvider>,
      );

      expect(screen.getByTestId('view')).toHaveTextContent('pdp');
      expect(screen.getByTestId('slug')).toHaveTextContent('ultratech-super-cement-50kg');
    });
  });

  describe('Browser History Back and Forward (popstate synchronization)', () => {
    it('synchronizes view state on popstate events', () => {
      window.history.replaceState(null, '', '/');

      const ConsumerComponent = () => {
        const { currentView, selectedProductSlug, navigateToProduct, navigateToHome } =
          useStorefront();
        return (
          <div>
            <span data-testid="view">{currentView}</span>
            <span data-testid="slug">{selectedProductSlug || 'none'}</span>
            <button onClick={() => navigateToProduct('steel-rebar')}>Go PDP</button>
            <button onClick={navigateToHome}>Go Home</button>
          </div>
        );
      };

      render(
        <StorefrontProvider>
          <ConsumerComponent />
        </StorefrontProvider>,
      );

      expect(screen.getByTestId('view')).toHaveTextContent('home');

      // Navigate to product
      act(() => {
        screen.getByText('Go PDP').click();
      });

      expect(screen.getByTestId('view')).toHaveTextContent('pdp');
      expect(screen.getByTestId('slug')).toHaveTextContent('steel-rebar');
      expect(window.location.pathname).toBe('/products/steel-rebar');

      // Simulate browser Back button: pushState to '/' and dispatch popstate
      act(() => {
        window.history.pushState(null, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(screen.getByTestId('view')).toHaveTextContent('home');
      expect(screen.getByTestId('slug')).toHaveTextContent('none');

      // Simulate browser Forward button: pushState to '/products/steel-rebar' and dispatch popstate
      act(() => {
        window.history.pushState(null, '', '/products/steel-rebar');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });

      expect(screen.getByTestId('view')).toHaveTextContent('pdp');
      expect(screen.getByTestId('slug')).toHaveTextContent('steel-rebar');
    });
  });

  describe('Graceful handling of unknown product slugs and invalid paths', () => {
    it('gracefully normalizes an invalid path to home without crashing', () => {
      window.history.replaceState(null, '', '/unrecognized-random-url-path');

      const ConsumerComponent = () => {
        const { currentView, selectedProductSlug } = useStorefront();
        return (
          <div>
            <span data-testid="view">{currentView}</span>
            <span data-testid="slug">{selectedProductSlug || 'none'}</span>
          </div>
        );
      };

      render(
        <StorefrontProvider>
          <ConsumerComponent />
        </StorefrontProvider>,
      );

      expect(screen.getByTestId('view')).toHaveTextContent('home');
      expect(screen.getByTestId('slug')).toHaveTextContent('none');
      // Confirms URL normalized to '/'
      expect(window.location.pathname).toBe('/');
    });

    it('renders error state and return button when unknown product slug is requested', async () => {
      window.history.replaceState(null, '', '/products/unknown-nonexistent-material');

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof Request
              ? input.url
              : String(input);

        if (url === '/api/v1/auth/refresh') {
          return {
            ok: false,
            status: 400,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Refresh token cookie is required',
              },
            }),
          } as Response;
        }

        return {
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Product not found in active catalogue',
            },
          }),
        } as Response;
      });

      render(<App />);

      // Verify that ProductDetailView renders error display gracefully
      expect(await screen.findByText('Product not found in active catalogue')).toBeInTheDocument();
      expect(screen.getByText('← Return to Catalogue')).toBeInTheDocument();
    });
  });
});
