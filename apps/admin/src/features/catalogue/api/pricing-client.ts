import type { IPriceHistory, IProductPricing, ISetPricingDto } from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export interface PricingReadQuery {
  serviceAreaId?: string;
  signal?: AbortSignal;
}

export interface PricingHistoryQuery {
  variantId?: string;
  page?: number;
  limit?: number;
  signal?: AbortSignal;
}

export interface PriceHistoryPage {
  items: IPriceHistory[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PricingMutationOptions {
  signal?: AbortSignal;
}

/**
 * Request payload for setting standalone or variant pricing.
 * Combines shared ISetPricingDto with optional backend-supported optimistic concurrency version.
 */
export type SetPricingPayload = ISetPricingDto & {
  expectedVersion?: number;
};

/**
 * Request payload for setting regional standalone or variant pricing overrides.
 * Requires a non-empty serviceAreaId string targeting an active service area.
 */
export type SetRegionalPricingPayload = Omit<SetPricingPayload, 'serviceAreaId'> & {
  serviceAreaId: string;
};

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

  async setProductPricing(
    productId: string,
    dto: SetPricingPayload,
    options: PricingMutationOptions = {},
  ): Promise<IProductPricing> {
    const result = await apiRequest<{ pricing: IProductPricing }>(
      `/products/${encodeURIComponent(productId)}/pricing`,
      {
        method: 'PUT',
        body: JSON.stringify(dto),
        signal: options.signal,
      },
    );
    return result.pricing;
  },

  async setVariantPricing(
    productId: string,
    variantId: string,
    dto: SetPricingPayload,
    options: PricingMutationOptions = {},
  ): Promise<IProductPricing> {
    const result = await apiRequest<{ pricing: IProductPricing }>(
      `/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(variantId)}/pricing`,
      {
        method: 'PUT',
        body: JSON.stringify(dto),
        signal: options.signal,
      },
    );
    return result.pricing;
  },

  async setProductRegionalPricing(
    productId: string,
    dto: SetRegionalPricingPayload,
    options: PricingMutationOptions = {},
  ): Promise<IProductPricing> {
    if (
      !dto.serviceAreaId ||
      typeof dto.serviceAreaId !== 'string' ||
      dto.serviceAreaId.trim() === ''
    ) {
      throw new Error('serviceAreaId must be a non-empty string for regional pricing');
    }
    return pricingClient.setProductPricing(productId, dto, options);
  },

  async setVariantRegionalPricing(
    productId: string,
    variantId: string,
    dto: SetRegionalPricingPayload,
    options: PricingMutationOptions = {},
  ): Promise<IProductPricing> {
    if (
      !dto.serviceAreaId ||
      typeof dto.serviceAreaId !== 'string' ||
      dto.serviceAreaId.trim() === ''
    ) {
      throw new Error('serviceAreaId must be a non-empty string for regional pricing');
    }
    return pricingClient.setVariantPricing(productId, variantId, dto, options);
  },

  async getPricingHistory(
    productId: string,
    query: PricingHistoryQuery = {},
  ): Promise<PriceHistoryPage> {
    const params = new URLSearchParams();
    if (query.variantId) params.set('variantId', query.variantId);
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const suffix = params.size ? `?${params.toString()}` : '';
    return apiRequest<PriceHistoryPage>(
      `/products/${encodeURIComponent(productId)}/pricing/history${suffix}`,
      { method: 'GET', signal: query.signal },
    );
  },
};
