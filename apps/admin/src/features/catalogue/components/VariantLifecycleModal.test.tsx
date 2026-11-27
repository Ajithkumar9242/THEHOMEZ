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
import { useAuth } from '../../../providers/AuthProvider.js';
import { variantClient } from '../api/variant-client.js';
import { pricingClient } from '../api/pricing-client.js';
import { VariantLifecycleModal, type VariantLifecycleModalProps } from './VariantLifecycleModal.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/variant-client.js', () => ({
  variantClient: {
    create: vi.fn(),
    update: vi.fn(),
    deactivate: vi.fn(),
    archive: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('../api/pricing-client.js', () => ({
  pricingClient: {
    getVariantPricing: vi.fn(),
  },
}));

const mockUser: IAuthUser = {
  id: 'staff-1',
  phone: '+919999999999',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PermissionCode.CATALOG_WRITE, PermissionCode.CATALOG_PUBLISH],
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
  id: 'var-10mm-1',
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
  id: 'var-12mm-1',
  title: '12 mm Rebar',
  sku: 'TATA-TISCON-12MM',
  status: 'ACTIVE',
  publishedAt: '2026-01-02T00:00:00Z',
};

const mockInactiveVariant: IProductVariant = {
  ...mockActiveVariant,
  id: 'var-16mm-1',
  title: '16 mm Rebar',
  sku: 'TATA-TISCON-16MM',
  status: 'INACTIVE',
};

const mockArchivedVariant: IProductVariant = {
  ...mockActiveVariant,
  id: 'var-8mm-1',
  title: '8 mm Rebar',
  sku: 'TATA-TISCON-8MM',
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

function renderModalWithRouter(props: Partial<VariantLifecycleModalProps> = {}, initialPath = '/') {
  const defaultProps: VariantLifecycleModalProps = {
    open: true,
    action: 'activate',
    parentProduct: mockParentProduct,
    variant: mockDraftVariant,
    onClose: vi.fn(),
    onSuccess: vi.fn(),
    ...props,
  };

  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/" element={<VariantLifecycleModal {...defaultProps} />} />
        <Route
          path="/catalogue/products/:productId/variants/:variantId/pricing"
          element={<div>Mock Variant Pricing Page</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('VariantLifecycleModal', () => {
  beforeEach(() => {
    setupAuth([PermissionCode.CATALOG_WRITE, PermissionCode.CATALOG_PUBLISH]);
    vi.mocked(pricingClient.getVariantPricing).mockResolvedValue([
      {
        id: 'pricing-global-1',
        productId: 'prod-tmt-1',
        variantId: 'var-10mm-1',
        pricingScope: 'VARIANT_GLOBAL',
        serviceAreaId: null,
        isActive: true,
        b2cPricePaise: 450000,
        version: 1,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      } as any,
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Scenario 1: Activation confirmation and correct API payload
  it('confirms activation and sends correct API payload ({ status: "ACTIVE" })', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();
    const activatedVariant: IProductVariant = { ...mockDraftVariant, status: 'ACTIVE' };
    vi.mocked(variantClient.update).mockResolvedValue(activatedVariant);

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
      onClose: handleClose,
      onSuccess: handleSuccess,
    });

    expect(screen.getByText(`Activate Variant: ${mockDraftVariant.title}`)).toBeInTheDocument();
    expect(screen.getByText('Activation Prerequisites')).toBeInTheDocument();
    expect(screen.getByText(/complete unit configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/VARIANT_GLOBAL/i)).toBeInTheDocument();

    const confirmBtn = screen.getByLabelText('Confirm activate button');
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(variantClient.update).toHaveBeenCalledWith(mockParentProduct.id, mockDraftVariant.id, {
        status: 'ACTIVE',
      });
      expect(handleSuccess).toHaveBeenCalledWith(activatedVariant);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  // Scenario 2: Activation permission requirements (passes with CATALOG_WRITE + CATALOG_PUBLISH)
  it('allows activation when user has both CATALOG_WRITE and CATALOG_PUBLISH', () => {
    setupAuth([PermissionCode.CATALOG_WRITE, PermissionCode.CATALOG_PUBLISH]);

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
    });

    expect(screen.queryByText(/Insufficient Permissions/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Confirm activate button')).toBeEnabled();
  });

  // Scenario 3: Activation blocked when required permissions are missing
  it('blocks activation when CATALOG_PUBLISH is missing', () => {
    setupAuth([PermissionCode.CATALOG_WRITE]); // Missing CATALOG_PUBLISH

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
    });

    expect(screen.getByText(/Insufficient Permissions/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          `Activating a variant requires ${PermissionCode.CATALOG_PUBLISH} permission`,
          'i',
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm activate button')).toBeDisabled();
  });

  it('blocks activation when CATALOG_WRITE is missing', () => {
    setupAuth([PermissionCode.CATALOG_PUBLISH]); // Missing CATALOG_WRITE

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
    });

    expect(screen.getByText(/Insufficient Permissions/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`Activating a variant requires ${PermissionCode.CATALOG_WRITE} permission`, 'i'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm activate button')).toBeDisabled();
  });

  it('blocks activation when both CATALOG_WRITE and CATALOG_PUBLISH are missing', () => {
    setupAuth([PermissionCode.CATALOG_READ]);

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
    });

    expect(screen.getByText(/Insufficient Permissions/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          `Activating a variant requires ${PermissionCode.CATALOG_WRITE} and ${PermissionCode.CATALOG_PUBLISH} permission`,
          'i',
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm activate button')).toBeDisabled();
  });

  // Scenario 4: CANNOT_ACTIVATE_UNPRICED_VARIANT displays clear explanation
  it('displays clear explanation and callout when CANNOT_ACTIVATE_UNPRICED_VARIANT is returned', async () => {
    vi.mocked(variantClient.update).mockRejectedValue(
      new ApiError(
        'Cannot activate variant: an active global B2C pricing record with price > 0 is required',
        400,
        'CANNOT_ACTIVATE_UNPRICED_VARIANT',
      ),
    );

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
    });

    fireEvent.click(screen.getByLabelText('Confirm activate button'));

    expect(
      await screen.findByText('Operation Failed: CANNOT_ACTIVATE_UNPRICED_VARIANT'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/an active global B2C pricing record with price > 0 is required/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Configure variant pricing button')).toBeInTheDocument();
  });

  // Scenario 5: Pricing navigation uses correct product and variant IDs
  it('navigates to pricing page with correct product and variant IDs', async () => {
    const handleClose = vi.fn();
    vi.mocked(variantClient.update).mockRejectedValue(
      new ApiError('Pricing record required', 400, 'CANNOT_ACTIVATE_UNPRICED_VARIANT'),
    );

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
      onClose: handleClose,
    });

    fireEvent.click(screen.getByLabelText('Confirm activate button'));

    const pricingBtn = await screen.findByLabelText('Configure variant pricing button');
    fireEvent.click(pricingBtn);

    expect(handleClose).toHaveBeenCalled();
    expect(await screen.findByText('Mock Variant Pricing Page')).toBeInTheDocument();
  });

  // Scenario 6: Deactivation confirmation and correct API method
  it('confirms deactivation and calls variantClient.deactivate', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();
    const deactivatedVariant: IProductVariant = { ...mockActiveVariant, status: 'INACTIVE' };
    vi.mocked(variantClient.deactivate).mockResolvedValue(deactivatedVariant);

    renderModalWithRouter({
      action: 'deactivate',
      variant: mockActiveVariant,
      onClose: handleClose,
      onSuccess: handleSuccess,
    });

    expect(screen.getByText(`Deactivate Variant: ${mockActiveVariant.title}`)).toBeInTheDocument();
    expect(screen.getByText('Storefront Availability')).toBeInTheDocument();
    expect(screen.getByText(/unavailable for customer purchase/i)).toBeInTheDocument();

    const confirmBtn = screen.getByLabelText('Confirm deactivate button');
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(variantClient.deactivate).toHaveBeenCalledWith(
        mockParentProduct.id,
        mockActiveVariant.id,
      );
      expect(handleSuccess).toHaveBeenCalledWith(deactivatedVariant);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('blocks deactivation when user lacks CATALOG_WRITE', () => {
    setupAuth([PermissionCode.CATALOG_READ, PermissionCode.CATALOG_PUBLISH]);

    renderModalWithRouter({
      action: 'deactivate',
      variant: mockActiveVariant,
    });

    expect(screen.getByText(/Insufficient Permissions/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(
          `Deactivating a variant requires ${PermissionCode.CATALOG_WRITE} permission`,
          'i',
        ),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm deactivate button')).toBeDisabled();
  });

  // Scenario 7: Archival confirmation, checkbox requirement, and correct API method
  it('requires checkbox confirmation before allowing archival and calls variantClient.archive', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();
    const archivedVariant: IProductVariant = { ...mockActiveVariant, status: 'ARCHIVED' };
    vi.mocked(variantClient.archive).mockResolvedValue(archivedVariant);

    renderModalWithRouter({
      action: 'archive',
      variant: mockActiveVariant,
      onClose: handleClose,
      onSuccess: handleSuccess,
    });

    expect(screen.getByText(`Archive Variant: ${mockActiveVariant.title}`)).toBeInTheDocument();
    expect(screen.getByText(/Irreversible Permanent Archival/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Mark the variant's canonical SKU reservation in the registry as ARCHIVED/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Deactivate all active regional and global pricing records/i),
    ).toBeInTheDocument();

    const confirmBtn = screen.getByLabelText('Confirm archive button');
    // Button is disabled until checkbox is checked
    expect(confirmBtn).toBeDisabled();

    const checkbox = screen.getByLabelText('Confirm permanent archival checkbox');
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(confirmBtn).toBeEnabled();

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(variantClient.archive).toHaveBeenCalledWith(
        mockParentProduct.id,
        mockActiveVariant.id,
      );
      expect(handleSuccess).toHaveBeenCalledWith(archivedVariant);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('blocks archival when user lacks CATALOG_WRITE', () => {
    setupAuth([PermissionCode.CATALOG_READ]);

    renderModalWithRouter({
      action: 'archive',
      variant: mockActiveVariant,
    });

    expect(screen.getByText(/Insufficient Permissions/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        new RegExp(`Archiving a variant requires ${PermissionCode.CATALOG_WRITE} permission`, 'i'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm archive button')).toBeDisabled();
  });

  // Scenario 8: Archived variants cannot be activated, deactivated, or archived again
  it('blocks actions on already archived variants with warning alert', () => {
    renderModalWithRouter({
      action: 'activate',
      variant: mockArchivedVariant,
    });

    expect(screen.getByText('Variant Archived')).toBeInTheDocument();
    expect(
      screen.getByText(/This variant is archived. Archived variants are permanently immutable/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm activate button')).toBeDisabled();
  });

  it('blocks deactivation on already archived variants', () => {
    renderModalWithRouter({
      action: 'deactivate',
      variant: mockArchivedVariant,
    });

    expect(screen.getByText('Variant Archived')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm deactivate button')).toBeDisabled();
  });

  it('blocks archival on already archived variants', () => {
    renderModalWithRouter({
      action: 'archive',
      variant: mockArchivedVariant,
    });

    expect(screen.getByText('Variant Archived')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm archive button')).toBeDisabled();
  });

  // Scenario 9: Archived parent products prevent lifecycle actions
  it('blocks lifecycle actions when parent product is archived', () => {
    const archivedParentProduct: IProduct = {
      ...mockParentProduct,
      status: 'ARCHIVED',
    };

    renderModalWithRouter({
      action: 'activate',
      parentProduct: archivedParentProduct,
      variant: mockDraftVariant,
    });

    expect(screen.getByText('Parent Product Archived')).toBeInTheDocument();
    expect(
      screen.getByText(
        /The parent product is archived. Lifecycle actions cannot be performed on variants belonging to an archived product/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm activate button')).toBeDisabled();
  });

  // State guards: Already ACTIVE / Already INACTIVE
  it('blocks activation when variant is already ACTIVE', () => {
    renderModalWithRouter({
      action: 'activate',
      variant: mockActiveVariant,
    });

    expect(screen.getByText('Variant Already Active')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm activate button')).toBeDisabled();
  });

  it('blocks deactivation when variant is already INACTIVE', () => {
    renderModalWithRouter({
      action: 'deactivate',
      variant: mockInactiveVariant,
    });

    expect(screen.getByText('Variant Already Inactive')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm deactivate button')).toBeDisabled();
  });

  // Scenario 10: Duplicate submission is prevented while loading
  it('prevents duplicate submissions while request is in flight', async () => {
    let resolveUpdate: (value: IProductVariant) => void;
    const pendingPromise = new Promise<IProductVariant>((resolve) => {
      resolveUpdate = resolve;
    });
    vi.mocked(variantClient.update).mockReturnValue(pendingPromise);

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
    });

    const confirmBtn = screen.getByLabelText('Confirm activate button');
    fireEvent.click(confirmBtn);

    // Button should now be disabled/loading
    expect(confirmBtn).toBeDisabled();

    // Trying to click again shouldn't trigger another API call
    fireEvent.click(confirmBtn);
    expect(variantClient.update).toHaveBeenCalledTimes(1);

    // Resolve
    resolveUpdate!({ ...mockDraftVariant, status: 'ACTIVE' });
    await waitFor(() => {
      expect(variantClient.update).toHaveBeenCalledTimes(1);
    });
  });

  // Scenario 11: Backend errors are displayed without falsely reporting success
  it('displays backend errors without calling onSuccess or closing modal', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();
    vi.mocked(variantClient.update).mockRejectedValue(
      new ApiError('Unit precision mismatch', 400, 'INVALID_UNIT_PRECISION'),
    );

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
      onClose: handleClose,
      onSuccess: handleSuccess,
    });

    fireEvent.click(screen.getByLabelText('Confirm activate button'));

    expect(await screen.findByText('Operation Failed: INVALID_UNIT_PRECISION')).toBeInTheDocument();
    expect(screen.getByText('Unit precision mismatch')).toBeInTheDocument();

    expect(handleSuccess).not.toHaveBeenCalled();
    expect(handleClose).not.toHaveBeenCalled();
  });

  // Scenario 12: Successful actions close the modal and invoke onSuccess(updatedVariant)
  it('calls onSuccess with updatedVariant and closes modal on successful execution', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();
    const updatedVariant: IProductVariant = { ...mockDraftVariant, status: 'ACTIVE' };
    vi.mocked(variantClient.update).mockResolvedValue(updatedVariant);

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
      onClose: handleClose,
      onSuccess: handleSuccess,
    });

    fireEvent.click(screen.getByLabelText('Confirm activate button'));

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledTimes(1);
      expect(handleSuccess).toHaveBeenCalledWith(updatedVariant);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  // Scenario 13: Renders canonical SKU with .sku-cell class
  it('renders canonical SKU with .sku-cell class in context summary', () => {
    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
    });

    const skuElement = document.querySelector('.sku-cell');
    expect(skuElement).toBeInTheDocument();
    expect(skuElement?.textContent).toBe(mockDraftVariant.sku);
  });

  // Scenario 14: Evaluates Gate A and renders complete unit configuration checklist
  it('displays unit configuration breakdown with Complete status for fully configured variant', () => {
    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
    });

    expect(screen.getByText('Prerequisite A: Unit Configuration')).toBeInTheDocument();
    expect(screen.getAllByText('Complete').length).toBeGreaterThan(0);
    expect(screen.getByText(mockDraftVariant.unitCode!)).toBeInTheDocument();
    expect(screen.getByText(`${mockDraftVariant.quantityPrecision} decimals`)).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2);
  });

  // Scenario 15: Blocks activation when unit configuration is incomplete and provides Configure Variant Units button
  it('blocks activation when variant and parent lack unit configuration and invokes onEditVariant', async () => {
    const handleClose = vi.fn();
    const handleEditVariant = vi.fn();

    const unconfiguredParent: IProduct = {
      ...mockParentProduct,
      unitCode: null as any,
      quantityPrecision: null as any,
      minOrderQuantity: null as any,
      stepIncrement: null as any,
    };

    const unconfiguredVariant: IProductVariant = {
      ...mockDraftVariant,
      unitCode: null as any,
      quantityPrecision: null as any,
      minOrderQuantity: null as any,
      stepIncrement: null as any,
    };

    renderModalWithRouter({
      action: 'activate',
      parentProduct: unconfiguredParent,
      variant: unconfiguredVariant,
      onClose: handleClose,
      onEditVariant: handleEditVariant,
    });

    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(
      screen.getByText(/Incomplete unit configuration prevents activation/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Activation Locked')).toBeInTheDocument();

    const confirmBtn = screen.getByLabelText('Confirm activate button');
    expect(confirmBtn).toBeDisabled();

    const configureUnitsBtn = screen.getByLabelText('Configure variant units button');
    expect(configureUnitsBtn).toBeInTheDocument();

    fireEvent.click(configureUnitsBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(handleEditVariant).toHaveBeenCalledWith(unconfiguredVariant);
  });

  // Scenario 16: Blocks activation when active global B2C pricing is missing
  it('blocks activation when active global B2C pricing is missing in Gate B', async () => {
    vi.mocked(pricingClient.getVariantPricing).mockResolvedValueOnce([]);

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
    });

    await waitFor(() => {
      expect(screen.getByText('Prerequisite B: Pricing Configuration')).toBeInTheDocument();
      expect(screen.getByText('Missing')).toBeInTheDocument();
    });

    expect(screen.getByText(/Missing active global B2C pricing record/i)).toBeInTheDocument();
    expect(screen.getByText('Activation Locked')).toBeInTheDocument();

    const confirmBtn = screen.getByLabelText('Confirm activate button');
    expect(confirmBtn).toBeDisabled();
  });

  // Scenario 17: Displays recovery button when CANNOT_PUBLISH_UNCONFIGURED_UNIT is returned
  it('displays recovery button for CANNOT_PUBLISH_UNCONFIGURED_UNIT error', async () => {
    const handleEditVariant = vi.fn();
    const handleClose = vi.fn();

    vi.mocked(variantClient.update).mockRejectedValueOnce(
      new ApiError(
        'Cannot activate variant: complete unit configuration (unitCode, quantityPrecision, minOrderQuantity, stepIncrement) is required',
        400,
        'CANNOT_PUBLISH_UNCONFIGURED_UNIT',
      ),
    );

    renderModalWithRouter({
      action: 'activate',
      variant: mockDraftVariant,
      onClose: handleClose,
      onEditVariant: handleEditVariant,
    });

    const confirmBtn = screen.getByLabelText('Confirm activate button');
    fireEvent.click(confirmBtn);

    expect(
      await screen.findByText('Operation Failed: CANNOT_PUBLISH_UNCONFIGURED_UNIT'),
    ).toBeInTheDocument();

    const configureBtn = screen.getByLabelText('Configure variant units button');
    expect(configureBtn).toBeInTheDocument();

    fireEvent.click(configureBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(handleEditVariant).toHaveBeenCalledWith(mockDraftVariant);
  });
});
