import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  UserStatus,
  IAdminCustomerListItemDto,
  IAdminCustomerListResponseDto,
} from '@thehomez/shared-types';
import { customerClient, type CustomerListQuery } from '../api/customer-client.js';

export interface UseCustomerDirectoryOptions {
  initialLimit?: number;
  debounceMs?: number;
  enabled?: boolean;
}

export type SortField = 'createdAt' | 'lastLoginAt' | 'phone';
export type SortDirection = 'asc' | 'desc';

export function useCustomerDirectory({
  initialLimit = 20,
  debounceMs = 300,
  enabled = true,
}: UseCustomerDirectoryOptions = {}) {
  // Filter & Query States
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [status, setStatus] = useState<UserStatus | undefined>(undefined);
  const [segment, setSegment] = useState<'B2B' | 'B2C' | undefined>(undefined);
  const [sortBy, setSortBy] = useState<SortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortDirection>('desc');
  const [page, setPage] = useState<number>(1);
  const [limit, setLimit] = useState<number>(initialLimit);

  // Result States
  const [items, setItems] = useState<IAdminCustomerListItemDto[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [hasNextPage, setHasNextPage] = useState<boolean>(false);
  const [hasPrevPage, setHasPrevPage] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState<number>(0);

  // Request race condition & cancellation tracker
  const requestIdRef = useRef<number>(0);

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => {
      const trimmed = searchInput.trim();
      setDebouncedSearch((prev) => {
        if (prev !== trimmed) {
          setPage(1);
          return trimmed;
        }
        return prev;
      });
    }, debounceMs);

    return () => clearTimeout(handler);
  }, [searchInput, debounceMs]);

  // Immediate search apply (e.g. on Enter or clear)
  const applySearchImmediately = useCallback((value: string) => {
    const trimmed = value.trim();
    setSearchInput(value);
    setDebouncedSearch(trimmed);
    setPage(1);
  }, []);

  const handleStatusChange = useCallback((newStatus?: UserStatus) => {
    setStatus(newStatus);
    setPage(1);
  }, []);

  const handleSegmentChange = useCallback((newSegment?: 'B2B' | 'B2C') => {
    setSegment(newSegment);
    setPage(1);
  }, []);

  const handleSortChange = useCallback((field: SortField, direction: SortDirection) => {
    setSortBy(field);
    setSortOrder(direction);
  }, []);

  const handlePaginationChange = useCallback(
    (newPage: number, newLimit?: number) => {
      setPage(newPage);
      if (newLimit && newLimit !== limit) {
        setLimit(newLimit);
      }
    },
    [limit],
  );

  const clearAllFilters = useCallback(() => {
    setSearchInput('');
    setDebouncedSearch('');
    setStatus(undefined);
    setSegment(undefined);
    setPage(1);
  }, []);

  const retry = useCallback(() => {
    setAttempt((prev) => prev + 1);
  }, []);

  // Fetch directory data
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    const query: CustomerListQuery = {
      page,
      limit,
      search: debouncedSearch || undefined,
      status: status || undefined,
      segment: segment || undefined,
      sortBy,
      sortOrder,
      signal: controller.signal,
    };

    customerClient
      .listCustomers(query, { signal: controller.signal })
      .then((response: IAdminCustomerListResponseDto) => {
        if (currentRequestId === requestIdRef.current && !controller.signal.aborted) {
          setItems(response.items);
          setTotal(response.pagination.total);
          setTotalPages(response.pagination.totalPages);
          setHasNextPage(response.pagination.hasNextPage);
          setHasPrevPage(response.pagination.hasPrevPage);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (currentRequestId === requestIdRef.current && !controller.signal.aborted) {
          setError(err);
        }
      })
      .finally(() => {
        if (currentRequestId === requestIdRef.current && !controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [enabled, page, limit, debouncedSearch, status, segment, sortBy, sortOrder, attempt]);

  const hasActiveFilters = Boolean(
    debouncedSearch || searchInput.trim() || status !== undefined || segment !== undefined,
  );

  return {
    // Filter & Query States
    searchInput,
    setSearchInput,
    applySearchImmediately,
    debouncedSearch,
    status,
    setStatus: handleStatusChange,
    segment,
    setSegment: handleSegmentChange,
    sortBy,
    sortOrder,
    setSorting: handleSortChange,
    page,
    limit,
    setPagination: handlePaginationChange,
    clearAllFilters,
    hasActiveFilters,

    // Data States
    items,
    total,
    totalPages,
    hasNextPage,
    hasPrevPage,
    loading,
    error,
    retry,
  };
}
