/**
 * TheHomez Storefront Context & State Management
 *
 * Provides reactive access to:
 * - Tri-state delivery location context (Unlocalized / Serviceable / Unserviceable)
 * - Customer segment / auth token simulation (B2C vs. verified B2B)
 * - Navigation routing state (Home / PLP / PDP / Search)
 * - Location selection modal control
 */

import React, { createContext, useContext, useState, useMemo, useCallback, useEffect } from 'react';
import type {
  StorefrontCustomerSegment,
  IStorefrontProductQuery,
  StorefrontSortOption,
} from '@thehomez/shared-types';
import { StorefrontClient } from '../api/storefront-client.js';

export interface ServiceAreaSummary {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
}

export type ViewType = 'home' | 'plp' | 'pdp';

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

function safePushState(url: string) {
  if (
    typeof window !== 'undefined' &&
    window.history &&
    typeof window.history.pushState === 'function'
  ) {
    const current = window.location.pathname + window.location.search;
    if (current !== url) {
      window.history.pushState(null, '', url);
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

  // Commercial Segment & B2B Authentication
  customerSegment: StorefrontCustomerSegment;
  b2bToken: string | null;
  setB2BToken: (token: string | null) => void;

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
}

const StorefrontContext = createContext<StorefrontContextValue | null>(null);

export const StorefrontProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pincode, setPincode] = useState<string | null>(null);
  const [serviceArea, setServiceArea] = useState<ServiceAreaSummary | null>(null);
  const [isServiceable, setIsServiceable] = useState<boolean | null>(null);
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);

  const [b2bToken, setB2BTokenState] = useState<string | null>(null);
  const customerSegment: StorefrontCustomerSegment = b2bToken ? 'B2B' : 'B2C';

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

  // Clean up unknown/invalid paths on initial mount if not a known storefront route
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const cleanPath = window.location.pathname.replace(/\/+$/, '') || '/';
    const isKnownPath =
      cleanPath === '/' ||
      cleanPath === '/home' ||
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

  const apiClient = useMemo(() => {
    return new StorefrontClient({
      getAuthToken: () => b2bToken,
    });
  }, [b2bToken]);

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

  const setB2BToken = useCallback((token: string | null) => {
    setB2BTokenState(token);
  }, []);

  const navigateToHome = useCallback(() => {
    setCurrentView('home');
    setSelectedProductSlug(null);
    setSearchQueryText('');
    safePushState('/');
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
    safePushState(`/products?category=${encodeURIComponent(categorySlug)}`);
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
    safePushState(`/search?q=${encodeURIComponent(trimmed)}`);
    safeScrollToTop();
  }, []);

  const navigateToProduct = useCallback((productSlug: string) => {
    setSelectedProductSlug(productSlug);
    setCurrentView('pdp');
    safePushState(`/products/${encodeURIComponent(productSlug)}`);
    safeScrollToTop();
  }, []);

  const navigateToPlp = useCallback((filters: Partial<IStorefrontProductQuery> = {}) => {
    setCurrentView('plp');
    setSelectedProductSlug(null);
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
    safePushState(qs ? `/products?${qs}` : '/products');
    safeScrollToTop();
  }, []);

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
      b2bToken,
      setB2BToken,
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
      b2bToken,
      setB2BToken,
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
    ],
  );

  return <StorefrontContext.Provider value={value}>{children}</StorefrontContext.Provider>;
};

export function useStorefront(): StorefrontContextValue {
  const context = useContext(StorefrontContext);
  if (!context) {
    throw new Error('useStorefront must be used within a StorefrontProvider');
  }
  return context;
}
