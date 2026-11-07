/**
 * TheHomez Storefront Product Card Component
 *
 * Implements:
 * - Discriminated union rendering (Standalone vs. Multi-Variant)
 * - Price ranges for multi-variant products (Decision #26 / AC-DISCOV-21)
 * - Retail B2C vs. Wholesale B2B display
 * - Localized availability badge
 * - Zero supplier identity leakage (Decision #48 / AC-DISCOV-06)
 * - Accessible touch target >= 44x44px (AC-DISCOV-23)
 */

import React from 'react';
import type { IStorefrontProductCard } from '@thehomez/shared-types';
import { formatPaiseToINR } from '@thehomez/shared-types';
import { AvailabilityBadge } from './AvailabilityBadge.js';
import { useStorefront } from '../../context/StorefrontContext.js';

export interface ProductCardProps {
  product: IStorefrontProductCard;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { navigateToProduct } = useStorefront();

  const handleCardClick = () => {
    navigateToProduct(product.slug);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigateToProduct(product.slug);
    }
  };

  const hasPrimaryImage = product.images && product.images.length > 0;
  const primaryImageUrl = hasPrimaryImage ? product.images[0] : null;

  return (
    <article
      className="thz-product-card"
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${product.title}`}
    >
      {/* Product Image */}
      <div className="thz-card-image-box">
        {primaryImageUrl ? (
          <img
            src={primaryImageUrl}
            alt={product.title}
            className="thz-card-image"
            loading="lazy"
          />
        ) : (
          <div className="thz-card-image-placeholder">
            <span>🏗️</span>
            <span>{product.brand}</span>
          </div>
        )}
      </div>

      {/* Card Content Body */}
      <div className="thz-card-body">
        <div className="thz-card-meta">
          <span className="thz-brand-badge">{product.brand}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--thz-text-muted)' }}>
            {product.category?.name}
          </span>
        </div>

        <h3 className="thz-card-title" title={product.title}>
          {product.title}
        </h3>

        {/* Availability Badge */}
        <AvailabilityBadge availability={product.availability} />

        {/* Pricing & Variant Configuration */}
        <div className="thz-card-pricing">
          {product.hasVariants ? (
            /* Multi-Variant Product Container: Dynamic Price Range */
            <div>
              <div className="thz-price-current">
                {formatPaiseToINR(product.priceRange.minPricePaise)} –{' '}
                {formatPaiseToINR(product.priceRange.maxPricePaise)}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '4px',
                }}
              >
                <span
                  className="thz-card-unit"
                  style={{ fontWeight: 600, color: 'var(--thz-primary)' }}
                >
                  {product.variantCount} Options Available
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--thz-text-muted)' }}>
                  View Options →
                </span>
              </div>
            </div>
          ) : (
            /* Standalone Product: Single Authoritative Price */
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="thz-price-current">
                  {formatPaiseToINR(product.pricing.pricePaise)}
                </span>
                {product.pricing.mrpPaise &&
                  product.pricing.mrpPaise > product.pricing.pricePaise && (
                    <>
                      <span className="thz-price-mrp">
                        {formatPaiseToINR(product.pricing.mrpPaise)}
                      </span>
                      {product.pricing.discountPercentage !== undefined && (
                        <span className="thz-discount-badge">
                          {product.pricing.discountPercentage}% OFF
                        </span>
                      )}
                    </>
                  )}
              </div>
              <div className="thz-card-unit">per {product.unit.unitCode}</div>
              {product.pricing.customerSegment === 'B2B' && product.pricing.hasVolumeTiers && (
                <div
                  style={{
                    fontSize: '0.75rem',
                    color: '#1e3a8a',
                    fontWeight: 600,
                    marginTop: '2px',
                  }}
                >
                  ⚡ Volume Discounts Available
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
};
