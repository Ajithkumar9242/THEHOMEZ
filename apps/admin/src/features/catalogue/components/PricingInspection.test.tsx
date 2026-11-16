import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IProductPricing,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { ProtectedRoute } from '../../../routes/ProtectedRoute.js';
import { AdminLayout } from '../../../layouts/AdminLayout.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { pricingClient } from '../api/pricing-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { PricingInspection, formatPricePaise } from './PricingInspection.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/pricing-client.js', () => ({
  pricingClient: { getProductPricing: vi.fn(), getVariantPricing: vi.fn() },
}));
vi.mock('../../service-areas/api/service-area-client.js', () => ({
  serviceAreaClient: { get: vi.fn() },
}));

const staff: IAuthUser = {
  id: 'staff-1',
  phone: '+910000000000',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PermissionCode.CATALOG_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};
const record: IProductPricing = {
  id: 'price-1',
  productId: 'p1',
  variantId: null,
  serviceAreaId: null,
  pricingScope: 'STANDALONE_GLOBAL',
  currency: 'INR',
  b2cPricePaise: 123456,
  b2cMrpPaise: null,
  b2bPricePaise: 100000,
  b2bTiers: [{ minQuantity: '1.250', pricePaise: 90000 }],
  isActive: true,
  version: 3,
  createdBy: 'staff-id',
  updatedBy: 'staff-id',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};
function auth(permissions: PermissionCode[] = [PermissionCode.PRICING_READ]) {
  return {
    user: { ...staff, permissions },
    status: 'signed-in' as const,
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
}
function renderPage({
  path = '/catalogue/products/p1/pricing',
  permissions = [PermissionCode.PRICING_READ],
  variantId,
}: {
  path?: string;
  permissions?: PermissionCode[];
  variantId?: string;
} = {}) {
  vi.mocked(useAuth).mockReturnValue(auth(permissions));
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route element={<ProtectedRoute permission={PermissionCode.PRICING_READ} />}>
          <Route
            path="/catalogue/products/:productId/pricing"
            element={<PricingInspection productId="p1" />}
          />
          <Route
            path="/catalogue/products/:productId/variants/:variantId/pricing"
            element={<PricingInspection productId="p1" variantId={variantId ?? 'v1'} />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(useAuth).mockReset().mockReturnValue(auth());
  vi.mocked(pricingClient.getProductPricing).mockReset();
  vi.mocked(pricingClient.getVariantPricing).mockReset();
  vi.mocked(serviceAreaClient.get).mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('formatPricePaise', () => {
  it.each([
    [0, '₹0.00'],
    [1, '₹0.01'],
    [1001, '₹10.01'],
    [Number.MAX_SAFE_INTEGER, '₹9,00,71,99,25,47,409.91'],
    [null, '—'],
  ])('formats %s paise as %s exactly', (value, expected) => {
    expect(formatPricePaise(value)).toBe(expected);
  });
});

describe('PricingInspection', () => {
  it('denies users without PRICING_READ and makes no pricing or service-area request', () => {
    vi.mocked(useAuth).mockReturnValue(auth([PermissionCode.CATALOG_READ]));
    render(
      <MemoryRouter>
        <PricingInspection productId="p1" />
      </MemoryRouter>,
    );
    expect(screen.getByText('PRICING_READ permission required')).toBeInTheDocument();
    expect(pricingClient.getProductPricing).not.toHaveBeenCalled();
    expect(pricingClient.getVariantPricing).not.toHaveBeenCalled();
    expect(serviceAreaClient.get).not.toHaveBeenCalled();
  });

  it('protects pricing routes with PRICING_READ', () => {
    renderPage({ permissions: [PermissionCode.CATALOG_READ] });
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(pricingClient.getProductPricing).not.toHaveBeenCalled();
  });

  it('hides pricing navigation for unauthorized staff', () => {
    vi.mocked(useAuth).mockReturnValue(auth([PermissionCode.CATALOG_READ]));
    render(
      <MemoryRouter>
        <AdminLayout>
          <div />
        </AdminLayout>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Pricing')).not.toBeInTheDocument();
  });

  it('uses the standalone product id and renders commercial configuration disclosures and fields', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([record]);
    renderPage();
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
    expect(screen.getByText('₹1,000.00')).toBeInTheDocument();
    expect(screen.getByText('1.250')).toBeInTheDocument();
    expect(screen.getByText('₹900.00')).toBeInTheDocument();
    expect(screen.getByText(/Configured prices are GST-exclusive/)).toBeInTheDocument();
    expect(screen.getByText(/not final delivered customer totals/)).toBeInTheDocument();
    expect(pricingClient.getProductPricing).toHaveBeenCalledWith('p1', {
      signal: expect.any(AbortSignal),
    });
  });

  it('omits MRP when null and labels inactive regional records, resolving area names only with permission', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
      {
        ...record,
        id: 'regional',
        serviceAreaId: 'area-1',
        pricingScope: 'STANDALONE_REGIONAL',
        isActive: false,
        b2cMrpPaise: null,
      },
    ]);
    vi.mocked(serviceAreaClient.get).mockResolvedValue({ name: 'North Zone' } as never);
    renderPage({ permissions: [PermissionCode.PRICING_READ, PermissionCode.SERVICE_AREA_READ] });
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText(/North Zone · area-1/)).toBeInTheDocument();
    expect(screen.getByText('STANDALONE REGIONAL')).toBeInTheDocument();
    expect(serviceAreaClient.get).toHaveBeenCalledWith('area-1', {
      signal: expect.any(AbortSignal),
    });
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('keeps regional references visible without SERVICE_AREA_READ and makes no lookup', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
      { ...record, serviceAreaId: 'area-1', pricingScope: 'STANDALONE_REGIONAL' },
    ]);
    renderPage();
    expect(await screen.findByText(/area-1/)).toBeInTheDocument();
    expect(screen.getByText('Service-area names are unavailable')).toBeInTheDocument();
    expect(serviceAreaClient.get).not.toHaveBeenCalled();
  });

  it('requests a variant only with both the selected parent and variant ids', async () => {
    vi.mocked(pricingClient.getVariantPricing).mockResolvedValue([{ ...record, variantId: 'v1' }]);
    renderPage({ path: '/catalogue/products/p1/variants/v1/pricing', variantId: 'v1' });
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
    expect(pricingClient.getVariantPricing).toHaveBeenCalledWith('p1', 'v1', {
      signal: expect.any(AbortSignal),
    });
    expect(pricingClient.getProductPricing).not.toHaveBeenCalled();
  });

  it('does not render a pricing record returned for another parent or variant', async () => {
    vi.mocked(pricingClient.getVariantPricing).mockResolvedValue([
      { ...record, variantId: 'v1' },
      { ...record, id: 'other', productId: 'other', variantId: 'v1', b2cPricePaise: 999999 },
      { ...record, id: 'other-variant', variantId: 'v2', b2cPricePaise: 888888 },
    ]);
    renderPage({ path: '/catalogue/products/p1/variants/v1/pricing', variantId: 'v1' });
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
    expect(screen.queryByText('₹9,999.99')).not.toBeInTheDocument();
    expect(screen.queryByText('₹8,888.88')).not.toBeInTheDocument();
  });

  it('shows an empty state when a product has no pricing records', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/No pricing configuration was returned/)).toBeInTheDocument();
  });

  it('handles a missing product or variant pricing context', async () => {
    vi.mocked(pricingClient.getProductPricing).mockRejectedValue(
      new ApiError('missing', 404, 'PRODUCT_NOT_FOUND'),
    );
    renderPage();
    expect(await screen.findByText('Pricing context not found')).toBeInTheDocument();
  });

  it('retries after a network error', async () => {
    vi.mocked(pricingClient.getProductPricing)
      .mockRejectedValueOnce(new ApiError('offline', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce([record]);
    renderPage();
    expect(await screen.findByText(/Unable to reach the API/)).toBeInTheDocument();
    const alerts = await screen.findAllByRole('alert');
    fireEvent.click(within(alerts[alerts.length - 1]!).getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();
  });

  it('withholds stale pricing data during context changes and replaces loading on error', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([record]);
    let resolveSecond: ((value: IProductPricing[]) => void) | null = null;
    const secondPromise = new Promise<IProductPricing[]>((resolve) => {
      resolveSecond = resolve;
    });

    const { rerender, container } = render(
      <MemoryRouter>
        <PricingInspection productId="p1" />
      </MemoryRouter>,
    );

    expect(await screen.findByText('₹1,234.56')).toBeInTheDocument();

    vi.mocked(pricingClient.getProductPricing).mockReturnValueOnce(secondPromise);
    rerender(
      <MemoryRouter>
        <PricingInspection productId="p2" />
      </MemoryRouter>,
    );

    // Stale data for p1 must be immediately withheld, loading skeleton shown
    expect(screen.queryByText('₹1,234.56')).not.toBeInTheDocument();
    expect(container.querySelector('.ant-skeleton')).toBeInTheDocument();

    // When p2 resolves, new data appears
    resolveSecond!([{ ...record, id: 'price-2', productId: 'p2', b2cPricePaise: 500000 }]);
    expect(await screen.findByText('₹5,000.00')).toBeInTheDocument();
  });

  it.each([
    [401, 'Session expired'],
    [403, 'Permission denied'],
  ])('handles HTTP %s authorization failures', async (status, message) => {
    vi.mocked(pricingClient.getProductPricing).mockRejectedValue(
      new ApiError('authorization failure', status, status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN'),
    );
    renderPage();
    expect(await screen.findByText(message)).toBeInTheDocument();
    const alerts = await screen.findAllByRole('alert');
    expect(within(alerts[alerts.length - 1]!).getByText(message)).toBeInTheDocument();
  });
});
