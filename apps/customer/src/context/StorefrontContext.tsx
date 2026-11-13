/**
 * TheHomez Storefront Context & State Management
 *
 * Provides reactive access to:
 * - Tri-state delivery location context (Unlocalized / Serviceable / Unserviceable)
 * - Customer commercial segment derived from verified AuthContext identity (B2C vs. B2B)
 * - Navigation routing state (Home / PLP / PDP / Search / Login / Account)
 * - Location selection modal control
 */

import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useEffect,
} from 'react';
import type {
  StorefrontCustomerSegment,
  IStorefrontProductQuery,
  StorefrontSortOption,
} from '@thehomez/shared-types';
import { StorefrontClient } from '../api/storefront-client.js';
import { useOptionalAuthContext } from '../components/auth/AuthUiContext.js';
import {
  ACCOUNT_ROUTE_PATH,
  ADDRESSES_ROUTE_PATH,
  CART_ROUTE_PATH,
  CHECKOUT_PREPARE_ROUTE_PATH,
  LOGIN_ROUTE_PATH,
  buildLoginRedirectUrl,
  sanitizeRedirectPath,
} from '../routing/redirect-utils.js';

export interface ServiceAreaSummary {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
}

export type ViewType = 'home' | 'plp' | 'pdp' | 'login' | 'account' | 'addresses' | 'cart' | 'checkout';

export interface ParsedRoute {
  view: ViewType;
  productSlug: string | null;
  searchQuery: string;
  filters: IStorefrontProductQuery;
}

/**
 * Parses the browser location (pathname and search query string) into structured storefront routing state.
 * Gracefully defaults to 'home' for unrecognized or invalid paths.
 */
export function parseLocationToRoute(pathname: string, search: string): ParsedRoute {
  const cleanPath = pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(search);

  // 0. Customer Authentication & Protected Account Routes
  if (cleanPath === LOGIN_ROUTE_PATH) {
    return {
      view: 'login',
      productSlug: null,
      searchQuery: '',
      filters: {},
    };
  }

  if (cleanPath === CART_ROUTE_PATH) {
    return {
      view: 'cart',
      productSlug: null,
      searchQuery: '',
      filters: {},
    };
  }
  if (cleanPath === CHECKOUT_PREPARE_ROUTE_PATH) {
    return { view: 'checkout', productSlug: null, searchQuery: '', filters: {} };
  }

  if (cleanPath === ADDRESSES_ROUTE_PATH || cleanPath === '/addresses') {
    return {
      view: 'addresses',
      productSlug: null,
      searchQuery: '',
      filters: {},
    };
  }

  if (cleanPath === ACCOUNT_ROUTE_PATH || cleanPath === '/profile') {
    return {
      view: 'account',
      productSlug: null,
      searchQuery: '',
      filters: {},
    };
  }

  // 1. Product Detail Page: /products/:slug or /storefront/products/:slug
  const pdpMatch = cleanPath.match(/^(?:\/storefront)?\/products\/([^/]+)$/);
  if (pdpMatch && pdpMatch[1]) {
    return {
      view: 'pdp',
      productSlug: decodeURIComponent(pdpMatch[1]),
      searchQuery: '',
      filters: {},
    };
  }

  // 2. Category Route: /category/:slug or /categories/:slug
  const catMatch = cleanPath.match(/^\/categor(?:ies|y)\/([^/]+)$/);
  if (catMatch && catMatch[1]) {
    const categorySlug = decodeURIComponent(catMatch[1]);
    return {
      view: 'plp',
      productSlug: null,
      searchQuery: '',
      filters: { category: categorySlug, page: 1 },
    };
  }

  // 3. Search Route: /search
  if (cleanPath === '/search') {
    const q = params.get('q') || params.get('search') || '';
    return {
      view: 'plp',
      productSlug: null,
      searchQuery: q.trim(),
      filters: { page: 1 },
    };
  }

  // 4. Products / Catalogue / PLP: /products, /catalogue, /catalog
  if (cleanPath === '/products' || cleanPath === '/catalogue' || cleanPath === '/catalog') {
    const category = params.get('category') || undefined;
    const brand = params.get('brand') || undefined;
    const sort = (params.get('sort') as StorefrontSortOption) || undefined;
    const pageStr = params.get('page');
    const page = pageStr ? parseInt(pageStr, 10) : 1;
    const inStockOnly = params.get('inStockOnly') === 'true';
    const q = params.get('q') || params.get('search') || '';

    return {
      view: 'plp',
      productSlug: null,
      searchQuery: q.trim(),
      filters: {
        ...(category ? { category } : {}),
        ...(brand ? { brand } : {}),
        ...(sort ? { sort } : {}),
        ...(inStockOnly ? { inStockOnly } : {}),
        page: isNaN(page) ? 1 : page,
      },
    };
  }

  // 5. Default / Fallback: Home view
  return {
    view: 'home',
    productSlug: null,
    searchQuery: '',
    filters: {},
  };
}

function safeSyncHistory(url: string, replace = false) {
  if (
    typeof window !== 'undefined' &&
    window.history &&
    typeof window.history.pushState === 'function'
  ) {
    const current = window.location.pathname + window.location.search;
    if (current !== url) {
      if (replace && typeof window.history.replaceState === 'function') {
        window.history.replaceState(null, '', url);
      } else {
        window.history.pushState(null, '', url);
      }
    }
  }
}

function safeScrollToTop() {
  if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      // jsdom environment does not implement window.scrollTo
    }
  }
}

export interface StorefrontContextValue {
  // Location & Tri-State Availability
  pincode: string | null;
  serviceArea: ServiceAreaSummary | null;
  isServiceable: boolean | null; // null = unlocalized, true = serviceable, false = unserviceable
  setPincodeResult: (pin: string, serviceable: boolean, serviceArea?: ServiceAreaSummary) => void;
  clearPincode: () => void;
  isLocationModalOpen: boolean;
  openLocationModal: () => void;
  closeLocationModal: () => void;

  // Commercial Segment (derived from verified AuthContext identity)
  customerSegment: StorefrontCustomerSegment;

  // Storefront API Client Instance
  apiClient: StorefrontClient;

  // View Navigation
  currentView: ViewType;
  selectedProductSlug: string | null;
  plpFilters: IStorefrontProductQuery;
  searchQueryText: string;
  navigateToHome: () => void;
  navigateToCategory: (categorySlug: string) => void;
  navigateToSearch: (q: string) => void;
  navigateToProduct: (productSlug: string) => void;
  navigateToPlp: (filters?: Partial<IStorefrontProductQuery>) => void;
  navigateToLogin: (redirectPath?: string, options?: { replace?: boolean }) => void;
  navigateToAccount: () => void;
  navigateToAddresses: () => void;
  navigateToCart: () => void;
  navigateToCheckout: () => void;
  navigateToUrl: (url: string, options?: { replace?: boolean }) => void;
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export const StorefrontProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useOptionalAuthContext();

  const [pincode, setPincode] = useState<string | null>(null);
  const [serviceArea, setServiceArea] = useState<ServiceAreaSummary | null>(null);
  const [isServiceable, setIsServiceable] = useState<boolean | null>(null);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);

  const hasB2BRole = Boolean(auth?.isAuthenticated && auth.user?.roles?.includes('B2B_CUSTOMER'));
  const customerSegment: StorefrontCustomerSegment = hasB2BRole ? 'B2B' : 'B2C';

  // Compute initial route directly from window.location (supports direct deep-link load & refresh)
  const initialRoute = useMemo<ParsedRoute>(() => {
    if (typeof window !== 'undefined' && window.location) {
      return parseLocationToRoute(window.location.pathname, window.location.search);
    }
    return {
      view: 'home',
      productSlug: null,
      searchQuery: '',
      filters: {},
    };
  }, []);

  // Navigation State initialized from URL
  const [currentView, setCurrentView] = useState<ViewType>(initialRoute.view);
  const [selectedProductSlug, setSelectedProductSlug] = useState<string | null>(
    initialRoute.productSlug,
  );
  const [plpFilters, setPlpFilters] = useState<IStorefrontProductQuery>(initialRoute.filters);
  const [searchQueryText, setSearchQueryText] = useState<string>(initialRoute.searchQuery);

  // Synchronize Browser History & Popstate (Back / Forward)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      const route = parseLocationToRoute(window.location.pathname, window.location.search);
      setCurrentView(route.view);
      setSelectedProductSlug(route.productSlug);
      setSearchQueryText(route.searchQuery);
      setPlpFilters({
        ...route.filters,
        ...(pincode ? { pincode } : {}),
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [pincode]);

  // Clean up unknown/invalid paths on initial mount if not a known storefront/auth route
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
    const isKnownPath =
      cleanPath === '/' ||
      cleanPath === '/home' ||
      cleanPath === LOGIN_ROUTE_PATH ||
      cleanPath === ACCOUNT_ROUTE_PATH ||
      cleanPath === ADDRESSES_ROUTE_PATH ||
      cleanPath === CART_ROUTE_PATH ||
      cleanPath === CHECKOUT_PREPARE_ROUTE_PATH ||
      cleanPath === '/addresses' ||
      cleanPath === '/profile' ||
      cleanPath === '/products' ||
      cleanPath === '/catalogue' ||
      cleanPath === '/catalog' ||
      cleanPath === '/search' ||
      /^(?:\/storefront)?\/products\/[^/]+$/.test(cleanPath) ||
      /^\/categor(?:ies|y)\/[^/]+$/.test(cleanPath);

    if (!isKnownPath) {
      window.history.replaceState(null, '', '/');
    }
  }, []);

  const authUserId = auth?.isAuthenticated ? (auth.user?.id ?? null) : null;
  const authFetch = auth?.authorizedFetch;

  const apiClient = useMemo(() => {
    return new StorefrontClient({
      ...(authFetch ? { fetchWithAuth: authFetch } : {}),
    });
  }, [authFetch, authUserId]);

  const setPincodeResult = useCallback(
    (pin: string, serviceable: boolean, area?: ServiceAreaSummary) => {
      setPincode(pin);
      setIsServiceable(serviceable);
      setServiceArea(serviceable && area ? area : null);
      // Update filters with pincode
      setPlpFilters((prev) => ({ ...prev, pincode: pin }));
    },
    [],
  );

  const clearPincode = useCallback(() => {
    setPincode(null);
    setServiceArea(null);
    setIsServiceable(null);
    setPlpFilters((prev) => {
      const next = { ...prev };
      delete next.pincode;
      delete next.inStockOnly;
      return next;
    });
  }, []);

  const openLocationModal = useCallback(() => setIsLocationModalOpen(true), []);
  const closeLocationModal = useCallback(() => setIsLocationModalOpen(false), []);

  const navigateToHome = useCallback(() => {
    setCurrentView('home');
    setSelectedProductSlug(null);
    setSearchQueryText('');
    safeSyncHistory('/');
    safeScrollToTop();
  }, []);

  const navigateToCategory = useCallback((categorySlug: string) => {
    setCurrentView('plp');
    setSelectedProductSlug(null);
    setSearchQueryText('');
    setPlpFilters((prev) => ({
      ...prev,
      category: categorySlug,
      page: 1,
    }));
    safeSyncHistory(`/products?category=${encodeURIComponent(categorySlug)}`);
    safeScrollToTop();
  }, []);

  const navigateToSearch = useCallback((q: string) => {
    const trimmed = q.trim();
    setCurrentView('plp');
    setSelectedProductSlug(null);
    setSearchQueryText(trimmed);
    setPlpFilters((prev) => ({
      ...prev,
      page: 1,
    }));
    safeSyncHistory(`/search?q=${encodeURIComponent(trimmed)}`);
    safeScrollToTop();
  }, []);

  const navigateToProduct = useCallback((productSlug: string) => {
    setSelectedProductSlug(productSlug);
    setCurrentView('pdp');
    safeSyncHistory(`/products/${encodeURIComponent(productSlug)}`);
    safeScrollToTop();
  }, []);

  const navigateToPlp = useCallback((filters: Partial<IStorefrontProductQuery> = {}) => {
    setCurrentView('plp');
    setSelectedProductSlug(null);
    setSearchQueryText('');
    setPlpFilters((prev) => ({
      ...prev,
      ...filters,
      page: 1,
    }));
    const params = new URLSearchParams();
    if (filters.category) params.set('category', filters.category);
    if (filters.brand) params.set('brand', filters.brand);
    if (filters.sort && filters.sort !== 'featured') params.set('sort', filters.sort);
    if (filters.inStockOnly) params.set('inStockOnly', 'true');
    const qs = params.toString();
    safeSyncHistory(qs ? `/products?${qs}` : '/products');
    safeScrollToTop();
  }, []);

  const navigateToLogin = useCallback(
    (redirectPath?: string, options?: { replace?: boolean }) => {
      const targetUrl = redirectPath ? buildLoginRedirectUrl(redirectPath) : LOGIN_ROUTE_PATH;
      setCurrentView('login');
      setSelectedProductSlug(null);
      setSearchQueryText('');
      safeSyncHistory(targetUrl, options?.replace ?? false);
      safeScrollToTop();
    },
    [],
  );

  const navigateToAccount = useCallback(() => {
    setCurrentView('account');
    setSelectedProductSlug(null);
    setSearchQueryText('');
    safeSyncHistory(ACCOUNT_ROUTE_PATH);
    safeScrollToTop();
  }, []);

  const navigateToAddresses = useCallback(() => {
    setCurrentView('addresses');
    setSelectedProductSlug(null);
    setSearchQueryText('');
    safeSyncHistory(ADDRESSES_ROUTE_PATH);
    safeScrollToTop();
  }, []);

  const navigateToCart = useCallback(() => {
    setCurrentView('cart');
    setSelectedProductSlug(null);
    setSearchQueryText('');
    safeSyncHistory(CART_ROUTE_PATH);
    safeScrollToTop();
  }, []);

  const navigateToCheckout = useCallback(() => {
    setCurrentView('checkout');
    setSelectedProductSlug(null);
    setSearchQueryText('');
    safeSyncHistory(CHECKOUT_PREPARE_ROUTE_PATH);
    safeScrollToTop();
  }, []);

  const navigateToUrl = useCallback(
    (url: string, options?: { replace?: boolean }) => {
      const safeTarget = sanitizeRedirectPath(url);
      const qIdx = safeTarget.indexOf('?');
      const pathname = qIdx >= 0 ? safeTarget.slice(0, qIdx) : safeTarget;
      const search = qIdx >= 0 ? safeTarget.slice(qIdx) : '';
      const route = parseLocationToRoute(pathname, search);

      setCurrentView(route.view);
      setSelectedProductSlug(route.productSlug);
      setSearchQueryText(route.searchQuery);
      setPlpFilters({
        ...route.filters,
        ...(pincode ? { pincode } : {}),
      });
      safeSyncHistory(safeTarget, options?.replace ?? false);
      safeScrollToTop();
    },
    [pincode],
  );

  const value = useMemo<StorefrontContextValue>(
    () => ({
      pincode,
      serviceArea,
      isServiceable,
      setPincodeResult,
      clearPincode,
      isLocationModalOpen,
      openLocationModal,
      closeLocationModal,
      customerSegment,
      apiClient,
      currentView,
      selectedProductSlug,
      plpFilters,
      searchQueryText,
      navigateToHome,
      navigateToCategory,
      navigateToSearch,
      navigateToProduct,
      navigateToPlp,
      navigateToLogin,
      navigateToAccount,
      navigateToAddresses,
      navigateToCart,
      navigateToCheckout,
      navigateToUrl,
    }),
    [
      pincode,
      serviceArea,
      isServiceable,
      setPincodeResult,
      clearPincode,
      isLocationModalOpen,
      openLocationModal,
      closeLocationModal,
      customerSegment,
      apiClient,
      currentView,
      selectedProductSlug,
      plpFilters,
      searchQueryText,
      navigateToHome,
      navigateToCategory,
      navigateToSearch,
      navigateToProduct,
      navigateToPlp,
      navigateToLogin,
      navigateToAccount,
      navigateToAddresses,
      navigateToCart,
      navigateToCheckout,
      navigateToUrl,
    ],
  );

  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
};

export function useOptionalStorefront(): StorefrontContextValue | null {
  return useContext(StorefrontContext);
}

export function useStorefront(): StorefrontContextValue {
  const context = useContext(StorefrontContext);
  if (!context) {
    throw new Error('useStorefront must be used within a StorefrontProvider');
  }
  return context;
}
