import type { IAdminProductQueryDto, IProduct } from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export interface ProductPage {
  items: IProduct[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const productClient = {
  list(query: IAdminProductQueryDto & { signal?: AbortSignal }): Promise<ProductPage> {
    const params = new URLSearchParams();
    for (const key of [
      'page',
      'limit',
      'status',
      'categoryId',
      'subcategoryId',
      'brand',
      'search',
    ] as const) {
      const value = query[key];
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const suffix = params.size ? `?${params.toString()}` : '';
    return apiRequest(`/products${suffix}`, { method: 'GET', signal: query.signal });
  },
  async get(id: string, options: { signal?: AbortSignal } = {}): Promise<IProduct> {
    const result = await apiRequest<{ product: IProduct }>(`/products/${encodeURIComponent(id)}`, {
      method: 'GET',
      signal: options.signal,
    });
    return result.product;
  },
};
