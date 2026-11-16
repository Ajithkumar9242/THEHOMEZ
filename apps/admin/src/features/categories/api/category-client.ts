import type {
  ICategory,
  ICategoryDetailsResponse,
  ICategoryTreeItem,
  ICreateCategoryDto,
  IUpdateCategoryDto,
} from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

  create(
    data: ICreateCategoryDto,
    options?: { signal?: AbortSignal },
  ): Promise<{ category: ICategory }> {
    return apiRequest('/categories', {
      method: 'POST',
      body: JSON.stringify(data),
      signal: options?.signal,
    });
  },

  update(
    id: string,
    data: IUpdateCategoryDto,
    options?: { signal?: AbortSignal },
  ): Promise<{ category: ICategory }> {
    return apiRequest(`/categories/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
      signal: options?.signal,
    });
  },

  delete(id: string, options?: { signal?: AbortSignal }): Promise<{ message: string }> {
    return apiRequest(`/categories/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal: options?.signal,
    });
  },
};
