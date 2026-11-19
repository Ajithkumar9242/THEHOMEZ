import { Types } from 'mongoose';
import type {
  IPartnerAdminSummaryDto,
  IPartnerAdminDetailDto,
  IAdminPartnerListResponseDto,
  IAdminPartnerAuditLogListResponseDto,
  IPartnerAuditLogDto,
  IPartnerServiceAreaDetailDto,
} from '@thehomez/shared-types';
import { PartnerModel, type IPartnerDocument } from '../../models/partner.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../../models/service-area.model.js';
import { UserModel } from '../../models/user.model.js';
import { RefreshTokenModel } from '../../models/refresh-token.model.js';
import { PartnerAuditLogModel } from '../../models/partner-audit-log.model.js';
import { withTransaction } from '../../database/transaction.js';
import { logger } from '../../logger/logger.js';
import { AdminPartnerError } from './admin-partner.errors.js';
import type {
  AdminPartnerQuery,
  UpdatePartnerStatusInput,
  AdminPartnerAuditLogsQuery,
} from '../../routes/admin-partner.schemas.js';

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
}

export const adminPartnerService = new AdminPartnerService();
