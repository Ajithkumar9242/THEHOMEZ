import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IProduct,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { getCategories, getUnitLabels, getUnits } from '../api/catalogue-lookups.js';
import { ProductLifecycleModal } from '../components/ProductLifecycleModal.js';
import { ProductListPage } from './ProductListPage.js';
import { ProductDetailPage } from './ProductDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/product-client.js', () => ({
  productClient: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
    deactivate: vi.fn(),
    archive: vi.fn(),
    deleteDraft: vi.fn(),
  },
}));
vi.mock('../api/catalogue-lookups.js', () => ({
  getCategories: vi.fn(),
  getUnitLabels: vi.fn(),
  getUnits: vi.fn(),
}));

const mockUser: IAuthUser = {
  id: 'staff-1',
  phone: '+919999999999',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PermissionCode.CATALOG_READ],
  createdAt: '2026-01-01',
};

const draftProduct: IProduct = {
  id: 'prod-draft-1',
  slug: 'test-draft-product',
  title: 'Test Draft Product',
  brand: 'Tata',
  categoryId: 'cat-1',
  subcategoryId: 'sub-1',
  hasVariants: false,
  sku: 'THZ-P-DRAFT-1',
  status: 'DRAFT',
  images: ['https://example.com/item.jpg'],
  specifications: { Grade: 'High' },
  unitCode: 'PIECE',
  quantityPrecision: 0,
  minOrderQuantity: '1',
  maxOrderQuantity: null,
  stepIncrement: '1',
  publishedBy: null,
  publishedAt: null,
  createdBy: 'staff-1',
  updatedBy: 'staff-1',
  version: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const activeProduct: IProduct = {
  ...draftProduct,
  id: 'prod-active-1',
  title: 'Test Active Product',
  status: 'ACTIVE',
  publishedAt: '2026-01-02T00:00:00Z',
  publishedBy: 'staff-1',
};

function setupAuth(permissions: PermissionCode[]) {
  vi.mocked(useAuth).mockReturnValue({
    user: { ...mockUser, permissions },
    status: 'signed-in' as const,
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
}

function renderWithRouter(ui: React.ReactElement, initialPath = '/') {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={ui} />
        <Route path="/catalogue/products" element={<ProductListPage />} />
        <Route path="/catalogue/products/:productId" element={<ProductDetailPage />} />
        <Route
          path="/catalogue/products/:productId/pricing"
          element={<div>Mock Pricing Browser Page</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(getCategories).mockResolvedValue({ tree: [], labels: new Map() });
  vi.mocked(getUnitLabels).mockResolvedValue(new Map());
  vi.mocked(getUnits).mockResolvedValue([]);
  vi.mocked(productClient.list).mockResolvedValue({
    items: [draftProduct],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  });
  vi.mocked(productClient.get).mockResolvedValue(draftProduct);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ProductLifecycleModal component', () => {
  it('executes product publication on success', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();
    vi.mocked(productClient.publish).mockResolvedValue({ ...draftProduct, status: 'ACTIVE' });

    render(
      <MemoryRouter>
        <ProductLifecycleModal
          open={true}
          action="publish"
          product={draftProduct}
          onClose={handleClose}
          onSuccess={handleSuccess}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(`Publish Product: ${draftProduct.title}`)).toBeInTheDocument();
    expect(screen.getByText(/Publication Prerequisites/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Confirm publish button'));

    await waitFor(() => {
      expect(productClient.publish).toHaveBeenCalledWith(draftProduct.id);
      expect(handleSuccess).toHaveBeenCalledWith(expect.objectContaining({ status: 'ACTIVE' }));
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('displays pricing error callout with Pricing Browser navigation on missing pricing', async () => {
    vi.mocked(productClient.publish).mockRejectedValue(
      new ApiError(
        'Cannot publish product: an active global B2C pricing record with price > 0 is required',
        400,
        'CANNOT_PUBLISH_UNPRICED_PRODUCT',
      ),
    );

    renderWithRouter(
      <ProductLifecycleModal
        open={true}
        action="publish"
        product={draftProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Confirm publish button'));

    expect(
      await screen.findByText(/Operation Failed: CANNOT_PUBLISH_UNPRICED_PRODUCT/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Open Pricing Browser to Configure Pricing/i }),
    ).toBeInTheDocument();

    // Clicking button navigates to Pricing Browser
    fireEvent.click(
      screen.getByRole('button', { name: /Open Pricing Browser to Configure Pricing/i }),
    );
    expect(await screen.findByText('Mock Pricing Browser Page')).toBeInTheDocument();
  });

  it('handles product deactivation', async () => {
    const handleSuccess = vi.fn();
    vi.mocked(productClient.deactivate).mockResolvedValue({ ...activeProduct, status: 'INACTIVE' });

    render(
      <MemoryRouter>
        <ProductLifecycleModal
          open={true}
          action="deactivate"
          product={activeProduct}
          onClose={vi.fn()}
          onSuccess={handleSuccess}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(`Deactivate Product: ${activeProduct.title}`)).toBeInTheDocument();
    expect(screen.getByText(/Storefront Visibility/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Confirm deactivate button'));

    await waitFor(() => {
      expect(productClient.deactivate).toHaveBeenCalledWith(activeProduct.id);
      expect(handleSuccess).toHaveBeenCalledWith(expect.objectContaining({ status: 'INACTIVE' }));
    });
  });

  it('requires explicit checkbox confirmation for permanent archival', async () => {
    const handleSuccess = vi.fn();
    vi.mocked(productClient.archive).mockResolvedValue({ ...activeProduct, status: 'ARCHIVED' });

    render(
      <MemoryRouter>
        <ProductLifecycleModal
          open={true}
          action="archive"
          product={activeProduct}
          onClose={vi.fn()}
          onSuccess={handleSuccess}
        />
      </MemoryRouter>,
    );

    const archiveButton = screen.getByLabelText('Confirm archive button');
    // Button is disabled until confirmed
    expect(archiveButton).toBeDisabled();

    // Check confirmation checkbox
    const checkbox = screen.getByLabelText('Confirm permanent archival checkbox');
    fireEvent.click(checkbox);
    expect(archiveButton).not.toBeDisabled();

    fireEvent.click(archiveButton);

    await waitFor(() => {
      expect(productClient.archive).toHaveBeenCalledWith(activeProduct.id);
      expect(handleSuccess).toHaveBeenCalledWith(expect.objectContaining({ status: 'ARCHIVED' }));
    });
  });

  it('handles draft product deletion', async () => {
    const handleSuccess = vi.fn();
    vi.mocked(productClient.deleteDraft).mockResolvedValue({
      message: 'Draft product deleted successfully',
    });

    render(
      <MemoryRouter>
        <ProductLifecycleModal
          open={true}
          action="delete"
          product={draftProduct}
          onClose={vi.fn()}
          onSuccess={handleSuccess}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Permanent Draft Deletion/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Confirm delete button'));

    await waitFor(() => {
      expect(productClient.deleteDraft).toHaveBeenCalledWith(draftProduct.id);
      expect(handleSuccess).toHaveBeenCalled();
    });
  });
});

describe('RBAC and Product Lifecycle Page Integration', () => {
  it('hides all mutation controls from CATALOG_READ-only staff on list and detail pages', async () => {
    setupAuth([PermissionCode.CATALOG_READ]);

    const listView = renderWithRouter(<ProductListPage />, '/catalogue/products');
    expect(await screen.findByText('Test Draft Product')).toBeInTheDocument();
    expect(screen.queryByLabelText('Create product button')).not.toBeInTheDocument();
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    listView.unmount();

    renderWithRouter(<ProductDetailPage />, '/catalogue/products/prod-draft-1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Test Draft Product' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit Test Draft Product')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Publish Test Draft Product')).not.toBeInTheDocument();
  });

  it('allows CATALOG_WRITE staff to access Create, Edit, Deactivate, Archive, and Delete Draft controls', async () => {
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);

    const listView = renderWithRouter(<ProductListPage />, '/catalogue/products');
    expect(await screen.findByLabelText('Create product button')).toBeInTheDocument();
    expect(screen.getByLabelText('Edit Test Draft Product')).toBeInTheDocument();
    expect(screen.getByLabelText('Archive Test Draft Product')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete draft Test Draft Product')).toBeInTheDocument();
    // Publish requires CATALOG_PUBLISH
    expect(screen.queryByLabelText('Publish Test Draft Product')).not.toBeInTheDocument();
    listView.unmount();

    renderWithRouter(<ProductDetailPage />, '/catalogue/products/prod-draft-1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Test Draft Product' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Edit Test Draft Product')).toBeInTheDocument();
    expect(screen.getByLabelText('Archive Test Draft Product')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete draft Test Draft Product')).toBeInTheDocument();
    expect(screen.queryByLabelText('Publish Test Draft Product')).not.toBeInTheDocument();
  });

  it('allows CATALOG_PUBLISH staff to see Publish action', async () => {
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_PUBLISH]);

    renderWithRouter(<ProductListPage />, '/catalogue/products');
    expect(await screen.findByLabelText('Publish Test Draft Product')).toBeInTheDocument();
    // Cannot create or edit without CATALOG_WRITE
    expect(screen.queryByLabelText('Create product button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Edit Test Draft Product')).not.toBeInTheDocument();
  });
});
