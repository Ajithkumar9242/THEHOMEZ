import type { IProductPricing } from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export interface PricingReadQuery {
  serviceAreaId?: string;
  signal?: AbortSignal;
}

export const pricingClient = {
  async getProductPricing(
    productId: string,
    query: PricingReadQuery = {},
  ): Promise<IProductPricing[]> {
    const params = new URLSearchParams();
    if (query.serviceAreaId) params.set('serviceAreaId', query.serviceAreaId);
    const suffix = params.size ? `?${params.toString()}` : '';
    const result = await apiRequest<{ items: IProductPricing[] }>(
      `/products/${encodeURIComponent(productId)}/pricing${suffix}`,
      { method: 'GET', signal: query.signal },
    );
    return result.items;
  },

  async getVariantPricing(
    productId: string,
    variantId: string,
    query: PricingReadQuery = {},
  ): Promise<IProductPricing[]> {
    const params = new URLSearchParams();
    if (query.serviceAreaId) params.set('serviceAreaId', query.serviceAreaId);
    const suffix = params.size ? `?${params.toString()}` : '';
    const result = await apiRequest<{ items: IProductPricing[] }>(
      `/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/pricing${suffix}`,
      { method: 'GET', signal: query.signal },
    );
    return result.items;
  },
};
