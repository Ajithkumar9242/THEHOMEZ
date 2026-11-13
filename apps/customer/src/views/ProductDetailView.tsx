/**
 * TheHomez Product Details Page (PDP) View
 *
 * Implements:
 * - Direct execution against GET /api/v1/storefront/products/:slug
 * - Neutral Initial Variant Selector (AC-DISCOV-19 / Decision #53)
 * - Real-Time B2B Volume Tier Highlighting (AC-DISCOV-22 / Decision #36)
 * - Construction Unit Measurement Stepper (AC-DISCOV-11, AC-DISCOV-12, AC-DISCOV-13)
 * - Unserviceable View-Only Guard (AC-DISCOV-25 / Decision #50)
 * - Zero Supplier Identity Leakage (AC-DISCOV-06 / Decision #48)
 * - Strict Milestone 4 Boundary Preservation (Zero premature Cart / Checkout)
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useStorefront } from '../context/StorefrontContext.js';
import { useOptionalAuthContext } from '../components/auth/AuthUiContext.js';
import { buildCartAddKey, useOptionalCart } from '../context/CartContext.js';
import {
  mapCartApiErrorMessage,
  validateCartQuantity,
} from '../components/cart/cart-quantity.utils.js';
import { VariantSelector } from '../components/product-detail/VariantSelector.js';
import { QuantityStepper } from '../components/product-detail/QuantityStepper.js';
import { VolumeTierTable } from '../components/product-detail/VolumeTierTable.js';
import { AvailabilityBadge } from '../components/catalog/AvailabilityBadge.js';
import { ErrorDisplay } from '../components/common/ErrorBoundary.js';
import { formatPaiseToINR } from '@thehomez/shared-types';
import type {
  IStorefrontProductDetailResponse,
  IStorefrontVariantDetail,
  IStorefrontUnitSummary,
  IStorefrontStandalonePricingDto,
  IStorefrontAvailabilityDto,
} from '@thehomez/shared-types';

export const ProductDetailView: React.FC = () => {
  const {
    selectedProductSlug,
    pincode,
    isServiceable,
    apiClient,
    navigateToPlp,
    navigateToCart,
    openLocationModal,
  } = useStorefront();
  const auth = useOptionalAuthContext();
  const cartCtx = useOptionalCart();

  const [detail, setDetail] = useState<IStorefrontProductDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Neutral Initial State (Decision #53 / AC-DISCOV-19): null variant preselected!
  const [selectedVariant, setSelectedVariant] = useState<IStorefrontVariantDetail | null>(null);
  const [quantity, setQuantity] = useState<string>('1');
  const [cartFeedback, setCartFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  useEffect(() => {
    setCartFeedback(null);
  }, [selectedProductSlug, selectedVariant, quantity]);

  useEffect(() => {
    let isMounted = true;
    if (!selectedProductSlug) return;

    const fetchDetail = async () => {
      try {
        setLoading(true);
        setError(null);
        setSelectedVariant(null); // Reset to neutral state whenever slug changes

        const response = await apiClient.getProductBySlug(
          selectedProductSlug,
          pincode || undefined,
        );

        if (isMounted) {
          setDetail(response);
          // If standalone product, initialize quantity with MOQ
          if (!response.product.hasVariants && response.product.unit) {
            setQuantity(response.product.unit.minOrderQuantity);
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(
            err instanceof Error ? err.message : 'Product not found or discontinued from catalogue',
          );
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchDetail();
    return () => {
      isMounted = false;
    };
  }, [selectedProductSlug, pincode, apiClient]);

  // Handle variant selection
  const handleVariantSelect = (variant: IStorefrontVariantDetail) => {
    setSelectedVariant(variant);
    if (variant.unit) {
      setQuantity(variant.unit.minOrderQuantity);
    }
  };

  // Resolve active unit, pricing, and availability
  const activeUnit: IStorefrontUnitSummary | undefined = useMemo(() => {
    if (!detail) return undefined;
    if (detail.product.hasVariants) {
      return selectedVariant?.unit;
    }
    return detail.product.unit;
  }, [detail, selectedVariant]);

  const activePricing: IStorefrontStandalonePricingDto | undefined = useMemo(() => {
    if (!detail) return undefined;
    if (detail.product.hasVariants) {
      return selectedVariant?.pricing;
    }
    return detail.product.pricing;
  }, [detail, selectedVariant]);

  const activeAvailability: IStorefrontAvailabilityDto | undefined = useMemo(() => {
    if (!detail) return undefined;
    if (detail.product.hasVariants) {
      return selectedVariant?.availability;
    }
    return detail.product.availability;
  }, [detail, selectedVariant]);

  if (loading) {
    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '24px 0' }}>
        <div className="thz-skeleton-card" style={{ height: '400px' }} />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div style={{ maxWidth: '800px', margin: '32px auto' }}>
        <ErrorDisplay
          message={error || 'Product not found in active catalogue'}
          onRetry={() => window.location.reload()}
        />
        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <button type="button" className="thz-btn-primary" onClick={() => navigateToPlp({})}>
            ← Return to Catalogue
          </button>
        </div>
      </div>
    );
  }

  const { product, variants } = detail;
  const isMultiVariant = product.hasVariants;
  const isUnserviceable = isServiceable === false;

  const isVariantPending = isMultiVariant && !selectedVariant;
  const isOutOfStock = Boolean(
    activeAvailability &&
      activeAvailability.availabilityUnknown === false &&
      activeAvailability.isAvailable === false,
  );
  const qtyValidation = activeUnit
    ? validateCartQuantity(quantity, activeUnit)
    : { isValid: false as const, message: undefined };
  const addKey = buildCartAddKey(product.id, selectedVariant?.id ?? null);
  const isAddingThisItem = cartCtx?.isAddingKey === addKey;

  const handleAddToCart = async () => {
    if (isVariantPending || isOutOfStock || isUnserviceable || !activeUnit || isAddingThisItem) {
      return;
    }

    if (!qtyValidation.isValid) {
      setCartFeedback({
        type: 'error',
        message: qtyValidation.message || 'Please enter a valid quantity.',
      });
      return;
    }

    if (!auth?.isAuthenticated) {
      setCartFeedback({
        type: 'info',
        message: 'Sign in with OTP to add materials to your cart.',
      });
      auth?.clearError();
      auth?.openAuthModal();
      return;
    }

    if (!cartCtx) return;

    setCartFeedback(null);
    try {
      await cartCtx.addItem({
        productId: product.id,
        variantId: selectedVariant ? selectedVariant.id : null,
        quantity: quantity.trim(),
        mode: 'INCREMENT',
        ...(pincode ? { pincode } : {}),
      });
      setCartFeedback({
        type: 'success',
        message: `${product.title}${selectedVariant ? ` (${selectedVariant.title})` : ''} added to your cart.`,
      });
    } catch (err: unknown) {
      setCartFeedback({
        type: 'error',
        message: mapCartApiErrorMessage(err),
      });
    }
  };

  return (
    <div className="thz-pdp-view">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="thz-breadcrumb-nav">
        <button type="button" onClick={() => navigateToPlp({})} className="thz-breadcrumb-btn">
          Catalogue
        </button>
        <span className="thz-breadcrumb-separator">/</span>
        <button
          type="button"
          onClick={() => navigateToPlp({ category: product.category.slug })}
          className="thz-breadcrumb-btn"
        >
          {product.category.name}
        </button>
        <span className="thz-breadcrumb-separator">/</span>
        <span className="thz-breadcrumb-current">{product.title}</span>
      </nav>

      {/* Unserviceable Area Warning (Decision #50 / AC-DISCOV-25) */}
      {isUnserviceable && pincode && (
        <div className="thz-notice-banner warning" role="status">
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <strong>Delivery Not Available in Postal Code {pincode}</strong>
            <p style={{ fontSize: '0.875rem', marginTop: '2px' }}>
              We do not deliver to this postal code yet. You are browsing the catalogue in view-only
              mode. Local stock is unserviceable and ordering is disabled.
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

      {/* PDP Main Layout */}
      <div className="thz-pdp-layout">
        {/* Left Column: Gallery & Placeholders */}
        <div className="thz-pdp-gallery">
          <div className="thz-pdp-main-image">
            {product.images && product.images.length > 0 ? (
              <img
                src={product.images[0]}
                alt={product.title}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--thz-text-secondary)' }}>
                <span style={{ fontSize: '3rem' }}>🏗️</span>
                <p style={{ fontWeight: 600, marginTop: '8px' }}>{product.brand}</p>
                <p style={{ fontSize: '0.8rem' }}>Structural Grade Material</p>
              </div>
            )}
          </div>

          {/* Technical Specifications Table */}
          {product.specifications && Object.keys(product.specifications).length > 0 && (
            <div style={{ marginTop: '24px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '8px' }}>
                Technical Specifications
              </h3>
              <table className="thz-specs-table">
                <tbody>
                  {Object.entries(product.specifications).map(([key, val]) => (
                    <tr key={key}>
                      <th scope="row">{key}</th>
                      <td>{val}</td>
                    </tr>
                  ))}
                  {product.sku && (
                    <tr>
                      <th scope="row">Base SKU</th>
                      <td>{product.sku}</td>
                    </tr>
                  )}
                  {selectedVariant?.sku && (
                    <tr>
                      <th scope="row">Variant SKU</th>
                      <td>{selectedVariant.sku}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Column: Title, Availability, Pricing, Stepper */}
        <div className="thz-pdp-info">
          <div>
            <span className="thz-brand-badge">{product.brand}</span>
            <h1 className="thz-pdp-title">{product.title}</h1>
            {product.description && (
              <p
                style={{
                  fontSize: '0.95rem',
                  color: 'var(--thz-text-secondary)',
                  marginTop: '8px',
                }}
              >
                {product.description}
              </p>
            )}
          </div>

          {/* Active Availability Badge */}
          {activeAvailability ? (
            <div>
              <AvailabilityBadge availability={activeAvailability} />
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem', color: 'var(--thz-text-muted)' }}>
              Select a specification option below to inspect localized availability.
            </div>
          )}

          {/* Neutral Variant Selector for Multi-Variant Containers (AC-DISCOV-19) */}
          {isMultiVariant && (
            <VariantSelector
              variants={variants}
              selectedVariant={selectedVariant}
              onSelectVariant={handleVariantSelect}
            />
          )}

          {/* Active Pricing Display */}
          {activePricing ? (
            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--thz-white)',
                border: '1px solid var(--thz-border-subtle)',
                borderRadius: '8px',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}
              >
                <span className="thz-price-current" style={{ fontSize: '1.75rem' }}>
                  {formatPaiseToINR(activePricing.pricePaise)}
                </span>
                {activePricing.mrpPaise && activePricing.mrpPaise > activePricing.pricePaise && (
                  <>
                    <span className="thz-price-mrp" style={{ fontSize: '1rem' }}>
                      {formatPaiseToINR(activePricing.mrpPaise)}
                    </span>
                    {activePricing.discountPercentage !== undefined && (
                      <span className="thz-discount-badge">
                        {activePricing.discountPercentage}% OFF
                      </span>
                    )}
                  </>
                )}
                {activeUnit && (
                  <span style={{ fontSize: '0.95rem', color: 'var(--thz-text-muted)' }}>
                    per {activeUnit.unitCode}
                  </span>
                )}
              </div>

              {activePricing.customerSegment === 'B2B' && (
                <div
                  style={{
                    marginTop: '6px',
                    fontSize: '0.8rem',
                    color: '#1e3a8a',
                    fontWeight: 600,
                  }}
                >
                  🏢 Verified B2B Trade Rate (Excl. GST)
                  {activePricing.retailBenchmarkPaise && (
                    <span
                      style={{ color: 'var(--thz-text-muted)', fontWeight: 400, marginLeft: '6px' }}
                    >
                      (Retail Benchmark: {formatPaiseToINR(activePricing.retailBenchmarkPaise)})
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            isMultiVariant && (
              <div
                style={{
                  padding: '16px',
                  backgroundColor: 'var(--thz-bg-well)',
                  borderRadius: '8px',
                  color: 'var(--thz-text-secondary)',
                  fontSize: '0.9rem',
                }}
              >
                Pricing details will appear once an option is selected above.
              </div>
            )
          )}

          {/* Construction Quantity Controls */}
          {activeUnit && (
            <div style={{ margin: '12px 0' }}>
              <QuantityStepper
                unit={activeUnit}
                quantity={quantity}
                onChange={setQuantity}
                disabled={isUnserviceable || isOutOfStock || isAddingThisItem}
                errorMessage={qtyValidation.isValid ? null : (qtyValidation.message ?? null)}
              />
            </div>
          )}

          {/* B2B Volume Discount Table with Dynamic Highlighting (AC-DISCOV-22) */}
          {activePricing?.b2bTiers && activePricing.b2bTiers.length > 0 && activeUnit && (
            <VolumeTierTable
              tiers={activePricing.b2bTiers}
              basePricePaise={activePricing.pricePaise}
              currentQuantity={quantity}
              unitCode={activeUnit.unitCode}
            />
          )}

          {/* Customer Cart Action (Milestone 5B.2) */}
          <div style={{ marginTop: '20px' }}>
            <button
              type="button"
              className="thz-btn-primary"
              style={{ width: '100%', height: '48px', fontSize: '1.05rem' }}
              disabled={
                isVariantPending ||
                isOutOfStock ||
                isUnserviceable ||
                !qtyValidation.isValid ||
                isAddingThisItem
              }
              aria-busy={isAddingThisItem}
              onClick={() => void handleAddToCart()}
              aria-label={
                isVariantPending
                  ? 'Select an option to add to cart'
                  : isOutOfStock
                    ? 'Material currently out of stock in your area'
                    : isUnserviceable
                      ? 'Ordering unavailable in this unserviceable postal code'
                      : isAddingThisItem
                        ? 'Adding material to cart'
                        : `Add ${product.title} to Cart`
              }
            >
              {isVariantPending
                ? 'Select an Option Above'
                : isOutOfStock
                  ? 'Out of Stock in Local Hub'
                  : isUnserviceable
                    ? 'Delivery Unavailable in Area'
                    : isAddingThisItem
                      ? 'Adding to Cart…'
                      : 'Add to Cart'}
            </button>

            {cartFeedback ? (
              <div
                className={`thz-pdp-cart-feedback ${cartFeedback.type}`}
                role={cartFeedback.type === 'error' ? 'alert' : 'status'}
              >
                <span>{cartFeedback.message}</span>
                {cartFeedback.type === 'success' ? (
                  <button
                    type="button"
                    className="thz-btn-secondary thz-btn-compact"
                    onClick={navigateToCart}
                  >
                    View Cart
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
