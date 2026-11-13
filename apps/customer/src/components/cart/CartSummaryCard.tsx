/**
 * Customer Cart Summary Card
 *
 * Displays only server-authoritative summary totals returned by `/api/v1/cart`:
 * - Total item count & valid item count
 * - Localization state & active delivery service area
 * - Customer pricing segment (B2C vs. B2B)
 * - GST-exclusive net material subtotal (`materialSubtotalPaise`)
 * - Clear-cart & cart-validation action triggers
 *
 * Strict Milestone 5B.3 Boundary:
 * Does NOT compute or display invented tax/GST estimates, delivery fees,
 * stock counts, or Checkout/Order Creation actions (5B.4 / 5B.5).
 */

import React from 'react';
import { formatPaiseToINR, type ICartSummaryDto } from '@thehomez/shared-types';

export type CartValidationSummaryStatus = 'READY' | 'ACTION_NEEDED' | 'STALE' | 'UNVALIDATED';

export interface CartSummaryCardProps {
  cart: ICartSummaryDto;
  isBusy: boolean;
  validationStatus?: CartValidationSummaryStatus;
  isValidating?: boolean;
  onValidateCart?: () => void;
  onChangeLocation: () => void;
  onRequestClearCart: () => void;
  onBrowseCatalog: () => void;
}

export const CartSummaryCard: React.FC<CartSummaryCardProps> = ({
  cart,
  isBusy,
  validationStatus = 'UNVALIDATED',
  isValidating = false,
  onValidateCart,
  onChangeLocation,
  onRequestClearCart,
  onBrowseCatalog,
}) => {
  const segmentLabel =
    cart.customerSegment === 'B2B' ? 'Verified Contractor (B2B)' : 'Retail Customer (B2C)';

  const validationStatusLabel =
    validationStatus === 'READY'
      ? 'Validated'
      : validationStatus === 'ACTION_NEEDED'
        ? 'Action Required'
        : validationStatus === 'STALE'
          ? 'Re-validation Needed'
          : 'Not Validated Yet';

  return (
    <aside className="thz-cart-summary-card" aria-label="Cart summary">
      <h2 className="thz-cart-summary-title">Cart Summary</h2>

      {/* Delivery PIN Localization Status */}
      <div className={`thz-cart-location-box state-${cart.localizationState.toLowerCase()}`}>
        <div className="thz-cart-location-header">
          <span className="thz-cart-location-label">Delivery PIN</span>
          <button
            type="button"
            className="thz-link-btn"
            onClick={onChangeLocation}
            disabled={isBusy}
          >
            {cart.pincode ? 'Change PIN' : 'Set PIN'}
          </button>
        </div>

        {cart.localizationState === 'SERVICEABLE' && cart.pincode && cart.serviceArea ? (
          <div className="thz-cart-location-value serviceable">
            ✓ {cart.pincode} — {cart.serviceArea.name} ({cart.serviceArea.code})
          </div>
        ) : cart.localizationState === 'UNSERVICEABLE' && cart.pincode ? (
          <div className="thz-cart-location-value unserviceable">
            ⚠️ {cart.pincode} is outside active delivery service areas.
          </div>
        ) : (
          <div className="thz-cart-location-value unlocalized">
            No delivery PIN set. Enter a PIN to verify local hub stock and area rates.
          </div>
        )}
      </div>

      {/* Authoritative Server Metrics */}
      <dl className="thz-cart-summary-rows">
        <div className="thz-cart-summary-row">
          <dt>Pricing Tier</dt>
          <dd>{segmentLabel}</dd>
        </div>
        <div className="thz-cart-summary-row">
          <dt>Items in Cart</dt>
          <dd>{cart.totalItemCount}</dd>
        </div>
        <div className="thz-cart-summary-row">
          <dt>Valid Items</dt>
          <dd>{cart.validItemCount}</dd>
        </div>
        <div className="thz-cart-summary-row">
          <dt>Validation Status</dt>
          <dd>{validationStatusLabel}</dd>
        </div>
        <div className="thz-cart-summary-row total">
          <dt>Material Subtotal</dt>
          <dd className="thz-cart-subtotal-amount">
            {formatPaiseToINR(cart.materialSubtotalPaise)}
          </dd>
        </div>
      </dl>

      {/* Authoritative GST-Exclusive Disclosure */}
      <p className="thz-cart-tax-disclosure">
        <strong>Pricing Basis:</strong> Material subtotal ({cart.currency}) is{' '}
        <strong>GST-exclusive</strong> and excludes delivery or unloading charges.
      </p>

      {cart.hasBlockingIssues ? (
        <div className="thz-cart-blocking-note" role="status">
          Some items need attention (availability, area delivery PIN, or quantity constraints) before
          the cart is ready for order review.
        </div>
      ) : null}

      <div className="thz-cart-summary-actions">
        {onValidateCart && cart.items.length > 0 ? (
          <button
            type="button"
            className="thz-btn-primary"
            onClick={onValidateCart}
            disabled={isBusy || isValidating}
          >
            {isValidating ? 'Validating Cart…' : 'Validate Cart Now'}
          </button>
        ) : null}

        <button
          type="button"
          className="thz-btn-secondary"
          onClick={onBrowseCatalog}
          disabled={isBusy}
        >
          Continue Browsing Materials
        </button>

        {cart.items.length > 0 ? (
          <button
            type="button"
            className="thz-btn-danger-outline"
            onClick={onRequestClearCart}
            disabled={isBusy}
          >
            Clear Cart
          </button>
        ) : null}
      </div>
    </aside>
  );
};
