/**
 * Accessible Clear Cart Confirmation Dialog
 *
 * Requires explicit customer confirmation before clearing all line items
 * via `POST /api/v1/cart/clear`, prevents duplicate submissions, and
 * manages focus & Escape key handling cleanly.
 */

import React, { useEffect, useRef } from 'react';

export interface ClearCartDialogProps {
  isOpen: boolean;
  itemCount: number;
  isClearing: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ClearCartDialog: React.FC<ClearCartDialogProps> = ({
  isOpen,
  itemCount,
  isClearing,
  error,
  onConfirm,
  onCancel,
}) => {
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const isClearingRef = useRef(isClearing);

  onCancelRef.current = onCancel;
  isClearingRef.current = isClearing;

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isClearingRef.current) {
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
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isClearing) {
      onCancel();
    }
  };

  return (
    <div
      className="thz-modal-backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="thz-clear-cart-title"
      aria-describedby="thz-clear-cart-desc"
      onClick={handleBackdropClick}
    >
      <div className="thz-modal-box">
        <div className="thz-modal-header">
          <h2 id="thz-clear-cart-title" className="thz-modal-title">
            Clear All Cart Items?
          </h2>
          <button
            type="button"
            className="thz-close-btn"
            onClick={onCancel}
            disabled={isClearing}
            aria-label="Close clear cart dialog"
          >
            ×
          </button>
        </div>

        <div id="thz-clear-cart-desc" className="thz-delete-dialog-body">
          <p>
            Are you sure you want to remove all{' '}
            <strong>
              {itemCount} {itemCount === 1 ? 'item' : 'items'}
            </strong>{' '}
            from your cart?
          </p>
          <p className="thz-delete-dialog-warning">
            Your active delivery PIN localization will be preserved, and you can re-add materials
            from the catalog at any time.
          </p>
        </div>

        {error ? (
          <div className="thz-auth-error" role="alert">
            {error}
          </div>
        ) : null}

        <div className="thz-modal-actions">
          <button
            ref={cancelBtnRef}
            type="button"
            className="thz-btn-secondary"
            onClick={onCancel}
            disabled={isClearing}
          >
            Keep Items
          </button>
          <button
            type="button"
            className="thz-btn-danger-solid"
            onClick={onConfirm}
            disabled={isClearing}
            aria-busy={isClearing}
          >
            {isClearing ? 'Clearing Cart…' : 'Clear Cart'}
          </button>
        </div>
      </div>
    </div>
  );
};
