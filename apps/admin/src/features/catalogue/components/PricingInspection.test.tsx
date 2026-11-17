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
  serviceAreaClient: { get: vi.fn(), list: vi.fn() },
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
  vi.mocked(serviceAreaClient.list).mockReset();
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

describe('PricingInspection Stage P-3B: Regional Inspection & Comparison UI', () => {
  const globalPricing: IProductPricing = {
    id: 'price-global-001',
    productId: 'p1',
    variantId: null,
    serviceAreaId: null,
    pricingScope: 'STANDALONE_GLOBAL',
    currency: 'INR',
    b2cPricePaise: 45000,
    b2cMrpPaise: 50000,
    b2bPricePaise: 42000,
    b2bTiers: [
      { minQuantity: '10.000', pricePaise: 40000 },
      { minQuantity: '50.000', pricePaise: 38000 },
    ],
    isActive: true,
    version: 1,
    createdBy: 'staff-1',
    updatedBy: 'staff-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  const regionalNorthPricing: IProductPricing = {
    id: 'price-regional-north',
    productId: 'p1',
    variantId: null,
    serviceAreaId: 'area-north',
    pricingScope: 'STANDALONE_REGIONAL',
    currency: 'INR',
    b2cPricePaise: 48000,
    b2cMrpPaise: 55000,
    b2bPricePaise: 44000,
    b2bTiers: [
      { minQuantity: '10.000', pricePaise: 41000 },
      { minQuantity: '100.000', pricePaise: 36000 },
    ],
    isActive: true,
    version: 2,
    createdBy: 'staff-1',
    updatedBy: 'staff-1',
    createdAt: '2026-01-03T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
  };

  const regionalSouthPricing: IProductPricing = {
    id: 'price-regional-south',
    productId: 'p1',
    variantId: null,
    serviceAreaId: 'area-south',
    pricingScope: 'STANDALONE_REGIONAL',
    currency: 'INR',
    b2cPricePaise: 41000,
    b2cMrpPaise: 50000,
    b2bPricePaise: 39000,
    b2bTiers: [],
    isActive: false,
    version: 4,
    createdBy: 'staff-1',
    updatedBy: 'staff-1',
    createdAt: '2026-01-05T00:00:00.000Z',
    updatedAt: '2026-01-06T00:00:00.000Z',
  };

  it('renders Global Baseline card with fallback disclaimers and tags', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([globalPricing]);
    renderPage();

    expect(await screen.findByText('GLOBAL BASELINE')).toBeInTheDocument();
    expect(screen.getByText('Fallback Schedule')).toBeInTheDocument();
    expect(screen.getByText('Platform Default Baseline Schedule')).toBeInTheDocument();
    expect(screen.getByText('₹450.00')).toBeInTheDocument();
    expect(screen.getByText('₹500.00')).toBeInTheDocument();
    expect(screen.getByText('₹420.00')).toBeInTheDocument();
    expect(screen.getByText('Version 1')).toBeInTheDocument();
  });

  it('hides Edit Pricing button when user lacks PRICING_WRITE permission', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([globalPricing]);
    renderPage({ permissions: [PermissionCode.PRICING_READ] });

    expect(await screen.findByText('GLOBAL BASELINE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit global pricing/i })).not.toBeInTheDocument();
  });

  it('exposes Edit Pricing button on global card for PRICING_WRITE users', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([globalPricing]);
    const onEdit = vi.fn();

    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.PRICING_READ, PermissionCode.PRICING_WRITE]),
    );
    render(
      <MemoryRouter>
        <PricingInspection productId="p1" onEditPricing={onEdit} />
      </MemoryRouter>,
    );

    const editBtn = await screen.findByRole('button', { name: /edit global pricing/i });
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(globalPricing);
  });

  it('renders higher price comparisons against global baseline with exact integer differences', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
      globalPricing,
      regionalNorthPricing,
    ]);
    vi.mocked(serviceAreaClient.get).mockResolvedValue({
      id: 'area-north',
      name: 'North Zone',
    } as never);

    renderPage({ permissions: [PermissionCode.PRICING_READ, PermissionCode.SERVICE_AREA_READ] });

    expect(await screen.findByText('North Zone')).toBeInTheDocument();
    expect(screen.getByText('REGIONAL OVERRIDE')).toBeInTheDocument();
    expect(screen.getByText('₹480.00')).toBeInTheDocument();

    expect(screen.getByText('+₹30.00 higher than global')).toBeInTheDocument();
    expect(screen.getByText('+₹50.00 higher than global MRP')).toBeInTheDocument();
    expect(screen.getByText('+₹20.00 higher than global B2B')).toBeInTheDocument();
  });

  it('renders lower and equal price comparisons against global baseline', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
      globalPricing,
      regionalSouthPricing,
    ]);
    vi.mocked(serviceAreaClient.get).mockResolvedValue({
      id: 'area-south',
      name: 'South Zone',
    } as never);

    renderPage({ permissions: [PermissionCode.PRICING_READ, PermissionCode.SERVICE_AREA_READ] });

    expect(await screen.findByText('South Zone')).toBeInTheDocument();
    expect(screen.getByText('₹410.00')).toBeInTheDocument();

    expect(screen.getByText('-₹40.00 lower than global')).toBeInTheDocument();
    expect(screen.getByText('Equal to global MRP')).toBeInTheDocument();
    expect(screen.getByText('-₹30.00 lower than global B2B')).toBeInTheDocument();
  });

  it('renders multiple regional overrides simultaneously with independent comparison metrics', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
      globalPricing,
      regionalNorthPricing,
      regionalSouthPricing,
    ]);
    vi.mocked(serviceAreaClient.get)
      .mockResolvedValueOnce({ id: 'area-north', name: 'North Zone' } as never)
      .mockResolvedValueOnce({ id: 'area-south', name: 'South Zone' } as never);

    renderPage({ permissions: [PermissionCode.PRICING_READ, PermissionCode.SERVICE_AREA_READ] });

    expect(await screen.findByText('Regional Service-Area Overrides (2)')).toBeInTheDocument();
    expect(screen.getByText('North Zone')).toBeInTheDocument();
    expect(screen.getByText('South Zone')).toBeInTheDocument();
    expect(screen.getByText('+₹30.00 higher than global')).toBeInTheDocument();
    expect(screen.getByText('-₹40.00 lower than global')).toBeInTheDocument();
  });

  it('enforces zero-inheritance warning when regional schedule has no volume tiers', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
      globalPricing,
      regionalSouthPricing,
    ]);
    renderPage();

    expect(await screen.findByText('No Regional Volume Tiers Configured')).toBeInTheDocument();
    expect(screen.getByText(/global baseline volume tiers are NOT inherited/i)).toBeInTheDocument();
  });

  it('compares volume tier slabs when both global and regional schedules have tiers', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
      globalPricing,
      regionalNorthPricing,
    ]);
    renderPage();

    expect(
      await screen.findByText(/Regional volume tiers compared against global baseline tiers/i),
    ).toBeInTheDocument();
    expect(screen.getByText('+₹10.00 higher than global tier')).toBeInTheDocument();
    expect(screen.getByText('Custom regional slab')).toBeInTheDocument();
  });

  it('handles missing global baseline record without crashing and warns administrator', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([regionalNorthPricing]);
    renderPage();

    expect(await screen.findByText('No Global Baseline Pricing Configured')).toBeInTheDocument();
    expect(screen.getByText('(Global baseline not configured)')).toBeInTheDocument();
  });

  it('handles regional records with missing optional fields (null MRP, null B2B)', async () => {
    const sparseRegional: IProductPricing = {
      ...regionalNorthPricing,
      id: 'price-reg-sparse',
      b2cMrpPaise: null,
      b2bPricePaise: null,
    };
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([globalPricing, sparseRegional]);
    renderPage();

    expect(await screen.findByText('(Not set on regional)')).toBeInTheDocument();
    expect(screen.getByText('(Not configured on regional)')).toBeInTheDocument();
  });

  it('gracefully falls back to serviceAreaId when serviceAreaClient.get rejects', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
      globalPricing,
      regionalNorthPricing,
    ]);
    vi.mocked(serviceAreaClient.get).mockRejectedValue(new Error('Network error'));

    renderPage({ permissions: [PermissionCode.PRICING_READ, PermissionCode.SERVICE_AREA_READ] });

    expect(await screen.findByText('area-north')).toBeInTheDocument();
  });

  it('displays service area coverage summary listing active areas that fall back to global baseline', async () => {
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
      globalPricing,
      regionalNorthPricing,
    ]);
    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: [
        {
          id: 'area-north',
          name: 'North Zone',
          code: 'NORTH',
          city: 'Bengaluru',
          state: 'KA',
          isActive: true,
        },
        {
          id: 'area-east',
          name: 'East Zone',
          code: 'EAST',
          city: 'Bengaluru',
          state: 'KA',
          isActive: true,
        },
        {
          id: 'area-west',
          name: 'West Zone',
          code: 'WEST',
          city: 'Bengaluru',
          state: 'KA',
          isActive: true,
        },
      ],
      total: 3,
      page: 1,
      limit: 100,
      totalPages: 1,
    } as never);

    renderPage({ permissions: [PermissionCode.PRICING_READ, PermissionCode.SERVICE_AREA_READ] });

    expect(await screen.findByText('Service Area Coverage Summary')).toBeInTheDocument();
    expect(screen.getByText(/Total active service areas:/)).toBeInTheDocument();
    expect(screen.getByText(/With regional override:/)).toBeInTheDocument();
    expect(screen.getByText(/Using global baseline fallback:/)).toBeInTheDocument();

    expect(screen.getByText('East Zone (EAST)')).toBeInTheDocument();
    expect(screen.getByText('West Zone (WEST)')).toBeInTheDocument();
  });

  it('supports variant pricing parity using variantId', async () => {
    const variantGlobal = {
      ...globalPricing,
      variantId: 'v1',
      pricingScope: 'VARIANT_GLOBAL' as const,
    };
    const variantRegional = {
      ...regionalNorthPricing,
      variantId: 'v1',
      pricingScope: 'VARIANT_REGIONAL' as const,
    };

    vi.mocked(pricingClient.getVariantPricing).mockResolvedValue([variantGlobal, variantRegional]);
    renderPage({
      path: '/catalogue/products/p1/variants/v1/pricing',
      variantId: 'v1',
      permissions: [PermissionCode.PRICING_READ, PermissionCode.SERVICE_AREA_READ],
    });

    expect(await screen.findByText('Variant pricing configuration')).toBeInTheDocument();
    expect(screen.getByText('VARIANT GLOBAL')).toBeInTheDocument();
    expect(screen.getByText('VARIANT REGIONAL')).toBeInTheDocument();
    expect(screen.getByText('+₹30.00 higher than global')).toBeInTheDocument();
    expect(pricingClient.getVariantPricing).toHaveBeenCalledWith('p1', 'v1', {
      signal: expect.any(AbortSignal),
    });
  });

  describe('Stage P-3C Mutation Action Triggers', () => {
    it('renders Add Regional Override button and fires callback when PRICING_WRITE is present', async () => {
      vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
        globalPricing,
        regionalNorthPricing,
      ]);
      const onAddRegionalOverride = vi.fn();
      const onRegionalRecordsLoaded = vi.fn();

      vi.mocked(useAuth).mockReturnValue(
        auth([PermissionCode.PRICING_READ, PermissionCode.PRICING_WRITE]),
      );
      render(
        <MemoryRouter>
          <PricingInspection
            productId="p1"
            onAddRegionalOverride={onAddRegionalOverride}
            onRegionalRecordsLoaded={onRegionalRecordsLoaded}
          />
        </MemoryRouter>,
      );

      const addBtn = await screen.findByRole('button', { name: /Add regional override button/i });
      expect(addBtn).toBeInTheDocument();
      fireEvent.click(addBtn);
      expect(onAddRegionalOverride).toHaveBeenCalledTimes(1);

      expect(onRegionalRecordsLoaded).toHaveBeenCalledWith([regionalNorthPricing]);
    });

    it('renders Edit Override button on regional cards and fires callback with record', async () => {
      vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
        globalPricing,
        regionalNorthPricing,
      ]);
      const onEditRegionalOverride = vi.fn();

      vi.mocked(useAuth).mockReturnValue(
        auth([PermissionCode.PRICING_READ, PermissionCode.PRICING_WRITE]),
      );
      render(
        <MemoryRouter>
          <PricingInspection productId="p1" onEditRegionalOverride={onEditRegionalOverride} />
        </MemoryRouter>,
      );

      const editBtn = await screen.findByRole('button', {
        name: /Edit regional override for area-north button/i,
      });
      expect(editBtn).toBeInTheDocument();
      fireEvent.click(editBtn);
      expect(onEditRegionalOverride).toHaveBeenCalledWith(regionalNorthPricing);
    });

    it('does not render Add Regional Override or Edit Override buttons without PRICING_WRITE', async () => {
      vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
        globalPricing,
        regionalNorthPricing,
      ]);
      const onAddRegionalOverride = vi.fn();
      const onEditRegionalOverride = vi.fn();

      vi.mocked(useAuth).mockReturnValue(auth([PermissionCode.PRICING_READ])); // only READ
      render(
        <MemoryRouter>
          <PricingInspection
            productId="p1"
            onAddRegionalOverride={onAddRegionalOverride}
            onEditRegionalOverride={onEditRegionalOverride}
          />
        </MemoryRouter>,
      );

      await screen.findByText('Regional Service-Area Overrides (1)');
      expect(
        screen.queryByRole('button', { name: /Add regional override button/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Edit regional override for/i }),
      ).not.toBeInTheDocument();
    });
  });
});
