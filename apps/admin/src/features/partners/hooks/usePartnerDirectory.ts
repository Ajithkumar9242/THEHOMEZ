import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  IAdminPartnerQueryDto,
  IPartnerAdminSummaryDto,
  PartnerStatus,
  IServiceArea,
} from '@thehomez/shared-types';
import { partnerClient } from '../api/partner-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';

interface UsePartnerDirectoryOptions {
  enabled?: boolean;
  debounceMs?: number;
  initialLimit?: number;
}

export function usePartnerDirectory({
  enabled = true,
  debounceMs = 350,
  initialLimit = 20,
}: UsePartnerDirectoryOptions = {}) {
  // Query States
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [status, setStatus] = useState<PartnerStatus | undefined>(undefined);
  const [serviceAreaId, setServiceAreaId] = useState<string | undefined>(undefined);
  const [sortBy, setSortBy] = useState<IAdminPartnerQueryDto['sortBy']>('createdAt');
  const [sortOrder, setSortOrder] = useState<IAdminPartnerQueryDto['sortOrder']>('desc');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(initialLimit);

  // Response States
  const [items, setItems] = useState<IPartnerAdminSummaryDto[]>([]);
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
        const res = await serviceAreaClient.list({ limit: 100 });
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
  const fetchPartners = useCallback(async () => {
    if (!enabled) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await partnerClient.listPartners(
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

      setItems(response.items);
      setTotal(response.pagination.total);
      setTotalPages(response.pagination.totalPages);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [enabled, page, limit, appliedSearch, status, serviceAreaId, sortBy, sortOrder]);

  useEffect(() => {
    void fetchPartners();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchPartners]);

  const handlePaginationChange = useCallback(
    (newPage: number, newPageSize?: number) => {
      setPage(newPage);
      if (newPageSize && newPageSize !== limit) {
        setLimit(newPageSize);
        setPage(1);
      }
    },
    [limit],
  );

  const handleSortChange = useCallback(
    (field: IAdminPartnerQueryDto['sortBy'], order: IAdminPartnerQueryDto['sortOrder']) => {
      setSortBy(field);
      setSortOrder(order);
      setPage(1);
    },
    [],
  );

  const clearAllFilters = useCallback(() => {
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
    searchInput,
    setSearchInput,
    applySearchImmediately,
    status,
    setStatus: (newStatus: PartnerStatus | undefined) => {
      setStatus(newStatus);
      setPage(1);
    },
    serviceAreaId,
    setServiceAreaId: (newSaId: string | undefined) => {
      setServiceAreaId(newSaId);
      setPage(1);
    },
    sortBy,
    sortOrder,
    setSorting: handleSortChange,
    page,
    limit,
    setPagination: handlePaginationChange,
    clearAllFilters,
    hasActiveFilters,
    items,
    total,
    totalPages,
    loading,
    error,
    retry: fetchPartners,
    refresh: fetchPartners,
    serviceAreas,
    loadingServiceAreas,
  };
}
