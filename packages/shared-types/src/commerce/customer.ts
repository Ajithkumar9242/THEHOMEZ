import type { UserStatus } from '../auth/user-status.js';
import type { ICustomerAddressDto } from './address.js';

/**
 * Summary DTO for customer records in administrative directory listings.
 * Strictly excludes passwordHash, tokens, OTP data, and internal credentials.
 */
export interface IAdminCustomerListItemDto {
  id: string;
  phone: string;
  email: string | null;
  status: UserStatus;
  roles: string[];
  customerSegment: 'B2B' | 'B2C';
  addressCount: number;
  defaultCity: string | null;
  defaultPincode: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Detailed DTO for customer profile inspection in administrative views.
 * Includes verified delivery site addresses, live serviceability, and safe metadata.
 */
export interface IAdminCustomerDetailDto {
  id: string;
  phone: string;
  email: string | null;
  status: UserStatus;
  roles: string[];
  customerSegment: 'B2B' | 'B2C';
  metadata: Record<string, unknown>;
  addresses: ICustomerAddressDto[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Paginated response wrapper for administrative customer directory queries.
 */
export interface IAdminCustomerListResponseDto {
  items: IAdminCustomerListItemDto[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

/**
 * Request payload for administrative customer account lifecycle status changes.
 */
export interface IUpdateCustomerStatusDto {
  status: 'ACTIVE' | 'SUSPENDED';
  reason: string;
}

/**
 * Request payload for administrative B2B wholesale contractor verification.
 */
export interface IUpdateCustomerB2bStatusDto {
  isB2B: boolean;
  companyName?: string;
  gstin?: string;
  reason: string;
}

/**
 * Query parameters supported by the administrative customer directory endpoint.
 */
export interface IAdminCustomerQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  status?: UserStatus;
  segment?: 'B2B' | 'B2C';
  sortBy?: 'createdAt' | 'lastLoginAt' | 'phone';
  sortOrder?: 'asc' | 'desc';
}
