/**
 * TheHomez Storefront Type-Safe API Client
 *
 * Interacts directly with actual backend endpoints:
 * - GET /api/v1/service-areas/check
 * - GET /api/v1/categories
 * - GET /api/v1/categories/:slug
 * - GET /api/v1/storefront/products
 * - GET /api/v1/storefront/products/:slug
 * - GET /api/v1/storefront/search
 *
 * Rules:
 * - Never returns fake hardcoded success responses.
 * - Handles IApiResponse<T> envelopes and normalizes errors.
 * - Transmits optional Bearer tokens for authenticated B2B customer simulation.
 */

import type {
  IApiResponse,
  IApiErrorResponse,
  IServiceAreaCheckResponse,
  ICategoryTreeItem,
  ICategoryDetailsResponse,
  IStorefrontProductListResponse,
  IStorefrontProductDetailResponse,
  IStorefrontProductQuery,
  IStorefrontSearchQuery,
} from '@thehomez/shared-types';

export class StorefrontApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, code = 'API_ERROR', status = 500, details?: unknown) {
    super(message);
    this.name = 'StorefrontApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface StorefrontClientOptions {
  baseUrl?: string;
  getAuthToken?: () => string | null;
  fetchWithAuth?: (endpointOrUrl: string, init?: RequestInit) => Promise<Response>;
}

export class StorefrontClient {
  private readonly baseUrl: string;
  private readonly getAuthToken?: () => string | null;
  private readonly fetchWithAuth?: (endpointOrUrl: string, init?: RequestInit) => Promise<Response>;

  constructor(options: StorefrontClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '/api/v1';
    this.getAuthToken = options.getAuthToken;
    this.fetchWithAuth = options.fetchWithAuth;
  }

  private async request<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...((init?.headers as Record<string, string>) || {}),
    };

    // Strip any caller-provided Authorization header so cleared tokens cannot linger.
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'authorization') {
        delete headers[key];
      }
    }

    // When fetchWithAuth (AuthClient.authorizedFetch) is wired, it is the single
    // authoritative resolver of the live in-memory access token.
    if (!this.fetchWithAuth) {
      const token = this.getAuthToken ? this.getAuthToken() : null;
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    let response: Response;
    try {
      response = this.fetchWithAuth
        ? await this.fetchWithAuth(url, { ...init, headers })
        : await fetch(url, { ...init, headers });
    } catch (networkError) {
      throw new StorefrontApiError(
        'Unable to connect to TheHomez server. Please check your network connection.',
        'NETWORK_ERROR',
        0,
        networkError,
      );
    }

    const contentType = response.headers.get('content-type') || '';
    let payload: unknown;

    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const errorPayload = payload as IApiErrorResponse | null;
      const errorCode = errorPayload?.error?.code || `HTTP_${response.status}`;
      const errorMessage =
        errorPayload?.error?.message ||
        `Request to ${endpoint} failed with HTTP status ${response.status}`;
      throw new StorefrontApiError(
        errorMessage,
        errorCode,
        response.status,
        errorPayload?.error?.details,
      );
    }

    const envelope = payload as IApiResponse<T>;
    if (envelope && typeof envelope === 'object' && 'success' in envelope && envelope.success) {
      return envelope.data;
    }

    // Direct data fallback if un-enveloped
    return payload as T;
  }

  /**
   * Check Indian postal PIN code serviceability.
   * GET /api/v1/service-areas/check?pincode={pin}
   */
  public async checkPincode(pincode: string): Promise<IServiceAreaCheckResponse> {
    const params = new URLSearchParams({ pincode: pincode.trim() });
    return this.request<IServiceAreaCheckResponse>(`/service-areas/check?${params.toString()}`);
  }

  /**
   * Retrieve active 2-tier category taxonomy tree.
   * GET /api/v1/categories
   * Backend envelope data structure: { categories: ICategoryTreeItem[] }
   */
  public async getCategories(): Promise<ICategoryTreeItem[]> {
    const data = await this.request<{ categories?: ICategoryTreeItem[] } | ICategoryTreeItem[]>(
      '/categories',
    );

    if (Array.isArray(data)) {
      return data;
    }

    if (
      data &&
      typeof data === 'object' &&
      'categories' in data &&
      Array.isArray(data.categories)
    ) {
      return data.categories;
    }

    // Safely return empty list if payload data is unexpectedly shaped without hiding network/HTTP errors
    return [];
  }

  /**
   * Retrieve category details by slug.
   * GET /api/v1/categories/:slug
   */
  public async getCategoryBySlug(slug: string): Promise<ICategoryDetailsResponse> {
    return this.request<ICategoryDetailsResponse>(`/categories/${encodeURIComponent(slug)}`);
  }

  /**
   * List storefront products with filters, sorting, and pagination.
   * GET /api/v1/storefront/products
   */
  public async listProducts(
    query: IStorefrontProductQuery = {},
  ): Promise<IStorefrontProductListResponse> {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    if (query.category) params.set('category', query.category);
    if (query.subcategory) params.set('subcategory', query.subcategory);
    if (query.brand) params.set('brand', query.brand);
    if (query.pincode) params.set('pincode', query.pincode);
    if (query.minPricePaise !== undefined) params.set('minPricePaise', String(query.minPricePaise));
    if (query.maxPricePaise !== undefined) params.set('maxPricePaise', String(query.maxPricePaise));
    if (query.inStockOnly !== undefined) params.set('inStockOnly', String(query.inStockOnly));
    if (query.sort) params.set('sort', query.sort);
    if (query.includeFacets !== undefined) params.set('includeFacets', String(query.includeFacets));

    const queryString = params.toString();
    const endpoint = `/storefront/products${queryString ? `?${queryString}` : ''}`;
    return this.request<IStorefrontProductListResponse>(endpoint);
  }

  /**
   * Search storefront products by query string.
   * GET /api/v1/storefront/search?q={query}
   */
  public async searchProducts(
    query: IStorefrontSearchQuery,
  ): Promise<IStorefrontProductListResponse> {
    const params = new URLSearchParams();
    params.set('q', query.q.trim());
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    if (query.category) params.set('category', query.category);
    if (query.subcategory) params.set('subcategory', query.subcategory);
    if (query.brand) params.set('brand', query.brand);
    if (query.pincode) params.set('pincode', query.pincode);
    if (query.minPricePaise !== undefined) params.set('minPricePaise', String(query.minPricePaise));
    if (query.maxPricePaise !== undefined) params.set('maxPricePaise', String(query.maxPricePaise));
    if (query.inStockOnly !== undefined) params.set('inStockOnly', String(query.inStockOnly));
    if (query.sort) params.set('sort', query.sort);
    if (query.includeFacets !== undefined) params.set('includeFacets', String(query.includeFacets));

    return this.request<IStorefrontProductListResponse>(`/storefront/search?${params.toString()}`);
  }

  /**
   * Retrieve storefront product details by product slug.
   * GET /api/v1/storefront/products/:slug
   */
  public async getProductBySlug(
    slug: string,
    pincode?: string,
  ): Promise<IStorefrontProductDetailResponse> {
    const params = new URLSearchParams();
    if (pincode) {
      params.set('pincode', pincode.trim());
    }
    const queryString = params.toString();
    const endpoint = `/storefront/products/${encodeURIComponent(slug)}${queryString ? `?${queryString}` : ''}`;
    return this.request<IStorefrontProductDetailResponse>(endpoint);
  }
}
