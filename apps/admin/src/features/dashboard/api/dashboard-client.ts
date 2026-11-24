import type {
  IAdminDashboardSummaryDto,
  IOperationalExceptionsDto,
  IPartnerOverviewDto,
  IRecentActivityDto,
  DashboardDateRange,
} from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export interface DashboardSummaryQueryParams {
  dateRange?: DashboardDateRange;
  startDate?: string;
  endDate?: string;
}

export const dashboardClient = {
  /**
   * Fetches top-level summary metrics with date filtering and RBAC masking.
   */
  async getSummary(
    params?: DashboardSummaryQueryParams,
    signal?: AbortSignal,
  ): Promise<IAdminDashboardSummaryDto> {
    const searchParams = new URLSearchParams();
    if (params?.dateRange) searchParams.set('dateRange', params.dateRange);
    if (params?.startDate) searchParams.set('startDate', params.startDate);
    if (params?.endDate) searchParams.set('endDate', params.endDate);

    const query = searchParams.toString();
    const path = `/admin/dashboard/summary${query ? `?${query}` : ''}`;
    return apiRequest<IAdminDashboardSummaryDto>(path, { signal });
  },

  /**
   * Fetches detailed partner operational metrics (Requires PARTNER_READ).
   */
  async getPartnerOverview(signal?: AbortSignal): Promise<IPartnerOverviewDto> {
    return apiRequest<IPartnerOverviewDto>('/admin/dashboard/partner-overview', { signal });
  },

  /**
   * Fetches actionable operational exceptions.
   */
  async getOperationalExceptions(
    limit = 10,
    signal?: AbortSignal,
  ): Promise<IOperationalExceptionsDto> {
    return apiRequest<IOperationalExceptionsDto>(
      `/admin/dashboard/operational-exceptions?limit=${limit}`,
      { signal },
    );
  },

  /**
   * Fetches recent operational audit logs (Requires AUDIT_READ).
   */
  async getRecentActivity(limit = 10, signal?: AbortSignal): Promise<IRecentActivityDto> {
    return apiRequest<IRecentActivityDto>(`/admin/dashboard/recent-activity?limit=${limit}`, {
      signal,
    });
  },
};
