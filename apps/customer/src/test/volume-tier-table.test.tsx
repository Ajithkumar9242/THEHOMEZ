// @vitest-environment jsdom
/**
 * B2B Volume Tier Highlighting Tests (AC-DISCOV-22 / Decision #36)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VolumeTierTable } from '../components/product-detail/VolumeTierTable.js';
import type { IB2BVolumeTier } from '@thehomez/shared-types';

describe('VolumeTierTable Component (AC-DISCOV-22 Dynamic Highlighting)', () => {
  const tiers: IB2BVolumeTier[] = [
    { minQuantity: '5.000', pricePaise: 5200000 }, // Tier 1: >= 5 tonnes
    { minQuantity: '10.000', pricePaise: 5000000 }, // Tier 2: >= 10 tonnes
    { minQuantity: '20.000', pricePaise: 4800000 }, // Tier 3: >= 20 tonnes
  ];

  const basePricePaise = 5400000; // Base: 54,000 INR/tonne

  it('highlights Base Rate when quantity is below first volume tier', () => {
    const { container } = render(
      <VolumeTierTable
        tiers={tiers}
        basePricePaise={basePricePaise}
        currentQuantity="2.000"
        unitCode="TONNE"
      />,
    );

    const baseRow = container.querySelector('tbody tr:first-child');
    expect(baseRow).toHaveClass('tier-highlighted');
    expect(screen.getByText('✓ Active')).toBeInTheDocument();
    expect(screen.getAllByText(/₹54,000/).length).toBeGreaterThanOrEqual(1);
  });

  it('dynamically highlights Tier 1 when quantity meets 5.000 (AC-DISCOV-22)', () => {
    const { container } = render(
      <VolumeTierTable
        tiers={tiers}
        basePricePaise={basePricePaise}
        currentQuantity="7.500"
        unitCode="TONNE"
      />,
    );

    const rows = container.querySelectorAll('tbody tr');
    // Row 0 is Base Rate, Row 1 is Tier 1
    expect(rows[0]).not.toHaveClass('tier-highlighted');
    expect(rows[1]).toHaveClass('tier-highlighted');
    expect(rows[2]).not.toHaveClass('tier-highlighted');

    // Effective rate should reflect 52,000 INR
    expect(screen.getAllByText(/₹52,000/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Volume Savings:/i)).toBeInTheDocument();
  });

  it('dynamically highlights Tier 2 when quantity increments to 10.000 (AC-DISCOV-22)', () => {
    const { container } = render(
      <VolumeTierTable
        tiers={tiers}
        basePricePaise={basePricePaise}
        currentQuantity="12.000"
        unitCode="TONNE"
      />,
    );

    const rows = container.querySelectorAll('tbody tr');
    // Row 2 is Tier 2 (>= 10 tonnes)
    expect(rows[1]).not.toHaveClass('tier-highlighted');
    expect(rows[2]).toHaveClass('tier-highlighted');
    expect(screen.getAllByText(/₹50,000/).length).toBeGreaterThanOrEqual(1);
  });

  it('dynamically highlights Tier 3 when quantity increments to 25.000 (AC-DISCOV-22)', () => {
    const { container } = render(
      <VolumeTierTable
        tiers={tiers}
        basePricePaise={basePricePaise}
        currentQuantity="25.000"
        unitCode="TONNE"
      />,
    );

    const rows = container.querySelectorAll('tbody tr');
    // Row 3 is Tier 3 (>= 20 tonnes)
    expect(rows[3]).toHaveClass('tier-highlighted');
    expect(screen.getAllByText(/₹48,000/).length).toBeGreaterThanOrEqual(1);
  });
});
