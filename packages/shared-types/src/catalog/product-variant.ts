/**
 * Product Variant Contracts & DTOs
 */

export type ProductVariantStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export const MAX_VARIANT_ATTRIBUTES = 20;
export const MAX_VARIANT_IMAGES = 10;

/**
 * Product Variant Entity Interface
 */
export interface IProductVariant {
  id: string;
  productId: string;
  sku: string;
  title: string;
  status: ProductVariantStatus;
  attributes: Record<string, string>;
  images: string[];
  unitCode?: string | null;
  quantityPrecision?: number | null;
  minOrderQuantity?: string | null;
  maxOrderQuantity?: string | null;
  stepIncrement?: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * DTO for creating a new product variant
 */
export interface ICreateProductVariantDto {
  title: string;
  sku?: string;
  status?: ProductVariantStatus;
  attributes: Record<string, string>;
  images?: string[];
  unitCode?: string | null;
  quantityPrecision?: number | null;
  minOrderQuantity?: string | null;
  maxOrderQuantity?: string | null;
  stepIncrement?: string | null;
}

/**
 * DTO for updating an existing product variant
 */
export interface IUpdateProductVariantDto {
  title?: string;
  sku?: string;
  status?: ProductVariantStatus;
  attributes?: Record<string, string>;
  images?: string[];
  unitCode?: string | null;
  quantityPrecision?: number | null;
  minOrderQuantity?: string | null;
  maxOrderQuantity?: string | null;
  stepIncrement?: string | null;
}
