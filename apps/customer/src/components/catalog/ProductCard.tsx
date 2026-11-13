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

import React, { useState } from 'react';
import type { IStorefrontProductCard } from '@thehomez/shared-types';
import { formatPaiseToINR } from '@thehomez/shared-types';
import { AvailabilityBadge } from './AvailabilityBadge.js';
import { useStorefront } from '../../context/StorefrontContext.js';
import { useOptionalAuthContext } from '../auth/AuthUiContext.js';
import { buildCartAddKey, useOptionalCart } from '../../context/CartContext.js';
import { mapCartApiErrorMessage } from '../cart/cart-quantity.utils.js';

export interface ProductCardProps {
  product: IStorefrontProductCard;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product }) => {
  const { navigateToProduct, navigateToCart, pincode, isServiceable } = useStorefront();
  const auth = useOptionalAuthContext();
  const cartCtx = useOptionalCart();

  const [cardAddState, setCardAddState] = useState<{
    status: 'idle' | 'added' | 'error';
    message?: string;
  }>({ status: 'idle' });

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

  const isExplicitlyOutOfStock =
    product.availability.availabilityUnknown === false && product.availability.isAvailable === false;
  const canQuickAddStandalone =
    !product.hasVariants && isServiceable !== false && !isExplicitlyOutOfStock && Boolean(cartCtx);
  const addKey = buildCartAddKey(product.id, null);
  const isAddingThisCard = cartCtx?.isAddingKey === addKey;

  const handleQuickAdd = async () => {
    if (product.hasVariants || !cartCtx || isAddingThisCard) return;

    if (!auth?.isAuthenticated) {
      auth?.clearError();
      auth?.openAuthModal();
      return;
    }

    setCardAddState({ status: 'idle' });
    try {
      await cartCtx.addItem({
        productId: product.id,
        variantId: null,
        quantity: product.unit.minOrderQuantity,
        mode: 'INCREMENT',
        ...(pincode ? { pincode } : {}),
      });
      setCardAddState({ status: 'added', message: 'Added to cart' });
    } catch (err: unknown) {
      setCardAddState({ status: 'error', message: mapCartApiErrorMessage(err) });
    }
  };

  return (
    <article className="thz-product-card">
      <div
        className="thz-card-main-trigger"
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
      </div>

      {/* Standalone Quick Add Action (outside role="button" to preserve ARIA validity) */}
      {canQuickAddStandalone ? (
        <div className="thz-card-actions">
          <button
            type="button"
            className="thz-btn-secondary thz-card-add-btn"
            onClick={() => void handleQuickAdd()}
            disabled={isAddingThisCard}
            aria-busy={isAddingThisCard}
          >
            {isAddingThisCard
              ? 'Adding…'
              : `Add ${product.unit.minOrderQuantity} ${product.unit.unitCode} to Cart`}
          </button>

          {cardAddState.status === 'added' ? (
            <div className="thz-card-feedback success" role="status">
              <span>Added</span>
              <button type="button" className="thz-link-btn" onClick={navigateToCart}>
                View Cart
              </button>
            </div>
          ) : null}

          {cardAddState.status === 'error' && cardAddState.message ? (
            <div className="thz-card-feedback error" role="alert">
              {cardAddState.message}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
};
