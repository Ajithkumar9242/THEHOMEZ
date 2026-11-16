import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from '../../../services/api-client.js';
import { pricingClient } from './pricing-client.js';

vi.mock('../../../services/api-client.js', () => ({ apiRequest: vi.fn() }));

afterEach(() => vi.clearAllMocks());

describe('pricingClient', () => {
  it('reads standalone product records using only the approved GET path', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [] });
    await pricingClient.getProductPricing('p/1');
    expect(apiRequest).toHaveBeenCalledWith('/products/p%2F1/pricing', {
      method: 'GET',
      signal: undefined,
    });
  });

  it('scopes variant reads to both product and variant and supports only serviceAreaId', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ items: [] });
    const controller = new AbortController();
    await pricingClient.getVariantPricing('p1', 'v1', {
      serviceAreaId: 'area-1',
      signal: controller.signal,
    });
    expect(apiRequest).toHaveBeenCalledWith(
      '/products/p1/variants/v1/pricing?serviceAreaId=area-1',
      { method: 'GET', signal: controller.signal },
    );
  });
});
