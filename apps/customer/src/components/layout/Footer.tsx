/**
 * TheHomez Marketplace Structural Footer
 * Multi-column trade navigation, hub compliance, and accessibility standards
 */

import React from 'react';
import { useStorefront } from '../../context/StorefrontContext.js';

export const Footer: React.FC = () => {
  const { navigateToHome, navigateToPlp, navigateToCategory, openLocationModal } = useStorefront();

  return (
    <footer className="thz-footer" role="contentinfo">
      <div className="thz-footer-grid">
        {/* Brand & Hub Info */}
        <div className="thz-footer-col">
          <div className="thz-footer-brand-title">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            <span>TheHomez</span>
          </div>
          <p className="thz-footer-brand-desc">
            Direct-from-hub construction materials marketplace. Supplying primary steel, certified
            cement, masonry, plumbing, and electrical materials across Bengaluru with weighbridge
            guarantee.
          </p>
          <div className="thz-footer-hub-badge">
            <span style={{ color: '#22c55e' }}>●</span>
            <span>Bengaluru Central Fulfillment Hub • Active Dispatch</span>
          </div>
        </div>

        {/* Divisions & Materials */}
        <div className="thz-footer-col">
          <h3 className="thz-footer-heading">Material Divisions</h3>
          <ul className="thz-footer-links-list">
            <li>
              <button
                type="button"
                className="thz-footer-link-btn"
                onClick={() => navigateToCategory('structural-steel')}
              >
                Structural Steel & TMT Rebars
              </button>
            </li>
            <li>
              <button
                type="button"
                className="thz-footer-link-btn"
                onClick={() => navigateToCategory('cement-concrete')}
              >
                Cement & Ready-Mix
              </button>
            </li>
            <li>
              <button
                type="button"
                className="thz-footer-link-btn"
                onClick={() => navigateToCategory('plumbing-sanitary')}
              >
                Plumbing & Drainage
              </button>
            </li>
            <li>
              <button
                type="button"
                className="thz-footer-link-btn"
                onClick={() => navigateToCategory('electrical')}
              >
                Electrical & Wiring
              </button>
            </li>
            <li>
              <button
                type="button"
                className="thz-footer-link-btn"
                onClick={() => navigateToPlp({})}
              >
                Full Material Catalogue →
              </button>
            </li>
          </ul>
        </div>

        {/* Contractor Trade Services */}
        <div className="thz-footer-col">
          <h3 className="thz-footer-heading">Commercial Trade</h3>
          <ul className="thz-footer-links-list">
            <li>
              <button
                type="button"
                className="thz-footer-link-btn"
                onClick={() => navigateToPlp({})}
              >
                Wholesale Volume Pricing
              </button>
            </li>
            <li>
              <button type="button" className="thz-footer-link-btn" onClick={openLocationModal}>
                Check Hub Serviceability
              </button>
            </li>
            <li>
              <span className="thz-footer-link-btn" style={{ cursor: 'default' }}>
                GST Input Tax Credit (ITC)
              </span>
            </li>
            <li>
              <span className="thz-footer-link-btn" style={{ cursor: 'default' }}>
                Mill Test Certificates (MTC)
              </span>
            </li>
            <li>
              <span className="thz-footer-link-btn" style={{ cursor: 'default' }}>
                Jobsite Tipper Logistics
              </span>
            </li>
          </ul>
        </div>

        {/* Quality Standards & Governance */}
        <div className="thz-footer-col">
          <h3 className="thz-footer-heading">Standards & Quality</h3>
          <ul className="thz-footer-links-list">
            <li>
              <span className="thz-footer-link-btn" style={{ cursor: 'default' }}>
                IS 1786: Fe 550D Rebars
              </span>
            </li>
            <li>
              <span className="thz-footer-link-btn" style={{ cursor: 'default' }}>
                IS 12269: OPC 53 Cement
              </span>
            </li>
            <li>
              <span className="thz-footer-link-btn" style={{ cursor: 'default' }}>
                IS 2185: AAC Blocks
              </span>
            </li>
            <li>
              <span className="thz-footer-link-btn" style={{ cursor: 'default' }}>
                Zero Weight Discrepancy
              </span>
            </li>
            <li>
              <button type="button" className="thz-footer-link-btn" onClick={navigateToHome}>
                Storefront Home
              </button>
            </li>
          </ul>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="thz-footer-bottom-row">
        <div>
          <strong>
            © {new Date().getFullYear()} TheHomez Commercial Marketplace. All rights reserved.
          </strong>
          <p style={{ marginTop: '4px', color: '#64748b' }}>
            Bengaluru Regional Fulfillment & Logistics Network • Central Hub
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <span className="thz-compliance-pill">✓ BIS Certified Suppliers</span>
          <span className="thz-compliance-pill">✓ GST Invoiced</span>
          <span className="thz-compliance-pill">✓ WCAG 2.1 AA Accessible</span>
        </div>
      </div>
    </footer>
  );
};
