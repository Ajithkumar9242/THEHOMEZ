/**
 * Storefront Catalog Filter Sidebar & Controls
 *
 * Implements:
 * - Brand filter
 * - Price range filter (in Rupees converted to paise)
 * - In-stock toggle (guarded by pincode presence per schema invariant)
 * - Clear filters action
 */

import React, { useState, useEffect } from 'react';
import type { IStorefrontProductQuery } from '@thehomez/shared-types';
import { useStorefront } from '../../context/StorefrontContext.js';

export interface FilterSidebarProps {
  filters: IStorefrontProductQuery;
  onFilterChange: (filters: IStorefrontProductQuery) => void;
  availableBrands?: string[];
}

export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  filters,
  onFilterChange,
  availableBrands = [],
}) => {
  const { pincode } = useStorefront();

  const [brand, setBrand] = useState(filters.brand || '');
  const [minPriceRupees, setMinPriceRupees] = useState(
    filters.minPricePaise !== undefined ? String(filters.minPricePaise / 100) : '',
  );
  const [maxPriceRupees, setMaxPriceRupees] = useState(
    filters.maxPricePaise !== undefined ? String(filters.maxPricePaise / 100) : '',
  );
  const [inStockOnly, setInStockOnly] = useState(Boolean(filters.inStockOnly));

  useEffect(() => {
    setBrand(filters.brand || '');
    setMinPriceRupees(
      filters.minPricePaise !== undefined ? String(filters.minPricePaise / 100) : '',
    );
    setMaxPriceRupees(
      filters.maxPricePaise !== undefined ? String(filters.maxPricePaise / 100) : '',
    );
    setInStockOnly(Boolean(filters.inStockOnly));
  }, [filters]);

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();

    const newFilters: IStorefrontProductQuery = {
      ...filters,
      page: 1,
    };

    if (brand.trim()) {
      newFilters.brand = brand.trim();
    } else {
      delete newFilters.brand;
    }

    const minP = minPriceRupees ? Math.round(Number(minPriceRupees) * 100) : undefined;
    const maxP = maxPriceRupees ? Math.round(Number(maxPriceRupees) * 100) : undefined;

    if (minP !== undefined && !isNaN(minP) && minP >= 0) {
      newFilters.minPricePaise = minP;
    } else {
      delete newFilters.minPricePaise;
    }

    if (maxP !== undefined && !isNaN(maxP) && maxP >= 0) {
      newFilters.maxPricePaise = maxP;
    } else {
      delete newFilters.maxPricePaise;
    }

    // Invariant: inStockOnly requires valid pincode
    if (inStockOnly && pincode) {
      newFilters.inStockOnly = true;
    } else {
      delete newFilters.inStockOnly;
    }

    onFilterChange(newFilters);
  };

  const handleReset = () => {
    setBrand('');
    setMinPriceRupees('');
    setMaxPriceRupees('');
    setInStockOnly(false);

    const cleared: IStorefrontProductQuery = {
      pincode: filters.pincode,
      page: 1,
      limit: filters.limit,
      sort: filters.sort,
    };
    onFilterChange(cleared);
  };

  return (
    <aside
      className="thz-filter-sidebar"
      style={{
        backgroundColor: 'var(--thz-white)',
        border: '1px solid var(--thz-border-subtle)',
        borderRadius: 'var(--thz-radius-lg)',
        padding: '20px',
      }}
      aria-label="Catalogue filters"
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Filter Materials</h3>
        <button
          type="button"
          className="thz-link-btn"
          style={{ fontSize: '0.825rem' }}
          onClick={handleReset}
        >
          Reset All
        </button>
      </div>

      <form onSubmit={handleApply}>
        {/* In-Stock Filter Guard */}
        <div style={{ marginBottom: '20px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.9rem',
              fontWeight: 500,
              cursor: pincode ? 'pointer' : 'not-allowed',
              opacity: pincode ? 1 : 0.6,
            }}
          >
            <input
              type="checkbox"
              checked={inStockOnly}
              disabled={!pincode}
              onChange={(e) => setInStockOnly(e.target.checked)}
              style={{ width: '18px', height: '18px', accentColor: 'var(--thz-primary)' }}
            />
            <span>In-Stock Only</span>
          </label>
          {!pincode && (
            <p style={{ fontSize: '0.75rem', color: 'var(--thz-text-muted)', marginTop: '4px' }}>
              Enter delivery PIN code to filter by local stock
            </p>
          )}
        </div>

        {/* Brand Filter */}
        <div style={{ marginBottom: '20px' }}>
          <label
            htmlFor="filter-brand"
            style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}
          >
            Brand
          </label>
          {availableBrands.length > 0 ? (
            <select
              id="filter-brand"
              className="thz-search-input"
              style={{ width: '100%', height: '40px', borderRadius: '6px' }}
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            >
              <option value="">All Brands</option>
              {availableBrands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="filter-brand"
              type="text"
              className="thz-search-input"
              style={{ width: '100%', height: '40px', borderRadius: '6px' }}
              placeholder="e.g. UltraTech, Tata Tiscon"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
          )}
        </div>

        {/* Price Range Filter */}
        <div style={{ marginBottom: '20px' }}>
          <span
            style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}
          >
            Price Range (₹)
          </span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="number"
              placeholder="Min"
              min={0}
              className="thz-search-input"
              style={{ width: '100%', height: '40px', borderRadius: '6px', textAlign: 'center' }}
              value={minPriceRupees}
              onChange={(e) => setMinPriceRupees(e.target.value)}
              aria-label="Minimum price in rupees"
            />
            <span style={{ color: 'var(--thz-text-muted)' }}>–</span>
            <input
              type="number"
              placeholder="Max"
              min={0}
              className="thz-search-input"
              style={{ width: '100%', height: '40px', borderRadius: '6px', textAlign: 'center' }}
              value={maxPriceRupees}
              onChange={(e) => setMaxPriceRupees(e.target.value)}
              aria-label="Maximum price in rupees"
            />
          </div>
        </div>

        {/* Action Button */}
        <button type="submit" className="thz-btn-primary" style={{ width: '100%', height: '44px' }}>
          Apply Filters
        </button>
      </form>
    </aside>
  );
};
