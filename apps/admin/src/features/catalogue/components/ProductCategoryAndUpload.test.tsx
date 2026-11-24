import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductFormDrawer } from './ProductFormDrawer.js';
import { ProductImageUploader } from './ProductImageUploader.js';
import { getCategories, getUnits } from '../api/catalogue-lookups.js';
import { uploadClient } from '../api/upload-client.js';
import type { ICategoryTreeItem } from '@thehomez/shared-types';

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

vi.mock('../api/upload-client.js', () => ({
  uploadClient: {
    uploadProductImage: vi.fn(),
    deleteProductImage: vi.fn(),
  },
}));

const mockCategoryTree: ICategoryTreeItem[] = [
  {
    id: 'root-civil',
    name: 'Civil & Construction',
    slug: 'civil-construction',
    level: 0,
    isActive: true,
    displayOrder: 1,
    parentId: null,
    subcategories: [
      {
        id: 'sub-cement',
        name: 'Cement',
        slug: 'cement',
        level: 1,
        isActive: true,
        displayOrder: 1,
        parentId: 'root-civil',
      },
      {
        id: 'sub-sand',
        name: 'Sand & Aggregates',
        slug: 'sand-aggregates',
        level: 1,
        isActive: true,
        displayOrder: 2,
        parentId: 'root-civil',
      },
    ],
  },
  {
    id: 'root-empty',
    name: 'Empty Category Without Children',
    slug: 'empty-category',
    level: 0,
    isActive: true,
    displayOrder: 2,
    parentId: null,
    subcategories: [],
  },
];

describe('Product Creation UX: Category Selectors & Cloudinary Image Upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUnits).mockResolvedValue([]);
  });

  // =========================================================================
  // 1. CATEGORY SELECTOR UX & ERROR/EMPTY STATES
  // =========================================================================
  describe('1. Category Selectors UX and Lifecycle', () => {
    it('loads root categories and displays searchable options', async () => {
      vi.mocked(getCategories).mockResolvedValue({
        tree: mockCategoryTree,
        labels: new Map(),
      });

      render(
        <ProductFormDrawer
          open={true}
          mode="create"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(getCategories).toHaveBeenCalled();
      });

      // Find root category selector
      const rootSelect = screen.getByLabelText(/root category/i);
      expect(rootSelect).toBeInTheDocument();
    });

    it('displays warning when no categories exist in database', async () => {
      vi.mocked(getCategories).mockResolvedValue({
        tree: [],
        labels: new Map(),
      });

      render(
        <ProductFormDrawer
          open={true}
          mode="create"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText(/no categories configured/i)).toBeInTheDocument();
      });

      expect(
        screen.getByText(/category setup is a prerequisite before creating products/i),
      ).toBeInTheDocument();
    });

    it('displays retryable error alert when category API call fails', async () => {
      vi.mocked(getCategories).mockRejectedValue(new Error('Network connection timeout'));

      render(
        <ProductFormDrawer
          open={true}
          mode="create"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText(/category synchronization failed/i)).toBeInTheDocument();
      });

      const retryBtn = screen.getByRole('button', { name: /retry categories/i });
      expect(retryBtn).toBeInTheDocument();

      // Click retry button to re-trigger getCategories
      vi.mocked(getCategories).mockResolvedValueOnce({
        tree: mockCategoryTree,
        labels: new Map(),
      });

      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(getCategories).toHaveBeenCalledTimes(2);
      });
    });

    it('subcategory selector is disabled with guidance until root category is selected', async () => {
      vi.mocked(getCategories).mockResolvedValue({
        tree: mockCategoryTree,
        labels: new Map(),
      });

      render(
        <ProductFormDrawer
          open={true}
          mode="create"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(getCategories).toHaveBeenCalled();
      });

      // Subcategory selector is initially disabled
      const subSelect = screen.getByLabelText(/subcategory/i);
      expect(subSelect).toBeDisabled();
    });
  });

  // =========================================================================
  // 2. PRODUCT IMAGE UPLOADER COMPONENT
  // =========================================================================
  describe('2. ProductImageUploader Component', () => {
    it('renders existing image URLs for editing products and allows reordering', () => {
      const onChange = vi.fn();
      const initialImages = [
        'https://res.cloudinary.com/thehomez/image/upload/photo1.jpg',
        'https://res.cloudinary.com/thehomez/image/upload/photo2.jpg',
      ];

      render(<ProductImageUploader value={initialImages} onChange={onChange} />);

      expect(screen.getByText(/2 \/ 10/i)).toBeInTheDocument();
      expect(screen.getByText(/primary/i)).toBeInTheDocument();
      expect(screen.getByText(/#2/i)).toBeInTheDocument();

      // Click move right on first image
      const moveRightBtn = screen.getByLabelText(/move image 1 right/i);
      fireEvent.click(moveRightBtn);

      expect(onChange).toHaveBeenCalledWith([initialImages[1], initialImages[0]]);
    });

    it('allows removing an image', () => {
      const onChange = vi.fn();
      const initialImages = [
        'https://res.cloudinary.com/thehomez/image/upload/photo1.jpg',
        'https://res.cloudinary.com/thehomez/image/upload/photo2.jpg',
      ];

      render(<ProductImageUploader value={initialImages} onChange={onChange} />);

      const removeBtn = screen.getByLabelText(/remove image 1/i);
      fireEvent.click(removeBtn);

      expect(onChange).toHaveBeenCalledWith([initialImages[1]]);
    });

    it('rejects unsupported file extensions before upload', async () => {
      const onChange = vi.fn();
      render(<ProductImageUploader value={[]} onChange={onChange} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();

      const invalidFile = new File(['text content'], 'manual.txt', { type: 'text/plain' });
      fireEvent.change(fileInput, { target: { files: [invalidFile] } });

      await waitFor(() => {
        expect(screen.getByText(/unsupported file format/i)).toBeInTheDocument();
      });

      expect(uploadClient.uploadProductImage).not.toHaveBeenCalled();
    });

    it('rejects files exceeding 5MB size limit before upload', async () => {
      const onChange = vi.fn();
      render(<ProductImageUploader value={[]} onChange={onChange} />);

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();

      // Create a 6MB mock file
      const bigBuffer = new Uint8Array(6 * 1024 * 1024);
      const hugeFile = new File([bigBuffer], 'oversized.jpg', { type: 'image/jpeg' });
      fireEvent.change(fileInput, { target: { files: [hugeFile] } });

      await waitFor(() => {
        expect(screen.getByText(/exceeds the maximum limit of 5 MB/i)).toBeInTheDocument();
      });

      expect(uploadClient.uploadProductImage).not.toHaveBeenCalled();
    });

    it('supports direct manual URL entry as backward compatibility fallback', async () => {
      const onChange = vi.fn();
      render(<ProductImageUploader value={[]} onChange={onChange} />);

      // Switch to "Add by URL" tab
      const urlTab = screen.getByText(/add by url/i);
      fireEvent.click(urlTab);

      const urlInput = screen.getByLabelText(/direct image url input/i);
      fireEvent.change(urlInput, {
        target: { value: 'https://example.com/pre-hosted-cement.jpg' },
      });

      const addBtn = screen.getByRole('button', { name: /add url/i });
      fireEvent.click(addBtn);

      expect(onChange).toHaveBeenCalledWith(['https://example.com/pre-hosted-cement.jpg']);
    });

    it('disables uploader and displays notification when 10 image limit is reached', () => {
      const tenImages = Array.from({ length: 10 }, (_, i) => `https://example.com/img-${i}.jpg`);
      render(<ProductImageUploader value={tenImages} />);

      expect(screen.getByText(/10 \/ 10/i)).toBeInTheDocument();
      expect(screen.getByText(/maximum limit of 10 images reached/i)).toBeInTheDocument();
    });
  });
});
