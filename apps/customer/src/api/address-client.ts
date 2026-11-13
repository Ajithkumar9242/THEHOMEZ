/**
 * TheHomez Customer Address Book API Client
 *
 * Interacts directly with backend Milestone 5B.1 endpoints via AuthContext's `authorizedFetch`:
 * - GET    /api/v1/customer/addresses
 * - POST   /api/v1/customer/addresses
 * - GET    /api/v1/customer/addresses/:addressId
 * - PUT    /api/v1/customer/addresses/:addressId
 * - PATCH  /api/v1/customer/addresses/:addressId/default
 * - DELETE /api/v1/customer/addresses/:addressId
 *
 * Security invariants:
 * - Delegates Bearer Authorization header injection, single-flight 401 refresh,
 *   and `credentials: 'include'` strictly to `AuthClient.authorizedFetch`.
 * - Never reads or persists access or refresh tokens in browser storage.
 */

import type {
  IApiErrorDetail,
  IApiErrorResponse,
  IApiResponse,
  ICreateCustomerAddressDto,
  ICustomerAddressDto,
  IDeleteCustomerAddressResponseDto,
  IUpdateCustomerAddressDto,
} from '@thehomez/shared-types';

export type AuthorizedFetchFn = (endpointOrUrl: string, init?: RequestInit) => Promise<Response>;

export class AddressApiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: IApiErrorDetail[];

  constructor(
    message: string,
    code = 'ADDRESS_API_ERROR',
    status = 500,
    details?: IApiErrorDetail[],
  ) {
    super(message);
    this.name = 'AddressApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface AddressClientOptions {
  basePath?: string;
  fetchWithAuth: AuthorizedFetchFn;
}

export class AddressClient {
  private readonly basePath: string;
  private readonly fetchWithAuth: AuthorizedFetchFn;

  constructor(options: AddressClientOptions) {
    this.basePath = (options.basePath ?? '/customer/addresses').replace(/\/+$/, '');
    this.fetchWithAuth = options.fetchWithAuth;
  }

  private async request<T>(
    pathSuffix: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
      throw new AddressApiError(
        'Unable to connect to TheHomez address service. Please check your internet connection and try again.',
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
          : `Address request failed with HTTP status ${response.status}`);
      const details = Array.isArray(errorPayload?.error?.details)
        ? errorPayload.error.details
        : undefined;

      throw new AddressApiError(errorMessage, errorCode, response.status, details);
    }

    const envelope = payload as IApiResponse<T> | null;
    if (envelope && typeof envelope === 'object' && 'success' in envelope && envelope.success) {
      return envelope.data;
    }

    return payload as T;
  }

  /**
   * Lists all saved delivery site addresses for the authenticated customer.
   * GET /api/v1/customer/addresses
   */
  public async listAddresses(signal?: AbortSignal): Promise<ICustomerAddressDto[]> {
    return this.request<ICustomerAddressDto[]>('', { method: 'GET', signal });
  }

  /**
   * Retrieves a single owned delivery site address by ID.
   * GET /api/v1/customer/addresses/:addressId
   */
  public async getAddressById(
    addressId: string,
    signal?: AbortSignal,
  ): Promise<ICustomerAddressDto> {
    return this.request<ICustomerAddressDto>(`/${encodeURIComponent(addressId)}`, {
      method: 'GET',
      signal,
    });
  }

  /**
   * Creates a new delivery site address for the authenticated customer.
   * POST /api/v1/customer/addresses
   */
  public async createAddress(dto: ICreateCustomerAddressDto): Promise<ICustomerAddressDto> {
    return this.request<ICustomerAddressDto>('', {
      method: 'POST',
      body: dto,
    });
  }

  /**
   * Updates an existing owned delivery site address.
   * PUT /api/v1/customer/addresses/:addressId
   */
  public async updateAddress(
    addressId: string,
    dto: IUpdateCustomerAddressDto,
  ): Promise<ICustomerAddressDto> {
    return this.request<ICustomerAddressDto>(`/${encodeURIComponent(addressId)}`, {
      method: 'PUT',
      body: dto,
    });
  }

  /**
   * Atomically promotes an owned delivery site address to default.
   * PATCH /api/v1/customer/addresses/:addressId/default
   */
  public async setDefaultAddress(addressId: string): Promise<ICustomerAddressDto> {
    return this.request<ICustomerAddressDto>(`/${encodeURIComponent(addressId)}/default`, {
      method: 'PATCH',
    });
  }

  /**
   * Deletes an owned delivery site address.
   * DELETE /api/v1/customer/addresses/:addressId
   */
  public async deleteAddress(addressId: string): Promise<IDeleteCustomerAddressResponseDto> {
    return this.request<IDeleteCustomerAddressResponseDto>(`/${encodeURIComponent(addressId)}`, {
      method: 'DELETE',
    });
  }
}
