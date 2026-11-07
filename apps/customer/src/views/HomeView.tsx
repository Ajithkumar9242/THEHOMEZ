/**
 * TheHomez Marketplace Homepage View (`/`)
 *
 * Implements:
 * - Architectural hero banner with value proposition
 * - Unserviceable area notice banner (Decision #50)
 * - Two-tier category taxonomy ribbon
 * - Featured materials ribbon calling GET /api/v1/storefront/products
 * - Live loading, empty, and error states
 */

import React, { useEffect, useState } from 'react';
import { useStorefront } from '../context/StorefrontContext.js';
import { CategoryRail } from '../components/catalog/CategoryRail.js';
import { ProductCard } from '../components/catalog/ProductCard.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { ErrorDisplay } from '../components/common/ErrorBoundary.js';
import type { IStorefrontProductCard } from '@thehomez/shared-types';

export const HomeView: React.FC = () => {
  const { pincode, isServiceable, apiClient, navigateToPlp, openLocationModal } = useStorefront();

  const [featuredProducts, setFeaturedProducts] = useState<IStorefrontProductCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFeatured = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.listProducts({
        limit: 8,
        sort: 'featured',
        pincode: pincode || undefined,
      });
      setFeaturedProducts(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load featured materials');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeatured();
  }, [pincode, apiClient]);

  return (
    <div className="thz-home-view">
      {/* Unserviceable Warning Notice (Decision #50 / AC-DISCOV-25) */}
      {isServiceable === false && pincode && (
        <div className="thz-notice-banner warning" role="status">
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <strong>Delivery Not Available in Postal Code {pincode}</strong>
            <p style={{ fontSize: '0.875rem', marginTop: '2px' }}>
              We do not deliver to this postal code yet. You are browsing the catalogue in view-only
              mode with baseline pricing.
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

      {/* Hero Section */}
      <section
        style={{
          backgroundColor: 'var(--thz-white)',
          border: '1px solid var(--thz-border-subtle)',
          borderRadius: 'var(--thz-radius-lg)',
          padding: '40px 32px',
          marginBottom: '32px',
          boxShadow: 'var(--thz-shadow-sm)',
        }}
        aria-labelledby="hero-title"
      >
        <span
          style={{
            fontSize: '0.8rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--thz-primary)',
          }}
        >
          Hyperlocal Construction Materials Marketplace
        </span>
        <h1
          id="hero-title"
          style={{
            fontSize: '2.25rem',
            fontWeight: 700,
            color: 'var(--thz-text-primary)',
            lineHeight: 1.2,
            margin: '12px 0 16px 0',
          }}
        >
          Structural Steel, Cement & Aggregates.
          <br />
          <span style={{ color: 'var(--thz-primary)' }}>Direct From Certified Hubs.</span>
        </h1>
        <p
          style={{
            fontSize: '1.05rem',
            color: 'var(--thz-text-secondary)',
            maxWidth: '640px',
            marginBottom: '24px',
          }}
        >
          Verified supply network with transparent volume tiers, certified batch compliance, and
          hyperlocal dispatch across Bengaluru.
        </p>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button type="button" className="thz-btn-primary" onClick={() => navigateToPlp({})}>
            Browse All Materials
          </button>
          <button type="button" className="thz-btn-secondary" onClick={openLocationModal}>
            {pincode ? `Delivery PIN: ${pincode}` : '📍 Enter Delivery PIN'}
          </button>
        </div>
      </section>

      {/* Category Navigation Rail */}
      <CategoryRail />

      {/* Featured Materials Ribbon */}
      <section style={{ margin: '36px 0' }} aria-labelledby="featured-title">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginBottom: '16px',
          }}
        >
          <div>
            <h2 id="featured-title" style={{ fontSize: '1.35rem', fontWeight: 600 }}>
              Featured Building Materials
            </h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--thz-text-muted)', marginTop: '2px' }}>
              Standard trade catalogue items ready for dispatch
            </p>
          </div>
          <button type="button" className="thz-link-btn" onClick={() => navigateToPlp({})}>
            View All ({featuredProducts.length}) →
          </button>
        </div>

        {loading && <LoadingSkeleton count={4} />}

        {error && <ErrorDisplay message={error} onRetry={fetchFeatured} />}

        {!loading && !error && featuredProducts.length === 0 && (
          <div
            style={{
              padding: '32px',
              textAlign: 'center',
              backgroundColor: 'var(--thz-white)',
              borderRadius: '8px',
              border: '1px solid var(--thz-border-subtle)',
            }}
          >
            <p style={{ color: 'var(--thz-text-secondary)' }}>
              No featured materials found in current active catalogue.
            </p>
          </div>
        )}

        {!loading && !error && featuredProducts.length > 0 && (
          <div className="thz-product-grid">
            {featuredProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
