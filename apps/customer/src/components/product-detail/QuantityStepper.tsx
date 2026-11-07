/**
 * Construction Measurement Quantity Stepper
 *
 * Implements:
 * - Discrete integer units (BAG, PIECE) vs. Metric decimal units (TONNE, KG)
 * - MOQ (minOrderQuantity) and step increment enforcement
 * - Scaled precision handling without floating-point artifacts (Decisions #28, #29)
 * - Mobile touch targets >= 44x44px (AC-DISCOV-23)
 */

import React from 'react';
import type { IStorefrontUnitSummary } from '@thehomez/shared-types';

export interface QuantityStepperProps {
  unit: IStorefrontUnitSummary;
  quantity: string;
  onChange: (newQuantity: string) => void;
  disabled?: boolean;
}

export const QuantityStepper: React.FC<QuantityStepperProps> = ({
  unit,
  quantity,
  onChange,
  disabled = false,
}) => {
  const precision = unit.quantityPrecision;
  const factor = Math.pow(10, precision);

  const parseVal = (str: string): number => {
    const n = parseFloat(str);
    return isNaN(n) ? parseFloat(unit.minOrderQuantity) : n;
  };

  const formatVal = (val: number): string => {
    return precision === 0 ? Math.round(val).toString() : val.toFixed(precision);
  };

  const minVal = parseVal(unit.minOrderQuantity);
  const maxVal = unit.maxOrderQuantity ? parseVal(unit.maxOrderQuantity) : Infinity;
  const stepVal = parseVal(unit.stepIncrement);
  const currentVal = parseVal(quantity);

  const handleDecrement = () => {
    if (disabled) return;
    const next = Math.max(minVal, currentVal - stepVal);
    // Precision round
    const rounded = Math.round(next * factor) / factor;
    onChange(formatVal(rounded));
  };

  const handleIncrement = () => {
    if (disabled) return;
    const next = Math.min(maxVal, currentVal + stepVal);
    const rounded = Math.round(next * factor) / factor;
    onChange(formatVal(rounded));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled) return;
    const val = e.target.value;
    onChange(val);
  };

  const handleInputBlur = () => {
    let parsed = parseVal(quantity);
    if (parsed < minVal) parsed = minVal;
    if (parsed > maxVal) parsed = maxVal;
    // Align to step increment
    const stepsFromMin = Math.round((parsed - minVal) / stepVal);
    const stepped = minVal + stepsFromMin * stepVal;
    const clamped = Math.min(maxVal, Math.max(minVal, stepped));
    const rounded = Math.round(clamped * factor) / factor;
    onChange(formatVal(rounded));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label
        htmlFor="thz-qty-stepper-input"
        style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--thz-text-primary)' }}
      >
        Order Quantity ({unit.unitCode}):
      </label>

      <div className="thz-stepper-box">
        <button
          type="button"
          className="thz-stepper-btn"
          onClick={handleDecrement}
          disabled={disabled || currentVal <= minVal}
          aria-label={`Decrease quantity by ${unit.stepIncrement} ${unit.unitCode}`}
        >
          −
        </button>

        <input
          id="thz-qty-stepper-input"
          type="text"
          inputMode={precision === 0 ? 'numeric' : 'decimal'}
          className="thz-stepper-input"
          value={quantity}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          disabled={disabled}
          aria-label={`Quantity in ${unit.unitCode}`}
        />

        <button
          type="button"
          className="thz-stepper-btn"
          onClick={handleIncrement}
          disabled={disabled || currentVal >= maxVal}
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
      </div>
    </div>
  );
};
