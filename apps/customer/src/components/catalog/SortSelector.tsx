/**
 * Storefront Deterministic Sort Selector
 *
 * Implements canonical sorting options (AC-DISCOV-17):
 * - featured (Default)
 * - newest
 * - price_asc
 * - price_desc
 * - title_asc
 * - title_desc
 */

import React from 'react';
import type { StorefrontSortOption } from '@thehomez/shared-types';

export interface SortSelectorProps {
  value: StorefrontSortOption;
  onChange: (sort: StorefrontSortOption) => void;
}

export const SortSelector: React.FC<SortSelectorProps> = ({ value, onChange }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <label
        htmlFor="thz-sort-select"
        style={{
          fontSize: '0.875rem',
          fontWeight: 500,
          color: 'var(--thz-text-secondary)',
          whiteSpace: 'nowrap',
        }}
      >
        Sort by:
      </label>
      <select
        id="thz-sort-select"
        className="thz-search-input"
        style={{
          height: 'var(--thz-touch-target)',
          borderRadius: 'var(--thz-radius-md)',
          padding: '0 12px',
          backgroundColor: 'var(--thz-white)',
          cursor: 'pointer',
          fontSize: '0.875rem',
        }}
        value={value}
        onChange={(e) => onChange(e.target.value as StorefrontSortOption)}
        aria-label="Sort product catalogue"
      >
        <option value="featured">Featured & Recommended</option>
        <option value="newest">Newest Additions</option>
        <option value="price_asc">Price: Low to High</option>
        <option value="price_desc">Price: High to Low</option>
        <option value="title_asc">Name: A to Z</option>
        <option value="title_desc">Name: Z to A</option>
      </select>
    </div>
  );
};
