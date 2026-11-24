import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  IAdminDashboardSummaryDto,
  IOperationalExceptionsDto,
  IPartnerOverviewDto,
  IRecentActivityDto,
  DashboardDateRange,
} from '@thehomez/shared-types';
import { dashboardClient } from '../api/dashboard-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { PermissionCode } from '@thehomez/shared-types';

export interface UseDashboardDataResult {
  dateRange: DashboardDateRange;
  setDateRange: (range: DashboardDateRange) => void;

  // Summary State
  summary: IAdminDashboardSummaryDto | null;
  summaryLoading: boolean;
  summaryError: string | null;

  // Partner Overview State
  partnerOverview: IPartnerOverviewDto | null;
  partnerLoading: boolean;
  partnerError: string | null;

  // Operational Exceptions State
  exceptions: IOperationalExceptionsDto | null;
  exceptionsLoading: boolean;
  exceptionsError: string | null;

  // Recent Activity State
  recentActivity: IRecentActivityDto | null;
  activityLoading: boolean;
  activityError: string | null;

  // Actions
  refreshAll: () => Promise<void>;
  isRefreshing: boolean;
}

export function useDashboardData(): UseDashboardDataResult {
  const { user } = useAuth();
  const [dateRange, setDateRange] = useState<DashboardDateRange>('30d');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Widget States
  const [summary, setSummary] = useState<IAdminDashboardSummaryDto | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [partnerOverview, setPartnerOverview] = useState<IPartnerOverviewDto | null>(null);
  const [partnerLoading, setPartnerLoading] = useState(false);
  const [partnerError, setPartnerError] = useState<string | null>(null);

  const [exceptions, setExceptions] = useState<IOperationalExceptionsDto | null>(null);
  const [exceptionsLoading, setExceptionsLoading] = useState(true);
  const [exceptionsError, setExceptionsError] = useState<string | null>(null);

  const [recentActivity, setRecentActivity] = useState<IRecentActivityDto | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const canReadPartner =
    user?.roles?.includes('SUPER_ADMIN') ||
    user?.permissions?.includes(PermissionCode.PARTNER_READ);

  const canReadAudit =
    user?.roles?.includes('SUPER_ADMIN') || user?.permissions?.includes(PermissionCode.AUDIT_READ);

  const fetchSummary = useCallback(async (range: DashboardDateRange, signal: AbortSignal) => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const data = await dashboardClient.getSummary({ dateRange: range }, signal);
      setSummary(data);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setSummaryError(err.message || 'Failed to load summary metrics.');
      }
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const fetchPartnerOverview = useCallback(
    async (signal: AbortSignal) => {
      if (!canReadPartner) return;
      setPartnerLoading(true);
      setPartnerError(null);
      try {
        const data = await dashboardClient.getPartnerOverview(signal);
        setPartnerOverview(data);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setPartnerError(err.message || 'Failed to load partner overview.');
        }
      } finally {
        setPartnerLoading(false);
      }
    },
    [canReadPartner],
  );

  const fetchExceptions = useCallback(async (signal: AbortSignal) => {
    setExceptionsLoading(true);
    setExceptionsError(null);
    try {
      const data = await dashboardClient.getOperationalExceptions(10, signal);
      setExceptions(data);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setExceptionsError(err.message || 'Failed to load operational exceptions.');
      }
    } finally {
      setExceptionsLoading(false);
    }
  }, []);

  const fetchRecentActivity = useCallback(
    async (signal: AbortSignal) => {
      if (!canReadAudit) return;
      setActivityLoading(true);
      setActivityError(null);
      try {
        const data = await dashboardClient.getRecentActivity(10, signal);
        setRecentActivity(data);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          setActivityError(err.message || 'Failed to load recent activity.');
        }
      } finally {
        setActivityLoading(false);
      }
    },
    [canReadAudit],
  );

  // Main fetch effect on mount or dateRange change
  useEffect(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    void fetchSummary(dateRange, controller.signal);
    void fetchPartnerOverview(controller.signal);
    void fetchExceptions(controller.signal);
    void fetchRecentActivity(controller.signal);

    return () => {
      controller.abort();
    };
  }, [dateRange, fetchSummary, fetchPartnerOverview, fetchExceptions, fetchRecentActivity]);

  const refreshAll = useCallback(async () => {
    setIsRefreshing(true);
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    await Promise.allSettled([
      fetchSummary(dateRange, controller.signal),
      fetchPartnerOverview(controller.signal),
      fetchExceptions(controller.signal),
      fetchRecentActivity(controller.signal),
    ]);
    setIsRefreshing(false);
  }, [dateRange, fetchSummary, fetchPartnerOverview, fetchExceptions, fetchRecentActivity]);

  return {
    dateRange,
    setDateRange,
    summary,
    summaryLoading,
    summaryError,
    partnerOverview,
    partnerLoading,
    partnerError,
    exceptions,
    exceptionsLoading,
    exceptionsError,
    recentActivity,
    activityLoading,
    activityError,
    refreshAll,
    isRefreshing,
  };
}
