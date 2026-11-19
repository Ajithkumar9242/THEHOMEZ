import type { DeliveryMode } from './delivery-mode.js';

/**
 * Approved lifecycle statuses for PartnerApplication entity.
 * Stage C-11.1 Frozen: Exactly six statuses are supported.
 */
export type PartnerApplicationStatus =
  'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

/**
 * Readonly array of all approved PartnerApplicationStatus values.
 */
export const PARTNER_APPLICATION_STATUSES: readonly PartnerApplicationStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
] as const;

/**
 * Structured refusal code representing reasons for onboarding application rejection.
 * Note: Concrete enum values are pending product owner definition (deferred to Stage C-11.2B).
 * Currently represented as string in accordance with the frozen C-11.1 contract.
 */
export type RefusalReasonCode = string;

/**
 * Representation of the primary partner user account details submitted during onboarding.
 */
export interface IPartnerApplicationInitialUser {
  contactName: string;
  phone: string;
  email?: string;
}

/**
 * Single state transition audit record embedded within a PartnerApplication.
 * Distinct from the regulatory operational PartnerAuditLogModel.
 */
export interface IPartnerApplicationAuditEntry {
  action: string;
  performedBy: string;
  timestamp: string;
  previousStatus?: PartnerApplicationStatus;
  newStatus?: PartnerApplicationStatus;
  reason?: string;
  refusalReasonCode?: RefusalReasonCode;
  metadata?: Record<string, unknown>;
}

/**
 * Comprehensive DTO for PartnerApplication administrative inspection and API responses.
 */
export interface IPartnerApplicationDto {
  id: string;
  businessName: string;
  legalName: string | null;
  phone: string;
  email: string | null;
  deliveryMode: DeliveryMode;
  serviceAreaIds: string[];
  metadata: Record<string, unknown>;
  initialUser: IPartnerApplicationInitialUser;
  status: PartnerApplicationStatus;
  refusalReasonCode: RefusalReasonCode | null;
  rejectionReason: string | null;
  previousApplicationId: string | null;
  assignedStaffUserId: string | null;
  partnerId: string | null;
  auditHistory: IPartnerApplicationAuditEntry[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Summary DTO for paginated partner application directory listings.
 */
export interface IPartnerApplicationSummaryDto {
  id: string;
  businessName: string;
  phone: string;
  email: string | null;
  status: PartnerApplicationStatus;
  deliveryMode: DeliveryMode;
  serviceAreaCount: number;
  assignedStaffUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Input payload for submitting a new partner onboarding application.
 */
export interface CreatePartnerApplicationInput {
  businessName: string;
  legalName?: string;
  phone: string;
  email?: string;
  deliveryMode?: DeliveryMode;
  serviceAreaIds?: string[];
  previousApplicationId?: string;
  metadata?: {
    pan?: string;
    gstin?: string;
    tradeLicense?: string;
    [key: string]: unknown;
  };
  initialUser: {
    contactName: string;
    phone: string;
    email?: string;
  };
}

/**
 * Input payload for rejecting a partner application with structured refusal code and audit reason.
 */
export interface IRejectPartnerApplicationInput {
  refusalReasonCode: RefusalReasonCode;
  reason: string;
}

/**
 * Input payload for withdrawing a partner application.
 */
export interface IWithdrawPartnerApplicationInput {
  reason: string;
}

/**
 * Administrative attestation checklist required for application approval.
 */
export interface IPartnerApplicationAttestations {
  identityVerified: boolean;
  serviceAreaConfirmed: boolean;
  complianceConfirmed: boolean;
}

/**
 * Input payload for approving a partner application at the verification gate.
 */
export interface IApprovePartnerApplicationInput {
  reason: string;
  checklist: IPartnerApplicationAttestations;
}

/**
 * Paginated list response wrapper for partner applications.
 */
export interface IPartnerApplicationListResponseDto {
  items: IPartnerApplicationSummaryDto[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}
