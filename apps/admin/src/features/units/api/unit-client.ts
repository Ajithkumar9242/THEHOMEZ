import type { IUnit, UnitClassification } from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export interface UnitListQuery {
  classification?: UnitClassification;
  activeOnly?: boolean;
  signal?: AbortSignal;
}

export const unitClient = {
  list(query: UnitListQuery = {}): Promise<IUnit[]> {
    const params = new URLSearchParams();
    if (query.classification) params.set('classification', query.classification);
    params.set('activeOnly', String(query.activeOnly ?? true));
    const suffix = `?${params.toString()}`;
    return apiRequest(`/units${suffix}`, { method: 'GET', signal: query.signal });
  },

  getByCode(code: string, options: { signal?: AbortSignal } = {}): Promise<IUnit> {
    return apiRequest(`/units/${encodeURIComponent(code)}`, {
      method: 'GET',
      signal: options.signal,
    });
  },
};
