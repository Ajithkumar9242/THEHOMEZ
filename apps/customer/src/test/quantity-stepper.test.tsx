// @vitest-environment jsdom
/**
 * QuantityStepper Component Tests (AC-DISCOV-11, AC-DISCOV-12, AC-DISCOV-23)
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuantityStepper } from '../components/product-detail/QuantityStepper.js';
import type { IStorefrontUnitSummary } from '@thehomez/shared-types';

describe('QuantityStepper Component', () => {
  const discreteBagUnit: IStorefrontUnitSummary = {
    unitCode: 'BAG',
    quantityPrecision: 0,
    minOrderQuantity: '10',
    maxOrderQuantity: '500',
    stepIncrement: '5',
  };

  const metricTonneUnit: IStorefrontUnitSummary = {
    unitCode: 'TONNE',
    quantityPrecision: 3,
    minOrderQuantity: '1.000',
    maxOrderQuantity: '50.000',
    stepIncrement: '0.500',
  };

  it('increments discrete units in integer step intervals (AC-DISCOV-11)', () => {
    const handleChange = vi.fn();
    render(<QuantityStepper unit={discreteBagUnit} quantity="15" onChange={handleChange} />);

    const plusBtn = screen.getByRole('button', { name: /Increase quantity by 5 BAG/i });
    fireEvent.click(plusBtn);

    expect(handleChange).toHaveBeenCalledWith('20');
  });

  it('decrements discrete units in integer step intervals down to MOQ', () => {
    const handleChange = vi.fn();
    render(<QuantityStepper unit={discreteBagUnit} quantity="15" onChange={handleChange} />);

    const minusBtn = screen.getByRole('button', { name: /Decrease quantity by 5 BAG/i });
    fireEvent.click(minusBtn);

    expect(handleChange).toHaveBeenCalledWith('10');
  });

  it('disables minus button when quantity is at or below MOQ', () => {
    render(<QuantityStepper unit={discreteBagUnit} quantity="10" onChange={vi.fn()} />);

    const minusBtn = screen.getByRole('button', { name: /Decrease quantity by 5 BAG/i });
    expect(minusBtn).toBeDisabled();
  });

  it('increments continuous decimal metric units with 3-decimal precision (AC-DISCOV-12)', () => {
    const handleChange = vi.fn();
    render(<QuantityStepper unit={metricTonneUnit} quantity="2.500" onChange={handleChange} />);

    const plusBtn = screen.getByRole('button', { name: /Increase quantity by 0.500 TONNE/i });
    fireEvent.click(plusBtn);

    expect(handleChange).toHaveBeenCalledWith('3.000');
  });
});
