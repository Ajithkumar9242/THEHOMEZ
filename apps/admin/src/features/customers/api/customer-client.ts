import type {
  IAdminCustomerDetailDto,
  IAdminCustomerListResponseDto,
  IAdminCustomerQueryDto,
  ICustomerAddressDto,
  IUpdateCustomerB2bStatusDto,
  IUpdateCustomerStatusDto,
} from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export interface CustomerRequestOptions {
  signal?: AbortSignal;
}

export type CustomerListQuery = IAdminCustomerQueryDto & CustomerRequestOptions;

export const customerClient = {
  /**
   * API 1: List customer directory with pagination, search, status, and segment filtering.
   * GET /api/v1/admin/customers
   */
  async listCustomers(
    query: CustomerListQuery = {},
    options: CustomerRequestOptions = {},
  ): Promise<IAdminCustomerListResponseDto> {
    const params = new URLSearchParams();
    if (query.page !== undefined && query.page !== null) params.set('page', String(query.page));
    if (query.limit !== undefined && query.limit !== null) params.set('limit', String(query.limit));
    if (query.search?.trim()) params.set('search', query.search.trim());
    if (query.status) params.set('status', query.status);
    if (query.segment) params.set('segment', query.segment);
    if (query.sortBy) params.set('sortBy', query.sortBy);
    if (query.sortOrder) params.set('sortOrder', query.sortOrder);

    const suffix = params.size ? `?${params.toString()}` : '';
    const signal = options.signal ?? query.signal;

    return apiRequest<IAdminCustomerListResponseDto>(`/admin/customers${suffix}`, {
      method: 'GET',
      signal,
    });
  },

  /**
   * API 2: Inspect full customer detail, delivery site addresses, serviceability, and safe metadata.
   * GET /api/v1/admin/customers/:id
   */
  async getCustomerById(
    id: string,
    options: CustomerRequestOptions = {},
  ): Promise<IAdminCustomerDetailDto> {
    return apiRequest<IAdminCustomerDetailDto>(`/admin/customers/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal: options.signal,
    });
  },

  /**
   * API 3: Inspect read-only customer delivery site address book with hub resolution.
   * GET /api/v1/admin/customers/:id/addresses
   */
  async getCustomerAddresses(
    id: string,
    options: CustomerRequestOptions = {},
  ): Promise<ICustomerAddressDto[]> {
    return apiRequest<ICustomerAddressDto[]>(
      `/admin/customers/${encodeURIComponent(id)}/addresses`,
      {
        method: 'GET',
        signal: options.signal,
      },
    );
  },

  /**
   * API 4: Update customer account lifecycle status (ACTIVE <-> SUSPENDED).
   * Atomically revokes refresh tokens on suspension and logs audit trail.
   * PATCH /api/v1/admin/customers/:id/status
   */
  async updateCustomerStatus(
    id: string,
    dto: IUpdateCustomerStatusDto,
    options: CustomerRequestOptions = {},
  ): Promise<IAdminCustomerDetailDto> {
    return apiRequest<IAdminCustomerDetailDto>(
      `/admin/customers/${encodeURIComponent(id)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify(dto),
        signal: options.signal,
      },
    );
  },

  /**
   * API 5: Verify or revoke B2B wholesale contractor status.
   * Grants/revokes 'B2B_CUSTOMER' role and persists verification metadata.
   * PATCH /api/v1/admin/customers/:id/b2b-status
   */
  async updateCustomerB2bStatus(
    id: string,
    dto: IUpdateCustomerB2bStatusDto,
    options: CustomerRequestOptions = {},
  ): Promise<IAdminCustomerDetailDto> {
    return apiRequest<IAdminCustomerDetailDto>(
      `/admin/customers/${encodeURIComponent(id)}/b2b-status`,
      {
        method: 'PATCH',
        body: JSON.stringify(dto),
        signal: options.signal,
      },
    );
  },
};
