import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IProduct,
  type IProductPricing,
  type IProductVariant,
  type MoneyPaise,
} from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { variantClient } from '../api/variant-client.js';
import { pricingClient } from '../api/pricing-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { ProductPricingDetailPage, VariantPricingDetailPage } from './PricingDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/product-client.js', () => ({
  productClient: { get: vi.fn() },
}));
vi.mock('../api/variant-client.js', () => ({
  variantClient: { get: vi.fn() },
}));
vi.mock('../api/pricing-client.js', () => ({
  pricingClient: {
    getProductPricing: vi.fn(),
    getVariantPricing: vi.fn(),
    setProductPricing: vi.fn(),
    setVariantPricing: vi.fn(),
    setProductRegionalPricing: vi.fn(),
    setVariantRegionalPricing: vi.fn(),
  },
}));
vi.mock('../../service-areas/api/service-area-client.js', () => ({
  serviceAreaClient: {
    get: vi.fn(),
    list: vi.fn(),
  },
}));

const staff: IAuthUser = {
  id: 'staff-1',
  phone: '+910000000000',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [
    PermissionCode.CATALOG_READ,
    PermissionCode.PRICING_READ,
    PermissionCode.PRICING_WRITE,
    PermissionCode.SERVICE_AREA_READ,
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function setupAuth(
  permissions: PermissionCode[] = [
    PermissionCode.CATALOG_READ,
    PermissionCode.PRICING_READ,
    PermissionCode.PRICING_WRITE,
    PermissionCode.SERVICE_AREA_READ,
  ],
) {
  vi.mocked(useAuth).mockReturnValue({
    user: { ...staff, permissions },
    status: 'signed-in',
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
}

const mockProduct: IProduct = {
  id: 'prod-cement-1',
  slug: 'ultratech-cement-50kg',
  title: 'UltraTech Super Cement 50kg',
  brand: 'UltraTech',
  categoryId: 'cat-cement',
  subcategoryId: 'sub-opc',
  hasVariants: false,
  sku: 'CEM-ULT-50KG',
  status: 'ACTIVE',
  images: [],
  specifications: {},
  unitCode: 'BAG',
  quantityPrecision: 0,
  minOrderQuantity: '10',
  maxOrderQuantity: '1000',
  stepIncrement: '5',
  publishedBy: null,
  publishedAt: null,
  createdBy: 'staff-1',
  updatedBy: 'staff-1',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const mockVariant: IProductVariant = {
  id: 'var-cement-25kg',
  productId: 'prod-cement-1',
  sku: 'CEM-ULT-25KG',
  title: '25kg Bag',
  status: 'ACTIVE',
  attributes: { weight: '25kg' },
  images: [],
  unitCode: 'BAG',
  quantityPrecision: 0,
  minOrderQuantity: '5',
  maxOrderQuantity: '500',
  stepIncrement: '5',
  publishedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const mockGlobalPricing: IProductPricing = {
  id: 'price-global-1',
  productId: 'prod-cement-1',
  variantId: null,
  serviceAreaId: null,
  pricingScope: 'STANDALONE_GLOBAL',
  currency: 'INR',
  b2cPricePaise: 40000 as MoneyPaise,
  b2cMrpPaise: 45000 as MoneyPaise,
  b2bPricePaise: 38000 as MoneyPaise,
  b2bTiers: [{ minQuantity: '20', pricePaise: 36000 as MoneyPaise }],
  isActive: true,
  version: 2,
  createdBy: 'staff-1',
  updatedBy: 'staff-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const mockRegionalPricing: IProductPricing = {
  id: 'price-regional-1',
  productId: 'prod-cement-1',
  variantId: null,
  serviceAreaId: 'area-south',
  pricingScope: 'STANDALONE_REGIONAL',
  currency: 'INR',
  b2cPricePaise: 42000 as MoneyPaise,
  b2cMrpPaise: 46000 as MoneyPaise,
  b2bPricePaise: 39000 as MoneyPaise,
  b2bTiers: [],
  isActive: true,
  version: 1,
  createdBy: 'staff-1',
  updatedBy: 'staff-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('PricingDetailPage End-to-End Workflow Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuth();
    vi.mocked(productClient.get).mockResolvedValue(mockProduct);
    vi.mocked(variantClient.get).mockResolvedValue(mockVariant);
    vi.mocked(pricingClient.getProductPricing).mockResolvedValue([
      mockGlobalPricing,
      mockRegionalPricing,
    ]);
    vi.mocked(pricingClient.getVariantPricing).mockResolvedValue([
      {
        ...mockGlobalPricing,
        variantId: 'var-cement-25kg',
        pricingScope: 'VARIANT_GLOBAL',
      },
      {
        ...mockRegionalPricing,
        variantId: 'var-cement-25kg',
        pricingScope: 'VARIANT_REGIONAL',
      },
    ]);
    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: [
        {
          id: 'area-south',
          name: 'Bengaluru South',
          code: 'BLR-S',
          city: 'Bengaluru',
          state: 'KA',
          countryCode: 'IN',
          pincodes: ['560068'],
          isActive: true,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
      total: 1,
      page: 1,
      limit: 100,
      totalPages: 1,
    } as never);
    vi.mocked(serviceAreaClient.get).mockResolvedValue({
      id: 'area-south',
      name: 'Bengaluru South',
      code: 'BLR-S',
      city: 'Bengaluru',
      state: 'KA',
      countryCode: 'IN',
      pincodes: ['560068'],
      isActive: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ProductPricingDetailPage', () => {
    it('loads product pricing, opens regional creation drawer, and refreshes on save', async () => {
      render(
        <MemoryRouter initialEntries={['/catalogue/products/prod-cement-1/pricing']}>
          <Routes>
            <Route
              path="/catalogue/products/:productId/pricing"
              element={<ProductPricingDetailPage />}
            />
          </Routes>
        </MemoryRouter>,
      );

      // Verify page title and inspection content
      expect(await screen.findByText('Product pricing configuration')).toBeInTheDocument();
      expect(screen.getByText(/UltraTech Super Cement 50kg/i)).toBeInTheDocument();

      // Trigger "Add Regional Override"
      const addRegionalBtn = screen.getByRole('button', {
        name: /Add regional override button/i,
      });
      fireEvent.click(addRegionalBtn);

      // Drawer opens in create mode
      expect(await screen.findByText('Add Product Regional Override')).toBeInTheDocument();
    });

    it('opens regional drawer in edit mode when clicking Edit Override on regional card', async () => {
      render(
        <MemoryRouter initialEntries={['/catalogue/products/prod-cement-1/pricing']}>
          <Routes>
            <Route
              path="/catalogue/products/:productId/pricing"
              element={<ProductPricingDetailPage />}
            />
          </Routes>
        </MemoryRouter>,
      );

      expect(await screen.findByText('Product pricing configuration')).toBeInTheDocument();

      // Find and click the Edit Override button on regional card
      const editRegionalBtn = await screen.findByRole('button', {
        name: /Edit regional override for/i,
      });
      fireEvent.click(editRegionalBtn);

      // Regional drawer opens in edit mode with revision badge
      expect(await screen.findByText('Edit Product Regional Override')).toBeInTheDocument();
      expect(screen.getByText('Revision 1')).toBeInTheDocument();
      expect(screen.getByLabelText('Regional B2C selling price input')).toHaveValue('420.00');
    });
  });

  describe('VariantPricingDetailPage', () => {
    it('loads variant pricing parity, opens variant regional drawer, and preserves context', async () => {
      render(
        <MemoryRouter
          initialEntries={['/catalogue/products/prod-cement-1/variants/var-cement-25kg/pricing']}
        >
          <Routes>
            <Route
              path="/catalogue/products/:productId/variants/:variantId/pricing"
              element={<VariantPricingDetailPage />}
            />
          </Routes>
        </MemoryRouter>,
      );

      expect(await screen.findByText('Variant pricing configuration')).toBeInTheDocument();
      expect(screen.getByText(/25kg Bag/i)).toBeInTheDocument();

      // Trigger "Add Regional Override" on variant page
      const addRegionalBtn = screen.getByRole('button', {
        name: /Add regional override button/i,
      });
      fireEvent.click(addRegionalBtn);

      // Drawer opens with variant context
      expect(await screen.findByText('Add Variant Regional Override')).toBeInTheDocument();
      expect(screen.getByText('var-cement-25kg')).toBeInTheDocument();
    });
  });
});
