/**
 * TheHomez Customer Account & Session View (`/account`)
 *
 * Protected customer-only route guarded by `<ProtectedRoute>`.
 * Displays verified session details from GET /api/v1/auth/me, active storefront
 * delivery location context, and real session revocation controls (Sign Out / Sign Out All Devices).
 */

import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.js';
import { useStorefront } from '../context/StorefrontContext.js';

function formatTimestamp(value?: Date | string): string {
  if (!value) {
    return 'Current session';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export const CustomerAccountView: React.FC = () => {
  const {
    user,
    isLoading,
    authError,
    refreshProfile,
    logout,
    logoutAll,
    clearError,
  } = useAuth();
  const {
    pincode,
    serviceArea,
    isServiceable,
    customerSegment,
    openLocationModal,
    navigateToHome,
    navigateToPlp,
  } = useStorefront();

  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isRefreshingProfile, setIsRefreshingProfile] = useState<boolean>(false);

  const handleRefreshProfile = async () => {
    setActionMessage(null);
    setActionError(null);
    clearError();
    setIsRefreshingProfile(true);
    try {
      const updated = await refreshProfile();
      if (updated) {
        setActionMessage('Account profile synced with server.');
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Unable to refresh account profile right now.',
      );
    } finally {
      setIsRefreshingProfile(false);
    }
  };

  const handleLogout = async () => {
    setActionMessage(null);
    setActionError(null);
    await logout();
  };

  const handleLogoutAll = async () => {
    setActionMessage(null);
    setActionError(null);
    try {
      await logoutAll();
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : 'Unable to sign out of all devices right now. Please try again.',
      );
    }
  };

  const displayedError = actionError ?? authError?.message ?? null;

  return (
    <section className="thz-account-section" aria-labelledby="thz-account-heading">
      <nav className="thz-breadcrumb-nav" aria-label="Breadcrumb">
        <button type="button" className="thz-breadcrumb-btn" onClick={navigateToHome}>
          Home
        </button>
        <span aria-hidden="true">/</span>
        <span style={{ color: 'var(--thz-text-primary)', fontWeight: 600 }}>My Account</span>
      </nav>

      <div className="thz-account-header">
        <div>
          <span className="thz-account-eyebrow">Verified Customer Session</span>
          <h1 id="thz-account-heading" className="thz-account-title">
            Customer Account
          </h1>
          <p className="thz-account-subtitle">
            Manage your authenticated session, account status, and delivery site localization.
          </p>
        </div>

        <div className="thz-account-header-actions">
          <button
            type="button"
            className="thz-btn-secondary"
            onClick={() => navigateToPlp({})}
          >
            Browse Catalogue
          </button>
          <button
            type="button"
            className="thz-btn-primary"
            onClick={() => {
              void handleLogout();
            }}
            disabled={isLoading}
          >
            {isLoading ? 'Signing out…' : 'Sign Out'}
          </button>
        </div>
      </div>

      {displayedError ? (
        <div className="thz-notice-banner error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <div style={{ flex: 1 }}>
            <strong>Session Notice</strong>
            <p style={{ fontSize: '0.875rem', marginTop: '2px' }}>{displayedError}</p>
          </div>
          <button
            type="button"
            className="thz-btn-secondary"
            onClick={() => {
              setActionError(null);
              clearError();
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {actionMessage ? (
        <div className="thz-notice-banner success" role="status" aria-live="polite">
          <span aria-hidden="true">✓</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>{actionMessage}</p>
          </div>
        </div>
      ) : null}

      <div className="thz-account-grid">
        <div className="thz-account-card">
          <div className="thz-account-card-header">
            <h2 className="thz-account-card-title">Identity &amp; Session</h2>
            <span className="thz-account-status-pill">{user?.status ?? 'ACTIVE'}</span>
          </div>

          <dl className="thz-account-dl">
            <div className="thz-account-dl-row">
              <dt>Mobile Number</dt>
              <dd className="thz-mono">{user?.phone ?? '—'}</dd>
            </div>
            <div className="thz-account-dl-row">
              <dt>Account Type</dt>
              <dd>{user?.userType ?? 'CUSTOMER'}</dd>
            </div>
            <div className="thz-account-dl-row">
              <dt>Pricing Segment</dt>
              <dd>{customerSegment === 'B2B' ? 'Verified B2B Contractor' : 'Retail (B2C)'}</dd>
            </div>
            <div className="thz-account-dl-row">
              <dt>Account ID</dt>
              <dd className="thz-mono">{user?.id ?? '—'}</dd>
            </div>
            <div className="thz-account-dl-row">
              <dt>Last Sign-In</dt>
              <dd>{formatTimestamp(user?.lastLoginAt)}</dd>
            </div>
            <div className="thz-account-dl-row">
              <dt>Member Since</dt>
              <dd>{formatTimestamp(user?.createdAt)}</dd>
            </div>
          </dl>

          <div className="thz-account-card-actions">
            <button
              type="button"
              className="thz-btn-secondary"
              onClick={() => {
                void handleRefreshProfile();
              }}
              disabled={isRefreshingProfile || isLoading}
            >
              {isRefreshingProfile ? 'Syncing…' : 'Refresh Profile'}
            </button>
            <button
              type="button"
              className="thz-btn-secondary thz-btn-danger-outline"
              onClick={() => {
                void handleLogoutAll();
              }}
              disabled={isLoading}
            >
              Sign Out All Devices
            </button>
          </div>
        </div>

        <div className="thz-account-card">
          <div className="thz-account-card-header">
            <h2 className="thz-account-card-title">Delivery Localization</h2>
            <span className="thz-account-segment-pill">
              {isServiceable === true
                ? 'Serviceable'
                : isServiceable === false
                  ? 'Unserviceable'
                  : 'Not Set'}
            </span>
          </div>

          <dl className="thz-account-dl">
            <div className="thz-account-dl-row">
              <dt>Active PIN Code</dt>
              <dd className="thz-mono">{pincode ?? 'Not selected'}</dd>
            </div>
            <div className="thz-account-dl-row">
              <dt>Dispatch Hub</dt>
              <dd>
                {isServiceable === true && serviceArea
                  ? `${serviceArea.name} (${serviceArea.code})`
                  : isServiceable === false
                    ? 'Outside active delivery zone (view-only mode)'
                    : 'Select a PIN to check live hub availability'}
              </dd>
            </div>
          </dl>

          <div className="thz-account-card-actions">
            <button type="button" className="thz-btn-secondary" onClick={openLocationModal}>
              {pincode ? 'Change Delivery PIN' : 'Select Delivery PIN'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
