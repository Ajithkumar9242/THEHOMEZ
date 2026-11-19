import type {
  IAdminPartnerAuditLogListResponseDto,
  IAdminPartnerListResponseDto,
  IAdminPartnerQueryDto,
  IPartnerAdminDetailDto,
  IUpdatePartnerStatusDto,
} from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export interface PartnerRequestOptions {
  signal?: AbortSignal;
}

export type PartnerListQuery = IAdminPartnerQueryDto & PartnerRequestOptions;

export interface PartnerAuditLogQuery extends PartnerRequestOptions {
  page?: number;
  limit?: number;
}

export const partnerClient = {
  /**
   * API 1: List partner directory with pagination, search, status, and service-area filtering.
   * GET /api/v1/admin/partners
   */
  async listPartners(
    query: PartnerListQuery = {},
    options: PartnerRequestOptions = {},
  ): Promise<IAdminPartnerListResponseDto> {
    const params = new URLSearchParams();
    if (query.page !== undefined && query.page !== null) params.set('page', String(query.page));
    if (query.limit !== undefined && query.limit !== null) params.set('limit', String(query.limit));
    if (query.search?.trim()) params.set('search', query.search.trim());
    if (query.status) params.set('status', query.status);
    if (query.serviceAreaId) params.set('serviceAreaId', query.serviceAreaId);
    if (query.sortBy) params.set('sortBy', query.sortBy);
    if (query.sortOrder) params.set('sortOrder', query.sortOrder);

    const suffix = params.size ? `?${params.toString()}` : '';
    const signal = options.signal ?? query.signal;

    return apiRequest<IAdminPartnerListResponseDto>(`/admin/partners${suffix}`, {
      method: 'GET',
      signal,
    });
  },

  /**
   * API 2: Inspect full partner profile, assigned service areas, linked user count, and safe metadata.
   * GET /api/v1/admin/partners/:partnerId
   */
  async getPartnerById(
    partnerId: string,
    options: PartnerRequestOptions = {},
  ): Promise<IPartnerAdminDetailDto> {
    return apiRequest<IPartnerAdminDetailDto>(`/admin/partners/${encodeURIComponent(partnerId)}`, {
      method: 'GET',
      signal: options.signal,
    });
  },

  /**
   * API 3: Update partner lifecycle status.
   * Enforces 16-state lifecycle transition matrix, revokes refresh tokens on INACTIVE/SUSPENDED,
   * writes immutable audit trail.
   * PATCH /api/v1/admin/partners/:partnerId/status
   */
  async updatePartnerStatus(
    partnerId: string,
    dto: IUpdatePartnerStatusDto,
    options: PartnerRequestOptions = {},
  ): Promise<IPartnerAdminDetailDto> {
    return apiRequest<IPartnerAdminDetailDto>(
      `/admin/partners/${encodeURIComponent(partnerId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify(dto),
        signal: options.signal,
      },
    );
  },

  /**
   * API 4: Retrieve chronological, immutable partner lifecycle audit logs.
   * GET /api/v1/admin/partners/:partnerId/audit-logs
   */
  async getPartnerAuditLogs(
    partnerId: string,
    query: PartnerAuditLogQuery = {},
    options: PartnerRequestOptions = {},
  ): Promise<IAdminPartnerAuditLogListResponseDto> {
    const params = new URLSearchParams();
    if (query.page !== undefined && query.page !== null) params.set('page', String(query.page));
    if (query.limit !== undefined && query.limit !== null) params.set('limit', String(query.limit));

    const suffix = params.size ? `?${params.toString()}` : '';
    const signal = options.signal ?? query.signal;

    return apiRequest<IAdminPartnerAuditLogListResponseDto>(
      `/admin/partners/${encodeURIComponent(partnerId)}/audit-logs${suffix}`,
      {
        method: 'GET',
        signal,
      },
    );
  },
};
