// @vitest-environment jsdom
/**
 * Neutral Variant Selector Tests (AC-DISCOV-19 / Decision #53)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VariantSelector } from '../components/product-detail/VariantSelector.js';
import type { IStorefrontVariantDetail } from '@thehomez/shared-types';

describe('VariantSelector Component (Neutral Initial Selection)', () => {
  const mockVariants: IStorefrontVariantDetail[] = [
    {
      id: 'var-1',
      sku: 'TMT-550D-10MM',
      title: '10mm Diameter Fe 550D',
      attributes: { Diameter: '10mm', Grade: 'Fe 550D' },
      images: [],
      unit: {
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '1.000',
        maxOrderQuantity: '50.000',
        stepIncrement: '0.500',
      },
      pricing: {
        customerSegment: 'B2C',
        pricePaise: 5400000,
        mrpPaise: 5800000,
        discountPercentage: 7,
        isRegionalOverride: false,
        hasVolumeTiers: false,
      },
      availability: {
        availabilityUnknown: false,
        isAvailable: true,
        serviceAreaId: 'area-1',
        minLeadTimeHours: 12,
        availablePartnerCount: 1,
      },
    },
    {
      id: 'var-2',
      sku: 'TMT-550D-12MM',
      title: '12mm Diameter Fe 550D',
      attributes: { Diameter: '12mm', Grade: 'Fe 550D' },
      images: [],
      unit: {
        unitCode: 'TONNE',
        quantityPrecision: 3,
        minOrderQuantity: '1.000',
        maxOrderQuantity: '50.000',
        stepIncrement: '0.500',
      },
      pricing: {
        customerSegment: 'B2C',
        pricePaise: 5500000,
        mrpPaise: 5900000,
        discountPercentage: 7,
        isRegionalOverride: false,
        hasVolumeTiers: false,
      },
      availability: {
        availabilityUnknown: false,
        isAvailable: false,
        serviceAreaId: 'area-1',
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      },
    },
  ];

  it('renders in neutral initial state with explicit selection prompt (AC-DISCOV-19)', () => {
    const handleSelect = vi.fn();
    render(
      <VariantSelector
        variants={mockVariants}
        selectedVariant={null}
        onSelectVariant={handleSelect}
      />,
    );

    // Initial state prompt must be displayed
    expect(
      screen.getByText(
        /Please select an option to view pricing, specifications, and availability/i,
      ),
    ).toBeInTheDocument();

    // Radiogroup chips rendered
    expect(screen.getByRole('radio', { name: /10mm Diameter Fe 550D/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /12mm Diameter Fe 550D/i })).toBeInTheDocument();

    // No variant is marked as selected (checked)
    const radio1 = screen.getByRole('radio', { name: /10mm Diameter Fe 550D/i });
    expect(radio1).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onSelectVariant when user clicks a variant chip', () => {
    const handleSelect = vi.fn();
    render(
      <VariantSelector
        variants={mockVariants}
        selectedVariant={null}
        onSelectVariant={handleSelect}
      />,
    );

    const radio1 = screen.getByRole('radio', { name: /10mm Diameter Fe 550D/i });
    fireEvent.click(radio1);

    expect(handleSelect).toHaveBeenCalledTimes(1);
    expect(handleSelect).toHaveBeenCalledWith(mockVariants[0]);
  });

  it('allows selecting an out-of-stock variant without crashing and indicates status', () => {
    const handleSelect = vi.fn();
    render(
      <VariantSelector
        variants={mockVariants}
        selectedVariant={mockVariants[1]!}
        onSelectVariant={handleSelect}
      />,
    );

    const radio2 = screen.getByRole('radio', { name: /12mm Diameter Fe 550D/i });
    expect(radio2).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('(Out of Stock)')).toBeInTheDocument();
  });
});
