import React from 'react';
import type { IAuthUser } from '@thehomez/shared-types';
import type { ICustomerAuthContextContract } from './auth-ui.types.js';
import { CustomerAuthFlow } from './CustomerAuthFlow.js';
import './auth.css';

export interface CustomerLoginViewProps {
  auth?: ICustomerAuthContextContract | null;
  onSuccess?: (user: IAuthUser | null) => void;
  onBackToStorefront?: () => void;
  initialCountryCode?: string;
  initialPhone?: string;
}

/**
 * Full-page responsive Customer Login Screen (`/login` route option).
 *
 * Matches TheHomez's architectural storefront palette (dark-slate trust panel + crisp white form card).
 */
export const CustomerLoginView: React.FC<CustomerLoginViewProps> = ({
  auth,
  onSuccess,
  onBackToStorefront,
  initialCountryCode,
  initialPhone,
}) => {
  return (
    <section className="thz-auth-page" aria-labelledby="thz-customer-login-headline">
      <div className="thz-auth-page-grid">
        {/* Architectural Trust & Value Summary Column */}
        <aside className="thz-auth-page-aside" aria-label="TheHomez customer benefits">
          <div className="thz-auth-page-eyebrow">
            <span className="thz-auth-eyebrow-dot" aria-hidden="true" />
            <span>Hyperlocal Trade Materials</span>
          </div>
          <h1 id="thz-customer-login-headline" className="thz-auth-page-headline">
            Direct site delivery with verified commercial pricing.
          </h1>
          <p className="thz-auth-page-lead">
            Sign in with your mobile number to save job-site delivery PINs, sync your order cart
            across devices, and access mill-certified materials.
          </p>

          <ul className="thz-auth-trust-list">
            <li className="thz-auth-trust-item">
              <span className="thz-auth-trust-badge" aria-hidden="true">
                01
              </span>
              <div>
                <strong>Saved Site Addresses</strong>
                <span>Store multiple project PIN codes &amp; heavy-truck approach instructions.</span>
              </div>
            </li>
            <li className="thz-auth-trust-item">
              <span className="thz-auth-trust-badge" aria-hidden="true">
                02
              </span>
              <div>
                <strong>Persistent Order Cart</strong>
                <span>Automatically sync guest materials to your account after OTP sign-in.</span>
              </div>
            </li>
            <li className="thz-auth-trust-item">
              <span className="thz-auth-trust-badge" aria-hidden="true">
                03
              </span>
              <div>
                <strong>Verified Batch Compliance</strong>
                <span>Weighbridge-guaranteed quantities with Mill Test Certificates.</span>
              </div>
            </li>
          </ul>

          {onBackToStorefront ? (
            <button
              type="button"
              className="thz-auth-aside-back"
              onClick={onBackToStorefront}
            >
              ← Return to Storefront Catalogue
            </button>
          ) : null}
        </aside>

        {/* Primary Authentication Flow Card */}
        <div className="thz-auth-page-card-col">
          <CustomerAuthFlow
            auth={auth}
            onSuccess={onSuccess}
            onClose={onBackToStorefront}
            titleId="thz-customer-login-form-title"
            initialCountryCode={initialCountryCode}
            initialPhone={initialPhone}
            showBrand
          />
        </div>
      </div>
    </section>
  );
};
