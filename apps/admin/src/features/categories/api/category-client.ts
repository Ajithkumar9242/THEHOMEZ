import type { ICategoryDetailsResponse, ICategoryTreeItem } from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export const categoryClient = {
  getTree(options: {
    includeInactive: boolean;
    signal?: AbortSignal;
  }): Promise<{ categories: ICategoryTreeItem[] }> {
    const query = new URLSearchParams();
    if (options.includeInactive) query.set('includeInactive', 'true');
    const suffix = query.size ? `?${query.toString()}` : '';
    return apiRequest(`/categories${suffix}`, { method: 'GET', signal: options.signal });
  },

  getDetails(
    slug: string,
    options: { includeInactive: boolean; signal?: AbortSignal },
  ): Promise<ICategoryDetailsResponse> {
    const query = new URLSearchParams();
    if (options.includeInactive) query.set('includeInactive', 'true');
    const suffix = query.size ? `?${query.toString()}` : '';
    return apiRequest(`/categories/${encodeURIComponent(slug)}${suffix}`, {
      method: 'GET',
      signal: options.signal,
    });
  },
};
