/**
 * TheHomez Customer Cart API Client
 *
 * Interacts directly with backend Milestone 5B.2 & 5B.3 Cart endpoints via AuthContext's `authorizedFetch`:
 * - GET    /api/v1/cart
 * - POST   /api/v1/cart/items
 * - PATCH  /api/v1/cart/items/:itemId
 * - DELETE /api/v1/cart/items/:itemId
 * - PATCH  /api/v1/cart/location
 * - POST   /api/v1/cart/clear
 * - POST   /api/v1/cart/validate
 * - POST   /api/v1/cart/acknowledge-prices
 *
 * Scope & Security Invariants:
 * - Does NOT implement Milestone 5B.4 (`/checkout/prepare`), Milestone 5B.5 (`/orders`),
 *   or unapproved guest-cart migration (`/cart/migrate`).
 * - Delegates Bearer Authorization header injection, single-flight 401 refresh,
 *   and `credentials: 'include'` strictly to `AuthClient.authorizedFetch`.
 * - Never reads or persists access or refresh tokens in browser storage.
 */

import type {
  IAcknowledgeCartPricesRequestDto,
  IAddCartItemRequestDto,
  IApiErrorDetail,
  IApiErrorResponse,
  IApiResponse,
  ICartSummaryDto,
  ICartValidationResultDto,
  IUpdateCartItemQuantityRequestDto,
  IUpdateCartLocationRequestDto,
  IValidateCartRequestDto,
} from '@thehomez/shared-types';
import type { AuthorizedFetchFn } from './address-client.js';

export class CartApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: IApiErrorDetail[];

  constructor(
    message: string,
    code = 'CART_API_ERROR',
    status = 500,
    details?: IApiErrorDetail[],
  ) {
    super(message);
    this.name = 'CartApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface CartClientOptions {
  basePath?: string;
  fetchWithAuth: AuthorizedFetchFn;
}

export class CartClient {
  private readonly basePath: string;
  private readonly fetchWithAuth: AuthorizedFetchFn;

  constructor(options: CartClientOptions) {
    this.basePath = (options.basePath ?? '/cart').replace(/\/+$/, '');
    this.fetchWithAuth = options.fetchWithAuth;
  }

  private async request<T>(
    pathSuffix: string,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      body?: unknown;
      signal?: AbortSignal;
    },
  ): Promise<T> {
    const endpoint = `${this.basePath}${pathSuffix}`;
    const hasBody = options.body !== undefined;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    };

    let response: Response;
    try {
      response = await this.fetchWithAuth(endpoint, {
        method: options.method,
        headers,
        ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      throw new CartApiError(
        'Unable to connect to TheHomez cart service. Please check your internet connection and try again.',
        'NETWORK_ERROR',
        0,
      );
    }

    const contentType = response.headers?.get?.('content-type') || '';
    let payload: unknown = null;

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
        (response.status === 401
          ? 'Your session has expired. Please sign in again.'
          : `Cart request failed with HTTP status ${response.status}`);
      const details = Array.isArray(errorPayload?.error?.details)
        ? errorPayload.error.details
        : undefined;

      throw new CartApiError(errorMessage, errorCode, response.status, details);
    }

    const envelope = payload as IApiResponse<T> | null;
    if (envelope && typeof envelope === 'object' && 'success' in envelope && envelope.success) {
      return envelope.data;
    }

    return payload as T;
  }

  /**
   * Fetches and hydrates the authenticated customer's active cart.
   * GET /api/v1/cart
   */
  public async getCart(signal?: AbortSignal): Promise<ICartSummaryDto> {
    return this.request<ICartSummaryDto>('', { method: 'GET', signal });
  }

  /**
   * Adds a product or variant to the authenticated customer's cart.
   * POST /api/v1/cart/items
   */
  public async addItem(dto: IAddCartItemRequestDto): Promise<ICartSummaryDto> {
    return this.request<ICartSummaryDto>('/items', {
      method: 'POST',
      body: dto,
    });
  }

  /**
   * Sets a new authoritative quantity on an existing cart line item.
   * PATCH /api/v1/cart/items/:itemId
   */
  public async updateItemQuantity(
    itemId: string,
    dto: IUpdateCartItemQuantityRequestDto,
  ): Promise<ICartSummaryDto> {
    return this.request<ICartSummaryDto>(`/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: dto,
    });
  }

  /**
   * Removes an item from the cart.
   * DELETE /api/v1/cart/items/:itemId
   */
  public async removeItem(itemId: string, expectedVersion?: number): Promise<ICartSummaryDto> {
    const query =
      expectedVersion !== undefined
        ? `?expectedVersion=${encodeURIComponent(String(expectedVersion))}`
        : '';
    return this.request<ICartSummaryDto>(`/items/${encodeURIComponent(itemId)}${query}`, {
      method: 'DELETE',
    });
  }

  /**
   * Updates or clears the cart's delivery PIN localization without altering cart items.
   * PATCH /api/v1/cart/location
   */
  public async updateLocation(dto: IUpdateCartLocationRequestDto): Promise<ICartSummaryDto> {
    return this.request<ICartSummaryDto>('/location', {
      method: 'PATCH',
      body: dto,
    });
  }

  /**
   * Removes all line items from the customer's cart.
   * POST /api/v1/cart/clear
   */
  public async clearCart(expectedVersion?: number): Promise<ICartSummaryDto> {
    const body = expectedVersion !== undefined ? { expectedVersion } : {};
    return this.request<ICartSummaryDto>('/clear', {
      method: 'POST',
      body,
    });
  }

  /**
   * Validates cart readiness, delivery serviceability, item availability, and price drift.
   * Read-only: does not mutate persisted cart PIN or prices.
   * POST /api/v1/cart/validate
   */
  public async validateCart(dto: IValidateCartRequestDto = {}): Promise<ICartValidationResultDto> {
    const body: IValidateCartRequestDto = {};
    if (dto.pincode !== undefined) {
      body.pincode = dto.pincode;
    }
    if (dto.addressId !== undefined) {
      body.addressId = dto.addressId;
    }
    if (dto.expectedVersion !== undefined) {
      body.expectedVersion = dto.expectedVersion;
    }
    return this.request<ICartValidationResultDto>('/validate', {
      method: 'POST',
      body,
    });
  }

  /**
   * Explicitly acknowledges updated unit prices for all items or a specific subset of itemIds.
   * POST /api/v1/cart/acknowledge-prices
   */
  public async acknowledgePrices(
    dto: IAcknowledgeCartPricesRequestDto = {},
  ): Promise<ICartSummaryDto> {
    const body: IAcknowledgeCartPricesRequestDto = {};
    if (dto.itemIds !== undefined) {
      body.itemIds = dto.itemIds;
    }
    if (dto.expectedVersion !== undefined) {
      body.expectedVersion = dto.expectedVersion;
    }
    if (dto.validationSnapshotId !== undefined) {
      body.validationSnapshotId = dto.validationSnapshotId;
    }
    return this.request<ICartSummaryDto>('/acknowledge-prices', {
      method: 'POST',
      body,
    });
  }
}
