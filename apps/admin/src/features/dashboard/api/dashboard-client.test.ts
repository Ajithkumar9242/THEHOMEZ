import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dashboardClient } from './dashboard-client.js';
import * as apiClient from '../../../services/api-client.js';

describe('Admin Dashboard API Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls /admin/dashboard/summary with formatted query parameters', async () => {
    const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue({
      timestamp: '2026-11-24T00:00:00.000Z',
      dateRange: '7d',
    } as any);

    const result = await dashboardClient.getSummary({
      dateRange: '7d',
      startDate: '2026-11-17T00:00:00.000Z',
      endDate: '2026-11-24T00:00:00.000Z',
    });

    expect(spy).toHaveBeenCalledWith(
      '/admin/dashboard/summary?dateRange=7d&startDate=2026-11-17T00%3A00%3A00.000Z&endDate=2026-11-24T00%3A00%3A00.000Z',
      { signal: undefined },
    );
    expect(result.dateRange).toBe('7d');
  });

  it('calls /admin/dashboard/partner-overview', async () => {
    const mockPartnerData = {
      activePartnersCount: 15,
      pendingVerificationCount: 3,
      suspendedPartnersCount: 1,
      totalApplicationsCount: 4,
      applicationsUnderReviewCount: 2,
      statusBreakdown: [],
      deliveryModeBreakdown: [],
    };
    const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockPartnerData);

    const result = await dashboardClient.getPartnerOverview();

    expect(spy).toHaveBeenCalledWith('/admin/dashboard/partner-overview', { signal: undefined });
    expect(result.activePartnersCount).toBe(15);
  });

  it('calls /admin/dashboard/operational-exceptions with bounded limit', async () => {
    const mockExceptions = {
      totalCount: 2,
      criticalCount: 1,
      items: [],
    };
    const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockExceptions);

    const result = await dashboardClient.getOperationalExceptions(5);

    expect(spy).toHaveBeenCalledWith('/admin/dashboard/operational-exceptions?limit=5', {
      signal: undefined,
    });
    expect(result.totalCount).toBe(2);
  });

  it('calls /admin/dashboard/recent-activity with limit', async () => {
    const mockActivity = {
      totalCount: 3,
      items: [],
    };
    const spy = vi.spyOn(apiClient, 'apiRequest').mockResolvedValue(mockActivity);

    const result = await dashboardClient.getRecentActivity(10);

    expect(spy).toHaveBeenCalledWith('/admin/dashboard/recent-activity?limit=10', {
      signal: undefined,
    });
    expect(result.totalCount).toBe(3);
  });
});
