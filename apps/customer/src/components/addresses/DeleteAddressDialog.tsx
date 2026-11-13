/**
 * Accessible Delete Address Confirmation Dialog
 *
 * Requires explicit customer confirmation before deleting a saved address,
 * explains automatic default promotion when deleting the default address,
 * prevents duplicate submissions while deleting, and surfaces API errors.
 */

import React, { useEffect, useRef } from 'react';
import type { ICustomerAddressDto } from '@thehomez/shared-types';

export interface DeleteAddressDialogProps {
  address: ICustomerAddressDto | null;
  hasOtherAddresses: boolean;
  isDeleting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const DeleteAddressDialog: React.FC<DeleteAddressDialogProps> = ({
  address,
  hasOtherAddresses,
  isDeleting,
  error,
  onConfirm,
  onCancel,
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const isDeletingRef = useRef(isDeleting);

  onCancelRef.current = onCancel;
  isDeletingRef.current = isDeleting;

  const isDialogOpen = Boolean(address);

  useEffect(() => {
    if (!isDialogOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeletingRef.current) {
        e.preventDefault();
        onCancelRef.current();
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
    if (e.target === e.currentTarget && !isDeleting) {
      onCancel();
    }
  };

  return (
    <div
      className="thz-modal-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="thz-delete-address-title"
      aria-describedby="thz-delete-address-desc"
      onClick={handleBackdropClick}
    >
      <div className="thz-modal-box">
        <div className="thz-modal-header">
          <h2 id="thz-delete-address-title" className="thz-modal-title">
            Delete Saved Address?
          </h2>
          <button
            type="button"
            className="thz-close-btn"
            onClick={onCancel}
            disabled={isDeleting}
            aria-label="Close confirmation dialog"
          >
            ×
          </button>
        </div>

        <div id="thz-delete-address-desc" className="thz-delete-dialog-body">
          <p>
            Are you sure you want to delete <strong>{address.label}</strong>?
          </p>
          <p className="thz-delete-dialog-preview">
            {address.recipientName} • {address.streetAddress}, {address.city}, {address.state}{' '}
            <span className="thz-mono">{address.pincode}</span>
          </p>
          {address.isDefault && hasOtherAddresses ? (
            <div className="thz-notice-banner info" role="note">
              <span aria-hidden="true">ℹ️</span>
              <span>
                This is your current default address. Another saved address will automatically be
                promoted to default.
              </span>
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="thz-notice-banner error" role="alert" style={{ marginTop: '12px' }}>
            <span aria-hidden="true">⚠️</span>
            <span>{error}</span>
          </div>
        ) : null}

        <div className="thz-address-modal-footer">
          <button
            ref={cancelBtnRef}
            type="button"
            className="thz-btn-secondary"
            onClick={onCancel}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="thz-btn-danger"
            onClick={onConfirm}
            disabled={isDeleting}
            aria-busy={isDeleting}
          >
            {isDeleting ? 'Deleting…' : 'Delete Address'}
          </button>
        </div>
      </div>
    </div>
  );
};
