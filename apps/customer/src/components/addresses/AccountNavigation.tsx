/**
 * Shared Account Section Navigation Bar
 *
 * Connects `/account` (Account Overview) and `/account/addresses` (Saved Addresses)
 * inside the authenticated Customer App.
 */

import React from 'react';
import { useStorefront } from '../../context/StorefrontContext.js';

export interface AccountNavigationProps {
  activeTab: 'overview' | 'addresses';
}

export const AccountNavigation: React.FC<AccountNavigationProps> = ({ activeTab }) => {
  const { navigateToAccount, navigateToAddresses } = useStorefront();

  return (
    <nav className="thz-account-nav" aria-label="Account navigation">
      <button
        type="button"
        className={`thz-account-nav-tab${activeTab === 'overview' ? ' active' : ''}`}
        onClick={navigateToAccount}
        aria-current={activeTab === 'overview' ? 'page' : undefined}
      >
        Account Overview
      </button>
      <button
        type="button"
        className={`thz-account-nav-tab${activeTab === 'addresses' ? ' active' : ''}`}
        onClick={navigateToAddresses}
        aria-current={activeTab === 'addresses' ? 'page' : undefined}
      >
        Saved Addresses
      </button>
    </nav>
  );
};
