import { useCallback, useEffect, useRef, useState } from 'react';
import type { IPartnerApplicationDto } from '@thehomez/shared-types';
import { partnerApplicationClient } from '../api/partner-application-client.js';

interface UsePartnerApplicationDetailOptions {
  enabled?: boolean;
}

export function usePartnerApplicationDetail(
  applicationId: string,
  { enabled = true }: UsePartnerApplicationDetailOptions = {},
) {
  const [application, setApplication] = useState<IPartnerApplicationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!enabled || !applicationId) {
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
      const data = await partnerApplicationClient.getApplicationById(applicationId, {
        signal: controller.signal,
      });
      setApplication(data);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [enabled, applicationId]);

  useEffect(() => {
    void fetchDetail();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchDetail]);

  return {
    application,
    setApplication,
    loading,
    error,
    retry: fetchDetail,
    refresh: fetchDetail,
  };
}
