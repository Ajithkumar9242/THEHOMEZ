/**
 * TheHomez Customer Storefront Root Application Component
 *
 * Coordinates:
 * - Reactive StorefrontProvider context
 * - Sticky navigation header & masthead
 * - Dynamic view routing (Home, PLP / Search, PDP)
 * - Location modal lifecycle
 * - Minimalist footer
 */

import React from 'react';
import { StorefrontProvider, useStorefront } from './context/StorefrontContext.js';
import { Header } from './components/layout/Header.js';
import { Footer } from './components/layout/Footer.js';
import { LocationModal } from './components/location/LocationModal.js';
import { HomeView } from './views/HomeView.js';
import { ProductListingView } from './views/ProductListingView.js';
import { ProductDetailView } from './views/ProductDetailView.js';
import './styles/customer.css';

const MainRouter: React.FC = () => {
  const { currentView } = useStorefront();

  return (
    <main className="thz-main-content" role="main">
      {currentView === 'home' && <HomeView />}
      {currentView === 'plp' && <ProductListingView />}
      {currentView === 'pdp' && <ProductDetailView />}
    </main>
  );
};

export const App: React.FC = () => {
  return (
    <StorefrontProvider>
      <div className="thz-app-container">
        <Header />
        <MainRouter />
        <LocationModal />
        <Footer />
      </div>
    </StorefrontProvider>
  );
};

export default App;
