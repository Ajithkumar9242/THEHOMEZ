import type {
  IAdminPartnerAuditLogListResponseDto,
  IAdminPartnerListResponseDto,
  IAdminPartnerQueryDto,
  IPartnerAdminDetailDto,
  IUpdatePartnerStatusDto,
  IUpdatePartnerProfileDto,
  IReactivatePartnerDto,
  IPartnerDocumentListResponseDto,
  ISignedUrlResponseDto,
  IReviewPartnerDocumentRequestDto,
  IReviewPartnerDocumentResponseDto,
  IDeletePartnerDocumentResponseDto,
  IScanOverrideRequestDto,
  IScanOverrideResponseDto,
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
   * API (P1A-13): Update partner profile metadata.
   * PUT /api/v1/admin/partners/:partnerId
   */
  async updatePartnerProfile(
    partnerId: string,
    dto: IUpdatePartnerProfileDto,
    options: PartnerRequestOptions = {},
  ): Promise<IPartnerAdminDetailDto> {
    return apiRequest<IPartnerAdminDetailDto>(`/admin/partners/${encodeURIComponent(partnerId)}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
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
   * API (P1A-14): Reactivate a partner with KYC proof validation and supervisory waiver.
   * POST /api/v1/admin/partners/:partnerId/reactivate
   */
  async reactivatePartner(
    partnerId: string,
    dto: IReactivatePartnerDto,
    options: PartnerRequestOptions = {},
  ): Promise<IPartnerAdminDetailDto> {
    return apiRequest<IPartnerAdminDetailDto>(
      `/admin/partners/${encodeURIComponent(partnerId)}/reactivate`,
      {
        method: 'POST',
        body: JSON.stringify(dto),
        signal: options.signal,
      },
    );
  },

  /**
   * API (P1A-16): Dedicated administrative partner service area assignment.
   * PUT /api/v1/admin/partners/:partnerId/service-areas
   */
  async assignServiceAreas(
    partnerId: string,
    serviceAreaIds: string[],
    options: PartnerRequestOptions = {},
  ): Promise<{ partnerId: string; serviceAreaIds: string[] }> {
    return apiRequest<{ partnerId: string; serviceAreaIds: string[] }>(
      `/admin/partners/${encodeURIComponent(partnerId)}/service-areas`,
      {
        method: 'PUT',
        body: JSON.stringify({ serviceAreaIds }),
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

  /**
   * API 5 (P1A-08): Inspect partner KYC documents list.
   * GET /api/v1/admin/partners/:partnerId/documents
   */
  async getPartnerDocuments(
    partnerId: string,
    options: PartnerRequestOptions = {},
  ): Promise<IPartnerDocumentListResponseDto> {
    return apiRequest<IPartnerDocumentListResponseDto>(
      `/admin/partners/${encodeURIComponent(partnerId)}/documents`,
      {
        method: 'GET',
        signal: options.signal,
      },
    );
  },

  /**
   * API 6 (P1A-09): Generate expiring signed download URL for a partner KYC document.
   * GET /api/v1/admin/partners/:partnerId/documents/:docId/signed-url
   */
  async getPartnerDocumentSignedUrl(
    partnerId: string,
    docId: string,
    options: PartnerRequestOptions = {},
  ): Promise<ISignedUrlResponseDto> {
    return apiRequest<ISignedUrlResponseDto>(
      `/admin/partners/${encodeURIComponent(partnerId)}/documents/${encodeURIComponent(docId)}/signed-url`,
      {
        method: 'GET',
        signal: options.signal,
      },
    );
  },

  /**
   * API (P1A-15): Review (verify or reject) partner KYC document.
   * PATCH /api/v1/admin/partners/:partnerId/documents/:docId/status
   */
  async reviewPartnerDocument(
    partnerId: string,
    docId: string,
    dto: IReviewPartnerDocumentRequestDto,
    options: PartnerRequestOptions = {},
  ): Promise<IReviewPartnerDocumentResponseDto> {
    return apiRequest<IReviewPartnerDocumentResponseDto>(
      `/admin/partners/${encodeURIComponent(partnerId)}/documents/${encodeURIComponent(docId)}/status`,
      {
        method: 'PATCH',
        body: JSON.stringify(dto),
        signal: options.signal,
      },
    );
  },

  /**
   * API 7 (P1A-10): Soft delete partner KYC document.
   * DELETE /api/v1/admin/partners/:partnerId/documents/:docId
   */
  async deletePartnerDocument(
    partnerId: string,
    docId: string,
    options: PartnerRequestOptions = {},
  ): Promise<IDeletePartnerDocumentResponseDto> {
    return apiRequest<IDeletePartnerDocumentResponseDto>(
      `/admin/partners/${encodeURIComponent(partnerId)}/documents/${encodeURIComponent(docId)}`,
      {
        method: 'DELETE',
        signal: options.signal,
      },
    );
  },

  /**
   * API 8 (P1A-11): Security override for infected or failed document scan status.
   * POST /api/v1/admin/partners/:partnerId/documents/:docId/scan-override
   */
  async overrideDocumentScanStatus(
    partnerId: string,
    docId: string,
    dto: IScanOverrideRequestDto,
    options: PartnerRequestOptions = {},
  ): Promise<IScanOverrideResponseDto> {
    return apiRequest<IScanOverrideResponseDto>(
      `/admin/partners/${encodeURIComponent(partnerId)}/documents/${encodeURIComponent(docId)}/scan-override`,
      {
        method: 'POST',
        body: JSON.stringify(dto),
        signal: options.signal,
      },
    );
  },
};
