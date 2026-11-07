/**
 * TheHomez Delivery PIN Selector & Service Area Eligibility Modal
 *
 * Implements:
 * - 6-digit Indian Postal PIN Code validation (/^[1-9][0-9]{5}$/)
 * - Serviceability lookup via GET /api/v1/service-areas/check
 * - Decision #50 / AC-DISCOV-25 Unserviceable View-Only Mode
 * - Strict exclusion of waitlist forms and customer data collection
 */

import React, { useState } from 'react';
import { useStorefront, type ServiceAreaSummary } from '../../context/StorefrontContext.js';
import { PINCODE_REGEX } from '@thehomez/shared-types';

export const LocationModal: React.FC = () => {
  const {
    pincode: currentPincode,
    isLocationModalOpen,
    closeLocationModal,
    setPincodeResult,
    clearPincode,
    apiClient,
  } = useStorefront();

  const [pinInput, setPinInput] = useState(currentPincode || '');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    checked: boolean;
    serviceable: boolean;
    pincode: string;
    serviceArea?: ServiceAreaSummary;
  } | null>(null);

  if (!isLocationModalOpen) {
    return null;
  }

  const handleCheck = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = pinInput.trim();

    if (!PINCODE_REGEX.test(trimmed)) {
      setErrorMsg('Please enter a valid 6-digit Indian postal PIN code (e.g. 560037)');
      setCheckResult(null);
      return;
    }

    setErrorMsg(null);
    setLoading(true);

    try {
      const response = await apiClient.checkPincode(trimmed);
      setCheckResult({
        checked: true,
        serviceable: response.serviceable,
        pincode: response.pincode,
        serviceArea: response.serviceArea,
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to check delivery location availability',
      );
      setCheckResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmServiceable = () => {
    if (checkResult && checkResult.serviceable && checkResult.serviceArea) {
      setPincodeResult(checkResult.pincode, true, checkResult.serviceArea);
      closeLocationModal();
    }
  };

  const handleConfirmUnserviceable = () => {
    if (checkResult && !checkResult.serviceable) {
      setPincodeResult(checkResult.pincode, false);
      closeLocationModal();
    }
  };

  const handleClearLocation = () => {
    clearPincode();
    setPinInput('');
    setCheckResult(null);
    closeLocationModal();
  };

  return (
    <div
      className="thz-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-modal-title"
    >
      <div className="thz-modal-box">
        <div className="thz-modal-header">
          <h2 id="location-modal-title" className="thz-modal-title">
            Select Delivery Location
          </h2>
          <button
            type="button"
            className="thz-close-btn"
            onClick={closeLocationModal}
            aria-label="Close location selector"
          >
            ×
          </button>
        </div>

        <p style={{ fontSize: '0.9rem', color: 'var(--thz-text-secondary)', marginBottom: '16px' }}>
          Enter your site PIN code to view accurate local inventory, lead times, and regional
          pricing.
        </p>

        {/* PIN Entry Form */}
        <form onSubmit={handleCheck} style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              maxLength={6}
              className="thz-search-input"
              style={{
                borderRadius: '6px',
                textAlign: 'center',
                fontSize: '1.1rem',
                letterSpacing: '0.1em',
              }}
              placeholder="e.g. 560037"
              value={pinInput}
              onChange={(e) => {
                setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                setCheckResult(null);
                setErrorMsg(null);
              }}
              aria-label="6-digit postal PIN code"
              autoFocus
            />
            <button
              type="submit"
              className="thz-btn-primary"
              disabled={loading || pinInput.length !== 6}
              style={{ minWidth: '120px' }}
            >
              {loading ? 'Checking...' : 'Check'}
            </button>
          </div>
        </form>

        {/* Validation Error */}
        {errorMsg && (
          <div className="thz-notice-banner warning" role="alert" style={{ marginBottom: '16px' }}>
            <span>⚠️</span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Serviceable State */}
        {checkResult && checkResult.serviceable && checkResult.serviceArea && (
          <div style={{ marginBottom: '16px' }}>
            <div
              className="thz-notice-banner"
              style={{
                backgroundColor: 'var(--thz-success-bg)',
                borderColor: 'var(--thz-success-border)',
                color: 'var(--thz-success-text)',
              }}
            >
              <span>🟢</span>
              <div>
                <strong>Delivery Available</strong>
                <p style={{ fontSize: '0.85rem', marginTop: '2px' }}>
                  Covered by {checkResult.serviceArea.name} ({checkResult.serviceArea.city},{' '}
                  {checkResult.serviceArea.state})
                </p>
              </div>
            </div>
            <button
              type="button"
              className="thz-btn-primary"
              style={{ width: '100%' }}
              onClick={handleConfirmServiceable}
            >
              Set Location to {checkResult.pincode}
            </button>
          </div>
        )}

        {/* Unserviceable State (Decision #50 / AC-DISCOV-25) */}
        {checkResult && !checkResult.serviceable && (
          <div style={{ marginBottom: '16px' }}>
            <div className="thz-notice-banner warning" role="status">
              <span>⚠️</span>
              <div>
                <strong>Delivery not available in this area</strong>
                <p style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                  We do not deliver to postal code {checkResult.pincode} yet. You can still browse
                  materials in view-only mode.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                className="thz-btn-primary"
                onClick={handleConfirmUnserviceable}
              >
                Browse Catalogue in View-Only Mode
              </button>
              <button
                type="button"
                className="thz-btn-secondary"
                onClick={() => {
                  setPinInput('');
                  setCheckResult(null);
                }}
              >
                Enter Another PIN
              </button>
            </div>
          </div>
        )}

        {/* Clear Location Action */}
        <div
          style={{
            borderTop: '1px solid var(--thz-border-subtle)',
            paddingTop: '12px',
            textAlign: 'center',
          }}
        >
          <button
            type="button"
            className="thz-btn-secondary"
            style={{ width: '100%', fontSize: '0.85rem' }}
            onClick={handleClearLocation}
          >
            Clear Location (Browse Unlocalized)
          </button>
        </div>
      </div>
    </div>
  );
};
