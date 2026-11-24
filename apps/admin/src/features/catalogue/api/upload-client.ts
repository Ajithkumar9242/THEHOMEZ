import type { IProductImageUploadResponse } from '@thehomez/shared-types';
import { apiRequest } from '../../../services/api-client.js';

export const uploadClient = {
  /**
   * Uploads a single product image to backend-backed Cloudinary storage.
   */
  async uploadProductImage(file: File, signal?: AbortSignal): Promise<IProductImageUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    return apiRequest<IProductImageUploadResponse>('/admin/uploads/product-image', {
      method: 'POST',
      body: formData,
      signal,
    });
  },

  /**
   * Requests deletion of an unreferenced image asset from Cloudinary.
   */
  async deleteProductImage(publicId: string, signal?: AbortSignal): Promise<{ message: string }> {
    return apiRequest<{ message: string }>('/admin/uploads/product-image', {
      method: 'DELETE',
      body: JSON.stringify({ publicId }),
      signal,
    });
  },
};
