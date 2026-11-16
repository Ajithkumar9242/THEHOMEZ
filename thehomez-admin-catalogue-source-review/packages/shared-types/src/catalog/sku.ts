/**
 * SKU Registry and Canonical SKU Formatting Types
 */

export type SkuRegistryStatus = 'RESERVED' | 'ASSIGNED' | 'ARCHIVED';

export type SkuEntityType = 'PRODUCT' | 'VARIANT';

/**
 * Canonical SKU Regex:
 * 4–64 characters, uppercase alphanumeric, hyphens, and underscores.
 * Must start and end with an alphanumeric character.
 */
export const CANONICAL_SKU_REGEX = /^[A-Z0-9][A-Z0-9_-]{2,62}[A-Z0-9]$/;

export const MIN_SKU_LENGTH = 4;
export const MAX_SKU_LENGTH = 64;

/**
 * Authoritative SKU Registry Document Interface
 */
export interface ISkuRegistry {
  id: string;
  sku: string;
  normalizedSku: string;
  entityType: SkuEntityType;
  entityId: string;
  productId: string;
  status: SkuRegistryStatus;
  createdAt: string;
  updatedAt: string;
}
