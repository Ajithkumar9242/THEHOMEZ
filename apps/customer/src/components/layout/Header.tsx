/**
 * TheHomez Customer Navigation Header & Masthead
 *
 * Implements:
 * - Brand logo linking to Home
 * - Search bar with accessible >= 44x44px touch targets
 * - Persistent Delivery PIN indicator pill with tri-state status
 * - Customer OTP Authentication actions (Sign In / Account / Sign Out)
 */

import React, { useState } from 'react';
import { useStorefront } from '../../context/StorefrontContext.js';
import { useOptionalCart } from '../../context/CartContext.js';
import { useOptionalAuthContext } from '../auth/AuthUiContext.js';
import { formatDisplayPhone } from '../auth/auth-utils.js';

export const Header: React.FC = () => {
  const {
    pincode,
    serviceArea,
    isServiceable,
    openLocationModal,
    customerSegment,
    navigateToHome,
    navigateToSearch,
    navigateToPlp,
    navigateToAccount,
    navigateToAddresses,
    navigateToCart,
    currentView,
  } = useStorefront();

  const auth = useOptionalAuthContext();
  const cartCtx = useOptionalCart();
  const cartItemCount = auth?.isAuthenticated && cartCtx?.cart ? cartCtx.cart.totalItemCount : null;

  const [searchInput, setSearchInput] = useState('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim().length >= 2) {
      navigateToSearch(searchInput.trim());
    }
  };

  const handleSignInClick = () => {
    auth?.clearError();
    auth?.openAuthModal();
  };

  const handleLogoutClick = () => {
    if (!auth) return;
    void auth.logout();
  };

  const locationPillClass =
    isServiceable === true
      ? 'thz-location-pill serviceable'
      : isServiceable === false
        ? 'thz-location-pill unserviceable'
        : 'thz-location-pill';

  const locationPillText =
    isServiceable === true && pincode && serviceArea
      ? `${pincode} — ${serviceArea.code}`
      : isServiceable === false && pincode
        ? `${pincode} — Unserviceable`
        : 'Select Delivery PIN';

  const formattedUserPhone = auth?.user?.phone
    ? formatDisplayPhone(auth.user.phone, auth.user.phone.startsWith('+91') ? '+91' : '')
    : '';

  return (
    <header className="thz-header" role="banner">
      {/* Top Announcement Utility Bar */}
      <div className="thz-top-announcement">
        <div className="thz-top-announcement-inner">
          <div className="thz-top-badge">
            <span className="thz-top-tag">TRADE DISPATCH</span>
            <span>Hyperlocal Trade Materials Delivery Across Bengaluru</span>
          </div>
          <div className="thz-top-links">
            <span className="thz-top-link-item">Weighbridge Slips Guaranteed</span>
            <span className="thz-top-divider" aria-hidden="true">·</span>
            <span className="thz-top-link-item">Mill Test Certificates (MTC)</span>
            <span className="thz-top-divider" aria-hidden="true">·</span>
            <span className="thz-top-link-item">Direct Jobsite Offloading</span>
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
            width="24"
            height="24"
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
          <span className="thz-logo-badge">TRADE HUB</span>
        </button>

        {/* Global Search Bar */}
        <form
          className="thz-search-form"
          onSubmit={handleSearchSubmit}
          role="search"
          aria-label="Search catalog materials"
        >
          <span className="thz-search-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <span>{locationPillText}</span>
          </button>

          {/* Shopping Cart Entry */}
          <button
            type="button"
            className="thz-cart-header-btn"
            onClick={navigateToCart}
            aria-label={
              cartItemCount !== null
                ? `Shopping Cart (${cartItemCount} ${cartItemCount === 1 ? 'item' : 'items'})`
                : 'Shopping Cart'
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            <span>Cart</span>
            {cartItemCount !== null && cartItemCount > 0 ? (
              <span className="thz-cart-count-badge">{cartItemCount}</span>
            ) : null}
          </button>

          {/* Customer Authentication Controls */}
          {auth?.isAuthenticated && auth.user ? (
            <div className="thz-auth-header-group" role="group" aria-label="Customer account">
              {customerSegment === 'B2B' ? (
                <span className="thz-segment-badge b2b" title="Verified B2B Contractor pricing">
                  🏢 B2B
                </span>
              ) : null}
              <button
                type="button"
                className="thz-account-pill"
                onClick={navigateToAccount}
                aria-label={`My Account (${formattedUserPhone})`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                <span>{formattedUserPhone}</span>
              </button>
              <button
                type="button"
                className="thz-account-pill"
                onClick={navigateToAddresses}
                aria-label="Saved Delivery Addresses"
              >
                <span>Addresses</span>
              </button>
              <button
                type="button"
                className="thz-logout-btn"
                onClick={handleLogoutClick}
                disabled={auth.isLoading}
                aria-label="Sign out"
              >
                {auth.isLoading ? 'Signing out…' : 'Sign Out'}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="thz-auth-signin-btn"
              onClick={handleSignInClick}
              aria-label="Sign in with phone OTP"
              aria-busy={auth?.isInitializing ?? false}
            >
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Links Bar */}
      <nav className="thz-nav-bar" aria-label="Storefront Navigation">
        <ul className="thz-nav-list">
          <li>
            <button
              type="button"
              className={`thz-nav-item ${currentView === 'home' ? 'active' : ''}`}
              onClick={navigateToHome}
              aria-label="Navigate to Home"
            >
              Home
            </button>
          </li>
          <li>
            <button
              type="button"
              className={`thz-nav-item ${currentView === 'plp' ? 'active' : ''}`}
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
    </header>
  );
};
