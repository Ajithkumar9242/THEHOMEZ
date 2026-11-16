/**
 * Master Product Catalogue Contracts & DTOs
 */

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export const MAX_SPECIFICATION_KEYS = 50;
export const MAX_SPECIFICATION_VALUE_LENGTH = 200;
export const MAX_PRODUCT_IMAGES = 10;
export const MAX_VARIANTS_PER_PRODUCT = 50;

export const SPECIFICATION_KEY_REGEX = /^[a-zA-Z0-9_-]{1,50}$/;
export const PRODUCT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Master Product Entity Interface
 */
export interface IProduct {
  id: string;
  slug: string;
  title: string;
  brand: string;
  description?: string;
  categoryId: string;
  subcategoryId: string;
  hasVariants: boolean;
  sku: string | null;
  status: ProductStatus;
  images: string[];
  specifications: Record<string, string>;
  unitCode?: string | null;
  quantityPrecision?: number | null;
  minOrderQuantity?: string | null;
  maxOrderQuantity?: string | null;
  stepIncrement?: string | null;
  publishedBy?: string | null;
  publishedAt: string | null;
  createdBy: string;
  updatedBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * DTO for creating a new product
 */
export interface ICreateProductDto {
  title: string;
  brand: string;
  slug?: string;
  description?: string;
  categoryId: string;
  subcategoryId: string;
  hasVariants?: boolean;
  sku?: string;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  unitCode?: string;
  quantityPrecision?: number;
  minOrderQuantity?: string;
  maxOrderQuantity?: string | null;
  stepIncrement?: string;
  publish?: boolean;
}

/**
 * DTO for updating an existing product
 */
export interface IUpdateProductDto {
  title?: string;
  brand?: string;
  slug?: string;
  description?: string;
  categoryId?: string;
  subcategoryId?: string;
  sku?: string;
  status?: ProductStatus;
  images?: string[];
  specifications?: Record<string, string>;
  unitCode?: string;
  quantityPrecision?: number;
  minOrderQuantity?: string;
  maxOrderQuantity?: string | null;
  stepIncrement?: string;
}

/**
 * Query parameters for administrative product listing
 */
export interface IAdminProductQueryDto {
  page?: number;
  limit?: number;
  status?: ProductStatus;
  categoryId?: string;
  subcategoryId?: string;
  brand?: string;
  search?: string;
}

/**
 * Query parameters for public product discovery
 */
export interface IPublicProductQueryDto {
  page?: number;
  limit?: number;
  category?: string; // category slug
  subcategory?: string; // subcategory slug
  brand?: string;
  search?: string;
}
