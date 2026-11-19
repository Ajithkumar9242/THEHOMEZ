/**
 * Partner lifecycle status enumeration.
 * Stage C-8A.8 Frozen: Exactly four statuses are supported.
 */
export type PartnerStatus = 'ACTIVE' | 'INACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED';

/**
 * Summary DTO for partner records in administrative directory listings.
 * Strictly excludes sensitive internal credentials and unmasked secrets.
 */
export interface IPartnerAdminSummaryDto {
  id: string;
  businessName: string;
  legalName: string | null;
  phone: string;
  email: string | null;
  status: PartnerStatus;
  deliveryMode: 'PARTNER_MANAGED' | 'PLATFORM_MANAGED';
  serviceAreaCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Service area representation nested within partner detail view.
 */
export interface IPartnerServiceAreaDetailDto {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
  pincodeCount: number;
  isActive: boolean;
}

/**
 * Detailed DTO for partner profile inspection in administrative views.
 * Includes assigned service areas, linked user metrics, and safe metadata.
 */
export interface IPartnerAdminDetailDto {
  id: string;
  businessName: string;
  legalName: string | null;
  phone: string;
  email: string | null;
  status: PartnerStatus;
  deliveryMode: 'PARTNER_MANAGED' | 'PLATFORM_MANAGED';
  serviceAreas: IPartnerServiceAreaDetailDto[];
  linkedUserCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request payload for administrative partner lifecycle status changes.
 */
export interface IUpdatePartnerStatusDto {
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED';
  reason: string;
}

/**
 * Audit log entry DTO for partner lifecycle events.
 */
export interface IPartnerAuditLogDto {
  id: string;
  action: 'PARTNER_STATUS_CHANGED';
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  reason: string;
  performedBy: {
    id: string;
    email: string | null;
    phone: string | null;
  };
  createdAt: string;
}

/**
 * Query parameters DTO for administrative partner directory queries.
 */
export interface IAdminPartnerQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  status?: PartnerStatus;
  serviceAreaId?: string;
  sortBy?: 'createdAt' | 'businessName' | 'status' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated response wrapper for administrative partner directory queries.
 */
export interface IAdminPartnerListResponseDto {
  items: IPartnerAdminSummaryDto[];
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
 * Paginated response wrapper for partner lifecycle audit history queries.
 */
export interface IAdminPartnerAuditLogListResponseDto {
  items: IPartnerAuditLogDto[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}
