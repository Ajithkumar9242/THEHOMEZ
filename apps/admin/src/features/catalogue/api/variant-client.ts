import type {
  ICreateProductVariantDto,
  IProductVariant,
  IUpdateProductVariantDto,
} from '@thehomez/shared-types';
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
  async create(productId: string, dto: ICreateProductVariantDto): Promise<IProductVariant> {
    const result = await apiRequest<{ variant: IProductVariant }>(
      `/products/${encodeURIComponent(productId)}/variants`,
      {
        method: 'POST',
        body: JSON.stringify(dto),
      },
    );
    return result.variant;
  },
  async update(
    productId: string,
    variantId: string,
    dto: IUpdateProductVariantDto,
  ): Promise<IProductVariant> {
    const result = await apiRequest<{ variant: IProductVariant }>(
      `/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(dto),
      },
    );
    return result.variant;
  },
  async deactivate(productId: string, variantId: string): Promise<IProductVariant> {
    const result = await apiRequest<{ variant: IProductVariant }>(
      `/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/deactivate`,
      { method: 'POST' },
    );
    return result.variant;
  },
  async archive(productId: string, variantId: string): Promise<IProductVariant> {
    const result = await apiRequest<{ variant: IProductVariant }>(
      `/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/archive`,
      { method: 'POST' },
    );
    return result.variant;
  },
};
