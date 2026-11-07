/**
 * Neutral Initial Variant Selector Component
 *
 * Implements:
 * - Neutral Initial State (Decision #53 / AC-DISCOV-19)
 * - Explicit prompt: "Please select an option to view pricing, specifications, and availability"
 * - Selectable variant chips with hit targets >= 44x44px (AC-DISCOV-23)
 * - Safe presentation of out-of-stock variants without crashing
 * - WCAG AA compliant contrast (AC-DISCOV-24)
 */

import React from 'react';
import type { IStorefrontVariantDetail } from '@thehomez/shared-types';

export interface VariantSelectorProps {
  variants: IStorefrontVariantDetail[];
  selectedVariant: IStorefrontVariantDetail | null;
  onSelectVariant: (variant: IStorefrontVariantDetail) => void;
}

export const VariantSelector: React.FC<VariantSelectorProps> = ({
  variants,
  selectedVariant,
  onSelectVariant,
}) => {
  if (!variants || variants.length === 0) {
    return null;
  }

  return (
    <section className="thz-variant-section" aria-labelledby="variant-selector-title">
      <h3
        id="variant-selector-title"
        style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '8px' }}
      >
        Select Specification / Variant:
      </h3>

      {/* Neutral Initial State Prompt */}
      {!selectedVariant && (
        <div className="thz-variant-prompt" role="alert">
          👉 Please select an option to view pricing, specifications, and availability
        </div>
      )}

      {/* Variant Selection Chips */}
      <div className="thz-variant-chips" role="radiogroup" aria-label="Available product variants">
        {variants.map((v) => {
          const isSelected = selectedVariant?.id === v.id;
          const isOutOfStock =
            v.availability.availabilityUnknown === false && v.availability.isAvailable === false;

          // Build chip label from title or attributes
          const attributeSummary = Object.entries(v.attributes)
            .map(([k, val]) => `${k}: ${val}`)
            .join(' | ');

          const label = v.title || attributeSummary || v.sku;

          return (
            <button
              key={v.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              className={`thz-variant-chip ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectVariant(v)}
              aria-label={`${label}${isOutOfStock ? ' (Out of stock)' : ''}`}
              title={label}
            >
              <span>{label}</span>
              {isOutOfStock && (
                <span
                  style={{
                    marginLeft: '6px',
                    fontSize: '0.7rem',
                    color: 'var(--thz-error-text)',
                    fontWeight: 600,
                  }}
                >
                  (Out of Stock)
                </span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
};
