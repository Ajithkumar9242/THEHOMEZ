import React from 'react';

export interface TheHomezBrandMarkProps {
  badgeText?: string;
}

/**
 * TheHomez architectural brand mark matching the storefront header masthead.
 */
export const TheHomezBrandMark: React.FC<TheHomezBrandMarkProps> = ({
  badgeText = 'CUSTOMER',
}) => {
  return (
    <div className="thz-auth-brand">
      <div className="thz-auth-brand-mark" aria-hidden="true">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </div>
      <span className="thz-auth-brand-name">TheHomez</span>
      {badgeText ? <span className="thz-auth-brand-badge">{badgeText}</span> : null}
    </div>
  );
};
