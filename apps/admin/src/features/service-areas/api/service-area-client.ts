import type { IServiceArea } from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export interface ServiceAreaListResponse {
  items: IServiceArea[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ServiceAreaListQuery {
  city?: string;
  state?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
  signal?: AbortSignal;
}

export const serviceAreaClient = {
  list(query: ServiceAreaListQuery = {}): Promise<ServiceAreaListResponse> {
    const params = new URLSearchParams();
    if (query.city?.trim()) params.set('city', query.city.trim());
    if (query.state?.trim()) params.set('state', query.state.trim());
    if (query.isActive !== undefined) params.set('isActive', String(query.isActive));
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const suffix = params.size ? `?${params.toString()}` : '';
    return apiRequest(`/service-areas${suffix}`, { method: 'GET', signal: query.signal });
  },

  get(id: string, options: { signal?: AbortSignal } = {}): Promise<IServiceArea> {
    return apiRequest(`/service-areas/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal: options.signal,
    });
  },
};
