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
import { useAuth } from '../../../providers/AuthProvider.js';
import { productClient } from '../api/product-client.js';
import { variantClient } from '../api/variant-client.js';
import { getUnitLabels, getUnits } from '../api/catalogue-lookups.js';
import { VariantListPage } from './VariantListPage.js';
import { VariantDetailPage } from './VariantDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/product-client.js', () => ({
  productClient: {
    get: vi.fn(),
    list: vi.fn(),
  },
}));
vi.mock('../api/variant-client.js', () => ({
  variantClient: {
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
    archive: vi.fn(),
  },
}));
vi.mock('../api/catalogue-lookups.js', () => ({
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

const mockParentProduct: IProduct = {
  id: 'prod-tmt-1',
  title: 'Tata Tiscon 550D TMT Rebars',
  brand: 'Tata Tiscon',
  slug: 'tata-tiscon-550d-tmt-rebars',
  categoryId: 'cat-steel',
  subcategoryId: 'sub-tmt',
  hasVariants: true,
  sku: null,
  status: 'ACTIVE',
  images: ['https://example.com/tmt.jpg'],
  specifications: {},
  unitCode: 'PIECE',
  quantityPrecision: 0,
  minOrderQuantity: '1',
  maxOrderQuantity: null,
  stepIncrement: '1',
  publishedBy: 'staff-1',
  publishedAt: '2026-01-01T00:00:00Z',
  createdBy: 'staff-1',
  updatedBy: 'staff-1',
  version: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const mockDraftVariant: IProductVariant = {
  id: 'var-10mm',
  productId: 'prod-tmt-1',
  title: '10 mm Rebar',
  sku: 'TATA-TISCON-10MM',
  status: 'DRAFT',
  attributes: { diameter: '10mm' },
  images: [],
  unitCode: 'PIECE',
  quantityPrecision: 0,
  minOrderQuantity: '1',
  maxOrderQuantity: null,
  stepIncrement: '1',
  publishedAt: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const mockActiveVariant: IProductVariant = {
  ...mockDraftVariant,
  id: 'var-12mm',
  title: '12 mm Rebar',
  sku: 'TATA-TISCON-12MM',
  status: 'ACTIVE',
  publishedAt: '2026-01-02T00:00:00Z',
};

const mockArchivedVariant: IProductVariant = {
  ...mockActiveVariant,
  id: 'var-16mm',
  title: '16 mm Rebar',
  sku: 'TATA-TISCON-16MM',
  status: 'ARCHIVED',
};

function setupAuth(permissions: PermissionCode[]) {
  vi.mocked(useAuth).mockReturnValue({
    user: { ...mockUser, permissions },
    status: 'signed-in' as const,
    signIn: vi.fn(),
    signOut: vi.fn(),
  });
}

function renderRoutes(initialPath: string) {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/catalogue/products/:productId/variants" element={<VariantListPage />} />
        <Route
          path="/catalogue/products/:productId/variants/:variantId"
          element={<VariantDetailPage />}
        />
        <Route
          path="/catalogue/products/:productId/variants/:variantId/pricing"
          element={<div>Mock Variant Pricing Page</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Variant Governance Pages Integration', () => {
  beforeEach(() => {
    vi.mocked(getUnitLabels).mockResolvedValue(new Map([['PIECE', 'Piece']]));
    vi.mocked(getUnits).mockResolvedValue([]);
    vi.mocked(productClient.get).mockResolvedValue(mockParentProduct);
    vi.mocked(variantClient.list).mockResolvedValue([mockDraftVariant, mockActiveVariant]);
    vi.mocked(variantClient.get).mockResolvedValue(mockDraftVariant);
    setupAuth([
      PermissionCode.CATALOG_READ,
      PermissionCode.CATALOG_WRITE,
      PermissionCode.CATALOG_PUBLISH,
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Scenario 1: Create button visibility with and without CATALOG_WRITE
  it('shows Create Variant button when user has CATALOG_WRITE and hides it when missing', async () => {
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);
    const viewWithWrite = renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(await screen.findByRole('button', { name: 'Create Variant' })).toBeInTheDocument();
    viewWithWrite.unmount();

    setupAuth([PermissionCode.CATALOG_READ]);
    renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(await screen.findByText('10 mm Rebar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Variant' })).not.toBeInTheDocument();
  });

  // Scenario 2: Create disabled/hidden for non-variant products (hasVariants: false)
  it('does not show Create Variant button and renders info alert when parent product has hasVariants: false', async () => {
    vi.mocked(productClient.get).mockResolvedValue({
      ...mockParentProduct,
      hasVariants: false,
    });
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);

    renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(await screen.findByText('Single-Item Product')).toBeInTheDocument();
    expect(
      screen.getByText(
        /This product is configured as a single item and does not support creating variants/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Variant' })).not.toBeInTheDocument();
  });

  // Scenario 3: Create disabled/hidden for archived parent products
  it('does not show Create Variant button and shows warning alert when parent product is archived', async () => {
    vi.mocked(productClient.get).mockResolvedValue({
      ...mockParentProduct,
      status: 'ARCHIVED',
    });
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);

    renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(await screen.findByText('Parent Product Archived')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Variant' })).not.toBeInTheDocument();
  });

  // Scenario 4: Successful creation refreshes the list
  it('opens VariantFormDrawer on Create Variant click and refreshes list on success', async () => {
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);
    const createdVariant: IProductVariant = {
      ...mockDraftVariant,
      id: 'var-new-1',
      title: 'New Variant',
    };
    vi.mocked(variantClient.create).mockResolvedValue(createdVariant);

    renderRoutes('/catalogue/products/prod-tmt-1/variants');
    const createBtn = await screen.findByRole('button', { name: 'Create Variant' });
    fireEvent.click(createBtn);

    expect(
      await screen.findByText('Add Variant to Tata Tiscon 550D TMT Rebars'),
    ).toBeInTheDocument();

    // Fill title
    fireEvent.change(screen.getByRole('textbox', { name: 'Variant Title' }), {
      target: { value: 'New Variant' },
    });

    // Add required attribute
    const keyInput = screen.getByPlaceholderText('Attribute Key (e.g. diameter, grade, size)');
    const valInput = screen.getByPlaceholderText('Attribute Value (e.g. 12mm, Fe550D)');
    fireEvent.change(keyInput, { target: { value: 'diameter' } });
    fireEvent.change(valInput, { target: { value: '20mm' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Attribute/i }));

    fireEvent.click(screen.getByLabelText('Save variant button'));

    await waitFor(() => {
      expect(variantClient.create).toHaveBeenCalledWith(
        'prod-tmt-1',
        expect.objectContaining({ title: 'New Variant' }),
      );
      // Refresh triggered: variantClient.list called again
      expect(variantClient.list).toHaveBeenCalledTimes(2);
    });
  });

  // Scenario 5: Edit visibility and drawer opening (on both list and detail pages)
  it('shows Edit button and opens drawer in edit mode on list and detail pages', async () => {
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);

    // List page
    const listView = renderRoutes('/catalogue/products/prod-tmt-1/variants');
    const editBtn = await screen.findByLabelText('Edit 10 mm Rebar');
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);

    expect(await screen.findByText('Edit Variant: 10 mm Rebar')).toBeInTheDocument();
    listView.unmount();

    // Detail page
    vi.mocked(variantClient.get).mockResolvedValue(mockDraftVariant);
    renderRoutes('/catalogue/products/prod-tmt-1/variants/var-10mm');
    const detailEditBtn = await screen.findByRole('button', { name: 'Edit Variant' });
    expect(detailEditBtn).toBeInTheDocument();
    fireEvent.click(detailEditBtn);
    expect(await screen.findByText('Edit Variant: 10 mm Rebar')).toBeInTheDocument();
  });

  // Scenario 6: Archived variants cannot be edited
  it('does not expose Edit button for archived variants on list or detail pages', async () => {
    vi.mocked(variantClient.list).mockResolvedValue([mockArchivedVariant]);
    vi.mocked(variantClient.get).mockResolvedValue(mockArchivedVariant);
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);

    // List page
    const listView = renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(await screen.findByText('16 mm Rebar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Edit 16 mm Rebar')).not.toBeInTheDocument();
    listView.unmount();

    // Detail page
    renderRoutes('/catalogue/products/prod-tmt-1/variants/var-16mm');
    expect(
      await screen.findByRole('heading', { level: 1, name: '16 mm Rebar' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Variant' })).not.toBeInTheDocument();
    expect(screen.getByText('Variant Archived')).toBeInTheDocument();
  });

  // Scenario 7: Activation visibility requires both permissions
  it('shows Activate button only when user has both CATALOG_WRITE and CATALOG_PUBLISH', async () => {
    // Both permissions
    setupAuth([
      PermissionCode.CATALOG_READ,
      PermissionCode.CATALOG_WRITE,
      PermissionCode.CATALOG_PUBLISH,
    ]);
    const viewWithBoth = renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(await screen.findByLabelText('Activate 10 mm Rebar')).toBeInTheDocument();
    viewWithBoth.unmount();

    // CATALOG_WRITE only (missing CATALOG_PUBLISH)
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);
    const viewWithoutPublish = renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(await screen.findByText('10 mm Rebar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Activate 10 mm Rebar')).not.toBeInTheDocument();
    viewWithoutPublish.unmount();

    // CATALOG_PUBLISH only (missing CATALOG_WRITE)
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_PUBLISH]);
    const viewWithoutWrite = renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(await screen.findByText('10 mm Rebar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Activate 10 mm Rebar')).not.toBeInTheDocument();
    viewWithoutWrite.unmount();
  });

  // Scenario 8: Deactivation visibility requires CATALOG_WRITE and ACTIVE status
  it('shows Deactivate button only when user has CATALOG_WRITE and variant is ACTIVE', async () => {
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);

    renderRoutes('/catalogue/products/prod-tmt-1/variants');
    // Active variant has Deactivate
    expect(await screen.findByLabelText('Deactivate 12 mm Rebar')).toBeInTheDocument();
    // Draft variant does NOT have Deactivate
    expect(screen.queryByLabelText('Deactivate 10 mm Rebar')).not.toBeInTheDocument();
  });

  // Scenario 9: Archive visibility requires CATALOG_WRITE and non-archived status
  it('shows Archive button when user has CATALOG_WRITE and variant is not archived', async () => {
    vi.mocked(variantClient.list).mockResolvedValue([mockDraftVariant, mockArchivedVariant]);
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);

    renderRoutes('/catalogue/products/prod-tmt-1/variants');
    // Non-archived variant has Archive
    expect(await screen.findByLabelText('Archive 10 mm Rebar')).toBeInTheDocument();
    // Archived variant does NOT have Archive
    expect(screen.queryByLabelText('Archive 16 mm Rebar')).not.toBeInTheDocument();
  });

  // Scenario 10: Lifecycle modal receives the correct parent and variant
  it('opens VariantLifecycleModal with correct parent product and variant records', async () => {
    setupAuth([
      PermissionCode.CATALOG_READ,
      PermissionCode.CATALOG_WRITE,
      PermissionCode.CATALOG_PUBLISH,
    ]);

    renderRoutes('/catalogue/products/prod-tmt-1/variants');
    const activateBtn = await screen.findByLabelText('Activate 10 mm Rebar');
    fireEvent.click(activateBtn);

    expect(await screen.findByText('Activate Variant: 10 mm Rebar')).toBeInTheDocument();
    expect(screen.getAllByText('Tata Tiscon 550D TMT Rebars').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('TATA-TISCON-10MM').length).toBeGreaterThanOrEqual(2);
  });

  // Scenario 11: Successful lifecycle actions refresh authoritative data
  it('refreshes authoritative data after successful lifecycle action', async () => {
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE]);
    vi.mocked(variantClient.deactivate).mockResolvedValue({
      ...mockActiveVariant,
      status: 'INACTIVE',
    });

    renderRoutes('/catalogue/products/prod-tmt-1/variants');
    const deactivateBtn = await screen.findByLabelText('Deactivate 12 mm Rebar');
    fireEvent.click(deactivateBtn);

    const confirmDeactivate = await screen.findByLabelText('Confirm deactivate button');
    fireEvent.click(confirmDeactivate);

    await waitFor(() => {
      expect(variantClient.deactivate).toHaveBeenCalledWith('prod-tmt-1', 'var-12mm');
      expect(variantClient.list).toHaveBeenCalledTimes(2);
    });
  });

  // Scenario 12: Detail page displays updated variant status after mutation
  it('updates variant detail display and actions after successful mutation on detail page', async () => {
    setupAuth([
      PermissionCode.CATALOG_READ,
      PermissionCode.CATALOG_WRITE,
      PermissionCode.CATALOG_PUBLISH,
    ]);
    vi.mocked(variantClient.get).mockResolvedValue(mockDraftVariant);
    vi.mocked(variantClient.update).mockResolvedValue({
      ...mockDraftVariant,
      status: 'ACTIVE',
      publishedAt: '2026-01-03T00:00:00Z',
    });

    renderRoutes('/catalogue/products/prod-tmt-1/variants/var-10mm');
    expect(
      await screen.findByRole('heading', { level: 1, name: '10 mm Rebar' }),
    ).toBeInTheDocument();

    const activateBtn = screen.getByRole('button', { name: 'Activate Variant' });
    fireEvent.click(activateBtn);

    const confirmActivate = await screen.findByLabelText('Confirm activate button');
    fireEvent.click(confirmActivate);

    await waitFor(() => {
      expect(variantClient.update).toHaveBeenCalledWith('prod-tmt-1', 'var-10mm', {
        status: 'ACTIVE',
      });
      // Detail page was refreshed
      expect(variantClient.get).toHaveBeenCalledTimes(2);
    });
  });

  // Scenario 13: Read-only users can browse without mutation controls
  it('allows read-only users with CATALOG_READ to browse without seeing any mutation controls', async () => {
    setupAuth([PermissionCode.CATALOG_READ]);

    // List page
    const listView = renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(await screen.findByText('10 mm Rebar')).toBeInTheDocument();
    expect(screen.getByText('12 mm Rebar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Variant' })).not.toBeInTheDocument();
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    listView.unmount();

    // Detail page
    vi.mocked(variantClient.get).mockResolvedValue(mockDraftVariant);
    renderRoutes('/catalogue/products/prod-tmt-1/variants/var-10mm');
    expect(
      await screen.findByRole('heading', { level: 1, name: '10 mm Rebar' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Variant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activate Variant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate Variant' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive Variant' })).not.toBeInTheDocument();
  });

  // Scenario 14: Loading, API failure and empty states work correctly
  it('handles loading, empty, and error retry states correctly on VariantListPage', async () => {
    vi.mocked(variantClient.list)
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce([]);

    const view = renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(view.container.querySelector('.ant-skeleton')).toBeInTheDocument();

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);

    expect(await screen.findByText('No variants found for this product')).toBeInTheDocument();
  });

  it('handles error retry state correctly on VariantDetailPage', async () => {
    vi.mocked(variantClient.get)
      .mockRejectedValueOnce(new Error('Fetch failed'))
      .mockResolvedValueOnce(mockDraftVariant);

    renderRoutes('/catalogue/products/prod-tmt-1/variants/var-10mm');
    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);

    expect(
      await screen.findByRole('heading', { level: 1, name: '10 mm Rebar' }),
    ).toBeInTheDocument();
  });

  // Scenario 15: No individual delete action exists
  it('confirms no individual delete button exists anywhere on variant list or detail pages', async () => {
    setupAuth([
      PermissionCode.CATALOG_READ,
      PermissionCode.CATALOG_WRITE,
      PermissionCode.CATALOG_PUBLISH,
    ]);

    // List page
    const listView = renderRoutes('/catalogue/products/prod-tmt-1/variants');
    expect(await screen.findByText('10 mm Rebar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    listView.unmount();

    // Detail page
    vi.mocked(variantClient.get).mockResolvedValue(mockDraftVariant);
    renderRoutes('/catalogue/products/prod-tmt-1/variants/var-10mm');
    expect(
      await screen.findByRole('heading', { level: 1, name: '10 mm Rebar' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});
