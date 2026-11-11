/**
 * TheHomez Customer Storefront Root Application Component
 *
 * Coordinates:
 * - AuthProvider (in-memory JWT access tokens & HTTP-only refresh cookie lifecycle)
 * - Reactive StorefrontProvider context wired to AuthContext
 * - Sticky navigation header & masthead
 * - Dynamic view routing (Home, PLP / Search, PDP, Login, Protected Account)
 * - Accessible CustomerAuthModal & LocationModal lifecycles
 * - Minimalist footer
 */

import React, { useEffect } from 'react';
import type { AuthClient } from './api/auth-client.js';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { StorefrontProvider, useStorefront } from './context/StorefrontContext.js';
import { Header } from './components/layout/Header.js';
import { Footer } from './components/layout/Footer.js';
import { LocationModal } from './components/location/LocationModal.js';
import { CustomerAuthModal } from './components/auth/CustomerAuthModal.js';
import { CustomerLoginView } from './components/auth/CustomerLoginView.js';
import { ProtectedRoute } from './routing/ProtectedRoute.js';
import { getRedirectTargetFromSearch } from './routing/redirect-utils.js';
import { HomeView } from './views/HomeView.js';
import { ProductListingView } from './views/ProductListingView.js';
import { ProductDetailView } from './views/ProductDetailView.js';
import { CustomerAccountView } from './views/CustomerAccountView.js';
import './styles/customer.css';

export interface AppProps {
  /** Optional AuthClient override for controlled integration testing. */
  authClient?: AuthClient;
  /** Optional flag to skip initial cookie restoration in isolated tests. */
  skipInitialRestore?: boolean;
}

const LoginRouteView: React.FC = () => {
  const { isAuthenticated, isInitializing } = useAuth();
  const { navigateToHome, navigateToUrl } = useStorefront();

  const redirectTarget =
    typeof window !== 'undefined' && window.location
      ? getRedirectTargetFromSearch(window.location.search)
      : '/';

  useEffect(() => {
    if (!isInitializing && isAuthenticated) {
      navigateToUrl(redirectTarget, { replace: true });
    }
  }, [isInitializing, isAuthenticated, navigateToUrl, redirectTarget]);

  if (isAuthenticated) {
    return null;
  }

  return (
    <CustomerLoginView
      onSuccess={() => {
        navigateToUrl(redirectTarget, { replace: true });
      }}
      onBackToStorefront={navigateToHome}
    />
  );
};

const SessionNoticeBanner: React.FC = () => {
  const { isAuthenticated, authError, isAuthModalOpen, openAuthModal, clearError } = useAuth();
  const { currentView } = useStorefront();

  if (isAuthenticated || isAuthModalOpen || currentView === 'login' || !authError) {
    return null;
  }

  return (
    <div className="thz-session-banner" role="alert" aria-live="polite">
      <div className="thz-session-banner-inner">
        <p className="thz-session-banner-text">
          <strong>Session Notice:</strong> {authError.message}
        </p>
        <div className="thz-session-banner-actions">
          <button
            type="button"
            className="thz-btn-primary"
            onClick={() => {
              clearError();
              openAuthModal();
            }}
          >
            Sign In
          </button>
          <button type="button" className="thz-btn-secondary" onClick={clearError}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

const MainRouter: React.FC = () => {
  const { currentView, navigateToLogin } = useStorefront();

  return (
    <main className="thz-main-content" role="main">
      {currentView === 'home' && <HomeView />}
      {currentView === 'plp' && <ProductListingView />}
      {currentView === 'pdp' && <ProductDetailView />}
      {currentView === 'login' && <LoginRouteView />}
      {currentView === 'account' && (
        <ProtectedRoute
          onRedirectToLogin={(requestedPath) => {
            navigateToLogin(requestedPath, { replace: true });
          }}
        >
          <CustomerAccountView />
        </ProtectedRoute>
      )}
    </main>
  );
};

export const App: React.FC<AppProps> = ({ authClient, skipInitialRestore = false }) => {
  return (
    <AuthProvider client={authClient} skipInitialRestore={skipInitialRestore}>
      <StorefrontProvider>
        <div className="thz-app-container">
          <Header />
          <SessionNoticeBanner />
          <MainRouter />
          <CustomerAuthModal />
          <LocationModal />
          <Footer />
        </div>
      </StorefrontProvider>
    </AuthProvider>
  );
};

export default App;
