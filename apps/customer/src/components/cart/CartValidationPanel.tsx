/**
 * Customer Cart Validation & Price Acknowledgement Panel (Milestone 5B.3)
 *
 * Allows the customer to:
 * - Explicitly run `POST /api/v1/cart/validate` against the active cart PIN,
 *   a saved delivery address (`addressId`), or an ephemeral 6-digit PIN (`pincode`).
 * - Inspect itemized blocking issues and recovery guidance.
 * - Inspect price increases/decreases and explicitly acknowledge individual or all price updates
 *   via `POST /api/v1/cart/acknowledge-prices`.
 */

import React, { useCallback, useId, useState } from 'react';
import {
  formatPaiseToINR,
  type ICartSummaryDto,
  type ICartValidationIssueDto,
  type ICartValidationResultDto,
  type ICustomerAddressDto,
} from '@thehomez/shared-types';
import {
  getPriceDriftComparison,
  getValidationIssueGuidance,
} from './cart-quantity.utils.js';

export type ValidationTargetMode = 'cart_pincode' | 'saved_address' | 'ephemeral_pincode';

export interface CartValidationPanelProps {
  cart: ICartSummaryDto;
  validationResult: ICartValidationResultDto | null;
  validationError: string | null;
  isValidating: boolean;
  isAcknowledging: boolean;
  acknowledgingItemIds: Record<string, boolean>;
  isValidationStale: boolean;
  hasCurrentValidationSnapshot: boolean;
  isCartBusy: boolean;
  savedAddresses: ICustomerAddressDto[] | null;
  isLoadingAddresses: boolean;
  addressLoadError: string | null;
  onLoadSavedAddresses: () => Promise<void>;
  onValidateCart: (options?: { pincode?: string; addressId?: string }) => Promise<unknown>;
  onInvalidateValidation: () => void;
  onAcknowledgePrices: (itemIds?: string[]) => Promise<unknown>;
  onOpenAddresses: () => void;
  onOpenLocationModal: () => void;
}

const PINCODE_REGEX = /^\d{6}$/;

function findItemLabel(
  cart: ICartSummaryDto,
  validationCart: ICartSummaryDto | undefined,
  itemId: string | null | undefined,
): string | null {
  if (!itemId) {
    return null;
  }
  const sourceItems = validationCart?.items ?? cart.items;
  const matched = sourceItems.find((item) => item.itemId === itemId);
  if (!matched) {
    return null;
  }
  const variantLabel = matched.variantTitle ? ` (${matched.variantTitle})` : '';
  return `${matched.title}${variantLabel} · ${matched.quantity} ${matched.unitCode}`;
}

export const CartValidationPanel: React.FC<CartValidationPanelProps> = ({
  cart,
  validationResult,
  validationError,
  isValidating,
  isAcknowledging,
  acknowledgingItemIds,
  isValidationStale,
  hasCurrentValidationSnapshot,
  isCartBusy,
  savedAddresses,
  isLoadingAddresses,
  addressLoadError,
  onLoadSavedAddresses,
  onValidateCart,
  onInvalidateValidation,
  onAcknowledgePrices,
  onOpenAddresses,
  onOpenLocationModal,
}) => {
  const modeGroupId = useId();
  const addressSelectId = useId();
  const ephemeralPinId = useId();

  const [targetMode, setTargetMode] = useState<ValidationTargetMode>('cart_pincode');
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [ephemeralPinInput, setEphemeralPinInput] = useState<string>('');
  const [inputError, setInputError] = useState<string | null>(null);

  const handleModeChange = useCallback(
    (nextMode: ValidationTargetMode) => {
      setTargetMode(nextMode);
      setInputError(null);
      onInvalidateValidation();
      if (nextMode === 'saved_address' && savedAddresses === null && !isLoadingAddresses) {
        void onLoadSavedAddresses();
      }
    },
    [isLoadingAddresses, onInvalidateValidation, onLoadSavedAddresses, savedAddresses],
  );

  // Pick a sensible default saved address once loaded if none is selected yet
  const safeAddresses = Array.isArray(savedAddresses) ? savedAddresses : null;
  const effectiveAddressId =
    selectedAddressId ||
    safeAddresses?.find((addr) => addr.isDefault)?.id ||
    safeAddresses?.[0]?.id ||
    '';

  const handleRunValidation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isValidating || isCartBusy || isAcknowledging || cart.items.length === 0) {
      return;
    }

    setInputError(null);

    if (targetMode === 'saved_address') {
      if (!effectiveAddressId) {
        setInputError('Select a saved delivery address or add one in your Address Book first.');
        return;
      }
      try {
        await onValidateCart({ addressId: effectiveAddressId });
      } catch {
        // Error surfaced by CartContext validationError
      }
      return;
    }

    if (targetMode === 'ephemeral_pincode') {
      const trimmedPin = ephemeralPinInput.trim();
      if (!PINCODE_REGEX.test(trimmedPin)) {
        setInputError('Enter a valid 6-digit Indian PIN code to check availability.');
        return;
      }
      try {
        await onValidateCart({ pincode: trimmedPin });
      } catch {
        // Error surfaced by CartContext validationError
      }
      return;
    }

    try {
      await onValidateCart({});
    } catch {
      // Error surfaced by CartContext validationError
    }
  };

  const priceChangedItemsFromCart = cart.items.filter((item) => item.priceDrift?.hasChanged);
  const priceChangedIssues: ICartValidationIssueDto[] = validationResult
    ? validationResult.priceChangedItems
    : [];

  const hasAnyPriceDrift =
    priceChangedIssues.length > 0 ||
    priceChangedItemsFromCart.length > 0 ||
    cart.hasUnacknowledgedPriceChanges;

  const isAnyAcknowledging =
    isAcknowledging || Object.values(acknowledgingItemIds).some(Boolean);

  const isValidatedReady =
    validationResult !== null &&
    hasCurrentValidationSnapshot &&
    !isValidationStale &&
    validationResult.isValidForCheckout &&
    validationResult.blockingReasons.length === 0 &&
    validationResult.priceChangedItems.length === 0;

  return (
    <section
      className="thz-cart-validation-panel"
      aria-labelledby="cart-validation-heading"
    >
      <div className="thz-cart-validation-header">
        <div>
          <h2 id="cart-validation-heading">Cart Validation &amp; Price Check</h2>
          <p className="thz-cart-validation-subtitle">
            Verify live local serviceability, item availability, and updated unit prices before continuing.
          </p>
        </div>
        {isValidatedReady ? (
          <span className="thz-validation-badge tone-success">Validated</span>
        ) : validationResult && !isValidationStale ? (
          <span className="thz-validation-badge tone-warning">Action Needed</span>
        ) : isValidationStale ? (
          <span className="thz-validation-badge tone-info">Re-validation Needed</span>
        ) : null}
      </div>

      <form className="thz-cart-validation-form" onSubmit={handleRunValidation} noValidate>
        <fieldset className="thz-validation-mode-fieldset">
          <legend className="thz-sr-only">Choose delivery target for validation</legend>
          <div className="thz-validation-mode-options" role="radiogroup" aria-labelledby={modeGroupId}>
            <span id={modeGroupId} className="thz-validation-mode-label">
              Validate delivery for:
            </span>
            <label className="thz-validation-mode-option">
              <input
                type="radio"
                name="validation-target-mode"
                value="cart_pincode"
                checked={targetMode === 'cart_pincode'}
                onChange={() => handleModeChange('cart_pincode')}
                disabled={isValidating}
              />
              <span>
                Active Cart PIN {cart.pincode ? `(${cart.pincode})` : '(Not set)'}
              </span>
            </label>

            <label className="thz-validation-mode-option">
              <input
                type="radio"
                name="validation-target-mode"
                value="saved_address"
                checked={targetMode === 'saved_address'}
                onChange={() => handleModeChange('saved_address')}
                disabled={isValidating}
              />
              <span>Saved Site Address</span>
            </label>

            <label className="thz-validation-mode-option">
              <input
                type="radio"
                name="validation-target-mode"
                value="ephemeral_pincode"
                checked={targetMode === 'ephemeral_pincode'}
                onChange={() => handleModeChange('ephemeral_pincode')}
                disabled={isValidating}
              />
              <span>Check Another PIN</span>
            </label>
          </div>
        </fieldset>

        {targetMode === 'saved_address' ? (
          <div className="thz-validation-target-box">
            {isLoadingAddresses ? (
              <p className="thz-validation-helper" role="status">
                Loading your saved delivery addresses…
              </p>
            ) : addressLoadError ? (
              <div className="thz-validation-inline-error" role="alert">
                <span>{addressLoadError}</span>
                <button
                  type="button"
                  className="thz-link-button"
                  onClick={() => void onLoadSavedAddresses()}
                >
                  Retry
                </button>
              </div>
            ) : savedAddresses && savedAddresses.length > 0 ? (
              <div className="thz-validation-field">
                <label htmlFor={addressSelectId}>Select Saved Site Address</label>
                <select
                  id={addressSelectId}
                  value={effectiveAddressId}
                  onChange={(e) => {
                    setSelectedAddressId(e.target.value);
                    setInputError(null);
                    onInvalidateValidation();
                  }}
                  disabled={isValidating}
                >
                  {savedAddresses.map((addr) => (
                    <option key={addr.id} value={addr.id}>
                      {addr.label ? `${addr.label} — ` : ''}
                      {addr.recipientName}, {addr.city} ({addr.pincode})
                      {addr.isDefault ? ' [Default]' : ''}
                    </option>
                  ))}
                </select>
                <p className="thz-validation-helper">
                  Checks availability and pricing for the selected address without overwriting your active cart PIN.
                </p>
              </div>
            ) : (
              <div className="thz-validation-helper-row">
                <span>No saved delivery addresses found in your Address Book.</span>
                <button
                  type="button"
                  className="thz-link-button"
                  onClick={onOpenAddresses}
                >
                  Manage Addresses
                </button>
              </div>
            )}
          </div>
        ) : null}

        {targetMode === 'ephemeral_pincode' ? (
          <div className="thz-validation-target-box">
            <div className="thz-validation-field">
              <label htmlFor={ephemeralPinId}>6-Digit Delivery PIN Code</label>
              <input
                id={ephemeralPinId}
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="e.g. 560037"
                value={ephemeralPinInput}
                onChange={(e) => {
                  const digitsOnly = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setEphemeralPinInput(digitsOnly);
                  setInputError(null);
                    onInvalidateValidation();
                }}
                disabled={isValidating}
              />
              <p className="thz-validation-helper">
                Preview availability &amp; pricing for a PIN without changing your saved cart location.
              </p>
            </div>
          </div>
        ) : null}

        {inputError ? (
          <div className="thz-cart-status-banner tone-error" role="alert">
            {inputError}
          </div>
        ) : null}

        <div className="thz-validation-actions-row">
          <button
            type="submit"
            className="thz-btn-primary"
            disabled={
              isValidating ||
              isCartBusy ||
              isAnyAcknowledging ||
              cart.items.length === 0
            }
          >
            {isValidating
              ? 'Validating Cart…'
              : validationResult || isValidationStale
                ? 'Re-validate Cart'
                : 'Validate Cart'}
          </button>

          {targetMode === 'cart_pincode' && !cart.pincode ? (
            <button
              type="button"
              className="thz-btn-secondary"
              onClick={onOpenLocationModal}
              disabled={isValidating || isCartBusy}
            >
              Set Delivery PIN
            </button>
          ) : null}
        </div>
      </form>

      {isValidating ? (
        <div className="thz-cart-status-banner tone-info" role="status" aria-live="polite">
          Validating cart availability, serviceability, and current prices…
        </div>
      ) : null}

      {validationError ? (
        <div className="thz-cart-status-banner tone-error" role="alert">
          <strong>Validation Failed:</strong> {validationError}
        </div>
      ) : null}

      {isValidationStale && !validationResult && !isValidating ? (
        <div className="thz-cart-status-banner tone-info" role="status">
          <strong>Re-validation required:</strong> Your cart was updated. Run{' '}
          <strong>Validate Cart</strong> again to confirm availability and prices.
        </div>
      ) : null}

      {/* Validated Success Banner (shown ONLY when fully valid and no price changes or blockers) */}
      {isValidatedReady && validationResult ? (
        <div className="thz-cart-validation-success" role="status">
          <strong>Cart Validated — All items are available and prices are current.</strong>
          <p>
            Evaluated PIN: <strong>{validationResult.evaluatedPincode ?? 'Not specified'}</strong>
            {validationResult.cart.serviceArea
              ? ` · ${validationResult.cart.serviceArea.city}, ${validationResult.cart.serviceArea.state}`
              : ''}
            {cart.pincode &&
            validationResult.evaluatedPincode &&
            cart.pincode !== validationResult.evaluatedPincode
              ? ` (Active cart PIN remains ${cart.pincode})`
              : ''}
          </p>
        </div>
      ) : null}

      {/* Blocking Validation Issues */}
      {validationResult && !isValidationStale && validationResult.blockingReasons.length > 0 ? (
        <div className="thz-cart-validation-blockers" role="alert">
          <div className="thz-cart-validation-section-head">
            <h3>
              Blocking Issues ({validationResult.blockingReasons.length})
            </h3>
            {validationResult.evaluatedPincode ? (
              <span className="thz-validation-pin-chip">
                Evaluated PIN: {validationResult.evaluatedPincode}
              </span>
            ) : null}
          </div>
          <ul className="thz-validation-issue-list">
            {validationResult.blockingReasons.map((issue, idx) => {
              const itemLabel = findItemLabel(cart, validationResult.cart, issue.itemId);
              return (
                <li
                  key={`${issue.code}-${issue.itemId ?? 'cart'}-${idx}`}
                  className="thz-validation-issue-item tone-error"
                >
                  <div className="thz-validation-issue-title">
                    {itemLabel ? <strong>{itemLabel}</strong> : <strong>Cart Requirement</strong>}
                    <span className="thz-validation-issue-code">{issue.code}</span>
                  </div>
                  <p className="thz-validation-issue-msg">{issue.message}</p>
                  <p className="thz-validation-issue-hint">
                    Next step: {getValidationIssueGuidance(issue.code)}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Price Changes / Acknowledgement Section */}
      {hasAnyPriceDrift ? (
        <div className="thz-cart-validation-prices" role="region" aria-label="Price changes requiring acknowledgement">
          <div className="thz-cart-validation-section-head">
            <div>
              <h3>Price Updates Detected</h3>
              <p className="thz-cart-validation-subtitle">
                Unit prices changed since items were added. Review and accept updated prices before continuing.
              </p>
            </div>
            <button
              type="button"
              className="thz-btn-secondary"
              disabled={!hasCurrentValidationSnapshot || isAnyAcknowledging || isValidating || isCartBusy}
              onClick={() => void onAcknowledgePrices()}
            >
              {isAcknowledging ? 'Accepting All…' : 'Accept All Price Updates'}
            </button>
          </div>
          {!hasCurrentValidationSnapshot ? (
            <p className="thz-validation-helper" role="status">
              {isValidationStale
                ? 'Re-validate the cart before acknowledging these prices.'
                : 'Validate the cart to create a current snapshot before acknowledging these prices.'}
            </p>
          ) : null}

          <ul className="thz-validation-issue-list">
            {priceChangedIssues.length > 0
              ? priceChangedIssues.map((issue, idx) => {
                  const itemId = issue.itemId ?? '';
                  const itemLabel = findItemLabel(cart, validationResult?.cart, issue.itemId);
                  const comparison = getPriceDriftComparison(
                    issue.acknowledgedUnitPricePaise,
                    issue.currentUnitPricePaise,
                  );
                  const isItemBusy = Boolean(itemId && acknowledgingItemIds[itemId]);

                  return (
                    <li
                      key={`${issue.code}-${itemId || idx}`}
                      className="thz-validation-issue-item tone-warning"
                    >
                      <div className="thz-validation-issue-title">
                        <strong>{itemLabel ?? 'Cart Item'}</strong>
                        {comparison.direction === 'INCREASED' ? (
                          <span className="thz-price-drift-pill tone-increase">
                            Price Increased (+{formatPaiseToINR(comparison.deltaPaise)})
                          </span>
                        ) : comparison.direction === 'DECREASED' ? (
                          <span className="thz-price-drift-pill tone-decrease">
                            Price Decreased (-{formatPaiseToINR(comparison.deltaPaise)})
                          </span>
                        ) : (
                          <span className="thz-price-drift-pill tone-info">Price Updated</span>
                        )}
                      </div>
                      <p className="thz-validation-issue-msg">
                        {issue.acknowledgedUnitPricePaise !== null &&
                        issue.acknowledgedUnitPricePaise !== undefined
                          ? `Previous: ${formatPaiseToINR(issue.acknowledgedUnitPricePaise)}`
                          : 'Previous price unavailable'}{' '}
                        →{' '}
                        <strong>
                          Current:{' '}
                          {issue.currentUnitPricePaise !== null &&
                          issue.currentUnitPricePaise !== undefined
                            ? formatPaiseToINR(issue.currentUnitPricePaise)
                            : 'Unavailable'}
                        </strong>
                      </p>
                      {itemId ? (
                        <div className="thz-validation-item-actions">
                          <button
                            type="button"
                            className="thz-btn-secondary"
                            disabled={!hasCurrentValidationSnapshot || isAnyAcknowledging || isValidating || isCartBusy}
                            onClick={() => void onAcknowledgePrices([itemId])}
                          >
                            {isItemBusy ? 'Accepting…' : 'Accept Updated Price'}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })
              : priceChangedItemsFromCart.map((item) => {
                  const drift = item.priceDrift!;
                  const comparison = getPriceDriftComparison(
                    drift.acknowledgedUnitPricePaise,
                    drift.currentUnitPricePaise,
                  );
                  const isItemBusy = Boolean(acknowledgingItemIds[item.itemId]);
                  const variantLabel = item.variantTitle ? ` (${item.variantTitle})` : '';

                  return (
                    <li
                      key={item.itemId}
                      className="thz-validation-issue-item tone-warning"
                    >
                      <div className="thz-validation-issue-title">
                        <strong>
                          {item.title}
                          {variantLabel} · {item.quantity} {item.unitCode}
                        </strong>
                        {comparison.direction === 'INCREASED' ? (
                          <span className="thz-price-drift-pill tone-increase">
                            Price Increased (+{formatPaiseToINR(comparison.deltaPaise)})
                          </span>
                        ) : comparison.direction === 'DECREASED' ? (
                          <span className="thz-price-drift-pill tone-decrease">
                            Price Decreased (-{formatPaiseToINR(comparison.deltaPaise)})
                          </span>
                        ) : (
                          <span className="thz-price-drift-pill tone-info">Price Updated</span>
                        )}
                      </div>
                      <p className="thz-validation-issue-msg">
                        {drift.acknowledgedUnitPricePaise !== null
                          ? `Previous: ${formatPaiseToINR(drift.acknowledgedUnitPricePaise)}`
                          : 'Previous price unavailable'}{' '}
                        →{' '}
                        <strong>
                          Current: {formatPaiseToINR(drift.currentUnitPricePaise)} per {item.unitCode}
                        </strong>
                      </p>
                      <div className="thz-validation-item-actions">
                        <button
                          type="button"
                          className="thz-btn-secondary"
                          disabled={!hasCurrentValidationSnapshot || isAnyAcknowledging || isValidating || isCartBusy}
                          onClick={() => void onAcknowledgePrices([item.itemId])}
                        >
                          {isItemBusy ? 'Accepting…' : 'Accept Updated Price'}
                        </button>
                      </div>
                    </li>
                  );
                })}
          </ul>
        </div>
      ) : null}
    </section>
  );
};
