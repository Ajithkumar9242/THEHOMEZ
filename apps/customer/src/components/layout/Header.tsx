/**
 * TheHomez Customer Navigation Header & Masthead
 *
 * Implements:
 * - Brand logo linking to Home
 * - Search bar with accessible >= 44x44px touch targets
 * - Persistent Delivery PIN indicator pill with tri-state status
 * - B2B Contractor mode switch simulator
 */

import React, { useState } from 'react';
import { useStorefront } from '../../context/StorefrontContext.js';

export const Header: React.FC = () => {
  const {
    pincode,
    serviceArea,
    isServiceable,
    openLocationModal,
    customerSegment,
    setB2BToken,
    navigateToHome,
    navigateToSearch,
    navigateToPlp,
  } = useStorefront();

  const [searchInput, setSearchInput] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [tokenInput, setTokenInput] = useState('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim().length >= 2) {
      navigateToSearch(searchInput.trim());
    }
  };

  const handleApplyB2B = () => {
    if (tokenInput.trim()) {
      setB2BToken(tokenInput.trim());
    } else {
      setB2BToken(null);
    }
    setShowAuthModal(false);
  };

  const locationPillClass =
    isServiceable === true
      ? 'thz-location-pill serviceable'
      : isServiceable === false
        ? 'thz-location-pill unserviceable'
        : 'thz-location-pill';

  const locationPillText =
    isServiceable === true && pincode && serviceArea
      ? `📍 ${pincode} — ${serviceArea.code}`
      : isServiceable === false && pincode
        ? `⚠️ ${pincode} — Unserviceable`
        : '📍 Select Delivery Location';

  return (
    <header className="thz-header" role="banner">
      {/* Top Announcement Utility Bar */}
      <div className="thz-top-announcement">
        <div className="thz-top-announcement-inner">
          <div className="thz-top-badge">
            <span className="thz-top-tag">Hub Dispatch</span>
            <span>Hyperlocal Trade Materials Delivery Across Bengaluru</span>
          </div>
          <div className="thz-top-links">
            <span className="thz-top-link-item">🏗️ Verified Batch Compliance</span>
            <span className="thz-top-link-item">⚖️ Weighbridge Guaranteed</span>
            <span className="thz-top-link-item">📜 Mill Test Certificates (MTC)</span>
          </div>
        </div>
      </div>

      <div className="thz-header-content">
        {/* Brand Logo */}
        <button
          type="button"
          className="thz-logo"
          onClick={navigateToHome}
          aria-label="TheHomez Home"
        >
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
            style={{ marginRight: '2px' }}
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span>TheHomez</span>
          <span className="thz-logo-badge">COMMERCIAL</span>
        </button>

        {/* Global Search Bar */}
        <form
          className="thz-search-form"
          onSubmit={handleSearchSubmit}
          role="search"
          aria-label="Search catalog materials"
        >
          <input
            type="search"
            className="thz-search-input"
            placeholder="Search structural steel, cement, masonry..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search materials"
          />
          <button
            type="submit"
            className="thz-search-button"
            aria-label="Submit search"
            disabled={searchInput.trim().length < 2}
          >
            Search
          </button>
        </form>

        {/* Header Actions */}
        <div className="thz-header-actions">
          {/* Location / PIN Pill */}
          <button
            type="button"
            className={locationPillClass}
            onClick={openLocationModal}
            aria-label={`Delivery location: ${locationPillText}. Click to change.`}
          >
            <span>{locationPillText}</span>
          </button>

          {/* Customer Segment / B2B Switcher */}
          <button
            type="button"
            className={`thz-segment-badge ${customerSegment === 'B2B' ? 'b2b' : ''}`}
            onClick={() => setShowAuthModal(true)}
            aria-label={`Current Segment: ${customerSegment}. Click to configure contractor credentials.`}
            title="Configure B2B Contractor mode"
          >
            <span>{customerSegment === 'B2B' ? '🏢 B2B Contractor' : '👤 Retail (B2C)'}</span>
          </button>
        </div>
      </div>

      {/* Navigation Links Bar */}
      <nav className="thz-nav-bar" aria-label="Storefront Navigation">
        <ul className="thz-nav-list">
          <li>
            <button
              type="button"
              className="thz-nav-item"
              onClick={navigateToHome}
              aria-label="Navigate to Home"
            >
              Home
            </button>
          </li>
          <li>
            <button
              type="button"
              className="thz-nav-item"
              onClick={() => navigateToPlp({})}
              aria-label="Browse All Materials"
            >
              All Materials
            </button>
          </li>
          <li>
            <button
              type="button"
              className="thz-nav-item"
              onClick={() => navigateToPlp({ inStockOnly: true })}
              disabled={isServiceable !== true}
              aria-label="Browse In-Stock Materials"
              title={
                isServiceable !== true
                  ? 'Enter a serviceable delivery PIN to filter by in-stock'
                  : 'In-stock materials in your area'
              }
            >
              In-Stock in My Area
            </button>
          </li>
        </ul>
      </nav>

      {/* Auth / Segment Modal Simulation */}
      {showAuthModal && (
        <div className="thz-modal-backdrop" role="dialog" aria-modal="true">
          <div className="thz-modal-box">
            <div className="thz-modal-header">
              <h2 className="thz-modal-title">Commercial Segment Simulator</h2>
              <button
                type="button"
                className="thz-close-btn"
                onClick={() => setShowAuthModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <p
              style={{
                fontSize: '0.9rem',
                color: 'var(--thz-text-secondary)',
                marginBottom: '16px',
              }}
            >
              The storefront dynamically presents wholesale prices and volume discount tiers to
              verified commercial contractors with active B2B credentials.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label
                htmlFor="b2b-token-input"
                style={{
                  display: 'block',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  marginBottom: '6px',
                }}
              >
                Contractor Bearer Token (Optional JWT):
              </label>
              <input
                id="b2b-token-input"
                type="text"
                className="thz-search-input"
                style={{ width: '100%', borderRadius: '6px' }}
                placeholder="Paste contractor JWT or leave blank for guest B2C"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="thz-btn-secondary"
                onClick={() => {
                  setTokenInput('');
                  setB2BToken(null);
                  setShowAuthModal(false);
                }}
              >
                Reset to Retail B2C
              </button>
              <button type="button" className="thz-btn-primary" onClick={handleApplyB2B}>
                Apply Credentials
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
