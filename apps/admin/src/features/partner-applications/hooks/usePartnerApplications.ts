import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  IPartnerApplicationSummaryDto,
  PartnerApplicationStatus,
  IServiceArea,
} from '@thehomez/shared-types';
import {
  partnerApplicationClient,
  type PartnerApplicationListQuery,
} from '../api/partner-application-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';

interface UsePartnerApplicationsOptions {
  enabled?: boolean;
  debounceMs?: number;
  initialLimit?: number;
}

export function usePartnerApplications({
  enabled = true,
  debounceMs = 350,
  initialLimit = 20,
}: UsePartnerApplicationsOptions = {}) {
  // Query States
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState<PartnerApplicationStatus | undefined>(undefined);
  const [serviceAreaId, setServiceAreaId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<PartnerApplicationListQuery['sortBy']>('createdAt');
  const [sortOrder, setSortOrder] = useState<PartnerApplicationListQuery['sortOrder']>('desc');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(initialLimit);

  // Response States
  const [items, setItems] = useState<IPartnerApplicationSummaryDto[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Service Areas for filter dropdown
  const [serviceAreas, setServiceAreas] = useState<IServiceArea[]>([]);
  const [loadingServiceAreas, setLoadingServiceAreas] = useState(false);

  // Abort controller ref
  const abortControllerRef = useRef<AbortController | null>(null);

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(() => {
      setAppliedSearch(searchInput.trim());
      setPage(1);
    }, debounceMs);
    return () => clearTimeout(handler);
  }, [searchInput, debounceMs]);

  const applySearchImmediately = useCallback(() => {
    setAppliedSearch(searchInput.trim());
    setPage(1);
  }, [searchInput]);

  // Fetch Service Areas on mount
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const fetchAreas = async () => {
      setLoadingServiceAreas(true);
      try {
        const res = await serviceAreaClient.list({ limit: 100, isActive: true });
        if (active && res?.items) {
          setServiceAreas(res.items);
        }
      } catch {
        // Non-fatal if service areas filter options fail to load
      } finally {
        if (active) setLoadingServiceAreas(false);
      }
    };
    void fetchAreas();
    return () => {
      active = false;
    };
  }, [enabled]);

  // Main data fetching function
  const fetchApplications = useCallback(async () => {
    if (!enabled) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await partnerApplicationClient.listApplications(
        {
          page,
          limit,
          search: appliedSearch || undefined,
          status,
          serviceAreaId,
          sortBy,
          sortOrder,
        },
        { signal: controller.signal },
      );

      setItems(response.items || []);
      setTotal(response.pagination?.total || 0);
      setTotalPages(response.pagination?.totalPages || 0);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [enabled, page, limit, appliedSearch, status, serviceAreaId, sortBy, sortOrder]);

  // Trigger fetch when parameters change
  useEffect(() => {
    void fetchApplications();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchApplications]);

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setAppliedSearch('');
    setStatus(undefined);
    setServiceAreaId(undefined);
    setSortBy('createdAt');
    setSortOrder('desc');
    setPage(1);
  }, []);

  const hasActiveFilters = useMemo(
    () => Boolean(appliedSearch || status || serviceAreaId),
    [appliedSearch, status, serviceAreaId],
  );

  return {
    // Data & state
    items,
    total,
    totalPages,
    loading,
    error,
    // Filters
    searchInput,
    setSearchInput,
    applySearchImmediately,
    status,
    setStatus: (val: PartnerApplicationStatus | undefined) => {
      setStatus(val);
      setPage(1);
    },
    serviceAreaId,
    setServiceAreaId: (val: string | undefined) => {
      setServiceAreaId(val);
      setPage(1);
    },
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    // Pagination
    page,
    setPage,
    limit,
    setLimit: (newLimit: number) => {
      setLimit(newLimit);
      setPage(1);
    },
    // Service areas for dropdown
    serviceAreas,
    loadingServiceAreas,
    // Actions
    resetFilters,
    hasActiveFilters,
    refresh: fetchApplications,
    retry: fetchApplications,
  };
}
