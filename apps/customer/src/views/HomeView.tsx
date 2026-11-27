/**
 * TheHomez Marketplace Homepage View (`/`)
 *
 * Implements:
 * - Architectural dark-slate hero canvas with live dispatch staging monitor
 * - Unserviceable area notice banner (Decision #50 / AC-DISCOV-25)
 * - Quality & Commercial Trust Pillars ("The TheHomez Standard")
 * - Two-tier category taxonomy ribbon (CategoryRail)
 * - Interactive category-filtered Featured Materials ribbon calling GET /api/v1/storefront/products
 * - Commercial B2B Contractor Advantage showcase
 * - 3-step direct jobsite fulfillment workflow
 * - Live loading, empty, and error states
 */

import React, { useEffect, useState } from 'react';
import { useStorefront } from '../context/StorefrontContext.js';
import { CategoryRail } from '../components/catalog/CategoryRail.js';
import { ProductCard } from '../components/catalog/ProductCard.js';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton.js';
import { ErrorDisplay } from '../components/common/ErrorBoundary.js';
import type { IStorefrontProductCard } from '@thehomez/shared-types';

interface FilterTab {
  id: string;
  label: string;
  keywords?: string[];
}

const FILTER_TABS: FilterTab[] = [
  { id: 'all', label: 'All Materials' },
  { id: 'steel', label: 'Structural Steel', keywords: ['steel', 'tmt', 'rebar', 'tiscon'] },
  {
    id: 'cement',
    label: 'Cement & Concrete',
    keywords: ['cement', 'concrete', 'ultratech', 'opc', 'ppc'],
  },
  {
    id: 'masonry',
    label: 'Masonry & Bricks',
    keywords: ['brick', 'block', 'aac', 'porotherm', 'clay'],
  },
  {
    id: 'plumbing-electrical',
    label: 'Plumbing & Electrical',
    keywords: ['pipe', 'cpvc', 'pvc', 'wire', 'havells', 'supreme'],
  },
];

export const HomeView: React.FC = () => {
  const { pincode, isServiceable, apiClient, navigateToPlp, openLocationModal } = useStorefront();

  const [featuredProducts, setFeaturedProducts] = useState<IStorefrontProductCard[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchFeatured = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.listProducts({
        limit: 8,
        sort: 'featured',
        pincode: pincode || undefined,
      });
      setFeaturedProducts(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load featured materials');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeatured();
  }, [pincode, apiClient]);

  // Client-side category tab filtering for the featured collection
  const activeTab = FILTER_TABS.find((t) => t.id === activeTabId);
  const displayedProducts =
    activeTab && activeTab.keywords
      ? featuredProducts.filter((p) => {
          const text =
            `${p.title} ${p.brand || ''} ${p.category?.name || ''} ${p.subcategory?.name || ''}`.toLowerCase();
          return activeTab.keywords?.some((kw) => text.includes(kw));
        })
      : featuredProducts;

  return (
    <div className="thz-home-view">
      {/* Unserviceable Warning Notice (Decision #50 / AC-DISCOV-25) */}
      {isServiceable === false && pincode && (
        <div className="thz-notice-banner warning" role="status">
          <span style={{ fontSize: '1.25rem' }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <strong>Delivery Not Available in Postal Code {pincode}</strong>
            <p style={{ fontSize: '0.875rem', marginTop: '2px' }}>
              We do not deliver to this postal code yet. You are browsing the catalogue in view-only
              mode with baseline pricing.
            </p>
          </div>
          <button
            type="button"
            className="thz-btn-secondary"
            onClick={openLocationModal}
            style={{ fontSize: '0.825rem' }}
          >
            Change PIN
          </button>
        </div>
      )}

      {/* Modern Hero Section & Architectural Dispatch Canvas */}
      <section className="thz-hero-section" aria-labelledby="hero-title">
        <div className="thz-hero-grid">
          <div className="thz-hero-content">
            <div className="thz-hero-status-pill">
              <span className="thz-status-dot" aria-hidden="true" />
              <span>Bengaluru Central Hub · Active Trade Fulfillment</span>
            </div>
            <h1 id="hero-title" className="thz-hero-title">
              Primary Structural Steel, Cement & Aggregates.
              <br />
              <span className="thz-hero-title-highlight">Direct From Certified Regional Hubs.</span>
            </h1>
            <p className="thz-hero-subtitle">
              Wholesale construction materials dispatched with computerized weighbridge slips,
              mill test certificates (MTC), and direct-to-jobsite tipper offloading across Bengaluru.
            </p>
            <div className="thz-hero-actions">
              <button
                type="button"
                className="thz-hero-btn-primary"
                onClick={() => navigateToPlp({})}
              >
                <span>Browse Trade Catalogue</span>
                <span aria-hidden="true">→</span>
              </button>
              <button type="button" className="thz-hero-btn-secondary" onClick={openLocationModal}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span>{pincode ? `Delivery PIN: ${pincode}` : 'Verify Delivery PIN'}</span>
              </button>
            </div>
            <div className="thz-hero-metrics">
              <div className="thz-hero-metric-item">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <span><strong>100%</strong> Mill Test Certified (MTC)</span>
              </div>
              <div className="thz-hero-metric-item">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="6" x2="12" y2="12" />
                  <line x1="12" y1="12" x2="16" y2="14" />
                </svg>
                <span><strong>Zero</strong> Weight Discrepancy</span>
              </div>
              <div className="thz-hero-metric-item">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="1" y="3" width="15" height="13" />
                  <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                  <circle cx="5.5" cy="18.5" r="2.5" />
                  <circle cx="18.5" cy="18.5" r="2.5" />
                </svg>
                <span><strong>Site Crane & Tipper</strong> Dispatch</span>
              </div>
            </div>
          </div>

          {/* Trade Hub Dispatch Staging Card */}
          <div className="thz-hero-hub-card">
            <div className="thz-hub-card-header">
              <div className="thz-hub-title">
                <span className="thz-hub-dot-indicator" aria-hidden="true" />
                <span>Bengaluru Hub Spot Index</span>
              </div>
              <span className="thz-hub-status-tag">SPOT BENCHMARK</span>
            </div>
            <div className="thz-hub-rates-list">
              <div className="thz-hub-rate-row">
                <div>
                  <span className="thz-rate-name">Tata Tiscon Fe 550D</span>
                  <span className="thz-rate-spec">Primary TMT Rebar (12mm/16mm)</span>
                </div>
                <div>
                  <span className="thz-rate-val">₹62.50</span>
                  <span className="thz-rate-unit">per kg baseline</span>
                </div>
              </div>
              <div className="thz-hub-rate-row">
                <div>
                  <span className="thz-rate-name">UltraTech Super Cement</span>
                  <span className="thz-rate-spec">OPC 53 Grade Fresh Batch</span>
                </div>
                <div>
                  <span className="thz-rate-val">₹385</span>
                  <span className="thz-rate-unit">per 50kg bag</span>
                </div>
              </div>
              <div className="thz-hub-rate-row">
                <div>
                  <span className="thz-rate-name">Supreme CPVC FlowGuard</span>
                  <span className="thz-rate-spec">SDR 11 Class 1 Heavy Duty</span>
                </div>
                <div>
                  <span className="thz-rate-val">₹420</span>
                  <span className="thz-rate-unit">per 3m pipe</span>
                </div>
              </div>
            </div>
            <div className="thz-hub-card-footer">
              <p className="thz-hub-footer-hint">
                {pincode
                  ? `Fulfillment verified for postal code ${pincode}`
                  : 'Enter jobsite PIN to lock in local inventory and wholesale tiers'}
              </p>
              <button
                type="button"
                className="thz-btn-secondary"
                onClick={openLocationModal}
                style={{ width: '100%' }}
              >
                {pincode ? `Delivery PIN: ${pincode} (Change)` : 'Verify Delivery PIN'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Quality & Commercial Trust Pillars ("The TheHomez Standard") */}
      <section className="thz-trust-section" aria-labelledby="trust-section-title">
        <div className="thz-section-header">
          <span className="thz-section-eyebrow">The TheHomez Standard</span>
          <h2 id="trust-section-title" className="thz-section-title">
            Engineered For Contractors & Professional Builders
          </h2>
          <p className="thz-section-desc">
            Contractor-grade compliance, guaranteed material traceability, and transparent wholesale pricing.
          </p>
        </div>
        <div className="thz-trust-grid">
          <div className="thz-trust-card">
            <div className="thz-trust-icon-box" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <h3 className="thz-trust-card-title">Mill Test Certificates (MTC)</h3>
            <p className="thz-trust-card-desc">
              Direct mill traceability for every structural steel heat number and cement batch.
              Chemistry and tensile test certificates provided upon dispatch.
            </p>
          </div>
          <div className="thz-trust-card">
            <div className="thz-trust-icon-box" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h3 className="thz-trust-card-title">Weighbridge Weight Slips</h3>
            <p className="thz-trust-card-desc">
              Computerized gross and tare weighbridge verification at the hub. Never pay for nominal
              or estimated weight shortages on your jobsite.
            </p>
          </div>
          <div className="thz-trust-card">
            <div className="thz-trust-icon-box" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </div>
            <h3 className="thz-trust-card-title">Wholesale Volume Tiers</h3>
            <p className="thz-trust-card-desc">
              Transparent multi-tier wholesale discounts that dynamically scale as your order
              reaches half-truckload and full-trailer commercial quantities.
            </p>
          </div>
          <div className="thz-trust-card">
            <div className="thz-trust-icon-box" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="3" width="15" height="13" />
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                <circle cx="5.5" cy="18.5" r="2.5" />
                <circle cx="18.5" cy="18.5" r="2.5" />
              </svg>
            </div>
            <h3 className="thz-trust-card-title">Dedicated Site Logistics</h3>
            <p className="thz-trust-card-desc">
              Tailored transport fleet including boom crane offloading trucks, flatbed trailers, and
              6-wheel tippers dispatched straight to your jobsite coordinate.
            </p>
          </div>
        </div>
      </section>

      {/* Category Navigation Rail */}
      <CategoryRail />

      {/* Featured Materials Ribbon */}
      <section className="thz-featured-section" aria-labelledby="featured-title">
        <div className="thz-featured-header">
          <div>
            <span className="thz-section-eyebrow">Spot Delivery Catalogue</span>
            <h2 id="featured-title" className="thz-section-title">
              Featured Building Materials
            </h2>
            <p className="thz-featured-header-subtitle">
              Standard trade catalogue items ready for dispatch from central hubs
            </p>
          </div>
          <button type="button" className="thz-link-btn" onClick={() => navigateToPlp({})}>
            View All ({featuredProducts.length}) →
          </button>
        </div>

        {/* Interactive Category Filter Tabs */}
        {!loading && !error && featuredProducts.length > 0 && (
          <div
            className="thz-filter-tabs-wrapper"
            role="tablist"
            aria-label="Filter featured materials"
          >
            <ul className="thz-filter-tabs">
              {FILTER_TABS.map((tab) => (
                <li key={tab.id}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTabId === tab.id}
                    className={`thz-filter-tab ${activeTabId === tab.id ? 'active' : ''}`}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    <span>{tab.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {loading && <LoadingSkeleton count={4} />}

        {error && <ErrorDisplay message={error} onRetry={fetchFeatured} />}

        {!loading && !error && featuredProducts.length === 0 && (
          <div className="thz-featured-empty">
            <p>
              No featured materials found in current active catalogue.
            </p>
          </div>
        )}

        {!loading && !error && featuredProducts.length > 0 && (
          <>
            {displayedProducts.length > 0 ? (
              <div className="thz-product-grid">
                {displayedProducts.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <div className="thz-featured-empty">
                <p style={{ marginBottom: '8px' }}>
                  No materials found under this quick filter in the featured collection.
                </p>
                <button
                  type="button"
                  className="thz-btn-secondary"
                  onClick={() => setActiveTabId('all')}
                >
                  Show All Featured Items
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {/* Commercial B2B Contractor Advantage Section */}
      <section className="thz-b2b-banner" aria-labelledby="b2b-section-title">
        <div className="thz-b2b-grid">
          <div>
            <span className="thz-b2b-badge">Contractor Advantage</span>
            <h2 id="b2b-section-title" className="thz-b2b-title">
              Commercial Wholesale Rates For Trade & Developers
            </h2>
            <p className="thz-b2b-desc">
              Are you an active civil contractor, structural engineer, or real estate developer?
              Unlock exclusive wholesale pricing tiers, formal GST tax invoicing, and prioritized
              dispatch schedules.
            </p>
            <div className="thz-b2b-features-grid">
              <div className="thz-b2b-feature-pill">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: '#38BDF8', flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Tier 1-3 Volume Price Discounts</span>
              </div>
              <div className="thz-b2b-feature-pill">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: '#38BDF8', flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>100% GST ITC Invoicing</span>
              </div>
              <div className="thz-b2b-feature-pill">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: '#38BDF8', flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Direct Batch Mill Reports</span>
              </div>
              <div className="thz-b2b-feature-pill">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: '#38BDF8', flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>Dedicated Dispatch Coordinator</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button type="button" className="thz-btn-primary" onClick={() => navigateToPlp({})}>
                Explore Commercial Materials
              </button>
              <button type="button" className="thz-btn-secondary" onClick={openLocationModal}>
                Check Hub Coverage
              </button>
            </div>
          </div>

          <div className="thz-b2b-simulation-box">
            <div className="thz-b2b-box-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: '#38BDF8' }}>
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              <span>Volume Tier Economics</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#cbd5e1' }}>
              Standard commercial discount structures applied automatically across trade items:
            </p>
            <div className="thz-b2b-tier-example">
              <div className="thz-b2b-tier-row">
                <span>50 – 199 units / bags</span>
                <strong>~3% – 5% Trade Discount</strong>
              </div>
              <div className="thz-b2b-tier-row">
                <span>200 – 499 units (Half Load)</span>
                <strong>~6% – 10% Contractor Margin</strong>
              </div>
              <div className="thz-b2b-tier-row">
                <span>500+ units (Full Trailer)</span>
                <strong>Direct Mill Wholesale Rate</strong>
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>
              * Discounts dynamically calculate on product detail pages when quantity thresholds are
              selected.
            </p>
          </div>
        </div>
      </section>

      {/* How TheHomez Works: 3-Step Fulfillment Flow */}
      <section className="thz-steps-section" aria-labelledby="steps-section-title">
        <div className="thz-section-header">
          <span className="thz-section-eyebrow">Direct Fulfillment Model</span>
          <h2 id="steps-section-title" className="thz-section-title">
            How TheHomez Works
          </h2>
          <p className="thz-section-desc">
            From local batch allocation to jobsite delivery in 3 streamlined steps.
          </p>
        </div>
        <div className="thz-steps-grid">
          <div className="thz-step-card">
            <div className="thz-step-badge">1</div>
            <h3 className="thz-step-card-title">Set Jobsite Location</h3>
            <p className="thz-step-card-desc">
              Enter your 6-digit postal code to load hyper-local hub inventory, available batch
              counts, and accurate delivery transit windows for your exact zone.
            </p>
          </div>
          <div className="thz-step-card">
            <div className="thz-step-badge">2</div>
            <h3 className="thz-step-card-title">Configure Specs & Volume Tiers</h3>
            <p className="thz-step-card-desc">
              Choose exact rebar diameters, cement grades, or block dimensions. Scale unit
              quantities to automatically unlock discounted wholesale price tiers.
            </p>
          </div>
          <div className="thz-step-card">
            <div className="thz-step-badge">3</div>
            <h3 className="thz-step-card-title">Direct Hub Dispatch</h3>
            <p className="thz-step-card-desc">
              Orders dispatch from our certified regional hubs with computerized weighbridge slips,
              mill test certificates, and dedicated jobsite offloading transport.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
