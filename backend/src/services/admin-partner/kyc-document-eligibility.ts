import {
  DocumentScanStatus,
  ManualSecurityReviewStatus,
  DocumentReviewStatus,
} from '@thehomez/shared-types';
import type { IPartnerDocumentItem } from '../../models/partner.model.js';

export type KycDocumentPurpose = 'DOWNLOAD' | 'REACTIVATION' | 'COMPLIANCE';

export interface IKycDocumentEligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Unified KYC Document Eligibility Policy predicate.
 * Single source of truth governing document eligibility across download access, verification, and reactivation.
 * Conforms strictly to Phase 1A Revision 4.3 Section 2.3.C.
 */
export function isKycDocumentEligible(
  doc: IPartnerDocumentItem,
  purpose: KycDocumentPurpose,
): IKycDocumentEligibilityResult {
  // 1. Soft-deletion check
  if (doc.isDeleted) {
    return { eligible: false, reason: 'Document is deleted' };
  }

  // 2. Unconditional malware blockade
  if (doc.scanStatus === DocumentScanStatus.INFECTED) {
    return { eligible: false, reason: 'Document is infected with malware' };
  }

  // 3. Expiration check
  if (doc.expiresAt && new Date(doc.expiresAt) <= new Date()) {
    return { eligible: false, reason: 'Document has expired' };
  }

  // 4. Security clearance check
  const isSecurityCleared =
    doc.scanStatus === DocumentScanStatus.CLEAN ||
    ((doc.scanStatus === DocumentScanStatus.SCAN_UNAVAILABLE ||
      doc.scanStatus === DocumentScanStatus.SCAN_FAILED) &&
      doc.manualSecurityReview?.status === ManualSecurityReviewStatus.APPROVED);

  if (!isSecurityCleared) {
    if (doc.scanStatus === DocumentScanStatus.PENDING_SCAN) {
      return { eligible: false, reason: 'Malware scan is pending' };
    }
    return {
      eligible: false,
      reason: 'Document scanning failed or unavailable without manual security approval',
    };
  }

  // 5. Purpose-specific business verification check
  if (purpose === 'REACTIVATION' || purpose === 'COMPLIANCE') {
    if (doc.status !== DocumentReviewStatus.VERIFIED) {
      return {
        eligible: false,
        reason: `Business verification status is ${doc.status} (must be VERIFIED)`,
      };
    }
  }

  return { eligible: true };
}
