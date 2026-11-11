import React, { useEffect, useRef } from 'react';
import type { IAuthUser } from '@thehomez/shared-types';
import type { ICustomerAuthContextContract } from './auth-ui.types.js';
import { useOptionalAuthContext } from './AuthUiContext.js';
import { CustomerAuthFlow } from './CustomerAuthFlow.js';
import './auth.css';

export interface CustomerAuthModalProps {
  /** Optional controlled open state; defaults to AuthContext.isAuthModalOpen when inside AuthProvider. */
  isOpen?: boolean;
  /** Optional controlled close handler; defaults to AuthContext.closeAuthModal when inside AuthProvider. */
  onClose?: () => void;
  onSuccess?: (user: IAuthUser | null) => void;
  auth?: ICustomerAuthContextContract | null;
  initialCountryCode?: string;
  initialPhone?: string;
}

/**
 * Accessible Customer Authentication Modal Dialog (`CustomerAuthModal`).
 *
 * Works both:
 * - Zero-prop connected inside `<AuthProvider>` (reads `isAuthModalOpen` / `closeAuthModal`)
 * - Controlled via explicit `isOpen` / `onClose` / `auth` props
 */
export const CustomerAuthModal: React.FC<CustomerAuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  auth,
  initialCountryCode,
  initialPhone,
}) => {
  const authContext = useOptionalAuthContext();
  const resolvedIsOpen = isOpen ?? authContext?.isAuthModalOpen ?? false;
  const resolvedOnClose = onClose ?? authContext?.closeAuthModal ?? (() => {});

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = 'thz-customer-auth-modal-title';

  useEffect(() => {
    if (!resolvedIsOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolvedOnClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current && document.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus();
      }
    };
  }, [resolvedIsOpen, resolvedOnClose]);

  if (!resolvedIsOpen) {
    return null;
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      resolvedOnClose();
    }
  };

  return (
    <div
      className="thz-auth-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={handleBackdropClick}
    >
      <div className="thz-auth-modal-shell">
        <button
          type="button"
          className="thz-auth-modal-close"
          onClick={resolvedOnClose}
          aria-label="Close sign in dialog"
        >
          <span aria-hidden="true">×</span>
        </button>

        <CustomerAuthFlow
          auth={auth}
          onSuccess={onSuccess}
          onClose={resolvedOnClose}
          titleId={titleId}
          initialCountryCode={initialCountryCode}
          initialPhone={initialPhone}
          showBrand
        />
      </div>
    </div>
  );
};
