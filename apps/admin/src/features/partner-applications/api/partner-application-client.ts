import type {
  CreatePartnerApplicationInput,
  IApprovePartnerApplicationInput,
  IPartnerAdminDetailDto,
  IPartnerApplicationDto,
  IPartnerApplicationListResponseDto,
  IRejectPartnerApplicationInput,
  IWithdrawPartnerApplicationInput,
  PartnerApplicationStatus,
} from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export interface PartnerApplicationRequestOptions {
  signal?: AbortSignal;
}

export interface PartnerApplicationListQuery extends PartnerApplicationRequestOptions {
  page?: number;
  limit?: number;
  search?: string;
  status?: PartnerApplicationStatus;
  serviceAreaId?: string;
  sortBy?: 'createdAt' | 'businessName' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface ApprovePartnerApplicationResponse {
  application: IPartnerApplicationDto;
  partner: IPartnerAdminDetailDto;
}

export const partnerApplicationClient = {
  /**
   * API: List partner applications directory with pagination, search, status, and service-area filtering.
   * GET /api/v1/admin/partner-applications
   */
  async listApplications(
    query: PartnerApplicationListQuery = {},
    options: PartnerApplicationRequestOptions = {},
  ): Promise<IPartnerApplicationListResponseDto> {
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

    return apiRequest<IPartnerApplicationListResponseDto>(`/admin/partner-applications${suffix}`, {
      method: 'GET',
      signal,
    });
  },

  /**
   * API: Inspect full application profile, initial user, embedded audit history, and lifecycle status.
   * GET /api/v1/admin/partner-applications/:id
   */
  async getApplicationById(
    id: string,
    options: PartnerApplicationRequestOptions = {},
  ): Promise<IPartnerApplicationDto> {
    return apiRequest<IPartnerApplicationDto>(
      `/admin/partner-applications/${encodeURIComponent(id)}`,
      {
        method: 'GET',
        signal: options.signal,
      },
    );
  },

  /**
   * API 1: Submit new partner application (intake).
   * POST /api/v1/admin/partner-applications
   */
  async createApplication(
    input: CreatePartnerApplicationInput,
    options: PartnerApplicationRequestOptions = {},
  ): Promise<IPartnerApplicationDto> {
    return apiRequest<IPartnerApplicationDto>('/admin/partner-applications', {
      method: 'POST',
      body: JSON.stringify(input),
      signal: options.signal,
    });
  },

  /**
   * API 2: Transition application from SUBMITTED to UNDER_REVIEW.
   * POST /api/v1/admin/partner-applications/:id/review
   */
  async reviewApplication(
    id: string,
    options: PartnerApplicationRequestOptions = {},
  ): Promise<IPartnerApplicationDto> {
    return apiRequest<IPartnerApplicationDto>(
      `/admin/partner-applications/${encodeURIComponent(id)}/review`,
      {
        method: 'POST',
        body: JSON.stringify({}),
        signal: options.signal,
      },
    );
  },

  /**
   * API 3: Reject partner application with mandatory refusal code and reason.
   * POST /api/v1/admin/partner-applications/:id/reject
   */
  async rejectApplication(
    id: string,
    input: IRejectPartnerApplicationInput,
    options: PartnerApplicationRequestOptions = {},
  ): Promise<IPartnerApplicationDto> {
    return apiRequest<IPartnerApplicationDto>(
      `/admin/partner-applications/${encodeURIComponent(id)}/reject`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options.signal,
      },
    );
  },

  /**
   * API: Withdraw partner application with mandatory reason.
   * POST /api/v1/admin/partner-applications/:id/withdraw
   */
  async withdrawApplication(
    id: string,
    input: IWithdrawPartnerApplicationInput,
    options: PartnerApplicationRequestOptions = {},
  ): Promise<IPartnerApplicationDto> {
    return apiRequest<IPartnerApplicationDto>(
      `/admin/partner-applications/${encodeURIComponent(id)}/withdraw`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options.signal,
      },
    );
  },

  /**
   * API 4: Transactional Approval Gate: Atomically approve application and provision operational Partner & User.
   * POST /api/v1/admin/partner-applications/:id/approve
   */
  async approveApplication(
    id: string,
    input: IApprovePartnerApplicationInput,
    options: PartnerApplicationRequestOptions = {},
  ): Promise<ApprovePartnerApplicationResponse> {
    return apiRequest<ApprovePartnerApplicationResponse>(
      `/admin/partner-applications/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify(input),
        signal: options.signal,
      },
    );
  },
};
