/**
 * Construction Measurement Quantity Stepper
 *
 * Implements:
 * - Discrete integer units (BAG, PIECE) vs. Metric decimal units (TONNE, KG)
 * - MOQ (minOrderQuantity) and step increment enforcement
 * - Exact scaled BigInt arithmetic via `ExactDecimalQuantity` (zero floating-point drift)
 * - Never silently rounds/truncates invalid user-entered quantities
 * - Mobile touch targets >= 44x44px (AC-DISCOV-23)
 */

import React from 'react';
import type { IStorefrontUnitSummary } from '@thehomez/shared-types';
import {
  isAtOrAboveMaximumQuantity,
  isAtOrBelowMinimumQuantity,
  stepExactQuantity,
  tryFormatCanonicalQuantity,
} from '../cart/cart-quantity.utils.js';

export interface QuantityStepperProps {
  unit: IStorefrontUnitSummary;
  quantity: string;
  onChange: (newQuantity: string) => void;
  disabled?: boolean;
  inputId?: string;
  label?: string;
  errorMessage?: string | null;
}

export const QuantityStepper: React.FC<QuantityStepperProps> = ({
  unit,
  quantity,
  onChange,
  disabled = false,
  inputId = 'thz-qty-stepper-input',
  label,
  errorMessage,
}) => {
  const precision = unit.quantityPrecision;

  const handleDecrement = () => {
    if (disabled) return;
    onChange(stepExactQuantity(quantity, unit, -1));
  };

  const handleIncrement = () => {
    if (disabled) return;
    onChange(stepExactQuantity(quantity, unit, 1));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    onChange(e.target.value);
  };

  const handleInputBlur = () => {
    // Only normalize canonical padding (e.g. "2" -> "2.000") if it already conforms cleanly;
    // never silently round/truncate invalid fractional precision or off-step entries.
    const formatted = tryFormatCanonicalQuantity(quantity, precision);
    if (formatted !== null && formatted !== quantity) {
      onChange(formatted);
    }
  };

  const isMinReached = isAtOrBelowMinimumQuantity(quantity, unit);
  const isMaxReached = isAtOrAboveMaximumQuantity(quantity, unit);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label
        htmlFor={inputId}
        style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--thz-text-primary)' }}
      >
        {label ?? `Order Quantity (${unit.unitCode}):`}
      </label>

      <div className="thz-stepper-box">
        <button
          type="button"
          className="thz-stepper-btn"
          onClick={handleDecrement}
          disabled={disabled || isMinReached}
          aria-label={`Decrease quantity by ${unit.stepIncrement} ${unit.unitCode}`}
        >
          −
        </button>

        <input
          id={inputId}
          type="text"
          inputMode={precision === 0 ? 'numeric' : 'decimal'}
          className={`thz-stepper-input${errorMessage ? ' error' : ''}`}
          value={quantity}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          disabled={disabled}
          aria-label={`Quantity in ${unit.unitCode}`}
          aria-invalid={errorMessage ? 'true' : 'false'}
          aria-describedby={errorMessage ? `${inputId}-error` : undefined}
        />

        <button
          type="button"
          className="thz-stepper-btn"
          onClick={handleIncrement}
          disabled={disabled || isMaxReached}
          aria-label={`Increase quantity by ${unit.stepIncrement} ${unit.unitCode}`}
        >
          +
        </button>

        <span style={{ fontSize: '0.9rem', color: 'var(--thz-text-secondary)', fontWeight: 500 }}>
          {unit.unitCode}
        </span>
      </div>

      <div style={{ fontSize: '0.75rem', color: 'var(--thz-text-muted)' }}>
        Min: {unit.minOrderQuantity} {unit.unitCode} • Step: {unit.stepIncrement} {unit.unitCode}
        {unit.maxOrderQuantity ? ` • Max: ${unit.maxOrderQuantity} ${unit.unitCode}` : ''}
      </div>

      {errorMessage ? (
        <div id={`${inputId}-error`} className="thz-form-error" role="alert">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
};
