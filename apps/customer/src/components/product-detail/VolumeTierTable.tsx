/**
 * B2B Volume Discount Tier Schedule & Dynamic Highlighting Table
 *
 * Implements:
 * - Dynamic Active Tier Highlighting based on quantity (AC-DISCOV-22 / Decision #36)
 * - Wholesale savings calculation against base price
 * - WCAG 2.1 AA Contrast Compliant styling (AC-DISCOV-24)
 * - Accessible screen reader announcements (aria-live="polite")
 */

import React, { useMemo } from 'react';
import type { IB2BVolumeTier } from '@thehomez/shared-types';
import { formatPaiseToINR } from '@thehomez/shared-types';

export interface VolumeTierTableProps {
  tiers: IB2BVolumeTier[];
  basePricePaise: number;
  currentQuantity: string;
  unitCode: string;
}

export const VolumeTierTable: React.FC<VolumeTierTableProps> = ({
  tiers,
  basePricePaise,
  currentQuantity,
  unitCode,
}) => {
  if (!tiers || tiers.length === 0) {
    return null;
  }

  const numericQty = parseFloat(currentQuantity) || 0;

  // Find the active qualifying tier (highest minQuantity <= numericQty)
  const sortedTiers = useMemo(() => {
    return [...tiers].sort((a, b) => parseFloat(a.minQuantity) - parseFloat(b.minQuantity));
  }, [tiers]);

  const activeTierIndex = useMemo(() => {
    let index = -1;
    for (let i = 0; i < sortedTiers.length; i++) {
      const tierMin = parseFloat(sortedTiers[i]!.minQuantity);
      if (numericQty >= tierMin) {
        index = i;
      }
    }
    return index;
  }, [sortedTiers, numericQty]);

  const activeTier = activeTierIndex >= 0 ? sortedTiers[activeTierIndex] : null;
  const effectiveUnitPrice = activeTier ? activeTier.pricePaise : basePricePaise;
  const totalAmountPaise = Math.round(effectiveUnitPrice * numericQty);
  const baselineTotalPaise = Math.round(basePricePaise * numericQty);
  const savingsPaise = Math.max(0, baselineTotalPaise - totalAmountPaise);

  return (
    <div className="thz-tier-table-box" aria-label="Wholesale Volume Discount Schedule">
      <div className="thz-tier-table-title">
        <span>🏢 Wholesale Volume Discount Schedule</span>
        <span style={{ fontSize: '0.8rem', color: '#1e3a8a', fontWeight: 500 }}>
          Contractor Pricing Active
        </span>
      </div>

      <table className="thz-tier-table" aria-describedby="tier-table-summary">
        <thead>
          <tr>
            <th scope="col">Tier</th>
            <th scope="col">Min Qty ({unitCode})</th>
            <th scope="col">Rate per {unitCode}</th>
            <th scope="col">Savings</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {/* Base Tier (Below first volume slab) */}
          <tr
            className={activeTierIndex === -1 ? 'tier-highlighted' : ''}
            aria-current={activeTierIndex === -1 ? 'true' : 'false'}
          >
            <td>Base Rate</td>
            <td>1 {unitCode}</td>
            <td>{formatPaiseToINR(basePricePaise)}</td>
            <td>—</td>
            <td>{activeTierIndex === -1 ? '✓ Active' : ''}</td>
          </tr>

          {/* Volume Tiers */}
          {sortedTiers.map((tier, idx) => {
            const isActive = idx === activeTierIndex;
            const discountPct =
              basePricePaise > 0
                ? Math.round(((basePricePaise - tier.pricePaise) / basePricePaise) * 100)
                : 0;

            return (
              <tr
                key={tier.minQuantity}
                className={isActive ? 'tier-highlighted' : ''}
                aria-current={isActive ? 'true' : 'false'}
              >
                <td>Tier {idx + 1}</td>
                <td>
                  ≥ {tier.minQuantity} {unitCode}
                </td>
                <td>{formatPaiseToINR(tier.pricePaise)}</td>
                <td>{discountPct}% OFF</td>
                <td>
                  {isActive ? (
                    <span style={{ color: '#92400e', fontWeight: 700 }}>★ Applied</span>
                  ) : (
                    <span style={{ color: 'var(--thz-text-muted)' }}>Available</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Summary Footer */}
      <div
        id="tier-table-summary"
        style={{
          padding: '12px 16px',
          backgroundColor: 'var(--thz-bg-well)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.875rem',
        }}
        aria-live="polite"
      >
        <div>
          <span>Effective Rate: </span>
          <strong style={{ color: 'var(--thz-text-primary)' }}>
            {formatPaiseToINR(effectiveUnitPrice)} / {unitCode}
          </strong>
        </div>
        {savingsPaise > 0 && (
          <div style={{ color: 'var(--thz-success-text)', fontWeight: 600 }}>
            🎉 Volume Savings: {formatPaiseToINR(savingsPaise)}
          </div>
        )}
      </div>
    </div>
  );
};
