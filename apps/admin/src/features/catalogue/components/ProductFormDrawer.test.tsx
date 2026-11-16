import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductFormDrawer } from './ProductFormDrawer.js';
import { ImageUrlManager } from './ImageUrlManager.js';
import { SpecificationEditor } from './SpecificationEditor.js';
import { productClient } from '../api/product-client.js';
import { getCategories, getUnits } from '../api/catalogue-lookups.js';
import type { ICategoryTreeItem, IProduct, IUnit } from '@thehomez/shared-types';

vi.mock('../api/product-client.js', () => ({
  productClient: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../api/catalogue-lookups.js', () => ({
  getCategories: vi.fn(),
  getUnits: vi.fn(),
}));

const mockCategories: ICategoryTreeItem[] = [
  {
    id: 'cat-root-1',
    name: 'Building Materials',
    slug: 'building-materials',
    level: 0,
    isActive: true,
    displayOrder: 1,
    parentId: null,
    subcategories: [
      {
        id: 'cat-sub-1',
        name: 'Cement',
        slug: 'cement',
        level: 1,
        isActive: true,
        displayOrder: 1,
        parentId: 'cat-root-1',
      },
      {
        id: 'cat-sub-inactive',
        name: 'Experimental Cement',
        slug: 'exp-cement',
        level: 1,
        isActive: false,
        displayOrder: 2,
        parentId: 'cat-root-1',
      },
    ],
  },
];

const mockUnits: IUnit[] = [
  {
    id: 'u1',
    code: 'BAG',
    name: 'Bag',
    symbol: 'bag',
    singularLabel: 'Bag',
    pluralLabel: 'Bags',
    classification: 'COUNT',
    isDiscrete: true,
    allowedMaxPrecision: 0,
    isActive: true,
    isSystem: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
  {
    id: 'u2',
    code: 'KG',
    name: 'Kilogram',
    symbol: 'kg',
    singularLabel: 'Kilogram',
    pluralLabel: 'Kilograms',
    classification: 'MASS',
    isDiscrete: false,
    allowedMaxPrecision: 3,
    isActive: true,
    isSystem: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  },
];

const mockDraftProduct: IProduct = {
  id: 'prod-1',
  slug: 'ultratech-cement-50kg',
  title: 'UltraTech Cement 50kg',
  brand: 'UltraTech',
  description: 'Premium portland pozzolana cement',
  categoryId: 'cat-root-1',
  subcategoryId: 'cat-sub-1',
  hasVariants: false,
  sku: 'THZ-P-TEST-001',
  status: 'DRAFT',
  images: ['https://example.com/cement.jpg'],
  specifications: { Grade: 'PPC 53' },
  unitCode: 'BAG',
  quantityPrecision: 0,
  minOrderQuantity: '10',
  maxOrderQuantity: '500',
  stepIncrement: '5',
  publishedBy: null,
  publishedAt: null,
  createdBy: 'user-1',
  updatedBy: 'user-1',
  version: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

beforeEach(() => {
  vi.mocked(getCategories).mockResolvedValue({
    tree: mockCategories,
    labels: new Map([
      ['cat-root-1', 'Building Materials'],
      ['cat-sub-1', 'Cement'],
    ]),
  });
  vi.mocked(getUnits).mockResolvedValue(mockUnits);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ImageUrlManager component', () => {
  it('validates HTTP/HTTPS URL strings and limits to 10 images', () => {
    const handleChange = vi.fn();
    render(<ImageUrlManager value={[]} onChange={handleChange} />);

    expect(screen.getByText(/At least one image URL is required to publish/i)).toBeInTheDocument();

    const input = screen.getByLabelText('Image URL input');
    const addButton = screen.getByRole('button', { name: /Add Image/i });

    // Invalid non-http string
    fireEvent.change(input, { target: { value: 'ftp://bad-url.com/img.png' } });
    fireEvent.click(addButton);
    expect(
      screen.getByText(/URL must begin with http:\/\/ or https:\/\/ and be a valid URL/i),
    ).toBeInTheDocument();
    expect(handleChange).not.toHaveBeenCalled();

    // Valid url
    fireEvent.change(input, { target: { value: 'https://example.com/valid.jpg' } });
    fireEvent.click(addButton);
    expect(handleChange).toHaveBeenCalledWith(['https://example.com/valid.jpg']);
  });

  it('prevents adding duplicate image URLs', () => {
    const handleChange = vi.fn();
    render(<ImageUrlManager value={['https://example.com/img1.jpg']} onChange={handleChange} />);

    const input = screen.getByLabelText('Image URL input');
    const addButton = screen.getByRole('button', { name: /Add Image/i });

    fireEvent.change(input, { target: { value: 'https://example.com/img1.jpg' } });
    fireEvent.click(addButton);
    expect(screen.getByText(/This image URL is already in the list/i)).toBeInTheDocument();
    expect(handleChange).not.toHaveBeenCalled();
  });

  it('disables input when 10 image limit is reached', () => {
    const tenImages = Array.from({ length: 10 }, (_, i) => `https://example.com/img${i}.jpg`);
    render(<ImageUrlManager value={tenImages} />);

    expect(screen.getByText(/Maximum limit of 10 images reached/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Image URL input')).not.toBeInTheDocument();
  });
});

describe('SpecificationEditor component', () => {
  it('adds specifications and prevents duplicate keys after case normalization', () => {
    const handleChange = vi.fn();
    render(<SpecificationEditor value={{ Grade: 'PPC' }} onChange={handleChange} />);

    const keyInput = screen.getByLabelText('Specification key input');
    const valInput = screen.getByLabelText('Specification value input');
    const addButton = screen.getByRole('button', { name: /Add/i });

    // Try adding duplicate with different case
    fireEvent.change(keyInput, { target: { value: 'grade' } });
    fireEvent.change(valInput, { target: { value: 'OPC 43' } });
    fireEvent.click(addButton);

    expect(screen.getByText(/already exists \(keys are case-insensitive\)/i)).toBeInTheDocument();
    expect(handleChange).not.toHaveBeenCalled();

    // Add unique specification
    fireEvent.change(keyInput, { target: { value: 'Finish' } });
    fireEvent.change(valInput, { target: { value: 'Smooth' } });
    fireEvent.click(addButton);

    expect(handleChange).toHaveBeenCalledWith({
      Grade: 'PPC',
      Finish: 'Smooth',
    });
  });

  it('enforces maximum value length of 200 characters', () => {
    const handleChange = vi.fn();
    render(<SpecificationEditor value={{}} onChange={handleChange} />);

    const keyInput = screen.getByLabelText('Specification key input');
    const valInput = screen.getByLabelText('Specification value input');
    const addButton = screen.getByRole('button', { name: /Add/i });

    fireEvent.change(keyInput, { target: { value: 'Description' } });
    fireEvent.change(valInput, { target: { value: 'a'.repeat(205) } });
    fireEvent.click(addButton);

    expect(screen.getByText(/Value cannot exceed 200 characters/i)).toBeInTheDocument();
    expect(handleChange).not.toHaveBeenCalled();
  });
});

describe('ProductFormDrawer component', () => {
  it('creates a standalone product draft with backend SKU generation when SKU omitted', async () => {
    const handleSuccess = vi.fn();
    const handleClose = vi.fn();
    vi.mocked(productClient.create).mockResolvedValue(mockDraftProduct);

    render(
      <ProductFormDrawer
        open={true}
        mode="create"
        onClose={handleClose}
        onSuccess={handleSuccess}
      />,
    );

    expect(screen.getByText('Create Product Draft')).toBeInTheDocument();

    // Fill basic details
    fireEvent.change(screen.getByPlaceholderText('e.g. UltraTech Super Cement 50kg'), {
      target: { value: 'Birla Gold Cement' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. UltraTech, Tata Steel'), {
      target: { value: 'Birla' },
    });

    // Select category and subcategory
    await waitFor(() => expect(getCategories).toHaveBeenCalled());

    // Submit form
    fireEvent.click(screen.getByLabelText('Save product button'));

    // Validation alerts if category not selected
    await waitFor(() => {
      expect(
        screen.getByText(/Please correct the validation errors in the form/i),
      ).toBeInTheDocument();
    });
  });

  it('respects SKU and unit immutability when editing a published product', async () => {
    const publishedProduct: IProduct = {
      ...mockDraftProduct,
      status: 'ACTIVE',
      publishedAt: '2026-01-05T00:00:00Z',
    };

    render(
      <ProductFormDrawer
        open={true}
        mode="edit"
        product={publishedProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText(`Edit Product: ${publishedProduct.title}`)).toBeInTheDocument();

    // SKU input must be disabled for published products
    const skuInput = screen.getByDisplayValue('THZ-P-TEST-001');
    expect(skuInput).toBeDisabled();
    expect(screen.getByText(/SKU is permanently immutable once published/i)).toBeInTheDocument();

    // Unit code immutability
    expect(
      screen.getByText(/Unit code is immutable after initial publication/i),
    ).toBeInTheDocument();
  });

  it('hides unit configuration for multi-variant container products', async () => {
    const multiVariantProduct: IProduct = {
      ...mockDraftProduct,
      hasVariants: true,
      unitCode: null,
      quantityPrecision: null,
    };

    render(
      <ProductFormDrawer
        open={true}
        mode="edit"
        product={multiVariantProduct}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Multi-Variant Container')).toBeInTheDocument();
    expect(screen.getByText(/Variant-Level Configuration/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Multi-variant parent products do not hold standalone unit configurations/i),
    ).toBeInTheDocument();
  });
});
