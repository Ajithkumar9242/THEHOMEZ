import type { IProductVariant } from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export const variantClient = {
  async list(
    productId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<IProductVariant[]> {
    const result = await apiRequest<{ variants: IProductVariant[] }>(
      `/products/${encodeURIComponent(productId)}/variants`,
      { method: 'GET', signal: options.signal },
    );
    return result.variants;
  },
  async get(
    productId: string,
    variantId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<IProductVariant> {
    const result = await apiRequest<{ variant: IProductVariant }>(
      `/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
      { method: 'GET', signal: options.signal },
    );
    return result.variant;
  },
};
