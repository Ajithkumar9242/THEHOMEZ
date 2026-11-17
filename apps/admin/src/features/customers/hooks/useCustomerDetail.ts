import { useCallback, useEffect, useState } from 'react';
import type { IAdminCustomerDetailDto } from '@thehomez/shared-types';
import { customerClient } from '../api/customer-client.js';

export interface UseCustomerDetailOptions {
  enabled?: boolean;
}

export function useCustomerDetail(
  customerId: string,
  { enabled = true }: UseCustomerDetailOptions = {},
) {
  const [customer, setCustomer] = useState<IAdminCustomerDetailDto | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState<number>(0);

  const retry = useCallback(() => {
    setAttempt((prev) => prev + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !customerId) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    customerClient
      .getCustomerById(customerId, { signal: controller.signal })
      .then((data: IAdminCustomerDetailDto) => {
        if (!controller.signal.aborted) {
          setCustomer(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setCustomer(null);
          setError(err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [customerId, enabled, attempt]);

  return {
    customer,
    loading,
    error,
    retry,
  };
}
