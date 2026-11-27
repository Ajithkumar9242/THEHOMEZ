import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VariantImageUploader } from './VariantImageUploader.js';
import { uploadClient } from '../api/upload-client.js';
import { ApiError } from '../../../services/api-client.js';

vi.mock('../api/upload-client.js', () => ({
  uploadClient: {
    uploadProductImage: vi.fn(),
    deleteProductImage: vi.fn(),
  },
}));

describe('VariantImageUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. renders empty state with guidance and format requirements', () => {
    render(<VariantImageUploader value={[]} />);

    expect(screen.getByText('Variant Images')).toBeInTheDocument();
    expect(screen.getByText('0 / 10')).toBeInTheDocument();
    expect(screen.getByText(/JPG, PNG, WebP · Max 5MB per file/i)).toBeInTheDocument();
    expect(screen.getByText(/No variant images uploaded yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Click to browse or drag image to this area to upload/i),
    ).toBeInTheDocument();
  });

  it('2. renders image gallery with primary indicator and allows reordering', () => {
    const onChange = vi.fn();
    const images = [
      'https://res.cloudinary.com/thehomez/image/upload/v1/variant-1.jpg',
      'https://res.cloudinary.com/thehomez/image/upload/v1/variant-2.jpg',
    ];

    render(<VariantImageUploader value={images} onChange={onChange} />);

    expect(screen.getByText('2 / 10')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();

    // Reorder: move image 1 right
    const moveRightBtn = screen.getByLabelText('Move image 1 right');
    fireEvent.click(moveRightBtn);

    expect(onChange).toHaveBeenCalledWith([images[1], images[0]]);
  });

  it('3. allows removing an image from the list', () => {
    const onChange = vi.fn();
    const images = [
      'https://res.cloudinary.com/thehomez/image/upload/v1/variant-1.jpg',
      'https://res.cloudinary.com/thehomez/image/upload/v1/variant-2.jpg',
    ];

    render(<VariantImageUploader value={images} onChange={onChange} />);

    const removeBtn = screen.getByLabelText('Remove image 1');
    fireEvent.click(removeBtn);

    expect(onChange).toHaveBeenCalledWith([images[1]]);
  });

  it('4. rejects unsupported file formats before upload', async () => {
    render(<VariantImageUploader value={[]} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    const invalidFile = new File(['mock content'], 'variant-specs.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    await waitFor(() => {
      expect(
        screen.getByText(/Unsupported file format for "variant-specs.pdf"/i),
      ).toBeInTheDocument();
    });

    expect(uploadClient.uploadProductImage).not.toHaveBeenCalled();
  });

  it('5. rejects files exceeding the 5MB size limit before upload', async () => {
    render(<VariantImageUploader value={[]} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    const hugeBuffer = new Uint8Array(6 * 1024 * 1024);
    const oversizedFile = new File([hugeBuffer], 'giant-variant.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    await waitFor(() => {
      expect(screen.getByText(/exceeds the maximum limit of 5 MB/i)).toBeInTheDocument();
    });

    expect(uploadClient.uploadProductImage).not.toHaveBeenCalled();
  });

  it('6. handles upload failure and provides a working Retry button', async () => {
    const onChange = vi.fn();
    vi.mocked(uploadClient.uploadProductImage)
      .mockRejectedValueOnce(new ApiError('Cloudinary storage quota exceeded', 507, 'STORAGE_FULL'))
      .mockResolvedValueOnce({
        url: 'https://res.cloudinary.com/thehomez/image/upload/v1/success.jpg',
        publicId: 'success',
        bytes: 12345,
        format: 'jpg',
        width: 800,
        height: 600,
      });

    render(<VariantImageUploader value={[]} onChange={onChange} />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const testFile = new File(['valid image bytes'], 'test-variant.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [testFile] } });

    await waitFor(() => {
      expect(
        screen.getByText(/Cloudinary storage quota exceeded \(STORAGE_FULL\)/i),
      ).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry upload/i });
    expect(retryBtn).toBeInTheDocument();

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(uploadClient.uploadProductImage).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenCalledWith([
        'https://res.cloudinary.com/thehomez/image/upload/v1/success.jpg',
      ]);
    });
  });

  it('7. supports direct URL input with Add Image button', () => {
    const onChange = vi.fn();
    render(<VariantImageUploader value={[]} onChange={onChange} />);

    const input = screen.getByLabelText('Image URL input');
    fireEvent.change(input, { target: { value: 'https://cdn.example.com/custom-bar.png' } });

    const addBtn = screen.getByRole('button', { name: /add image/i });
    fireEvent.click(addBtn);

    expect(onChange).toHaveBeenCalledWith(['https://cdn.example.com/custom-bar.png']);
  });

  it('8. enforces maximum 10 images limit and hides upload form when reached', () => {
    const maxImages = Array.from({ length: 10 }, (_, i) => `https://cdn.example.com/var-${i}.jpg`);
    render(<VariantImageUploader value={maxImages} />);

    expect(screen.getByText('10 / 10')).toBeInTheDocument();
    expect(screen.getByText(/Maximum limit of 10 images reached/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });
});
