/**
 * Customer Delivery Site Address Card Component
 *
 * Displays a single saved address with default badge, live serviceability status,
 * recipient details, street/PIN details, optional site contact & heavy-vehicle access notes,
 * and accessible action controls (Details, Edit, Set as Default, Delete).
 */

import React from 'react';
import type { ICustomerAddressDto } from '@thehomez/shared-types';

export interface AddressCardProps {
  address: ICustomerAddressDto;
  isSettingDefault: boolean;
  isDeleting: boolean;
  onViewDetails: (address: ICustomerAddressDto) => void;
  onEdit: (address: ICustomerAddressDto) => void;
  onSetDefault: (address: ICustomerAddressDto) => void;
  onDelete: (address: ICustomerAddressDto) => void;
}

export const AddressCard: React.FC<AddressCardProps> = ({
  address,
  isSettingDefault,
  isDeleting,
  onViewDetails,
  onEdit,
  onSetDefault,
  onDelete,
}) => {
  const busy = isSettingDefault || isDeleting;

  return (
    <article
      className={`thz-address-card${address.isDefault ? ' is-default' : ''}`}
      aria-label={`Saved address: ${address.label}`}
      data-testid={`address-card-${address.id}`}
    >
      <div className="thz-address-card-header">
        <div className="thz-address-card-title-row">
          <h2 className="thz-address-card-label">{address.label}</h2>
          <div className="thz-address-badges">
            {address.isDefault ? (
              <span className="thz-address-badge default">Default</span>
            ) : null}
            {address.isServiceable && address.serviceArea ? (
              <span className="thz-address-badge serviceable">
                Serviceable • {address.serviceArea.code}
              </span>
            ) : (
              <span className="thz-address-badge unserviceable">Outside delivery area</span>
            )}
          </div>
        </div>
      </div>

      <div className="thz-address-card-body">
        <p className="thz-address-recipient">
          <strong>{address.recipientName}</strong>
          <span className="thz-mono thz-address-phone">{address.phone}</span>
        </p>

        <address className="thz-address-lines">
          <span>{address.streetAddress}</span>
          {address.landmark ? (
            <span className="thz-address-landmark">Landmark: {address.landmark}</span>
          ) : null}
          <span>
            {address.city}, {address.state} —{' '}
            <strong className="thz-mono">{address.pincode}</strong>
          </span>
        </address>

        {address.serviceArea ? (
          <p className="thz-address-service-area">
            Dispatch zone: {address.serviceArea.name} ({address.serviceArea.city},{' '}
            {address.serviceArea.state})
          </p>
        ) : null}

        {address.siteContactPerson || address.heavyVehicleAccessInstructions ? (
          <div className="thz-address-site-meta">
            {address.siteContactPerson ? (
              <p className="thz-address-meta-item">
                <span className="thz-address-meta-key">Site Contact:</span>{' '}
                <span>
                  {address.siteContactPerson.name} (
                  <span className="thz-mono">{address.siteContactPerson.phone}</span>)
                </span>
              </p>
            ) : null}
            {address.heavyVehicleAccessInstructions ? (
              <p className="thz-address-meta-item">
                <span className="thz-address-meta-key">Vehicle Access:</span>{' '}
                <span>{address.heavyVehicleAccessInstructions}</span>
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="thz-address-card-actions">
        <button
          type="button"
          className="thz-btn-secondary thz-address-action-btn"
          onClick={() => onViewDetails(address)}
          disabled={busy}
          aria-label={`View details for ${address.label}`}
        >
          Details
        </button>

        <button
          type="button"
          className="thz-btn-secondary thz-address-action-btn"
          onClick={() => onEdit(address)}
          disabled={busy}
          aria-label={`Edit ${address.label}`}
        >
          Edit
        </button>

        {!address.isDefault ? (
          <button
            type="button"
            className="thz-btn-secondary thz-address-action-btn"
            onClick={() => onSetDefault(address)}
            disabled={busy}
            aria-busy={isSettingDefault}
            aria-label={`Set ${address.label} as default address`}
          >
            {isSettingDefault ? 'Setting Default…' : 'Set as Default'}
          </button>
        ) : null}

        <button
          type="button"
          className="thz-btn-secondary thz-btn-danger-outline thz-address-action-btn"
          onClick={() => onDelete(address)}
          disabled={busy}
          aria-label={`Delete ${address.label}`}
        >
          Delete
        </button>
      </div>
    </article>
  );
};
