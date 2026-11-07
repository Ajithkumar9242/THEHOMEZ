/**
 * Product Taxonomy: Categories and Subcategories Contracts & DTOs
 */

/**
 * Standard Category URL Slug Regex:
 * Lowercase alphanumeric words separated by single hyphens.
 */
export const CATEGORY_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const MAX_CATEGORY_NAME_LENGTH = 100;
export const MAX_CATEGORY_DESC_LENGTH = 500;
export const MAX_CATEGORY_SLUG_LENGTH = 64;

/**
 * Core Category Entity Contract
 */
export interface ICategory {
  id: string;
  slug: string;
  name: string;
  description?: string;
  parentId?: string | null;
  level: 0 | 1;
  displayOrder: number;
  isActive: boolean;
  iconUrl?: string;
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Subcategory Item within a Category Tree
 */
export interface ICategorySubcategoryItem {
  id: string;
  slug: string;
  name: string;
  description?: string;
  parentId: string;
  level: 1;
  displayOrder: number;
  isActive: boolean;
  iconUrl?: string;
  imageUrl?: string;
}

/**
 * Root Category Tree Item containing nested subcategories
 */
export interface ICategoryTreeItem {
  id: string;
  slug: string;
  name: string;
  description?: string;
  parentId: null;
  level: 0;
  displayOrder: number;
  isActive: boolean;
  iconUrl?: string;
  imageUrl?: string;
  subcategories: ICategorySubcategoryItem[];
}

/**
 * Detailed Category Response (with subcategories if root, or parent if subcategory)
 */
export interface ICategoryDetailsResponse {
  category: ICategory;
  subcategories?: ICategorySubcategoryItem[];
  parent?: ICategory | null;
}

/**
 * DTO for Category Creation (Admin)
 */
export interface ICreateCategoryDto {
  slug: string;
  name: string;
  description?: string;
  parentId?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  iconUrl?: string;
  imageUrl?: string;
}

/**
 * DTO for Category Update (Admin)
 */
export interface IUpdateCategoryDto {
  slug?: string;
  name?: string;
  description?: string;
  parentId?: string | null;
  displayOrder?: number;
  isActive?: boolean;
  iconUrl?: string;
  imageUrl?: string;
}
