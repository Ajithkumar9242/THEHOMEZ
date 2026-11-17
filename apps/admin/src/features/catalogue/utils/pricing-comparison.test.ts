import { describe, expect, it } from 'vitest';
import type { IB2BVolumeTier, MoneyPaise } from '@thehomez/shared-types';
import { comparePricePaise, compareVolumeTiers, formatPaiseExact } from './pricing-comparison.js';

describe('formatPaiseExact', () => {
  it('formats zero paise correctly', () => {
    expect(formatPaiseExact(0)).toBe('₹0.00');
  });

  it('formats single-digit paise correctly', () => {
    expect(formatPaiseExact(5)).toBe('₹0.05');
  });

  it('formats standard rupee values correctly', () => {
    expect(formatPaiseExact(45050)).toBe('₹450.50');
    expect(formatPaiseExact(100000)).toBe('₹1,000.00');
  });

  it('returns dash for null or negative numbers', () => {
    expect(formatPaiseExact(null)).toBe('—');
    expect(formatPaiseExact(undefined)).toBe('—');
    expect(formatPaiseExact(-100)).toBe('—');
  });
});

describe('comparePricePaise', () => {
  it('calculates HIGHER price comparison with exact difference', () => {
    const result = comparePricePaise(48000, 45000);
    expect(result.hasComparison).toBe(true);
    expect(result.direction).toBe('HIGHER');
    expect(result.diffPaise).toBe(3000);
    expect(result.absDiffPaise).toBe(3000);
    expect(result.diffFormatted).toBe('+₹30.00');
    expect(result.label).toBe('₹30.00 higher than global');
  });

  it('calculates LOWER price comparison with exact difference', () => {
    const result = comparePricePaise(42000, 45000);
    expect(result.hasComparison).toBe(true);
    expect(result.direction).toBe('LOWER');
    expect(result.diffPaise).toBe(-3000);
    expect(result.absDiffPaise).toBe(3000);
    expect(result.diffFormatted).toBe('-₹30.00');
    expect(result.label).toBe('₹30.00 lower than global');
  });

  it('calculates EQUAL price comparison', () => {
    const result = comparePricePaise(50000, 50000);
    expect(result.hasComparison).toBe(true);
    expect(result.direction).toBe('EQUAL');
    expect(result.diffPaise).toBe(0);
    expect(result.absDiffPaise).toBe(0);
    expect(result.diffFormatted).toBe('₹0.00');
    expect(result.label).toBe('Same as global baseline');
  });

  it('handles missing global value gracefully', () => {
    const result = comparePricePaise(48000, null);
    expect(result.hasComparison).toBe(false);
    expect(result.diffPaise).toBeNull();
    expect(result.label).toBe('Global baseline not configured');
  });

  it('handles missing regional value gracefully', () => {
    const result = comparePricePaise(null, 50000);
    expect(result.hasComparison).toBe(false);
    expect(result.diffPaise).toBeNull();
    expect(result.label).toBe('Regional value not configured');
  });

  it('handles both values missing', () => {
    const result = comparePricePaise(null, null);
    expect(result.hasComparison).toBe(false);
    expect(result.label).toBe('Not configured');
  });

  it('preserves exact BigInt integers without floating point loss', () => {
    // 38050 paise vs 38000 paise
    const result = comparePricePaise(38050, 38000);
    expect(result.diffPaise).toBe(50);
    expect(result.diffFormatted).toBe('+₹0.50');
  });
});

describe('compareVolumeTiers', () => {
  const globalTiers: IB2BVolumeTier[] = [
    { minQuantity: '10.000', pricePaise: 40000 as MoneyPaise },
    { minQuantity: '50.000', pricePaise: 38000 as MoneyPaise },
  ];

  const regionalTiers: IB2BVolumeTier[] = [
    { minQuantity: '10.000', pricePaise: 42000 as MoneyPaise }, // higher than global
    { minQuantity: '100.000', pricePaise: 35000 as MoneyPaise }, // regional only
  ];

  it('explicitly warns when regional has NO volume tiers (zero inheritance)', () => {
    const result = compareVolumeTiers([], globalTiers);
    expect(result.hasRegionalTiers).toBe(false);
    expect(result.hasGlobalTiers).toBe(true);
    expect(result.summaryMessage).toContain('global tiers are not inherited');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.status).toBe('GLOBAL_ONLY');
  });

  it('handles regional with tiers when global has none', () => {
    const result = compareVolumeTiers(regionalTiers, []);
    expect(result.hasRegionalTiers).toBe(true);
    expect(result.hasGlobalTiers).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.status).toBe('REGIONAL_ONLY');
  });

  it('correctly maps matched, regional-only, and global-only tiers when both schedules exist', () => {
    const result = compareVolumeTiers(regionalTiers, globalTiers);
    expect(result.hasRegionalTiers).toBe(true);
    expect(result.hasGlobalTiers).toBe(true);
    expect(result.rows).toHaveLength(3);

    // 10.000 matches in both
    const matchedRow = result.rows.find((r) => r.minQuantity === '10.000');
    expect(matchedRow?.status).toBe('MATCHED');
    expect(matchedRow?.comparison?.direction).toBe('HIGHER');
    expect(matchedRow?.comparison?.diffPaise).toBe(2000);

    // 100.000 is regional-only
    const regionalOnlyRow = result.rows.find((r) => r.minQuantity === '100.000');
    expect(regionalOnlyRow?.status).toBe('REGIONAL_ONLY');
    expect(regionalOnlyRow?.globalPricePaise).toBeNull();

    // 50.000 is global-only
    const globalOnlyRow = result.rows.find((r) => r.minQuantity === '50.000');
    expect(globalOnlyRow?.status).toBe('GLOBAL_ONLY');
    expect(globalOnlyRow?.regionalPricePaise).toBeNull();
  });

  it('handles empty tiers in both global and regional', () => {
    const result = compareVolumeTiers([], []);
    expect(result.hasRegionalTiers).toBe(false);
    expect(result.hasGlobalTiers).toBe(false);
    expect(result.rows).toHaveLength(0);
  });
});
