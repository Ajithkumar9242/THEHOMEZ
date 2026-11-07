/**
 * TheHomez Product Listing Page (PLP) & Search Results View
 *
 * Implements:
 * - Direct execution against GET /api/v1/storefront/products or /storefront/search
 * - Canonical sorting (AC-DISCOV-17)
 * - Strict pagination limits (1 to 50 items per AC-DISCOV-18)
 * - Brand, price range, and in-stock filtering
 * - Loading skeletons, empty results, and error recovery
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useStorefront } from '../context/StorefrontContext.js';
import { ProductCard } from '../components/catalog/ProductCard.js';
import { FilterSidebar } from '../components/catalog/FilterSidebar.js';
import { SortSelector } from '../components/catalog/SortSelector.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { EmptyState } from '../components/common/EmptyState.js';
import { ErrorDisplay } from '../components/common/ErrorBoundary.js';
import type {
  IStorefrontProductCard,
  IStorefrontPagination,
  StorefrontSortOption,
  IStorefrontProductQuery,
} from '@thehomez/shared-types';

export const ProductListingView: React.FC = () => {
  const {
    pincode,
    isServiceable,
    apiClient,
    plpFilters,
    searchQueryText,
    navigateToHome,
    openLocationModal,
  } = useStorefront();

  const [products, setProducts] = useState<IStorefrontProductCard[]>([]);
  const [pagination, setPagination] = useState<IStorefrontPagination>({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableBrands, setAvailableBrands] = useState<string[]>([]);

  // Active query state
  const [queryState, setQueryState] = useState<IStorefrontProductQuery>({
    ...plpFilters,
    pincode: pincode || undefined,
    limit: 20,
    page: 1,
  });

  // Sync external filters from context
  useEffect(() => {
    setQueryState((prev) => ({
      ...prev,
      ...plpFilters,
      pincode: pincode || undefined,
    }));
  }, [plpFilters, pincode]);

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let response;
      if (searchQueryText.trim().length >= 2) {
        response = await apiClient.searchProducts({
          q: searchQueryText.trim(),
          ...queryState,
          pincode: pincode || undefined,
        });
      } else {
        response = await apiClient.listProducts({
          ...queryState,
          pincode: pincode || undefined,
        });
      }

      setProducts(response.items);
      setPagination(response.pagination);

      // Extract brands from facets if present or collect distinct from items
      if (response.facets?.brands && response.facets.brands.length > 0) {
        setAvailableBrands(response.facets.brands.map((b) => b.brand));
      } else if (response.items.length > 0) {
        const brands = Array.from(new Set(response.items.map((i) => i.brand))).filter(Boolean);
        if (brands.length > 0) setAvailableBrands(brands);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve materials catalogue');
    } finally {
      setLoading(false);
    }
  }, [apiClient, searchQueryText, queryState, pincode]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  const handleSortChange = (newSort: StorefrontSortOption) => {
    setQueryState((prev) => ({ ...prev, sort: newSort, page: 1 }));
  };

  const handleFilterChange = (newFilters: IStorefrontProductQuery) => {
    setQueryState(newFilters);
  };

  const handlePageChange = (newPage: number) => {
    setQueryState((prev) => ({ ...prev, page: newPage }));
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const isSearchMode = searchQueryText.trim().length >= 2;

  // Synchronize active PLP filter/sort/page state with browser URL using replaceState
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    if (isSearchMode) {
      const params = new URLSearchParams();
      params.set('q', searchQueryText.trim());
      if (queryState.page && queryState.page > 1) params.set('page', String(queryState.page));
      if (queryState.sort && queryState.sort !== 'featured') params.set('sort', queryState.sort);
      window.history.replaceState(null, '', `/search?${params.toString()}`);
    } else {
      const params = new URLSearchParams();
      if (queryState.category) params.set('category', queryState.category);
      if (queryState.brand) params.set('brand', queryState.brand);
      if (queryState.sort && queryState.sort !== 'featured') params.set('sort', queryState.sort);
      if (queryState.page && queryState.page > 1) params.set('page', String(queryState.page));
      const qs = params.toString();
      window.history.replaceState(null, '', qs ? `/products?${qs}` : '/products');
    }
  }, [queryState, isSearchMode, searchQueryText]);

  const pageTitle = isSearchMode
    ? `Search Results for "${searchQueryText}"`
    : queryState.category
      ? `Materials: ${queryState.category}`
      : 'All Construction Materials';

  return (
    <div className="thz-plp-view">
      {/* Unserviceable Warning Notice (Decision #50 / AC-DISCOV-25) */}
      {isServiceable === false && pincode && (
        <div className="thz-notice-banner warning" role="status">
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <strong>Delivery Not Available in Postal Code {pincode}</strong>
            <p style={{ fontSize: '0.875rem', marginTop: '2px' }}>
              We do not deliver to this postal code yet. You are browsing the catalogue in view-only
              mode. Local inventory and ordering actions are locked.
            </p>
          </div>
          <button
            type="button"
            className="thz-btn-secondary"
            onClick={openLocationModal}
            style={{ fontSize: '0.825rem' }}
          >
            Change PIN
          </button>
        </div>
      )}

      {/* Header & Breadcrumb Bar */}
      <div style={{ marginBottom: '24px' }}>
        <nav aria-label="Breadcrumb" className="thz-breadcrumb-nav">
          <button type="button" onClick={navigateToHome} className="thz-breadcrumb-btn">
            Home
          </button>
          <span className="thz-breadcrumb-separator">/</span>
          <span className="thz-breadcrumb-current">{isSearchMode ? 'Search' : 'Catalogue'}</span>
          {queryState.category && (
            <>
              <span className="thz-breadcrumb-separator">/</span>
              <span className="thz-breadcrumb-current">{queryState.category}</span>
            </>
          )}
        </nav>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--thz-text-primary)' }}>
              {pageTitle}
            </h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--thz-text-muted)', marginTop: '2px' }}>
              Showing {pagination.total} active verified items
            </p>
          </div>

          <SortSelector
            value={(queryState.sort as StorefrontSortOption) || 'featured'}
            onChange={handleSortChange}
          />
        </div>
      </div>

      {/* Responsive PLP Layout Stylesheet */}
      <style>{`
        .thz-plp-layout {
          display: grid;
          grid-template-columns: minmax(240px, 280px) 1fr;
          gap: 24px;
          align-items: start;
        }
        @media (max-width: 768px) {
          .thz-plp-layout {
            grid-template-columns: 1fr;
            gap: 16px;
          }
        }
      `}</style>

      {/* Grid Layout: Sidebar + Product Grid */}
      <div className="thz-plp-layout">
        {/* Filter Sidebar */}
        <FilterSidebar
          filters={queryState}
          onFilterChange={handleFilterChange}
          availableBrands={availableBrands}
        />

        {/* Content Area */}
        <section aria-labelledby="product-results-title">
          <h2 id="product-results-title" className="sr-only" style={{ display: 'none' }}>
            Products List
          </h2>

          {loading && <LoadingSkeleton count={6} />}

          {error && <ErrorDisplay message={error} onRetry={loadProducts} />}

          {!loading && !error && products.length === 0 && (
            <EmptyState
              title={isSearchMode ? 'No matching materials found' : 'No materials in this category'}
              message={
                isSearchMode
                  ? `Zero products matched "${searchQueryText}". Try adjusting your keywords or clearing filters.`
                  : 'There are currently no active products matching the selected filters.'
              }
            />
          )}

          {!loading && !error && products.length > 0 && (
            <>
              <div className="thz-product-grid">
                {products.map((item) => (
                  <ProductCard key={item.id} product={item} />
                ))}
              </div>

              {/* Pagination Controls (Strictly Bounded 1 to 50) */}
              {pagination.totalPages > 1 && (
                <nav className="thz-pagination" aria-label="Catalogue pagination">
                  <button
                    type="button"
                    className="thz-page-btn"
                    disabled={!pagination.hasPrevPage}
                    onClick={() => handlePageChange(pagination.page - 1)}
                    aria-label="Go to previous page"
                  >
                    ← Previous
                  </button>

                  <span className="thz-page-info">
                    Page {pagination.page} of {pagination.totalPages}
                  </span>

                  <button
                    type="button"
                    className="thz-page-btn"
                    disabled={!pagination.hasNextPage}
                    onClick={() => handlePageChange(pagination.page + 1)}
                    aria-label="Go to next page"
                  >
                    Next →
                  </button>
                </nav>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};
