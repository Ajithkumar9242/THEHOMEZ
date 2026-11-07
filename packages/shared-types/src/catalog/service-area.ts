/**
 * Service Area Domain Contracts & DTOs
 */

/**
 * Standard Indian 6-Digit Postal PIN Code Regex:
 * First digit must be 1-9; followed by exactly 5 decimal digits.
 */
export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

/**
 * Technical Security Limit: Max PIN codes per service area / request payload.
 * Mitigates array payload denial-of-service (GHSA-mrhx-c7xc-m3w5).
 */
export const MAX_PINCODES_PER_SERVICE_AREA = 500;

/**
 * Technical Security Limit: Max service areas assignable per partner.
 */
export const MAX_SERVICE_AREAS_PER_PARTNER = 50;

/**
 * Core Service Area Entity Contract
 */
export interface IServiceArea {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
  countryCode: string;
  pincodes: string[];
  deliveryRadiusKm?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public Location Eligibility Check Response
 * Strictly sanitizes operational internals (no partnerIds, internal codes, or radius).
 */
export interface IServiceAreaCheckResponse {
  serviceable: boolean;
  pincode: string;
  serviceArea?: {
    id: string;
    code: string;
    name: string;
    city: string;
    state: string;
  };
}

/**
 * DTO for Administrative Service Area Creation
 */
export interface ICreateServiceAreaDto {
  code: string;
  name: string;
  city: string;
  state: string;
  countryCode?: string;
  pincodes: string[];
  deliveryRadiusKm?: number;
  isActive?: boolean;
}

/**
 * DTO for Administrative Service Area Update
 */
export interface IUpdateServiceAreaDto {
  code?: string;
  name?: string;
  city?: string;
  state?: string;
  countryCode?: string;
  pincodes?: string[];
  deliveryRadiusKm?: number;
  isActive?: boolean;
}

/**
 * DTO for Admin Assigning Service Areas to a Partner
 */
export interface IAssignPartnerServiceAreasDto {
  serviceAreaIds: string[];
}

/**
 * Partner Assigned Service Area Summary
 */
export interface IPartnerServiceAreaItem {
  id: string;
  code: string;
  name: string;
  city: string;
  state: string;
  pincodesCount: number;
  isActive: boolean;
}

/**
 * Summary of Partner Servicing a Specific Service Area
 */
export interface IServiceAreaPartnerItem {
  partnerId: string;
  businessName: string;
  phone: string;
  status: string;
}
