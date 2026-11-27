import { Types } from 'mongoose';
import {
  type IPartnerAdminSummaryDto,
  type IPartnerAdminDetailDto,
  type IAdminPartnerListResponseDto,
  type IAdminPartnerAuditLogListResponseDto,
  type IPartnerAuditLogDto,
  type IPartnerServiceAreaDetailDto,
  type IPartnerDocumentListResponseDto,
  type IPartnerDocumentDto,
  type ISignedUrlResponseDto,
  type IDeletePartnerDocumentResponseDto,
  type IScanOverrideResponseDto,
  DocumentScanStatus,
  ManualSecurityReviewStatus,
  UserType,
  UserStatus,
} from '@thehomez/shared-types';
import { PartnerModel, type IPartnerDocument } from '../../models/partner.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../../models/service-area.model.js';
import { UserModel } from '../../models/user.model.js';
import { RefreshTokenModel } from '../../models/refresh-token.model.js';
import { PartnerAuditLogModel } from '../../models/partner-audit-log.model.js';
import { StorageCleanupTriggerReason } from '../../models/storage-cleanup-job.model.js';
import { withTransaction } from '../../database/transaction.js';
import { logger } from '../../logger/logger.js';
import { AdminPartnerError } from './admin-partner.errors.js';
import { normalizePhoneNumber } from '../phone.utils.js';
import type {
  AdminPartnerQuery,
  UpdatePartnerStatusInput,
  UpdatePartnerProfileInput,
  AdminPartnerAuditLogsQuery,
  ScanOverrideInput,
} from '../../routes/admin-partner.schemas.js';
import type { IPrivateDocumentStorageAdapter } from '../storage/private-storage.interface.js';
import { cloudinaryPrivateStorageAdapter } from '../storage/cloudinary-private-storage.service.js';
import { StorageCleanupService, storageCleanupService } from '../storage/storage-cleanup.service.js';
import {
  isKycDocumentEligible,
  type IKycDocumentEligibilityResult,
  type KycDocumentPurpose,
} from './kyc-document-eligibility.js';

export {
  isKycDocumentEligible,
  type IKycDocumentEligibilityResult,
  type KycDocumentPurpose,
};

function escapeRegex(text: string): string {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

function projectSafeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object') return {};
  const safe: Record<string, unknown> = {};
  const blockedKeys = new Set([
    'passwordHash',
    'password',
    'token',
    'refreshToken',
    'otp',
    'hashedOtp',
    'secret',
  ]);
  for (const [key, value] of Object.entries(metadata)) {
    if (
      !blockedKeys.has(key) &&
      !key.toLowerCase().includes('secret') &&
      !key.toLowerCase().includes('hash')
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

const PERMITTED_STATUS_TRANSITIONS: ReadonlySet<string> = new Set([
  'PENDING_VERIFICATION:INACTIVE',
  'PENDING_VERIFICATION:SUSPENDED',
  'ACTIVE:INACTIVE',
  'ACTIVE:SUSPENDED',
  'INACTIVE:SUSPENDED',
  'SUSPENDED:INACTIVE',
]);

export class AdminPartnerService {
  constructor(
    private readonly storageAdapter: IPrivateDocumentStorageAdapter = cloudinaryPrivateStorageAdapter,
    private readonly cleanupService: StorageCleanupService = storageCleanupService,
  ) {}

  private parsePartnerObjectId(id: string): Types.ObjectId {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new AdminPartnerError(
        'Partner ID must be a valid 24-character hexadecimal ObjectId',
        'INVALID_PARTNER_ID',
        400,
      );
    }
    return new Types.ObjectId(id);
  }

  private parseDocumentObjectId(id: string): Types.ObjectId {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new AdminPartnerError(
        'Document ID must be a valid 24-character hexadecimal ObjectId',
        'INVALID_DOCUMENT_ID',
        400,
      );
    }
    return new Types.ObjectId(id);
  }


  /**
   * API 1: List partner directory with pagination, search, status, and service area filtering
   * GET /api/v1/admin/partners
   */
  public async listPartners(query: AdminPartnerQuery): Promise<IAdminPartnerListResponseDto> {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      serviceAreaId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const filter: Record<string, unknown> = {};

    if (status) {
      filter.status = status;
    }

    if (serviceAreaId) {
      filter.serviceAreaIds = new Types.ObjectId(serviceAreaId);
    }

    if (search && search.trim().length > 0) {
      const sanitized = escapeRegex(search.trim());
      const regex = new RegExp(sanitized, 'i');
      filter.$or = [{ businessName: regex }, { legalName: regex }, { phone: regex }];
    }

    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sortOptions: Record<string, 1 | -1> = { [sortBy]: sortDirection };
    if (sortBy !== 'createdAt') {
      sortOptions.createdAt = -1;
    }

    const skip = (page - 1) * limit;

    const [partnerDocs, total] = await Promise.all([
      PartnerModel.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(limit)
        .lean<IPartnerDocument[]>(),
      PartnerModel.countDocuments(filter),
    ]);

    const items: IPartnerAdminSummaryDto[] = partnerDocs.map((doc) => ({
      id: doc._id.toString(),
      businessName: doc.businessName,
      legalName: doc.legalName ?? null,
      phone: doc.phone,
      email: doc.email ?? null,
      status: doc.status,
      deliveryMode: doc.deliveryMode,
      serviceAreaCount: Array.isArray(doc.serviceAreaIds) ? doc.serviceAreaIds.length : 0,
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * API 2: Partner detail inspection
   * GET /api/v1/admin/partners/:partnerId
   */
  public async getPartnerById(partnerId: string): Promise<IPartnerAdminDetailDto> {
    const partnerObjectId = this.parsePartnerObjectId(partnerId);

    const partner = await PartnerModel.findById(partnerObjectId).lean<IPartnerDocument>();

    if (!partner) {
      throw new AdminPartnerError('Partner not found', 'PARTNER_NOT_FOUND', 404);
    }

    const serviceAreaIds = Array.isArray(partner.serviceAreaIds) ? partner.serviceAreaIds : [];

    const [serviceAreaDocs, linkedUserCount] = await Promise.all([
      serviceAreaIds.length > 0
        ? ServiceAreaModel.find({ _id: { $in: serviceAreaIds } }).lean<IServiceAreaDocument[]>()
        : Promise.resolve([]),
      UserModel.countDocuments({ partnerId: partnerObjectId }),
    ]);

    const serviceAreas: IPartnerServiceAreaDetailDto[] = serviceAreaDocs.map((sa) => ({
      id: sa._id.toString(),
      code: sa.code,
      name: sa.name,
      city: sa.city,
      state: sa.state,
      pincodeCount: Array.isArray(sa.pincodes) ? sa.pincodes.length : 0,
      isActive: sa.isActive,
    }));

    return {
      id: partner._id.toString(),
      businessName: partner.businessName,
      legalName: partner.legalName ?? null,
      phone: partner.phone,
      email: partner.email ?? null,
      status: partner.status,
      deliveryMode: partner.deliveryMode,
      serviceAreas,
      linkedUserCount,
      metadata: projectSafeMetadata(partner.metadata as Record<string, unknown>),
      createdAt: new Date(partner.createdAt).toISOString(),
      updatedAt: new Date(partner.updatedAt).toISOString(),
    };
  }

  /**
   * API 3: Partner lifecycle status mutation
   * PATCH /api/v1/admin/partners/:partnerId/status
   *
   * Ordered 5-step lifecycle validation per Stage C-8A.8 contract:
   * Step 1: Same-Status Check -> INVALID_STATE_TRANSITION (400)
   * Step 2: ACTIVE Verification Gate -> PARTNER_VERIFICATION_REQUIRED (400)
   * Step 3: PENDING_VERIFICATION Backward-Transition Check -> INVALID_STATE_TRANSITION (400)
   * Step 4: Permitted Transition Matrix Check -> INVALID_STATE_TRANSITION (400)
   * Step 5: Transactional Mutation with Concurrency Lock, SECURITY_RESET token revocation, and Audit Log
   */
  public async updatePartnerStatus(
    partnerId: string,
    input: UpdatePartnerStatusInput,
    staffUser: { id: string; email?: string; phone?: string },
  ): Promise<IPartnerAdminDetailDto> {
    const partnerObjectId = this.parsePartnerObjectId(partnerId);

    const partner = await PartnerModel.findById(partnerObjectId);

    if (!partner) {
      throw new AdminPartnerError('Partner not found', 'PARTNER_NOT_FOUND', 404);
    }

    const currentStatus = partner.status;
    const targetStatus = input.status;

    // Step 1 (Same-Status Check): Universal no-op rejection for all statuses including ACTIVE -> ACTIVE
    if (targetStatus === currentStatus) {
      throw new AdminPartnerError(
        `Partner is already ${currentStatus.toLowerCase()}`,
        'INVALID_STATE_TRANSITION',
        400,
      );
    }

    // Step 2 (ACTIVE Verification Gate): Genuine transitions targeting ACTIVE require verification workflow
    if (targetStatus === 'ACTIVE') {
      throw new AdminPartnerError(
        'Transition to ACTIVE requires partner verification workflow (Stage C-11)',
        'PARTNER_VERIFICATION_REQUIRED',
        400,
      );
    }

    // Step 3 (Backward-Transition Check): Cannot regress operational partner to PENDING_VERIFICATION
    if (targetStatus === 'PENDING_VERIFICATION') {
      throw new AdminPartnerError(
        'Transition to PENDING_VERIFICATION is not permitted',
        'INVALID_STATE_TRANSITION',
        400,
      );
    }

    // Step 4 (Permitted Transition Matrix Check)
    const transitionKey = `${currentStatus}:${targetStatus}`;
    if (!PERMITTED_STATUS_TRANSITIONS.has(transitionKey)) {
      throw new AdminPartnerError('Illegal state transition', 'INVALID_STATE_TRANSITION', 400);
    }

    // Step 5 (Transactional Mutation): Proceed with atomic state update, token revocation, and audit log
    await withTransaction(async (session) => {
      // Optimistic concurrency check ensuring status has not been modified
      const updated = await PartnerModel.findOneAndUpdate(
        { _id: partnerObjectId, status: currentStatus },
        { $set: { status: targetStatus } },
        { session, new: true },
      );

      if (!updated) {
        throw new AdminPartnerError(
          'Partner status was concurrently modified by another transaction',
          'CONCURRENT_MODIFICATION',
          409,
        );
      }

      // Query all users linked to this partner tenant
      const linkedUsers = await UserModel.find({ partnerId: partnerObjectId })
        .select('_id')
        .session(session);
      const linkedUserIds = linkedUsers.map((u) => u._id);

      // Atomically revoke all active refresh tokens for all linked partner users
      if (linkedUserIds.length > 0) {
        await RefreshTokenModel.updateMany(
          { userId: { $in: linkedUserIds }, isRevoked: false },
          {
            $set: {
              isRevoked: true,
              revokedReason: 'SECURITY_RESET',
              revokedAt: new Date(),
            },
          },
          { session },
        );
      }

      // Record immutable lifecycle audit entry
      await PartnerAuditLogModel.create(
        [
          {
            partnerId: partnerObjectId,
            staffUserId: new Types.ObjectId(staffUser.id),
            action: 'PARTNER_STATUS_CHANGED',
            previousState: { status: currentStatus },
            newState: { status: targetStatus },
            reason: input.reason.trim(),
            metadata: {
              staffEmail: staffUser.email,
              staffPhone: staffUser.phone,
            },
          },
        ],
        { session },
      );
    });

    logger.info(
      {
        staffUserId: staffUser.id,
        partnerId,
        previousStatus: currentStatus,
        targetStatus,
      },
      'Partner lifecycle status updated by staff',
    );

    return this.getPartnerById(partnerId);
  }

  /**
   * API: Partner Profile Edit (P1A-13)
   * PUT /api/v1/admin/partners/:partnerId
   *
   * Modifies partner dispatch contacts without altering UserModel login credentials,
   * unless syncPrimaryOperatorPhone is explicitly true.
   * Email synchronization to UserModel is strictly unsupported.
   *
   * Validates:
   * - NO_ACTIVE_OPERATOR: HTTP 400 when syncPrimaryOperatorPhone is true but no active operator exists.
   * - MULTIPLE_OPERATORS_EXIST: HTTP 400 when syncPrimaryOperatorPhone is true but > 1 operators exist.
   * - PHONE_ALREADY_REGISTERED: HTTP 409 when operator login phone is already used by another partner operator.
   * - Atomic transaction execution via withTransaction.
   * - SECURITY_RESET token revocation on operator phone update.
   * - PARTNER_PROFILE_UPDATED and PARTNER_OPERATOR_CREDENTIALS_UPDATED audit logs.
   */
  public async updatePartnerProfile(
    partnerId: string,
    input: UpdatePartnerProfileInput,
    staffUser: { id: string; email?: string; phone?: string },
  ): Promise<IPartnerAdminDetailDto> {
    const partnerObjectId = this.parsePartnerObjectId(partnerId);

    const partner = await PartnerModel.findById(partnerObjectId);
    if (!partner) {
      throw new AdminPartnerError('Partner not found', 'PARTNER_NOT_FOUND', 404);
    }

    const partnerUpdates: Record<string, unknown> = {};
    const previousState: Record<string, unknown> = {};
    const newState: Record<string, unknown> = {};

    if (input.businessName !== undefined) {
      partnerUpdates.businessName = input.businessName;
      previousState.businessName = partner.businessName;
      newState.businessName = input.businessName;
    }

    if (input.legalName !== undefined) {
      partnerUpdates.legalName = input.legalName;
      previousState.legalName = partner.legalName;
      newState.legalName = input.legalName;
    }

    let targetNormalizedPhone: string | undefined;
    if (input.phone !== undefined) {
      targetNormalizedPhone = normalizePhoneNumber(input.phone);
      partnerUpdates.phone = targetNormalizedPhone;
      previousState.phone = partner.phone;
      newState.phone = targetNormalizedPhone;
    }

    if (input.email !== undefined) {
      partnerUpdates.email = input.email;
      previousState.email = partner.email;
      newState.email = input.email;
    }

    if (input.deliveryMode !== undefined) {
      partnerUpdates.deliveryMode = input.deliveryMode;
      previousState.deliveryMode = partner.deliveryMode;
      newState.deliveryMode = input.deliveryMode;
    }

    let primaryOperator: InstanceType<typeof UserModel> | null = null;

    if (input.syncPrimaryOperatorPhone) {
      if (!targetNormalizedPhone) {
        throw new AdminPartnerError(
          'Phone number is required when syncPrimaryOperatorPhone is enabled',
          'PHONE_REQUIRED_FOR_SYNC',
          400,
        );
      }

      // Check operator count for ambiguity
      const operatorCount = await UserModel.countDocuments({
        partnerId: partnerObjectId,
        userType: UserType.PARTNER,
      });

      if (operatorCount > 1) {
        throw new AdminPartnerError(
          'Multiple operator accounts exist for this partner. Synchronizing login phone is ambiguous and must be performed via dedicated operator account management',
          'MULTIPLE_OPERATORS_EXIST',
          400,
        );
      }

      // Resolve primary active operator
      primaryOperator = await UserModel.findOne({
        partnerId: partnerObjectId,
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
      }).sort({ createdAt: 1 });

      if (!primaryOperator) {
        throw new AdminPartnerError(
          'No active operator account exists for this partner. Provision an operator user before attempting credential synchronization',
          'NO_ACTIVE_OPERATOR',
          400,
        );
      }

      // Pre-check phone collision across other partner operators
      const phoneConflict = await UserModel.exists({
        phone: targetNormalizedPhone,
        userType: UserType.PARTNER,
        _id: { $ne: primaryOperator._id },
      });

      if (phoneConflict) {
        throw new AdminPartnerError(
          'Phone number is already registered to another partner operator',
          'PHONE_ALREADY_REGISTERED',
          409,
        );
      }
    }

    try {
      await withTransaction(async (session) => {
        if (input.syncPrimaryOperatorPhone && primaryOperator && targetNormalizedPhone) {
          // Re-verify uniqueness inside transaction session
          const sessionConflict = await UserModel.exists({
            phone: targetNormalizedPhone,
            userType: UserType.PARTNER,
            _id: { $ne: primaryOperator._id },
          }).session(session);

          if (sessionConflict) {
            throw new AdminPartnerError(
              'Phone number is already registered to another partner operator',
              'PHONE_ALREADY_REGISTERED',
              409,
            );
          }

          // 1. Update Partner dispatch profile
          const updatedPartner = await PartnerModel.findByIdAndUpdate(
            partnerObjectId,
            { $set: partnerUpdates },
            { session, new: true, runValidators: true },
          );

          if (!updatedPartner) {
            throw new AdminPartnerError('Partner not found', 'PARTNER_NOT_FOUND', 404);
          }

          // 2. Update UserModel phone
          const previousOperatorPhone = primaryOperator.phone;
          await UserModel.updateOne(
            { _id: primaryOperator._id },
            { $set: { phone: targetNormalizedPhone } },
            { session, runValidators: true },
          );

          // 3. Revoke active refresh tokens for operator
          await RefreshTokenModel.updateMany(
            { userId: primaryOperator._id, isRevoked: false },
            {
              $set: {
                isRevoked: true,
                revokedReason: 'SECURITY_RESET',
                revokedAt: new Date(),
              },
            },
            { session },
          );

          // 4. Record operator credentials update audit log
          await PartnerAuditLogModel.create(
            [
              {
                partnerId: partnerObjectId,
                staffUserId: new Types.ObjectId(staffUser.id),
                action: 'PARTNER_OPERATOR_CREDENTIALS_UPDATED',
                previousState: {
                  phone: previousOperatorPhone,
                  operatorUserId: primaryOperator._id.toString(),
                },
                newState: {
                  phone: targetNormalizedPhone,
                  operatorUserId: primaryOperator._id.toString(),
                },
                reason: input.reason.trim(),
                metadata: {
                  staffEmail: staffUser.email,
                  staffPhone: staffUser.phone,
                },
              },
            ],
            { session },
          );

          // 5. Record partner profile update audit log
          await PartnerAuditLogModel.create(
            [
              {
                partnerId: partnerObjectId,
                staffUserId: new Types.ObjectId(staffUser.id),
                action: 'PARTNER_PROFILE_UPDATED',
                previousState,
                newState,
                reason: input.reason.trim(),
                metadata: {
                  staffEmail: staffUser.email,
                  staffPhone: staffUser.phone,
                },
              },
            ],
            { session },
          );
        } else {
          // Standard dispatch contact update without operator sync
          const updatedPartner = await PartnerModel.findByIdAndUpdate(
            partnerObjectId,
            { $set: partnerUpdates },
            { session, new: true, runValidators: true },
          );

          if (!updatedPartner) {
            throw new AdminPartnerError('Partner not found', 'PARTNER_NOT_FOUND', 404);
          }

          // Record partner profile update audit log
          await PartnerAuditLogModel.create(
            [
              {
                partnerId: partnerObjectId,
                staffUserId: new Types.ObjectId(staffUser.id),
                action: 'PARTNER_PROFILE_UPDATED',
                previousState,
                newState,
                reason: input.reason.trim(),
                metadata: {
                  staffEmail: staffUser.email,
                  staffPhone: staffUser.phone,
                },
              },
            ],
            { session },
          );
        }
      });
    } catch (err: any) {
      if (err instanceof AdminPartnerError) {
        throw err;
      }
      if (err?.code === 11000 || (err?.name === 'MongoServerError' && err?.code === 11000)) {
        throw new AdminPartnerError(
          'Phone number is already registered to another partner operator',
          'PHONE_ALREADY_REGISTERED',
          409,
        );
      }
      throw err;
    }

    logger.info(
      {
        staffUserId: staffUser.id,
        partnerId,
        syncedOperatorPhone: Boolean(input.syncPrimaryOperatorPhone),
        updatedFields: Object.keys(partnerUpdates),
      },
      'Partner profile updated by staff',
    );

    return this.getPartnerById(partnerId);
  }

  /**
   * API 4: Partner audit logs history inspection
   * GET /api/v1/admin/partners/:partnerId/audit-logs
   */
  public async getPartnerAuditLogs(
    partnerId: string,
    query: AdminPartnerAuditLogsQuery,
  ): Promise<IAdminPartnerAuditLogListResponseDto> {
    const partnerObjectId = this.parsePartnerObjectId(partnerId);

    const partnerExists = await PartnerModel.exists({ _id: partnerObjectId });
    if (!partnerExists) {
      throw new AdminPartnerError('Partner not found', 'PARTNER_NOT_FOUND', 404);
    }

    const { page = 1, limit = 20 } = query;
    const filter = {
      partnerId: partnerObjectId,
      action: 'PARTNER_STATUS_CHANGED',
    };

    const skip = (page - 1) * limit;

    const [auditDocs, total] = await Promise.all([
      PartnerAuditLogModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PartnerAuditLogModel.countDocuments(filter),
    ]);

    const items: IPartnerAuditLogDto[] = auditDocs.map((doc) => ({
      id: doc._id.toString(),
      action: 'PARTNER_STATUS_CHANGED',
      previousState: (doc.previousState as Record<string, unknown>) ?? {},
      newState: (doc.newState as Record<string, unknown>) ?? {},
      reason: doc.reason,
      performedBy: {
        id: doc.staffUserId.toString(),
        email: doc.metadata?.staffEmail ?? null,
        phone: doc.metadata?.staffPhone ?? null,
      },
      createdAt: new Date(doc.createdAt).toISOString(),
    }));

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      items,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * API 5 (P1A-08): Inspect partner KYC document metadata
   * GET /api/v1/admin/partners/:partnerId/documents
   */
  public async getPartnerDocuments(
    partnerId: string,
  ): Promise<IPartnerDocumentListResponseDto> {
    const partnerObjectId = this.parsePartnerObjectId(partnerId);

    const partner = await PartnerModel.findById(partnerObjectId).lean<IPartnerDocument>();
    if (!partner) {
      throw new AdminPartnerError('Partner not found', 'PARTNER_NOT_FOUND', 404);
    }

    const rawDocuments = Array.isArray(partner.documents) ? partner.documents : [];

    // Default behavior: exclude soft-deleted documents
    const filteredDocs = rawDocuments.filter((doc) => !doc.isDeleted);

    // Sort newest uploaded first
    const sortedDocs = [...filteredDocs].sort(
      (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
    );

    const items: IPartnerDocumentDto[] = sortedDocs.map((doc) => ({
      id: doc._id.toString(),
      documentType: doc.documentType,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
      sha256Hash: doc.sha256Hash,
      uploadedAt: new Date(doc.uploadedAt).toISOString(),
      uploadedBy: doc.uploadedBy ? doc.uploadedBy.toString() : '',
      status: doc.status,
      rejectionReason: doc.rejectionReason ?? null,
      reviewedAt: doc.reviewedAt ? new Date(doc.reviewedAt).toISOString() : null,
      reviewedBy: doc.reviewedBy ? doc.reviewedBy.toString() : null,
      expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
      scanStatus: doc.scanStatus,
      scanGeneration: doc.scanGeneration ?? 1,
      scannedAt: doc.scannedAt ? new Date(doc.scannedAt).toISOString() : null,
      scanDetails: doc.scanDetails as IPartnerDocumentDto['scanDetails'],
      manualSecurityReview: {
        status: doc.manualSecurityReview?.status ?? ManualSecurityReviewStatus.NOT_REVIEWED,
        reviewedBy: doc.manualSecurityReview?.reviewedBy?.toString(),
        reviewedAt: doc.manualSecurityReview?.reviewedAt
          ? new Date(doc.manualSecurityReview.reviewedAt).toISOString()
          : undefined,
        reason: doc.manualSecurityReview?.reason,
      },
      notes: doc.notes ?? null,
      isDeleted: Boolean(doc.isDeleted),
      deletedAt: doc.deletedAt ? new Date(doc.deletedAt).toISOString() : null,
      deletedBy: doc.deletedBy ? doc.deletedBy.toString() : null,
    }));

    return {
      partnerId: partner._id.toString(),
      items,
      total: items.length,
    };
  }

  /**
   * API 6 (P1A-09): Expiring signed download URL generation with unified KYC eligibility
   * GET /api/v1/admin/partners/:partnerId/documents/:docId/signed-url
   */
  public async getPartnerDocumentSignedUrl(
    partnerId: string,
    docId: string,
    staffUser: { id: string; email?: string },
    auditMetadata?: { correlationId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<ISignedUrlResponseDto> {
    const partnerObjectId = this.parsePartnerObjectId(partnerId);
    const docObjectId = this.parseDocumentObjectId(docId);

    // 1. Partner lookup
    const partner = await PartnerModel.findById(partnerObjectId).lean<IPartnerDocument>();
    if (!partner) {
      throw new AdminPartnerError('Partner not found', 'PARTNER_NOT_FOUND', 404);
    }

    // 2. Find document strictly belonging to this partner
    const documents = Array.isArray(partner.documents) ? partner.documents : [];
    const doc = documents.find((d) => d._id.toString() === docObjectId.toString());
    if (!doc) {
      throw new AdminPartnerError('Document not found', 'DOCUMENT_NOT_FOUND', 404);
    }

    // 3. Unified KYC Document Eligibility Evaluation
    const eligibility = isKycDocumentEligible(doc, 'DOWNLOAD');
    if (!eligibility.eligible) {
      if (doc.isDeleted) {
        throw new AdminPartnerError('Document not found', 'DOCUMENT_NOT_FOUND', 404);
      }
      if (doc.scanStatus === DocumentScanStatus.INFECTED) {
        throw new AdminPartnerError(
          eligibility.reason || 'Document is quarantined due to malware infection',
          'DOCUMENT_QUARANTINED',
          403,
        );
      }
      if (doc.scanStatus === DocumentScanStatus.PENDING_SCAN) {
        throw new AdminPartnerError(
          eligibility.reason || 'Document malware scan is pending',
          'DOCUMENT_SCAN_PENDING',
          423,
        );
      }
      if (doc.scanStatus === DocumentScanStatus.SCAN_FAILED) {
        throw new AdminPartnerError(
          eligibility.reason || 'Document scanning failed',
          'DOCUMENT_SCAN_FAILED',
          502,
        );
      }
      if (doc.scanStatus === DocumentScanStatus.SCAN_UNAVAILABLE) {
        throw new AdminPartnerError(
          eligibility.reason || 'Malware scanner unavailable',
          'SCANNER_UNAVAILABLE',
          503,
        );
      }
      if (doc.expiresAt && new Date(doc.expiresAt) <= new Date()) {
        throw new AdminPartnerError(
          eligibility.reason || 'Document has expired',
          'DOCUMENT_EXPIRED',
          410,
        );
      }
      throw new AdminPartnerError(
        eligibility.reason || 'Document is not eligible for download',
        'DOCUMENT_INELIGIBLE',
        400,
      );
    }

    // 4. Generate Expiring Signed URL (15-minute / 900-second TTL)
    const ttlSeconds = 900;
    const signedResult = await this.storageAdapter.generateExpiringSignedUrl(
      doc.storageKey,
      ttlSeconds,
    );

    // 5. Emit mandatory PARTNER_DOCUMENT_ACCESSED audit event
    // If audit logging fails, do not return a successful download URL
    try {
      await PartnerAuditLogModel.create({
        partnerId: partner._id,
        staffUserId: new Types.ObjectId(staffUser.id),
        action: 'PARTNER_DOCUMENT_ACCESSED',
        previousState: {},
        newState: {
          documentId: doc._id,
          documentType: doc.documentType,
          originalFilename: doc.originalFilename,
          expiresAt: signedResult.expiresAt,
          ttlSeconds,
        },
        reason: `KYC document ${doc.documentType} accessed by staff user`,
        metadata: {
          staffEmail: staffUser.email,
          ipAddress: auditMetadata?.ipAddress,
          userAgent: auditMetadata?.userAgent,
          correlationId: auditMetadata?.correlationId,
        },
      });
    } catch (auditErr) {
      logger.error(
        { err: auditErr, partnerId, docId },
        'AdminPartnerService: Mandatory PARTNER_DOCUMENT_ACCESSED audit log creation failed. Suppressing signed URL release.',
      );
      throw new AdminPartnerError(
        'Failed to record document access audit trail',
        'AUDIT_LOG_FAILED',
        500,
      );
    }

    return {
      downloadUrl: signedResult.downloadUrl,
      expiresAt: signedResult.expiresAt.toISOString(),
      ttlSeconds,
    };
  }

  /**
   * API 7 (P1A-10): Soft deletion and storage cleanup trigger for partner KYC document
   * DELETE /api/v1/admin/partners/:partnerId/documents/:docId
   */
  public async deletePartnerDocument(
    partnerId: string,
    docId: string,
    staffUser: { id: string; email?: string },
    auditMetadata?: { correlationId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<IDeletePartnerDocumentResponseDto> {
    const partnerObjectId = this.parsePartnerObjectId(partnerId);
    const docObjectId = this.parseDocumentObjectId(docId);
    const staffObjectId = new Types.ObjectId(staffUser.id);

    // 1. Partner lookup
    const partner = await PartnerModel.findById(partnerObjectId);
    if (!partner) {
      throw new AdminPartnerError('Partner not found', 'PARTNER_NOT_FOUND', 404);
    }

    // 2. Find document strictly belonging to this partner
    const documents = Array.isArray(partner.documents) ? partner.documents : [];
    const doc = documents.find((d) => d._id.toString() === docObjectId.toString());
    if (!doc) {
      throw new AdminPartnerError('Document not found', 'DOCUMENT_NOT_FOUND', 404);
    }

    // Repeated deletion safe handling: reject if already deleted
    if (doc.isDeleted) {
      throw new AdminPartnerError(
        'Document has already been deleted',
        'DOCUMENT_ALREADY_DELETED',
        400,
      );
    }

    const now = new Date();

    // 3. Atomically soft-delete document in MongoDB (ensuring isDeleted is not already true)
    const updateResult = await PartnerModel.updateOne(
      {
        _id: partnerObjectId,
        'documents._id': docObjectId,
        'documents.isDeleted': { $ne: true },
      },
      {
        $set: {
          'documents.$.isDeleted': true,
          'documents.$.deletedAt': now,
          'documents.$.deletedBy': staffObjectId,
        },
      },
    );

    if (updateResult.modifiedCount === 0) {
      // Concurrently deleted by another request
      throw new AdminPartnerError(
        'Document has already been deleted',
        'DOCUMENT_ALREADY_DELETED',
        400,
      );
    }

    // 4. Emit mandatory PARTNER_DOCUMENT_DELETED audit event
    try {
      await PartnerAuditLogModel.create({
        partnerId: partner._id,
        staffUserId: staffObjectId,
        action: 'PARTNER_DOCUMENT_DELETED',
        previousState: {
          documentId: doc._id.toString(),
          documentType: doc.documentType,
          isDeleted: false,
          status: doc.status,
          scanStatus: doc.scanStatus,
        },
        newState: {
          documentId: doc._id.toString(),
          documentType: doc.documentType,
          isDeleted: true,
          deletedAt: now.toISOString(),
          deletedBy: staffObjectId.toString(),
        },
        reason: `KYC document ${doc.documentType} soft-deleted by staff user`,
        metadata: {
          staffEmail: staffUser.email,
          ipAddress: auditMetadata?.ipAddress,
          userAgent: auditMetadata?.userAgent,
          correlationId: auditMetadata?.correlationId,
        },
      });
    } catch (auditErr) {
      logger.error(
        { err: auditErr, partnerId, docId },
        'AdminPartnerService: Mandatory PARTNER_DOCUMENT_DELETED audit log creation failed. Rolling back soft deletion.',
      );

      // Rollback soft-delete state to preserve audit immutability invariant
      try {
        await PartnerModel.updateOne(
          {
            _id: partnerObjectId,
            'documents._id': docObjectId,
          },
          {
            $set: {
              'documents.$.isDeleted': false,
            },
            $unset: {
              'documents.$.deletedAt': 1,
              'documents.$.deletedBy': 1,
            },
          },
        );
      } catch (rollbackErr) {
        logger.error(
          { err: rollbackErr, partnerId, docId },
          'AdminPartnerService: Failed to rollback document soft deletion after audit log creation failure.',
        );
      }

      throw new AdminPartnerError(
        'Failed to record document deletion audit trail',
        'AUDIT_LOG_FAILED',
        500,
      );
    }

    // 5. Schedule storage cleanup job via dual-layer queue (MongoDB + WAL fallback)
    try {
      await this.cleanupService.recordCompensationFailure({
        storageKey: doc.storageKey,
        partnerId: partner._id,
        documentId: doc._id,
        triggerReason: StorageCleanupTriggerReason.DOCUMENT_DELETED,
      });
    } catch (cleanupQueueErr) {
      logger.error(
        { err: cleanupQueueErr, storageKey: doc.storageKey, partnerId, docId },
        'AdminPartnerService: Unexpected error scheduling storage cleanup job in queue.',
      );
    }

    return {
      message: 'Document deleted successfully',
      documentId: doc._id.toString(),
    };
  }

  /**
   * API 8 (P1A-11): Manual security override for partner KYC document scan status
   * POST /api/v1/admin/partners/:partnerId/documents/:docId/scan-override
   */
  public async overrideDocumentScanStatus(
    partnerId: string,
    docId: string,
    input: ScanOverrideInput,
    staffUser: { id: string; email?: string },
    auditMetadata?: { correlationId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<IScanOverrideResponseDto> {
    const partnerObjectId = this.parsePartnerObjectId(partnerId);
    const docObjectId = this.parseDocumentObjectId(docId);
    const staffObjectId = new Types.ObjectId(staffUser.id);
    const reason = input.reason.trim();

    // 1. Partner lookup
    const partner = await PartnerModel.findById(partnerObjectId);
    if (!partner) {
      throw new AdminPartnerError('Partner not found', 'PARTNER_NOT_FOUND', 404);
    }

    // 2. Document existence and soft-deletion check
    const documents = Array.isArray(partner.documents) ? partner.documents : [];
    const doc = documents.find((d) => d._id.toString() === docObjectId.toString());
    if (!doc || doc.isDeleted) {
      throw new AdminPartnerError('Document not found', 'DOCUMENT_NOT_FOUND', 404);
    }

    // 3. Scan eligibility gates:
    // Security Rule 1: Manual review must NEVER override an INFECTED scan result
    if (doc.scanStatus === DocumentScanStatus.INFECTED) {
      throw new AdminPartnerError(
        'Infected documents cannot be manually overridden',
        'DOCUMENT_QUARANTINED',
        403,
      );
    }

    // Security Rule 2: Cannot override while scan is in progress
    if (doc.scanStatus === DocumentScanStatus.PENDING_SCAN) {
      throw new AdminPartnerError(
        'Cannot override document while malware scan is pending',
        'DOCUMENT_SCAN_PENDING',
        400,
      );
    }

    // Security Rule 3: Cannot override if scanStatus is already CLEAN
    if (doc.scanStatus === DocumentScanStatus.CLEAN) {
      throw new AdminPartnerError(
        'Document scan status is already clean and does not require an override',
        'SCAN_OVERRIDE_NOT_PERMITTED',
        400,
      );
    }

    // Security Rule 4: Cannot override if manual security review is already APPROVED
    if (doc.manualSecurityReview?.status === ManualSecurityReviewStatus.APPROVED) {
      throw new AdminPartnerError(
        'Manual security review has already been approved for this document',
        'SECURITY_OVERRIDE_ALREADY_GRANTED',
        400,
      );
    }

    const now = new Date();

    // 4. Atomic document state mutation:
    // Sets manualSecurityReview fields WITHOUT altering doc.scanStatus
    const updateResult = await PartnerModel.updateOne(
      {
        _id: partnerObjectId,
        'documents._id': docObjectId,
        'documents.isDeleted': { $ne: true },
        'documents.scanStatus': {
          $in: [DocumentScanStatus.SCAN_UNAVAILABLE, DocumentScanStatus.SCAN_FAILED],
        },
        'documents.manualSecurityReview.status': { $ne: ManualSecurityReviewStatus.APPROVED },
      },
      {
        $set: {
          'documents.$.manualSecurityReview.status': ManualSecurityReviewStatus.APPROVED,
          'documents.$.manualSecurityReview.reviewedBy': staffObjectId,
          'documents.$.manualSecurityReview.reviewedAt': now,
          'documents.$.manualSecurityReview.reason': reason,
        },
      },
    );

    if (updateResult.modifiedCount === 0) {
      throw new AdminPartnerError(
        'Manual security review could not be applied due to a concurrent update or conflicting document state',
        'SECURITY_OVERRIDE_CONFLICT',
        409,
      );
    }

    // 5. Emit mandatory PARTNER_DOCUMENT_MANUAL_SECURITY_OVERRIDE_GRANTED audit event
    try {
      await PartnerAuditLogModel.create({
        partnerId: partner._id,
        staffUserId: staffObjectId,
        action: 'PARTNER_DOCUMENT_MANUAL_SECURITY_OVERRIDE_GRANTED',
        previousState: {
          documentId: doc._id.toString(),
          documentType: doc.documentType,
          scanStatus: doc.scanStatus,
          manualSecurityReview: {
            status: doc.manualSecurityReview?.status ?? ManualSecurityReviewStatus.NOT_REVIEWED,
            reviewedBy: doc.manualSecurityReview?.reviewedBy?.toString(),
            reviewedAt: doc.manualSecurityReview?.reviewedAt
              ? new Date(doc.manualSecurityReview.reviewedAt).toISOString()
              : undefined,
            reason: doc.manualSecurityReview?.reason,
          },
        },
        newState: {
          documentId: doc._id.toString(),
          documentType: doc.documentType,
          scanStatus: doc.scanStatus,
          manualSecurityReview: {
            status: ManualSecurityReviewStatus.APPROVED,
            reviewedBy: staffObjectId.toString(),
            reviewedAt: now.toISOString(),
            reason,
          },
        },
        reason,
        metadata: {
          staffEmail: staffUser.email,
          ipAddress: auditMetadata?.ipAddress,
          userAgent: auditMetadata?.userAgent,
          correlationId: auditMetadata?.correlationId,
        },
      });
    } catch (auditErr) {
      logger.error(
        { err: auditErr, partnerId, docId },
        'AdminPartnerService: Mandatory PARTNER_DOCUMENT_MANUAL_SECURITY_OVERRIDE_GRANTED audit log creation failed. Rolling back override.',
      );

      // Rollback manual security review state to preserve audit immutability invariant
      try {
        const rollbackFilter: Record<string, unknown> = {
          _id: partnerObjectId,
          'documents._id': docObjectId,
          'documents.manualSecurityReview.status': ManualSecurityReviewStatus.APPROVED,
          'documents.manualSecurityReview.reviewedAt': now,
        };

        const rollbackSet: Record<string, unknown> = {
          'documents.$.manualSecurityReview.status':
            doc.manualSecurityReview?.status ?? ManualSecurityReviewStatus.NOT_REVIEWED,
        };
        const rollbackUnset: Record<string, unknown> = {};

        if (doc.manualSecurityReview?.reviewedBy) {
          rollbackSet['documents.$.manualSecurityReview.reviewedBy'] = doc.manualSecurityReview.reviewedBy;
        } else {
          rollbackUnset['documents.$.manualSecurityReview.reviewedBy'] = 1;
        }

        if (doc.manualSecurityReview?.reviewedAt) {
          rollbackSet['documents.$.manualSecurityReview.reviewedAt'] = doc.manualSecurityReview.reviewedAt;
        } else {
          rollbackUnset['documents.$.manualSecurityReview.reviewedAt'] = 1;
        }

        if (doc.manualSecurityReview?.reason) {
          rollbackSet['documents.$.manualSecurityReview.reason'] = doc.manualSecurityReview.reason;
        } else {
          rollbackUnset['documents.$.manualSecurityReview.reason'] = 1;
        }

        const rollbackUpdate: Record<string, unknown> = {
          $set: rollbackSet,
        };
        if (Object.keys(rollbackUnset).length > 0) {
          rollbackUpdate.$unset = rollbackUnset;
        }

        const rollbackResult = await PartnerModel.updateOne(rollbackFilter, rollbackUpdate);
        if (rollbackResult.modifiedCount === 0) {
          logger.error(
            {
              partnerId: partnerObjectId.toString(),
              docId: docObjectId.toString(),
              matchedCount: rollbackResult.matchedCount,
              modifiedCount: rollbackResult.modifiedCount,
            },
            'AdminPartnerService: Rollback could not be applied because document state was concurrently modified or no longer matches override state',
          );
        }
      } catch (rollbackErr) {
        logger.error(
          { err: rollbackErr, partnerId, docId },
          'AdminPartnerService: Failed to rollback manual security override after audit log failure',
        );
      }

      throw new AdminPartnerError(
        'Failed to record manual security override audit trail',
        'AUDIT_LOG_FAILED',
        500,
      );
    }

    // 6. Return sanitized updated document DTO (no storageKey, no private URLs)
    const updatedDocDto: IPartnerDocumentDto = {
      id: doc._id.toString(),
      documentType: doc.documentType,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
      fileSizeBytes: doc.fileSizeBytes,
      sha256Hash: doc.sha256Hash,
      uploadedAt: new Date(doc.uploadedAt).toISOString(),
      uploadedBy: doc.uploadedBy ? doc.uploadedBy.toString() : '',
      status: doc.status,
      rejectionReason: doc.rejectionReason ?? null,
      reviewedAt: doc.reviewedAt ? new Date(doc.reviewedAt).toISOString() : null,
      reviewedBy: doc.reviewedBy ? doc.reviewedBy.toString() : null,
      expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
      scanStatus: doc.scanStatus,
      scanGeneration: doc.scanGeneration ?? 1,
      scannedAt: doc.scannedAt ? new Date(doc.scannedAt).toISOString() : null,
      scanDetails: doc.scanDetails as IPartnerDocumentDto['scanDetails'],
      manualSecurityReview: {
        status: ManualSecurityReviewStatus.APPROVED,
        reviewedBy: staffObjectId.toString(),
        reviewedAt: now.toISOString(),
        reason,
      },
      notes: doc.notes ?? null,
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
    };

    return {
      document: updatedDocDto,
    };
  }
}

export const adminPartnerService = new AdminPartnerService();
