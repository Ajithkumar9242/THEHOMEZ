import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VariantFormDrawer } from './VariantFormDrawer.js';
import { variantClient } from '../api/variant-client.js';
import { getUnits } from '../api/catalogue-lookups.js';
import { ApiError } from '../../../services/api-client.js';
import type { IProduct, IProductVariant, IUnit } from '@thehomez/shared-types';

vi.mock('../api/variant-client.js', () => ({
  variantClient: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../api/catalogue-lookups.js', () => ({
  getUnits: vi.fn(),
}));

const mockUnits: IUnit[] = [
  {
    id: 'u-piece',
    code: 'PIECE',
    name: 'Piece',
    symbol: 'pc',
    singularLabel: 'Piece',
    pluralLabel: 'Pieces',
    classification: 'COUNT',
    isDiscrete: true,
    allowedMaxPrecision: 0,
    isActive: true,
    isSystem: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'u-tonne',
    code: 'TONNE',
    name: 'Metric Tonne',
    symbol: 't',
    singularLabel: 'Tonne',
    pluralLabel: 'Tonnes',
    classification: 'MASS',
    isDiscrete: false,
    allowedMaxPrecision: 3,
    isActive: true,
    isSystem: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

const mockParentProduct: IProduct = {
  id: 'prod-tmt-1',
  title: 'Tata Tiscon 550D TMT Rebars',
  brand: 'Tata Tiscon',
  slug: 'tata-tiscon-550d-tmt-rebars',
  categoryId: 'cat-steel',
  subcategoryId: 'sub-tmt',
  hasVariants: true,
  status: 'ACTIVE',
  images: ['https://example.com/tmt.jpg'],
  specifications: { Standard: 'IS 1786' },
  unitCode: 'TONNE',
  quantityPrecision: 3,
  minOrderQuantity: '1.000',
  maxOrderQuantity: '100.000',
  stepIncrement: '0.500',
  sku: 'THZ-P-TMT-550D',
  publishedBy: 'user-admin',
  publishedAt: '2026-01-01T00:00:00Z',
  createdBy: 'user-admin',
  updatedBy: 'user-admin',
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockDraftVariant: IProductVariant = {
  id: 'var-12mm',
  productId: 'prod-tmt-1',
  title: '12mm TMT Bar (12m)',
  sku: 'THZ-V-TMT-12MM',
  status: 'DRAFT',
  attributes: { diameter: '12mm', length: '12m' },
  images: ['https://example.com/12mm.jpg'],
  unitCode: 'TONNE',
  quantityPrecision: 3,
  minOrderQuantity: '1.000',
  maxOrderQuantity: '50.000',
  stepIncrement: '0.500',
  publishedAt: null,
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const mockPublishedVariant: IProductVariant = {
  ...mockDraftVariant,
  id: 'var-published',
  status: 'ACTIVE',
  publishedAt: '2026-01-03T00:00:00Z',
};

describe('VariantFormDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUnits).mockResolvedValue(mockUnits);
  });

  it('1. renders in create mode with title, empty fields, and DRAFT default', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Add Variant to Tata Tiscon 550D TMT Rebars')).toBeInTheDocument();
    expect(screen.getByLabelText('Variant Title')).toHaveValue('');
    expect(screen.getByLabelText('Canonical SKU')).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Draft' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Inactive' })).not.toBeChecked();
  });

  it('2. renders in edit mode pre-populating existing variant values', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="edit"
        parentProduct={mockParentProduct}
        variant={mockDraftVariant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Edit Variant: 12mm TMT Bar (12m)')).toBeInTheDocument();
    expect(screen.getByLabelText('Variant Title')).toHaveValue('12mm TMT Bar (12m)');
    expect(screen.getByLabelText('Canonical SKU')).toHaveValue('THZ-V-TMT-12MM');
    expect(screen.getByText('diameter')).toBeInTheDocument();
    expect(screen.getByDisplayValue('12mm')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
  });

  it('3. validates required title and whitespace-only title', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText('Save variant button'));

    await waitFor(() => {
      expect(
        screen.getByText(/Please correct the validation errors in the form/i),
      ).toBeInTheDocument();
    });

    const titleInput = screen.getByLabelText('Variant Title');
    fireEvent.change(titleInput, { target: { value: '    ' } });
    fireEvent.click(screen.getByLabelText('Save variant button'));

    await waitFor(() => {
      expect(
        screen.getByText(/Please correct the validation errors in the form/i),
      ).toBeInTheDocument();
    });
  });

  it('4. enforces title maximum length of 200 characters', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const titleInput = screen.getByLabelText('Variant Title');
    expect(titleInput).toHaveAttribute('maxlength', '200');
  });

  it('5. integrates AttributeEditor and enforces at least one attribute', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Variant Title'), {
      target: { value: 'Tata 16mm TMT' },
    });
    fireEvent.click(screen.getByLabelText('Save variant button'));

    await waitFor(() => {
      expect(
        screen.getByText('At least one attribute is required for a product variant.'),
      ).toBeInTheDocument();
    });

    // Add an attribute via AttributeEditor
    const keyInput = screen.getByPlaceholderText('Attribute Key (e.g. diameter, grade, size)');
    const valInput = screen.getByPlaceholderText('Attribute Value (e.g. 12mm, Fe550D)');
    fireEvent.change(keyInput, { target: { value: 'diameter' } });
    fireEvent.change(valInput, { target: { value: '16mm' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Attribute/i }));

    await waitFor(() => {
      expect(screen.getByText('diameter')).toBeInTheDocument();
      expect(screen.getByDisplayValue('16mm')).toBeInTheDocument();
    });
  });

  it('6. integrates ImageUrlManager allowing pre-hosted HTTP/HTTPS image URLs', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const urlInput = screen.getByLabelText('Image URL input');
    fireEvent.change(urlInput, { target: { value: 'https://cdn.example.com/16mm.png' } });
    fireEvent.click(screen.getByRole('button', { name: /add image/i }));

    await waitFor(() => {
      expect(screen.getByText('https://cdn.example.com/16mm.png')).toBeInTheDocument();
    });
  });

  it('7. handles optional SKU by omitting sku from payload when left empty', async () => {
    vi.mocked(variantClient.create).mockResolvedValue({
      ...mockDraftVariant,
      sku: 'THZ-V-AUTO-GEN',
    });

    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Variant Title'), {
      target: { value: 'Tata 16mm TMT' },
    });

    // Add attribute
    fireEvent.change(screen.getByPlaceholderText('Attribute Key (e.g. diameter, grade, size)'), {
      target: { value: 'diameter' },
    });
    fireEvent.change(screen.getByPlaceholderText('Attribute Value (e.g. 12mm, Fe550D)'), {
      target: { value: '16mm' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Attribute/i }));

    // SKU is left blank
    expect(screen.getByLabelText('Canonical SKU')).toHaveValue('');

    fireEvent.click(screen.getByLabelText('Save variant button'));

    await waitFor(() => {
      expect(variantClient.create).toHaveBeenCalledWith(
        'prod-tmt-1',
        expect.not.objectContaining({ sku: expect.anything() }),
      );
    });
  });

  it('8. normalizes manual SKU to uppercase and validates canonical regex format', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const skuInput = screen.getByLabelText('Canonical SKU');
    fireEvent.change(skuInput, { target: { value: 'thz-v-steel-12' } });

    expect(skuInput).toHaveValue('THZ-V-STEEL-12');

    // Fill title
    fireEvent.change(screen.getByLabelText('Variant Title'), {
      target: { value: 'Tata Steel 12mm' },
    });

    // Invalid SKU (too short)
    fireEvent.change(skuInput, { target: { value: 'AB' } });
    fireEvent.click(screen.getByLabelText('Save variant button'));

    await waitFor(() => {
      expect(
        screen.getByText(/Please correct the validation errors in the form/i),
      ).toBeInTheDocument();
    });
  });

  it('9. enforces SKU immutability after initial publication', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="edit"
        parentProduct={mockParentProduct}
        variant={mockPublishedVariant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const skuInput = screen.getByLabelText('Canonical SKU');
    expect(skuInput).toBeDisabled();
    expect(screen.getByText('SKU is permanently immutable once published.')).toBeInTheDocument();
  });

  it('10. renders unit configuration controls', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Unit of Measurement')).toBeInTheDocument();
      expect(screen.getByLabelText('Quantity Precision (Decimals)')).toBeInTheDocument();
      expect(screen.getByLabelText('Min Order Qty (MOQ)')).toBeInTheDocument();
      expect(screen.getByLabelText('Max Order Qty')).toBeInTheDocument();
      expect(screen.getByLabelText('Step Increment')).toBeInTheDocument();
    });
  });

  it('11. enforces discrete unit precision restriction (precision must be 0 and is disabled)', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(getUnits).toHaveBeenCalled();
    });

    const unitSelect = screen.getByLabelText('Unit of Measurement');
    fireEvent.mouseDown(unitSelect);

    await waitFor(() => {
      expect(screen.getByText('Piece (pc) · PIECE')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Piece (pc) · PIECE'));

    await waitFor(() => {
      const precisionInput = screen.getByLabelText('Quantity Precision (Decimals)');
      expect(precisionInput).toHaveValue('0');
      expect(precisionInput).toBeDisabled();
    });
  });

  it('12. enforces continuous unit precision ceiling', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(getUnits).toHaveBeenCalled();
    });

    const unitSelect = screen.getByLabelText('Unit of Measurement');
    fireEvent.mouseDown(unitSelect);

    await waitFor(() => {
      expect(screen.getByText('Metric Tonne (t) · TONNE')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Metric Tonne (t) · TONNE'));

    await waitFor(() => {
      const precisionInput = screen.getByLabelText('Quantity Precision (Decimals)');
      expect(precisionInput).not.toBeDisabled();
      expect(screen.getByText('Allowed precision: 0 to 3.')).toBeInTheDocument();
    });
  });

  it('13. displays parent unit snapshot explanation', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Parent Unit Snapshot')).toBeInTheDocument();
    expect(
      screen.getByText(
        /If unit fields are left blank during creation, the backend will automatically snapshot these parent settings/,
      ),
    ).toBeInTheDocument();
  });

  it('14. enforces published unit code and precision immutability', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="edit"
        parentProduct={mockParentProduct}
        variant={mockPublishedVariant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Published Unit Immutability')).toBeInTheDocument();
    expect(screen.getByLabelText('Unit of Measurement')).toBeDisabled();
    expect(screen.getByLabelText('Quantity Precision (Decimals)')).toBeDisabled();
  });

  it('15. allows published quantity-boundary editing', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="edit"
        parentProduct={mockParentProduct}
        variant={mockPublishedVariant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Min Order Qty (MOQ)')).not.toBeDisabled();
    expect(screen.getByLabelText('Max Order Qty')).not.toBeDisabled();
    expect(screen.getByLabelText('Step Increment')).not.toBeDisabled();
  });

  it('16. validates invalid MOQ, max, and step values', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    // Set title and attribute so they don't trigger validation failure
    fireEvent.change(screen.getByLabelText('Variant Title'), {
      target: { value: 'Tata TMT 12mm' },
    });
    fireEvent.change(screen.getByPlaceholderText('Attribute Key (e.g. diameter, grade, size)'), {
      target: { value: 'diameter' },
    });
    fireEvent.change(screen.getByPlaceholderText('Attribute Value (e.g. 12mm, Fe550D)'), {
      target: { value: '12mm' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Attribute/i }));

    const moqInput = screen.getByLabelText('Min Order Qty (MOQ)');

    // Zero MOQ
    fireEvent.change(moqInput, { target: { value: '0' } });
    fireEvent.click(screen.getByLabelText('Save variant button'));
    await waitFor(() => {
      expect(
        screen.getByText(/Please correct the validation errors in the form/i),
      ).toBeInTheDocument();
    });

    // Reset MOQ, set Step to 0
    fireEvent.change(moqInput, { target: { value: '1' } });
    const stepInput = screen.getByLabelText('Step Increment');
    fireEvent.change(stepInput, { target: { value: '0' } });
    fireEvent.click(screen.getByLabelText('Save variant button'));
    await waitFor(() => {
      expect(
        screen.getByText(/Please correct the validation errors in the form/i),
      ).toBeInTheDocument();
    });

    // Max < MOQ
    fireEvent.change(stepInput, { target: { value: '1' } });
    fireEvent.change(moqInput, { target: { value: '10' } });
    const maxInput = screen.getByLabelText('Max Order Qty');
    fireEvent.change(maxInput, { target: { value: '5' } });
    fireEvent.click(screen.getByLabelText('Save variant button'));
    await waitFor(() => {
      expect(
        screen.getByText(/Please correct the validation errors in the form/i),
      ).toBeInTheDocument();
    });
  });

  it('17. restricts initial status options to DRAFT and INACTIVE only', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Draft' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Inactive' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Active' })).not.toBeInTheDocument();
  });

  it('18. restricts operations when parent product is archived', async () => {
    const archivedParent: IProduct = {
      ...mockParentProduct,
      status: 'ARCHIVED',
    };

    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={archivedParent}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Parent Product Archived')).toBeInTheDocument();
    expect(screen.getByLabelText('Variant Title')).toBeDisabled();
    expect(screen.getByLabelText('Save variant button')).toBeDisabled();
  });

  it('19. restricts operations when variant is archived in edit mode', async () => {
    const archivedVariant: IProductVariant = {
      ...mockDraftVariant,
      status: 'ARCHIVED',
    };

    render(
      <VariantFormDrawer
        open={true}
        mode="edit"
        parentProduct={mockParentProduct}
        variant={archivedVariant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Variant Archived')).toBeInTheDocument();
    expect(screen.getByLabelText('Variant Title')).toBeDisabled();
    expect(screen.getByLabelText('Save variant button')).toBeDisabled();
  });

  it('20. submits correct API payload on create and handles success callbacks', async () => {
    const onSuccessMock = vi.fn();
    const onCloseMock = vi.fn();

    vi.mocked(variantClient.create).mockResolvedValue(mockDraftVariant);

    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={onCloseMock}
        onSuccess={onSuccessMock}
      />,
    );

    fireEvent.change(screen.getByLabelText('Variant Title'), {
      target: { value: '12mm TMT Bar (12m)' },
    });
    fireEvent.change(screen.getByLabelText('Canonical SKU'), {
      target: { value: 'THZ-V-TMT-12MM' },
    });

    // Add attribute
    fireEvent.change(screen.getByPlaceholderText('Attribute Key (e.g. diameter, grade, size)'), {
      target: { value: 'diameter' },
    });
    fireEvent.change(screen.getByPlaceholderText('Attribute Value (e.g. 12mm, Fe550D)'), {
      target: { value: '12mm' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Attribute/i }));

    fireEvent.click(screen.getByLabelText('Save variant button'));

    await waitFor(() => {
      expect(variantClient.create).toHaveBeenCalledWith('prod-tmt-1', {
        title: '12mm TMT Bar (12m)',
        sku: 'THZ-V-TMT-12MM',
        status: 'DRAFT',
        attributes: { diameter: '12mm' },
      });
      expect(onSuccessMock).toHaveBeenCalledWith(mockDraftVariant);
      expect(onCloseMock).toHaveBeenCalled();
    });
  });

  it('21. handles backend errors such as DUPLICATE_VARIANT_ATTRIBUTES and VARIANT_SKU_EXISTS', async () => {
    vi.mocked(variantClient.create).mockRejectedValueOnce(
      new ApiError('Duplicate attributes', 409, 'DUPLICATE_VARIANT_ATTRIBUTES'),
    );

    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Variant Title'), {
      target: { value: 'Duplicate Variant' },
    });

    // Add attribute
    fireEvent.change(screen.getByPlaceholderText('Attribute Key (e.g. diameter, grade, size)'), {
      target: { value: 'diameter' },
    });
    fireEvent.change(screen.getByPlaceholderText('Attribute Value (e.g. 12mm, Fe550D)'), {
      target: { value: '12mm' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Attribute/i }));

    fireEvent.click(screen.getByLabelText('Save variant button'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'A sibling variant with this exact combination of attributes already exists for this product. Attributes must uniquely distinguish each variant. (DUPLICATE_VARIANT_ATTRIBUTES)',
        ),
      ).toBeInTheDocument();
    });
  });

  it('22. prevents direct ACTIVE creation with clear guidance', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        'Variants cannot be created directly as ACTIVE. Direct activation requires configured global B2C pricing and is performed as a separate operational step.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Active' })).not.toBeInTheDocument();
  });

  it('23. allows full editing of SKU, unitCode, precision, and boundaries for DRAFT variant with null publishedAt', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="edit"
        parentProduct={mockParentProduct}
        variant={mockDraftVariant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(mockDraftVariant.status).toBe('DRAFT');
    expect(mockDraftVariant.publishedAt).toBeNull();

    // Verify all fields are editable
    expect(screen.getByLabelText('Canonical SKU')).not.toBeDisabled();
    expect(screen.getByLabelText('Unit of Measurement')).not.toBeDisabled();
    expect(screen.getByLabelText('Quantity Precision (Decimals)')).not.toBeDisabled();
    expect(screen.getByLabelText('Min Order Qty (MOQ)')).not.toBeDisabled();
    expect(screen.getByLabelText('Max Order Qty')).not.toBeDisabled();
    expect(screen.getByLabelText('Step Increment')).not.toBeDisabled();
    expect(screen.queryByText('Published Unit Immutability')).not.toBeInTheDocument();
  });

  it('24. locks SKU, unitCode, and precision but keeps quantity boundaries editable for ACTIVE variant with publishedAt', async () => {
    render(
      <VariantFormDrawer
        open={true}
        mode="edit"
        parentProduct={mockParentProduct}
        variant={mockPublishedVariant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(mockPublishedVariant.status).toBe('ACTIVE');
    expect(mockPublishedVariant.publishedAt).not.toBeNull();

    // SKU, unitCode, and precision are immutable
    expect(screen.getByLabelText('Canonical SKU')).toBeDisabled();
    expect(screen.getByLabelText('Unit of Measurement')).toBeDisabled();
    expect(screen.getByLabelText('Quantity Precision (Decimals)')).toBeDisabled();
    expect(screen.getByText('Published Unit Immutability')).toBeInTheDocument();

    // Quantity boundaries remain editable
    expect(screen.getByLabelText('Min Order Qty (MOQ)')).not.toBeDisabled();
    expect(screen.getByLabelText('Max Order Qty')).not.toBeDisabled();
    expect(screen.getByLabelText('Step Increment')).not.toBeDisabled();
  });

  it('25. locks SKU, unitCode, and precision but keeps quantity boundaries editable for INACTIVE variant with prior publication', async () => {
    const inactivePublishedVariant: IProductVariant = {
      ...mockPublishedVariant,
      id: 'var-inactive-published',
      status: 'INACTIVE',
      publishedAt: '2026-01-03T00:00:00Z',
    };

    render(
      <VariantFormDrawer
        open={true}
        mode="edit"
        parentProduct={mockParentProduct}
        variant={inactivePublishedVariant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    // SKU, unitCode, and precision are immutable due to publishedAt
    expect(screen.getByLabelText('Canonical SKU')).toBeDisabled();
    expect(screen.getByLabelText('Unit of Measurement')).toBeDisabled();
    expect(screen.getByLabelText('Quantity Precision (Decimals)')).toBeDisabled();
    expect(screen.getByText('Published Unit Immutability')).toBeInTheDocument();

    // Quantity boundaries remain editable
    expect(screen.getByLabelText('Min Order Qty (MOQ)')).not.toBeDisabled();
    expect(screen.getByLabelText('Max Order Qty')).not.toBeDisabled();
    expect(screen.getByLabelText('Step Increment')).not.toBeDisabled();
  });

  it('26. completely blocks all editing when variant is archived', async () => {
    const archivedVariant: IProductVariant = {
      ...mockDraftVariant,
      id: 'var-archived',
      status: 'ARCHIVED',
    };

    render(
      <VariantFormDrawer
        open={true}
        mode="edit"
        parentProduct={mockParentProduct}
        variant={archivedVariant}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Variant Archived')).toBeInTheDocument();
    expect(screen.getByLabelText('Variant Title')).toBeDisabled();
    expect(screen.getByLabelText('Canonical SKU')).toBeDisabled();
    expect(screen.getByLabelText('Min Order Qty (MOQ)')).toBeDisabled();
    expect(screen.getByLabelText('Max Order Qty')).toBeDisabled();
    expect(screen.getByLabelText('Step Increment')).toBeDisabled();
    expect(screen.getByLabelText('Save variant button')).toBeDisabled();
  });

  it('27. correctly serializes stepIncrement and exact decimal strings in update payload for published variant', async () => {
    const onSuccessMock = vi.fn();
    vi.mocked(variantClient.update).mockResolvedValue({
      ...mockPublishedVariant,
      minOrderQuantity: '2.500',
      maxOrderQuantity: '150.000',
      stepIncrement: '0.250',
    });

    render(
      <VariantFormDrawer
        open={true}
        mode="edit"
        parentProduct={mockParentProduct}
        variant={mockPublishedVariant}
        onClose={vi.fn()}
        onSuccess={onSuccessMock}
      />,
    );

    const moqInput = screen.getByLabelText('Min Order Qty (MOQ)');
    const maxInput = screen.getByLabelText('Max Order Qty');
    const stepInput = screen.getByLabelText('Step Increment');

    fireEvent.change(moqInput, { target: { value: '2.500' } });
    fireEvent.change(maxInput, { target: { value: '150.000' } });
    fireEvent.change(stepInput, { target: { value: '0.250' } });

    fireEvent.click(screen.getByLabelText('Save variant button'));

    await waitFor(() => {
      expect(variantClient.update).toHaveBeenCalledWith('prod-tmt-1', 'var-published', {
        title: '12mm TMT Bar (12m)',
        attributes: { diameter: '12mm', length: '12m' },
        images: ['https://example.com/12mm.jpg'],
        minOrderQuantity: '2.500',
        maxOrderQuantity: '150.000',
        stepIncrement: '0.250',
      });
      // Ensure immutable fields are excluded from updateDto
      const updatePayload = vi.mocked(variantClient.update).mock.calls[0]![2];
      expect(updatePayload.sku).toBeUndefined();
      expect(updatePayload.unitCode).toBeUndefined();
      expect(updatePayload.quantityPrecision).toBeUndefined();
      expect(onSuccessMock).toHaveBeenCalled();
    });
  });

  it('28. correctly serializes custom quantity boundaries and stepIncrement as decimal strings on create', async () => {
    vi.mocked(variantClient.create).mockResolvedValue(mockDraftVariant);

    render(
      <VariantFormDrawer
        open={true}
        mode="create"
        parentProduct={mockParentProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Variant Title'), {
      target: { value: 'Tata Tiscon 10mm Overridden' },
    });

    fireEvent.change(screen.getByPlaceholderText('Attribute Key (e.g. diameter, grade, size)'), {
      target: { value: 'diameter' },
    });
    fireEvent.change(screen.getByPlaceholderText('Attribute Value (e.g. 12mm, Fe550D)'), {
      target: { value: '10mm' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Add Attribute/i }));

    // Set unit quantity overrides
    fireEvent.change(screen.getByLabelText('Min Order Qty (MOQ)'), {
      target: { value: '0.500' },
    });
    fireEvent.change(screen.getByLabelText('Max Order Qty'), {
      target: { value: '80.000' },
    });
    fireEvent.change(screen.getByLabelText('Step Increment'), {
      target: { value: '0.250' },
    });

    fireEvent.click(screen.getByLabelText('Save variant button'));

    await waitFor(() => {
      expect(variantClient.create).toHaveBeenCalledWith('prod-tmt-1', {
        title: 'Tata Tiscon 10mm Overridden',
        status: 'DRAFT',
        attributes: { diameter: '10mm' },
        minOrderQuantity: '0.500',
        maxOrderQuantity: '80.000',
        stepIncrement: '0.250',
      });
    });
  });
});
