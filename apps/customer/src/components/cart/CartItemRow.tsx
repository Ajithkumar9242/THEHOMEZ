/**
 * Customer Cart Line Item Row
 *
 * Displays hydrated server-authoritative item details:
 * - Product title, brand, image, SKU, selected variant & unit metadata
 * - Applied pricing tier & net GST-exclusive unit price / line subtotal
 * - Exact decimal quantity editor powered by `ExactDecimalQuantity` (BigInt arithmetic)
 * - Backend `itemStatus` diagnostics (unavailable, unlocalized, unserviceable, out-of-stock, unit drift)
 * - Accessible item removal & duplicate-submission protection
 */

import React, { useEffect, useState } from 'react';
import {
  formatPaiseToINR,
  type CartItemStatus,
  type ICartItemDto,
  type ICartValidationIssueDto,
} from '@thehomez/shared-types';
import {
  buildConstraintsFromCartItem,
  getPriceDriftComparison,
  isAtOrAboveMaximumQuantity,
  isAtOrBelowMinimumQuantity,
  stepExactQuantity,
  tryFormatCanonicalQuantity,
  validateCartQuantity,
} from './cart-quantity.utils.js';

export interface CartItemRowProps {
  item: ICartItemDto;
  isPending: boolean;
  isCartBusy: boolean;
  isAcknowledging?: boolean;
  canAcknowledgePrice?: boolean;
  validationIssues?: ICartValidationIssueDto[];
  onUpdateQuantity: (itemId: string, quantity: string) => Promise<void>;
  onRemoveItem: (itemId: string) => Promise<void>;
  onAcknowledgePrice?: (itemId: string) => Promise<void>;
  onNavigateToProduct: (slug: string) => void;
  onChangeLocation: () => void;
}

function getItemStatusLabel(status: CartItemStatus): {
  title: string;
  tone: 'error' | 'warning' | 'info';
} {
  switch (status) {
    case 'PRODUCT_UNAVAILABLE':
      return { title: 'Product Unavailable', tone: 'error' };
    case 'VARIANT_UNAVAILABLE':
      return { title: 'Selected Variant Unavailable', tone: 'error' };
    case 'OUT_OF_STOCK_IN_AREA':
      return { title: 'Out of Stock in Delivery Area', tone: 'warning' };
    case 'UNSERVICEABLE_AREA':
      return { title: 'Unavailable in Selected Delivery PIN', tone: 'warning' };
    case 'UNIT_CONSTRAINTS_CHANGED':
      return { title: 'Quantity Constraints Updated', tone: 'warning' };
    case 'NOT_PRICED':
      return { title: 'Pricing Unavailable', tone: 'warning' };
    case 'UNLOCALIZED':
      return { title: 'Delivery PIN Required for Availability', tone: 'info' };
    default:
      return { title: 'Available', tone: 'info' };
  }
}

export const CartItemRow: React.FC<CartItemRowProps> = ({
  item,
  isPending,
  isCartBusy,
  isAcknowledging = false,
  canAcknowledgePrice = true,
  validationIssues,
  onUpdateQuantity,
  onRemoveItem,
  onAcknowledgePrice,
  onNavigateToProduct,
  onChangeLocation,
}) => {
  const constraints = buildConstraintsFromCartItem(item);
  const [draftQuantity, setDraftQuantity] = useState<string>(item.quantity);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Sync draft quantity whenever server commits an authoritative quantity change
  useEffect(() => {
    setDraftQuantity(item.quantity);
    setValidationError(null);
  }, [item.quantity]);

  const isCatalogDeleted =
    item.itemStatus === 'PRODUCT_UNAVAILABLE' || item.itemStatus === 'VARIANT_UNAVAILABLE';
  const isRowDisabled = isPending || isCartBusy || isAcknowledging;
  const isQuantityDisabled = isRowDisabled || isCatalogDeleted;

  const trimmedDraft = draftQuantity.trim();
  const validation = validateCartQuantity(trimmedDraft, constraints);
  const normalizedDraft = tryFormatCanonicalQuantity(trimmedDraft, item.quantityPrecision);
  const normalizedServer = tryFormatCanonicalQuantity(item.quantity, item.quantityPrecision);
  const isQuantityChanged =
    normalizedDraft !== null && normalizedServer !== null
      ? normalizedDraft !== normalizedServer
      : trimmedDraft !== item.quantity;

  const isMinReached = isAtOrBelowMinimumQuantity(item.quantity, constraints);
  const isMaxReached = isAtOrAboveMaximumQuantity(item.quantity, constraints);

  const handleDraftChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setDraftQuantity(next);
    const check = validateCartQuantity(next, constraints);
    setValidationError(check.isValid ? null : check.message || 'Invalid quantity');
  };

  const handleStep = async (direction: 1 | -1) => {
    if (isQuantityDisabled) return;
    const base = validation.isValid ? trimmedDraft : item.quantity;
    const nextQty = stepExactQuantity(base, constraints, direction);
    const check = validateCartQuantity(nextQty, constraints);
    if (!check.isValid) {
      setValidationError(check.message || 'Invalid quantity');
      return;
    }
    setDraftQuantity(nextQty);
    setValidationError(null);
    try {
      await onUpdateQuantity(item.itemId, nextQty);
    } catch {
      // Revert draft if rejected so input matches server-authoritative quantity
      setDraftQuantity(item.quantity);
    }
  };

  const handleQuantitySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isQuantityDisabled) return;

    const check = validateCartQuantity(trimmedDraft, constraints);
    if (!check.isValid) {
      setValidationError(check.message || 'Invalid quantity');
      return;
    }

    const submitValue =
      tryFormatCanonicalQuantity(trimmedDraft, item.quantityPrecision) ?? trimmedDraft;
    setValidationError(null);

    try {
      await onUpdateQuantity(item.itemId, submitValue);
    } catch {
      // Parent CartContext exposes server error banner
    }
  };

  const handleRemoveClick = async () => {
    if (isRowDisabled) return;
    try {
      await onRemoveItem(item.itemId);
    } catch {
      // Parent CartView / CartContext displays API error state
    }
  };

  const variantAttrs = Object.entries(item.variantAttributes ?? {});
  const statusInfo = item.itemStatus !== 'VALID' ? getItemStatusLabel(item.itemStatus) : null;
  const qtyInputId = `thz-cart-qty-${item.itemId}`;
  const qtyErrorId = `thz-cart-qty-err-${item.itemId}`;

  return (
    <article
      className={`thz-cart-item-card${item.itemStatus !== 'VALID' ? ' has-issue' : ''}`}
      aria-busy={isPending}
    >
      <div className="thz-cart-item-main">
        {/* Product Thumbnail */}
        <div className="thz-cart-item-media">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.title}
              className="thz-cart-item-img"
              loading="lazy"
            />
          ) : (
            <div className="thz-cart-item-placeholder" aria-hidden="true">
              <span>🏗️</span>
              <span>{item.brand}</span>
            </div>
          )}
        </div>

        {/* Item Identity & Metadata */}
        <div className="thz-cart-item-info">
          <div className="thz-cart-item-meta-top">
            <span className="thz-brand-badge">{item.brand}</span>
            <span className="thz-cart-sku">SKU: {item.sku}</span>
            {item.tierMinQuantity &&
            item.pricingTierApplied !== 'STANDARD_B2C' &&
            item.pricingTierApplied !== 'BASE_B2B' ? (
              <span className="thz-cart-tier-badge">
                Volume Tier ({item.tierMinQuantity}+ {item.unitCode})
              </span>
            ) : null}
          </div>

          <h3 className="thz-cart-item-title">
            <button
              type="button"
              className="thz-cart-title-link"
              onClick={() => onNavigateToProduct(item.slug)}
            >
              {item.title}
            </button>
          </h3>

          {item.variantTitle ? (
            <div className="thz-cart-variant-line">Option: {item.variantTitle}</div>
          ) : null}

          {variantAttrs.length > 0 ? (
            <div className="thz-cart-attr-list">
              {variantAttrs.map(([attrKey, attrVal]) => (
                <span key={attrKey} className="thz-cart-attr-chip">
                  {attrKey}: {attrVal}
                </span>
              ))}
            </div>
          ) : null}

          {/* Lead Time & Constraints */}
          <div className="thz-cart-constraints-line">
            <span>
              Min: {item.minOrderQuantity} {item.unitCode} • Step: {item.stepIncrement}{' '}
              {item.unitCode}
              {item.maxOrderQuantity ? ` • Max: ${item.maxOrderQuantity} ${item.unitCode}` : ''}
            </span>
            {item.isAvailable === true && item.minLeadTimeHours !== null ? (
              <span className="thz-cart-leadtime">Dispatch in ~{item.minLeadTimeHours}h</span>
            ) : null}
          </div>
        </div>

        {/* Line Pricing */}
        <div className="thz-cart-item-pricing">
          {item.unitPricePaise !== null && item.lineSubtotalPaise !== null ? (
            <>
              <div className="thz-cart-line-subtotal">
                {formatPaiseToINR(item.lineSubtotalPaise)}
              </div>
              <div className="thz-cart-unit-price">
                {formatPaiseToINR(item.unitPricePaise)} / {item.unitCode}
              </div>
              {item.savingsPaise && item.savingsPaise > 0 ? (
                <div className="thz-cart-savings">
                  You save {formatPaiseToINR(item.savingsPaise)} vs MRP
                </div>
              ) : null}
              {item.isServiceAreaOverride ? (
                <div className="thz-cart-area-rate">Local delivery area rate</div>
              ) : null}
            </>
          ) : (
            <div className="thz-cart-price-unavailable">Price unavailable</div>
          )}
        </div>
      </div>

      {/* Item Status Issue Banner */}
      {statusInfo ? (
        <div className={`thz-cart-status-banner tone-${statusInfo.tone}`} role="status">
          <div className="thz-cart-status-copy">
            <strong>{statusInfo.title}:</strong>{' '}
            <span>{item.statusMessage || 'Action needed before checkout.'}</span>
          </div>
          <div className="thz-cart-status-actions">
            {item.itemStatus === 'UNLOCALIZED' ||
            item.itemStatus === 'UNSERVICEABLE_AREA' ||
            item.itemStatus === 'OUT_OF_STOCK_IN_AREA' ? (
              <button
                type="button"
                className="thz-btn-secondary thz-btn-compact"
                onClick={onChangeLocation}
              >
                {item.itemStatus === 'UNLOCALIZED' ? 'Select Delivery PIN' : 'Change PIN'}
              </button>
            ) : null}
            {isCatalogDeleted ? (
              <button
                type="button"
                className="thz-btn-secondary thz-btn-compact"
                onClick={() => onNavigateToProduct(item.slug)}
              >
                View Product
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Item-Level Validation Diagnostics from Latest Cart Validation */}
      {validationIssues && validationIssues.length > 0 ? (
        <div className="thz-cart-status-banner tone-error" role="alert">
          <div className="thz-cart-status-copy">
            <strong>Validation issue:</strong>{' '}
            <span>{validationIssues.map((issue) => issue.message).join(' ')}</span>
          </div>
        </div>
      ) : null}

      {/* Price Drift Notice & Explicit Per-Item Acknowledgement (Milestone 5B.3) */}
      {item.priceDrift && item.priceDrift.hasChanged ? (
        (() => {
          const comparison = getPriceDriftComparison(
            item.priceDrift.acknowledgedUnitPricePaise,
            item.priceDrift.currentUnitPricePaise,
          );
          const directionLabel =
            comparison.direction === 'INCREASED'
              ? `Price increased (+${formatPaiseToINR(comparison.deltaPaise)})`
              : comparison.direction === 'DECREASED'
                ? `Price decreased (-${formatPaiseToINR(comparison.deltaPaise)})`
                : null;
          return (
            <div className="thz-cart-status-banner tone-warning" role="status">
              <div className="thz-cart-status-copy">
                <strong>Unit price updated:</strong>{' '}
                {directionLabel ? (
                  <span
                    className={`thz-price-drift-pill ${
                      comparison.direction === 'INCREASED' ? 'tone-increase' : 'tone-decrease'
                    }`}
                  >
                    {directionLabel}
                  </span>
                ) : null}{' '}
                <span>
                  {item.priceDrift.acknowledgedUnitPricePaise !== null
                    ? `Changed from ${formatPaiseToINR(item.priceDrift.acknowledgedUnitPricePaise)} to `
                    : 'Updated to '}
                  {formatPaiseToINR(item.priceDrift.currentUnitPricePaise)} per {item.unitCode}.
                </span>
              </div>
              {onAcknowledgePrice ? (
                <div className="thz-cart-status-actions">
                  <button
                    type="button"
                    className="thz-btn-secondary thz-btn-compact"
                    disabled={isRowDisabled || !canAcknowledgePrice}
                    onClick={() => void onAcknowledgePrice(item.itemId)}
                  >
                    {isAcknowledging ? 'Accepting…' : 'Accept Updated Price'}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })()
      ) : null}

      {/* Quantity Controls & Remove Action */}
      <div className="thz-cart-item-footer">
        <form className="thz-cart-qty-form" onSubmit={handleQuantitySubmit} noValidate>
          <label htmlFor={qtyInputId} className="thz-cart-qty-label">
            Qty ({item.unitCode}):
          </label>
          <div className="thz-stepper-box">
            <button
              type="button"
              className="thz-stepper-btn"
              onClick={() => void handleStep(-1)}
              disabled={isQuantityDisabled || isMinReached}
              aria-label={`Decrease quantity for ${item.title} by ${item.stepIncrement} ${item.unitCode}`}
            >
              −
            </button>
            <input
              id={qtyInputId}
              type="text"
              inputMode={item.quantityPrecision === 0 ? 'numeric' : 'decimal'}
              className={`thz-stepper-input${validationError ? ' error' : ''}`}
              value={draftQuantity}
              onChange={handleDraftChange}
              disabled={isQuantityDisabled}
              aria-label={`Quantity for ${item.title} in ${item.unitCode}`}
              aria-invalid={validationError ? 'true' : 'false'}
              aria-describedby={validationError ? qtyErrorId : undefined}
            />
            <button
              type="button"
              className="thz-stepper-btn"
              onClick={() => void handleStep(1)}
              disabled={isQuantityDisabled || isMaxReached}
              aria-label={`Increase quantity for ${item.title} by ${item.stepIncrement} ${item.unitCode}`}
            >
              +
            </button>
          </div>

          {isQuantityChanged && !isCatalogDeleted ? (
            <button
              type="submit"
              className="thz-btn-secondary thz-btn-compact"
              disabled={isQuantityDisabled || !validation.isValid}
            >
              {isPending ? 'Saving…' : 'Update'}
            </button>
          ) : null}
        </form>

        <button
          type="button"
          className="thz-btn-danger-outline"
          onClick={handleRemoveClick}
          disabled={isRowDisabled}
          aria-label={`Remove ${item.title} from cart`}
        >
          {isPending ? 'Updating…' : 'Remove'}
        </button>
      </div>

      {validationError ? (
        <div id={qtyErrorId} className="thz-form-error" role="alert">
          {validationError}
        </div>
      ) : null}
    </article>
  );
};
