import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IProduct,
  type IProductVariant,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { AdminLayout } from '../../../layouts/AdminLayout.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { variantClient } from '../api/variant-client.js';
import { getCategories, getUnitLabels } from '../api/catalogue-lookups.js';
import { ProductListPage } from './ProductListPage.js';
import { ProductDetailPage } from './ProductDetailPage.js';
import { VariantListPage } from './VariantListPage.js';
import { VariantDetailPage } from './VariantDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/product-client.js', () => ({ productClient: { list: vi.fn(), get: vi.fn() } }));
vi.mock('../api/variant-client.js', () => ({ variantClient: { list: vi.fn(), get: vi.fn() } }));
vi.mock('../api/catalogue-lookups.js', () => ({ getCategories: vi.fn(), getUnitLabels: vi.fn() }));

const staff: IAuthUser = {
  id: 'staff',
  phone: '+910000000000',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PermissionCode.CATALOG_READ],
  createdAt: '2026-01-01',
};
const product: IProduct = {
  id: 'p1',
  slug: 'red-brick',
  title: 'Red Brick',
  brand: 'Acme',
  categoryId: 'c1',
  subcategoryId: 'c2',
  hasVariants: true,
  sku: null,
  status: 'ACTIVE',
  images: [],
  specifications: { color: 'red' },
  unitCode: 'PIECE',
  quantityPrecision: 0,
  minOrderQuantity: '1',
  maxOrderQuantity: null,
  stepIncrement: '1',
  publishedBy: null,
  publishedAt: null,
  createdBy: 'staff-id',
  updatedBy: 'staff-id',
  version: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
};
const variant: IProductVariant = {
  id: 'v1',
  productId: 'p1',
  sku: 'SKU-1',
  title: 'Standard',
  status: 'ACTIVE',
  attributes: { size: 'standard' },
  images: [],
  unitCode: 'PIECE',
  quantityPrecision: 0,
  minOrderQuantity: '1',
  maxOrderQuantity: null,
  stepIncrement: '1',
  publishedAt: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
};
function auth(permissions = [PermissionCode.CATALOG_READ]) {
  return {
    user: { ...staff, permissions },
    status: 'signed-in' as const,
    signIn: vi.fn(),
    requestOtp: vi.fn(),
    signOut: vi.fn(),
  };
}
function routes(path: string) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/catalogue/products" element={<ProductListPage />} />
        <Route path="/catalogue/products/:productId" element={<ProductDetailPage />} />
        <Route path="/catalogue/products/:productId/variants" element={<VariantListPage />} />
        <Route
          path="/catalogue/products/:productId/variants/:variantId"
          element={<VariantDetailPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.mocked(getUnitLabels).mockReset().mockResolvedValue(new Map());
  vi.mocked(getCategories).mockReset();
  vi.mocked(useAuth).mockReset().mockReturnValue(auth());
  vi.mocked(productClient.list).mockReset();
  vi.mocked(productClient.get).mockReset();
  vi.mocked(variantClient.list).mockReset();
  vi.mocked(variantClient.get).mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('catalogue pages', () => {
  it('renders product rows, applies supported filters, and changes pagination', async () => {
    vi.mocked(useAuth).mockReturnValue(auth());
    vi.mocked(getCategories).mockResolvedValue({ tree: [], labels: new Map() });
    vi.mocked(productClient.list).mockResolvedValue({
      items: [product],
      total: 21,
      page: 1,
      limit: 20,
      totalPages: 2,
    });
    routes('/catalogue/products');
    expect(await screen.findByRole('heading', { level: 1, name: 'Red Brick' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search products' }), {
      target: { value: 'brick' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() =>
      expect(productClient.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'brick', page: 1 }),
      ),
    );
  });
  it('gates list calls when CATALOG_READ is missing and renders product details', async () => {
    vi.mocked(useAuth).mockReturnValue(auth([]));
    const denied = routes('/catalogue/products');
    expect(screen.getByText(/CATALOG_READ permission required/)).toBeInTheDocument();
    expect(productClient.list).not.toHaveBeenCalled();
    denied.unmount();
    vi.mocked(useAuth).mockReturnValue(auth());
    vi.mocked(productClient.get).mockResolvedValue(product);
    vi.mocked(getCategories).mockResolvedValue({
      tree: [],
      labels: new Map([
        ['c1', 'Materials'],
        ['c2', 'Brick'],
      ]),
    });
    vi.mocked(getUnitLabels).mockResolvedValue(new Map([['PIECE', 'Piece (pc)']]));
    routes('/catalogue/products/p1');
    expect(await screen.findByText('Red Brick')).toBeInTheDocument();
    expect(screen.getByText('Materials')).toBeInTheDocument();
    expect(screen.getByText('color')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view variants/i })).toBeInTheDocument();
    expect(screen.queryByText('staff-id')).not.toBeInTheDocument();
  });
  it('shows the contextual pricing entry only to staff with PRICING_READ', async () => {
    vi.mocked(getCategories).mockResolvedValue({ tree: [], labels: new Map() });
    vi.mocked(getUnitLabels).mockResolvedValue(new Map());
    vi.mocked(productClient.get).mockResolvedValue({ ...product, hasVariants: false });
    vi.mocked(useAuth).mockReturnValue(auth());
    const withoutPricing = routes('/catalogue/products/p1');
    expect(await screen.findByRole('heading', { level: 1, name: 'Red Brick' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Inspect pricing' })).not.toBeInTheDocument();
    withoutPricing.unmount();
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.CATALOG_READ, PermissionCode.PRICING_READ]),
    );
    routes('/catalogue/products/p1');
    expect(await screen.findByRole('button', { name: 'Inspect pricing' })).toBeInTheDocument();
  });
  it('shows loading, empty and retry states for product lists', async () => {
    vi.mocked(useAuth).mockReturnValue(auth());
    vi.mocked(getCategories).mockResolvedValue({ tree: [], labels: new Map() });
    vi.mocked(productClient.list)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 20, totalPages: 1 });
    const view = routes('/catalogue/products');
    expect(view.container.querySelector('.ant-skeleton')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
    expect(await screen.findByText('No products match these filters')).toBeInTheDocument();
  });
  it('renders explicit 401/403 errors and permission-aware catalogue navigation', async () => {
    vi.mocked(useAuth).mockReturnValue(auth());
    vi.mocked(getCategories).mockResolvedValue({ tree: [], labels: new Map() });
    vi.mocked(productClient.list)
      .mockRejectedValueOnce(new ApiError('expired', 401, 'UNAUTHORIZED'))
      .mockRejectedValueOnce(new ApiError('forbidden', 403, 'FORBIDDEN'));
    const first = routes('/catalogue/products');
    expect(await screen.findByText('Session expired')).toBeInTheDocument();
    first.unmount();
    const deniedByApi = routes('/catalogue/products');
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    deniedByApi.unmount();
    const allowedNav = render(
      <MemoryRouter>
        <AdminLayout>
          <div />
        </AdminLayout>
      </MemoryRouter>,
    );
    expect(screen.getByText('Products')).toBeInTheDocument();
    allowedNav.unmount();
    vi.mocked(useAuth).mockReturnValue(auth([]));
    render(
      <MemoryRouter>
        <AdminLayout>
          <div />
        </AdminLayout>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Products')).not.toBeInTheDocument();
  });
  it('lists only variants matching the selected parent and loads nested variant details', async () => {
    vi.mocked(productClient.get).mockResolvedValue(product);
    vi.mocked(variantClient.list).mockResolvedValue([
      variant,
      { ...variant, id: 'v-other', productId: 'other' },
    ]);
    const listing = routes('/catalogue/products/p1/variants');
    expect(await screen.findByText('Standard')).toBeInTheDocument();
    expect(screen.queryByText('v-other')).not.toBeInTheDocument();
    listing.unmount();
    vi.mocked(variantClient.get).mockResolvedValue(variant);
    vi.mocked(getUnitLabels).mockResolvedValue(new Map([['PIECE', 'Piece (pc)']]));
    routes('/catalogue/products/p1/variants/v1');
    expect(await screen.findByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByText('standard')).toBeInTheDocument();
    expect(variantClient.get).toHaveBeenLastCalledWith(
      'p1',
      'v1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
