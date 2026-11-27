/**
 * Statutory KYC and verification document types for partners.
 * Standard technical baseline (SRS Decision #2 remains open for statutory mandates).
 */
export enum PartnerDocumentType {
  GST_CERTIFICATE = 'GST_CERTIFICATE',
  PAN_CARD = 'PAN_CARD',
  TRADE_LICENSE = 'TRADE_LICENSE',
  CANCELLED_CHEQUE = 'CANCELLED_CHEQUE',
  SHOP_ESTABLISHMENT = 'SHOP_ESTABLISHMENT',
  OTHER = 'OTHER',
}

/**
 * Compliance review lifecycle status for verification documents.
 */
export enum DocumentReviewStatus {
  PENDING_REVIEW = 'PENDING_REVIEW',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
}

/**
 * Automated malware scanning lifecycle status.
 * Represents purely the automated antivirus engine outcome.
 */
export enum DocumentScanStatus {
  PENDING_SCAN = 'PENDING_SCAN',
  CLEAN = 'CLEAN',
  INFECTED = 'INFECTED',
  SCAN_FAILED = 'SCAN_FAILED',
  SCAN_UNAVAILABLE = 'SCAN_UNAVAILABLE',
}

/**
 * Administrative manual security review approval status.
 * Decoupled from automated antivirus scan results.
 */
export enum ManualSecurityReviewStatus {
  NOT_REVIEWED = 'NOT_REVIEWED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * Administrative manual security review details.
 */
export interface IManualSecurityReviewDto {
  status: ManualSecurityReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reason?: string;
}

/**
 * Detailed DTO for partner statutory verification document.
 */
export interface IPartnerDocumentDto {
  id: string;
  documentType: PartnerDocumentType;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Hash: string;
  uploadedAt: string;
  uploadedBy: string;
  status: DocumentReviewStatus;
  rejectionReason?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  expiresAt?: string | null;
  scanStatus: DocumentScanStatus;
  scanGeneration: number;
  scannedAt?: string | null;
  scanDetails?: {
    engine?: string;
    signatureVersion?: string;
    threatName?: string;
  };
  manualSecurityReview: IManualSecurityReviewDto;
  notes?: string | null;
  isDeleted: boolean;
  deletedAt?: string | null;
  deletedBy?: string | null;
}

/**
 * Response payload for document upload endpoint.
 */
export interface IUploadPartnerDocumentResponseDto {
  document: IPartnerDocumentDto;
}

/**
 * Response payload for listing partner KYC documents.
 */
export interface IPartnerDocumentListResponseDto {
  partnerId: string;
  items: IPartnerDocumentDto[];
  total: number;
}

/**
 * Response payload for expiring signed download URL generation.
 */
export interface ISignedUrlResponseDto {
  downloadUrl: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * Response payload for soft-deleting a partner KYC document.
 */
export interface IDeletePartnerDocumentResponseDto {
  message: string;
  documentId: string;
}

/**
 * Request payload for manual security override of a KYC document scan.
 */
export interface IScanOverrideRequestDto {
  reason: string;
}

/**
 * Response payload for manual security override of a KYC document scan.
 */
export interface IScanOverrideResponseDto {
  document: IPartnerDocumentDto;
}

/**
 * Cleaned / sanitized public DTO for a storage cleanup job.
 * Note: storageKey, physical bucket paths, and private URLs are strictly omitted for security.
 */
export interface IStorageCleanupJobDto {
  id: string;
  partnerId?: string | null;
  documentId?: string | null;
  triggerReason: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  nextRetryAt: string;
  leaseExpiresAt?: string | null;
  workerId?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Response payload for administrative retry of a storage cleanup job.
 */
export interface IStorageCleanupJobRetryResponseDto {
  job: IStorageCleanupJobDto;
}

/**
 * Request payload for reviewing a partner KYC document (PATCH /status).
 */
export interface IReviewPartnerDocumentRequestDto {
  status: DocumentReviewStatus.VERIFIED | DocumentReviewStatus.REJECTED;
  rejectionReason?: string;
}

/**
 * Response payload for reviewing a partner KYC document.
 */
export interface IReviewPartnerDocumentResponseDto {
  document: IPartnerDocumentDto;
}

