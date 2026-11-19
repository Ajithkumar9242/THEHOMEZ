import { useCallback, useEffect, useRef, useState } from 'react';
import type { IPartnerAdminDetailDto } from '@thehomez/shared-types';
import { partnerClient } from '../api/partner-client.js';

interface UsePartnerDetailOptions {
  enabled?: boolean;
}

export function usePartnerDetail(
  partnerId: string,
  { enabled = true }: UsePartnerDetailOptions = {},
) {
  const [partner, setPartner] = useState<IPartnerAdminDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!enabled || !partnerId) {
      setLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const data = await partnerClient.getPartnerById(partnerId, {
        signal: controller.signal,
      });
      setPartner(data);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [enabled, partnerId]);

  useEffect(() => {
    void fetchDetail();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchDetail]);

  return {
    partner,
    setPartner,
    loading,
    error,
    retry: fetchDetail,
    refresh: fetchDetail,
  };
}
