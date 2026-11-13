/**
 * Customer Delivery Address Details Modal
 *
 * Displays complete structured details for a saved delivery site address,
 * including live serviceability coverage, optional site contact, vehicle access
 * instructions, timestamps, and quick management actions.
 */

import React, { useEffect, useRef } from 'react';
import type { ICustomerAddressDto } from '@thehomez/shared-types';
import { formatAddressTimestamp } from './address-form.utils.js';

export interface AddressDetailsModalProps {
  address: ICustomerAddressDto | null;
  isSettingDefault: boolean;
  onClose: () => void;
  onEdit: (address: ICustomerAddressDto) => void;
  onSetDefault: (address: ICustomerAddressDto) => void;
  onDelete: (address: ICustomerAddressDto) => void;
}

export const AddressDetailsModal: React.FC<AddressDetailsModalProps> = ({
  address,
  isSettingDefault,
  onClose,
  onEdit,
  onSetDefault,
  onDelete,
}) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const isDialogOpen = Boolean(address);

  useEffect(() => {
    if (!isDialogOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current && document.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus();
      }
    };
  }, [isDialogOpen]);

  if (!address) {
    return null;
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="thz-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="thz-address-details-title"
      onClick={handleBackdropClick}
    >
      <div className="thz-modal-box thz-address-modal-box">
        <div className="thz-modal-header">
          <div>
            <h2 id="thz-address-details-title" className="thz-modal-title">
              {address.label}
            </h2>
            <div className="thz-address-badges" style={{ marginTop: '6px' }}>
              {address.isDefault ? (
                <span className="thz-address-badge default">Default Address</span>
              ) : null}
              {address.isServiceable && address.serviceArea ? (
                <span className="thz-address-badge serviceable">
                  Serviceable • {address.serviceArea.name} ({address.serviceArea.code})
                </span>
              ) : (
                <span className="thz-address-badge unserviceable">
                  Outside current delivery area
                </span>
              )}
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            className="thz-close-btn"
            onClick={onClose}
            aria-label="Close address details"
          >
            ×
          </button>
        </div>

        <dl className="thz-account-dl thz-address-details-dl">
          <div className="thz-account-dl-row">
            <dt>Recipient Name</dt>
            <dd>{address.recipientName}</dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>Phone Number</dt>
            <dd className="thz-mono">{address.phone}</dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>Street / Plot Address</dt>
            <dd>{address.streetAddress}</dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>Landmark</dt>
            <dd>{address.landmark || 'Not provided'}</dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>City</dt>
            <dd>{address.city}</dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>State</dt>
            <dd>{address.state}</dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>PIN Code</dt>
            <dd className="thz-mono">{address.pincode}</dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>Service Area</dt>
            <dd>
              {address.isServiceable && address.serviceArea
                ? `${address.serviceArea.name} (${address.serviceArea.code}) — ${address.serviceArea.city}, ${address.serviceArea.state}`
                : 'Not covered by an active service area'}
            </dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>Site Contact Person</dt>
            <dd>
              {address.siteContactPerson ? (
                <>
                  {address.siteContactPerson.name} (
                  <span className="thz-mono">{address.siteContactPerson.phone}</span>)
                </>
              ) : (
                'Not provided'
              )}
            </dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>Heavy Vehicle Access</dt>
            <dd>{address.heavyVehicleAccessInstructions || 'None provided'}</dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>Created</dt>
            <dd>{formatAddressTimestamp(address.createdAt)}</dd>
          </div>
          <div className="thz-account-dl-row">
            <dt>Last Updated</dt>
            <dd>{formatAddressTimestamp(address.updatedAt)}</dd>
          </div>
        </dl>

        <div className="thz-address-modal-footer">
          <button
            type="button"
            className="thz-btn-primary"
            onClick={() => onEdit(address)}
            disabled={isSettingDefault}
          >
            Edit Address
          </button>

          {!address.isDefault ? (
            <button
              type="button"
              className="thz-btn-secondary"
              onClick={() => onSetDefault(address)}
              disabled={isSettingDefault}
              aria-busy={isSettingDefault}
            >
              {isSettingDefault ? 'Setting Default…' : 'Set as Default'}
            </button>
          ) : null}

          <button
            type="button"
            className="thz-btn-secondary thz-btn-danger-outline"
            onClick={() => onDelete(address)}
            disabled={isSettingDefault}
          >
            Delete
          </button>

          <button type="button" className="thz-btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
