import { useCallback, useEffect, useRef, useState } from 'react';
import type { IPartnerAuditLogDto } from '@thehomez/shared-types';
import { partnerClient } from '../api/partner-client.js';

interface UsePartnerAuditLogsOptions {
  enabled?: boolean;
  initialLimit?: number;
}

export function usePartnerAuditLogs(
  partnerId: string,
  { enabled = true, initialLimit = 20 }: UsePartnerAuditLogsOptions = {},
) {
  const [items, setItems] = useState<IPartnerAuditLogDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(initialLimit);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchAuditLogs = useCallback(async () => {
    if (!enabled || !partnerId) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const response = await partnerClient.getPartnerAuditLogs(
        partnerId,
        { page, limit },
        { signal: controller.signal },
      );
      setItems(response.items);
      setTotal(response.pagination.total);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [enabled, partnerId, page, limit]);

  useEffect(() => {
    void fetchAuditLogs();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchAuditLogs]);

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

  return {
    items,
    total,
    page,
    limit,
    setPagination: handlePaginationChange,
    loading,
    error,
    refresh: fetchAuditLogs,
  };
}
