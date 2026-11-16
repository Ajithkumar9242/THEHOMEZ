import type {
  IAdminProductQueryDto,
  ICreateProductDto,
  IProduct,
  IUpdateProductDto,
} from '@thehomez/shared-types';
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
  async create(dto: ICreateProductDto): Promise<IProduct> {
    const result = await apiRequest<{ product: IProduct }>('/products', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
    return result.product;
  },
  async update(id: string, dto: IUpdateProductDto): Promise<IProduct> {
    const result = await apiRequest<{ product: IProduct }>(`/products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
    return result.product;
  },
  async publish(id: string): Promise<IProduct> {
    const result = await apiRequest<{ product: IProduct }>(
      `/products/${encodeURIComponent(id)}/publish`,
      { method: 'POST' },
    );
    return result.product;
  },
  async deactivate(id: string): Promise<IProduct> {
    const result = await apiRequest<{ product: IProduct }>(
      `/products/${encodeURIComponent(id)}/deactivate`,
      { method: 'POST' },
    );
    return result.product;
  },
  async archive(id: string): Promise<IProduct> {
    const result = await apiRequest<{ product: IProduct }>(
      `/products/${encodeURIComponent(id)}/archive`,
      { method: 'POST' },
    );
    return result.product;
  },
  deleteDraft(id: string): Promise<{ message: string }> {
    return apiRequest<{ message: string }>(`/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },
};
