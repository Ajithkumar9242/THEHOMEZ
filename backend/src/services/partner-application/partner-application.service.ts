import { Types } from 'mongoose';
import {
  UserType,
  UserStatus,
  type IPartnerApplicationDto,
  type IPartnerApplicationSummaryDto,
  type IPartnerApplicationListResponseDto,
  type IPartnerAdminDetailDto,
  type IPartnerServiceAreaDetailDto,
} from '@thehomez/shared-types';
import {
  PartnerApplicationModel,
  type IPartnerApplicationDocument,
} from '../../models/partner-application.model.js';
import { PartnerModel, type IPartnerDocument } from '../../models/partner.model.js';
import { UserModel } from '../../models/user.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../../models/service-area.model.js';
import { PartnerAuditLogModel } from '../../models/partner-audit-log.model.js';
import { withTransaction } from '../../database/transaction.js';
import { logger } from '../../logger/logger.js';
import { PartnerApplicationError } from './partner-application.errors.js';
import type {
  CreatePartnerApplicationSchemaInput,
  RejectPartnerApplicationSchemaInput,
  WithdrawPartnerApplicationSchemaInput,
  ApprovePartnerApplicationSchemaInput,
  AdminPartnerApplicationQuery,
} from '../../routes/admin-partner-application.schemas.js';

export interface IStaffActorContext {
  id: string;
  email?: string;
  phone?: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

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

export class PartnerApplicationService {
  private parseObjectId(id: string, entityName: string = 'Application'): Types.ObjectId {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new PartnerApplicationError(
        `${entityName} ID must be a valid 24-character hexadecimal ObjectId`,
        'INVALID_ID',
        400,
      );
    }
    return new Types.ObjectId(id);
  }

  public formatApplicationDto(doc: IPartnerApplicationDocument): IPartnerApplicationDto {
    const rawAreas = doc.serviceAreaIds || [];
    const areaIdStrings = rawAreas.map((id) => id.toString());

    const auditHistory = (doc.auditHistory || []).map((entry) => ({
      action: entry.action,
      performedBy: entry.performedBy ? entry.performedBy.toString() : '',
      timestamp: entry.timestamp
        ? new Date(entry.timestamp).toISOString()
        : new Date().toISOString(),
      previousStatus: entry.previousStatus,
      newStatus: entry.newStatus,
      reason: entry.reason,
      refusalReasonCode: entry.refusalReasonCode,
      metadata: entry.metadata
        ? projectSafeMetadata(entry.metadata as Record<string, unknown>)
        : undefined,
    }));

    return {
      id: doc._id.toString(),
      businessName: doc.businessName,
      legalName: doc.legalName ?? null,
      phone: doc.phone,
      email: doc.email ?? null,
      deliveryMode: doc.deliveryMode,
      serviceAreaIds: areaIdStrings,
      metadata: projectSafeMetadata(doc.metadata as Record<string, unknown>),
      initialUser: {
        contactName: doc.initialUser.contactName,
        phone: doc.initialUser.phone,
        email: doc.initialUser.email,
      },
      status: doc.status,
      refusalReasonCode: doc.refusalReasonCode ?? null,
      rejectionReason: doc.rejectionReason ?? null,
      previousApplicationId: doc.previousApplicationId
        ? doc.previousApplicationId.toString()
        : null,
      assignedStaffUserId: doc.assignedStaffUserId ? doc.assignedStaffUserId.toString() : null,
      partnerId: doc.partnerId ? doc.partnerId.toString() : null,
      auditHistory,
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  public formatApplicationSummaryDto(
    doc: IPartnerApplicationDocument,
  ): IPartnerApplicationSummaryDto {
    return {
      id: doc._id.toString(),
      businessName: doc.businessName,
      phone: doc.phone,
      email: doc.email ?? null,
      status: doc.status,
      deliveryMode: doc.deliveryMode,
      serviceAreaCount: Array.isArray(doc.serviceAreaIds) ? doc.serviceAreaIds.length : 0,
      assignedStaffUserId: doc.assignedStaffUserId ? doc.assignedStaffUserId.toString() : null,
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  private async formatPartnerAdminDetail(
    partner: IPartnerDocument,
  ): Promise<IPartnerAdminDetailDto> {
    const serviceAreaIds = Array.isArray(partner.serviceAreaIds) ? partner.serviceAreaIds : [];

    const [serviceAreaDocs, linkedUserCount] = await Promise.all([
      serviceAreaIds.length > 0
        ? ServiceAreaModel.find({ _id: { $in: serviceAreaIds } }).lean<IServiceAreaDocument[]>()
        : Promise.resolve([]),
      UserModel.countDocuments({ partnerId: partner._id }),
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
   * API 1: Create Partner Application (Intake)
   * POST /api/v1/admin/partner-applications
   */
  public async createApplication(
    input: CreatePartnerApplicationSchemaInput,
    staffContext: IStaffActorContext,
  ): Promise<IPartnerApplicationDto> {
    const staffObjectId = this.parseObjectId(staffContext.id, 'Staff User');

    // 1. Reapplication lineage validation
    let previousAppObjectId: Types.ObjectId | undefined;
    if (input.previousApplicationId) {
      previousAppObjectId = this.parseObjectId(input.previousApplicationId, 'Previous Application');
      const previousApp = await PartnerApplicationModel.findById(previousAppObjectId);
      if (!previousApp) {
        throw new PartnerApplicationError(
          'Referenced previous application does not exist',
          'PREVIOUS_APPLICATION_NOT_FOUND',
          404,
        );
      }
      if (previousApp.status !== 'REJECTED') {
        throw new PartnerApplicationError(
          `Reapplication must reference a REJECTED partner application (referenced application has status "${previousApp.status}")`,
          'INVALID_REAPPLICATION_TARGET',
          400,
        );
      }
    }

    // 2. Validate service area IDs format and max count
    const areaObjectIds: Types.ObjectId[] = [];
    if (input.serviceAreaIds && input.serviceAreaIds.length > 0) {
      for (const areaId of input.serviceAreaIds) {
        areaObjectIds.push(this.parseObjectId(areaId, 'Service Area'));
      }
    }

    // 3. Application pre-checks for friendly collision errors
    const partnerPhoneExists = await PartnerModel.exists({ phone: input.phone });
    if (partnerPhoneExists) {
      throw new PartnerApplicationError(
        'A partner organisation with this business phone already exists',
        'PARTNER_PHONE_EXISTS',
        409,
      );
    }

    const partnerUserExists = await UserModel.exists({
      phone: input.initialUser.phone,
      userType: UserType.PARTNER,
    });
    if (partnerUserExists) {
      throw new PartnerApplicationError(
        'A partner operator account with this contact phone already exists',
        'PHONE_ALREADY_REGISTERED',
        409,
      );
    }

    if (input.initialUser.email) {
      const emailExists = await UserModel.exists({
        email: input.initialUser.email.toLowerCase(),
      });
      if (emailExists) {
        throw new PartnerApplicationError(
          'A user account with this email address already exists',
          'EMAIL_ALREADY_REGISTERED',
          409,
        );
      }
    }

    // 4. Create PartnerApplication document with SUBMITTED status and initial audit entry
    const initialAudit = {
      action: 'APPLICATION_SUBMITTED',
      performedBy: staffObjectId,
      timestamp: new Date(),
      newStatus: 'SUBMITTED' as const,
      reason: previousAppObjectId
        ? `Reapplication submitted linking previous application ${previousAppObjectId.toString()}`
        : 'Initial partner application submitted',
      metadata: previousAppObjectId
        ? { previousApplicationId: previousAppObjectId.toString() }
        : {},
    };

    const newApp = new PartnerApplicationModel({
      businessName: input.businessName,
      legalName: input.legalName,
      phone: input.phone,
      email: input.email,
      deliveryMode: input.deliveryMode,
      serviceAreaIds: areaObjectIds,
      metadata: input.metadata || {},
      initialUser: {
        contactName: input.initialUser.contactName,
        phone: input.initialUser.phone,
        email: input.initialUser.email,
      },
      status: 'SUBMITTED',
      previousApplicationId: previousAppObjectId,
      auditHistory: [initialAudit],
    });

    await newApp.save();

    logger.info(
      { applicationId: newApp._id, businessName: newApp.businessName, staffId: staffContext.id },
      'Partner application created successfully',
    );

    return this.formatApplicationDto(newApp);
  }

  /**
   * List Partner Applications with filtering and pagination
   * GET /api/v1/admin/partner-applications
   */
  public async listApplications(
    query: AdminPartnerApplicationQuery,
  ): Promise<IPartnerApplicationListResponseDto> {
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
      filter.$or = [
        { businessName: regex },
        { legalName: regex },
        { phone: regex },
        { email: regex },
        { 'initialUser.contactName': regex },
        { 'initialUser.phone': regex },
      ];
    }

    const skip = (page - 1) * limit;
    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    const sortOptions: Record<string, 1 | -1> = { [sortBy]: sortDirection };

    const [docs, total] = await Promise.all([
      PartnerApplicationModel.find(filter).sort(sortOptions).skip(skip).limit(limit),
      PartnerApplicationModel.countDocuments(filter),
    ]);

    const items = docs.map((doc) => this.formatApplicationSummaryDto(doc));
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
   * Get Application Detail by ID
   * GET /api/v1/admin/partner-applications/:id
   */
  public async getApplicationById(id: string): Promise<IPartnerApplicationDto> {
    const objectId = this.parseObjectId(id);
    const doc = await PartnerApplicationModel.findById(objectId);
    if (!doc) {
      throw new PartnerApplicationError(
        'Partner application not found',
        'APPLICATION_NOT_FOUND',
        404,
      );
    }
    return this.formatApplicationDto(doc);
  }

  /**
   * Move Application to Review (SUBMITTED -> UNDER_REVIEW)
   * POST /api/v1/admin/partner-applications/:id/review
   */
  public async reviewApplication(
    id: string,
    staffContext: IStaffActorContext,
  ): Promise<IPartnerApplicationDto> {
    const objectId = this.parseObjectId(id);
    const staffObjectId = this.parseObjectId(staffContext.id, 'Staff User');

    const app = await PartnerApplicationModel.findById(objectId);
    if (!app) {
      throw new PartnerApplicationError(
        'Partner application not found',
        'APPLICATION_NOT_FOUND',
        404,
      );
    }

    if (app.status === 'UNDER_REVIEW') {
      throw new PartnerApplicationError(
        'Partner application is already under review',
        'INVALID_STATE_TRANSITION',
        400,
      );
    }

    if (app.status !== 'SUBMITTED') {
      throw new PartnerApplicationError(
        `Cannot move partner application with status "${app.status}" into review`,
        'INVALID_STATE_TRANSITION',
        400,
      );
    }

    const updated = await PartnerApplicationModel.findOneAndUpdate(
      { _id: objectId, status: 'SUBMITTED' },
      {
        $set: { status: 'UNDER_REVIEW', assignedStaffUserId: staffObjectId },
        $push: {
          auditHistory: {
            action: 'APPLICATION_UNDER_REVIEW',
            performedBy: staffObjectId,
            timestamp: new Date(),
            previousStatus: 'SUBMITTED',
            newStatus: 'UNDER_REVIEW',
            reason: 'Administrative compliance and document review initiated by staff',
          },
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new PartnerApplicationError(
        'Partner application was concurrently modified by another transaction',
        'CONCURRENT_MODIFICATION',
        409,
      );
    }

    logger.info(
      { applicationId: updated._id, staffId: staffContext.id },
      'Partner application transitioned to UNDER_REVIEW',
    );

    return this.formatApplicationDto(updated);
  }

  /**
   * Reject Partner Application
   * POST /api/v1/admin/partner-applications/:id/reject
   */
  public async rejectApplication(
    id: string,
    input: RejectPartnerApplicationSchemaInput,
    staffContext: IStaffActorContext,
  ): Promise<IPartnerApplicationDto> {
    const objectId = this.parseObjectId(id);
    const staffObjectId = this.parseObjectId(staffContext.id, 'Staff User');

    const app = await PartnerApplicationModel.findById(objectId);
    if (!app) {
      throw new PartnerApplicationError(
        'Partner application not found',
        'APPLICATION_NOT_FOUND',
        404,
      );
    }

    if (app.status === 'REJECTED') {
      throw new PartnerApplicationError(
        'Partner application has already been rejected',
        'INVALID_STATE_TRANSITION',
        400,
      );
    }

    if (app.status === 'APPROVED' || app.status === 'WITHDRAWN') {
      throw new PartnerApplicationError(
        `Cannot reject partner application with status "${app.status}"`,
        'INVALID_STATE_TRANSITION',
        400,
      );
    }

    const updated = await PartnerApplicationModel.findOneAndUpdate(
      { _id: objectId, status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      {
        $set: {
          status: 'REJECTED',
          refusalReasonCode: input.refusalReasonCode,
          rejectionReason: input.reason,
        },
        $push: {
          auditHistory: {
            action: 'APPLICATION_REJECTED',
            performedBy: staffObjectId,
            timestamp: new Date(),
            previousStatus: app.status,
            newStatus: 'REJECTED',
            reason: input.reason,
            refusalReasonCode: input.refusalReasonCode,
          },
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new PartnerApplicationError(
        'Partner application was concurrently modified by another transaction',
        'CONCURRENT_MODIFICATION',
        409,
      );
    }

    logger.info(
      {
        applicationId: updated._id,
        refusalCode: input.refusalReasonCode,
        staffId: staffContext.id,
      },
      'Partner application rejected successfully',
    );

    return this.formatApplicationDto(updated);
  }

  /**
   * Withdraw Partner Application
   * POST /api/v1/admin/partner-applications/:id/withdraw
   */
  public async withdrawApplication(
    id: string,
    input: WithdrawPartnerApplicationSchemaInput,
    staffContext: IStaffActorContext,
  ): Promise<IPartnerApplicationDto> {
    const objectId = this.parseObjectId(id);
    const staffObjectId = this.parseObjectId(staffContext.id, 'Staff User');

    const app = await PartnerApplicationModel.findById(objectId);
    if (!app) {
      throw new PartnerApplicationError(
        'Partner application not found',
        'APPLICATION_NOT_FOUND',
        404,
      );
    }

    if (app.status === 'WITHDRAWN') {
      throw new PartnerApplicationError(
        'Partner application has already been withdrawn',
        'INVALID_STATE_TRANSITION',
        400,
      );
    }

    if (app.status === 'APPROVED' || app.status === 'REJECTED') {
      throw new PartnerApplicationError(
        `Cannot withdraw partner application with status "${app.status}"`,
        'INVALID_STATE_TRANSITION',
        400,
      );
    }

    const updated = await PartnerApplicationModel.findOneAndUpdate(
      { _id: objectId, status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      {
        $set: {
          status: 'WITHDRAWN',
          rejectionReason: input.reason,
        },
        $push: {
          auditHistory: {
            action: 'APPLICATION_WITHDRAWN',
            performedBy: staffObjectId,
            timestamp: new Date(),
            previousStatus: app.status,
            newStatus: 'WITHDRAWN',
            reason: input.reason,
          },
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new PartnerApplicationError(
        'Partner application was concurrently modified by another transaction',
        'CONCURRENT_MODIFICATION',
        409,
      );
    }

    logger.info(
      { applicationId: updated._id, staffId: staffContext.id },
      'Partner application withdrawn successfully',
    );

    return this.formatApplicationDto(updated);
  }

  /**
   * API 4: Transactional Application Approval Gate
   * POST /api/v1/admin/partner-applications/:id/approve
   *
   * The exclusive operational creation gate for PartnerModel and primary UserModel.
   * Executes atomically inside MongoDB withTransaction:
   * 1. Re-validates application state (SUBMITTED or UNDER_REVIEW).
   * 2. Asserts mandatory 3-point administrative attestations.
   * 3. Sorts assigned service areas ascending and acquires Level 1 guards ($inc: guardVersion).
   * 4. Pre-checks business phone within transaction.
   * 5. Transitions application status to APPROVED.
   * 6. Creates PartnerModel directly in status: 'ACTIVE' with coverageVersion: 0.
   * 7. Creates primary UserModel with userType: PARTNER and roles: ['PARTNER_OPERATOR'].
   * 8. Appends operational PartnerAuditLogModel record (null -> ACTIVE).
   * 9. Handles duplicate key collisions cleanly with 409 Conflict.
   * 10. Reconciles ambiguous commit results idempotently.
   */
  public async approveApplication(
    id: string,
    input: ApprovePartnerApplicationSchemaInput,
    staffContext: IStaffActorContext,
  ): Promise<{ application: IPartnerApplicationDto; partner: IPartnerAdminDetailDto }> {
    const objectId = this.parseObjectId(id);
    const staffObjectId = this.parseObjectId(staffContext.id, 'Staff User');

    // Pre-flight check outside transaction
    const initialCheck = await PartnerApplicationModel.findById(objectId);
    if (!initialCheck) {
      throw new PartnerApplicationError(
        'Partner application not found',
        'APPLICATION_NOT_FOUND',
        404,
      );
    }

    if (initialCheck.status === 'APPROVED') {
      throw new PartnerApplicationError(
        'Partner application has already been approved',
        'INVALID_STATE_TRANSITION',
        400,
      );
    }

    if (initialCheck.status !== 'SUBMITTED' && initialCheck.status !== 'UNDER_REVIEW') {
      throw new PartnerApplicationError(
        `Cannot approve partner application with status "${initialCheck.status}"`,
        'INVALID_STATE_TRANSITION',
        400,
      );
    }

    // Asserts 3 mandatory attestations
    if (
      !input.checklist.identityVerified ||
      !input.checklist.serviceAreaConfirmed ||
      !input.checklist.complianceConfirmed
    ) {
      throw new PartnerApplicationError(
        'All three administrative verification attestations must be affirmatively confirmed (true)',
        'ATTESTATIONS_INCOMPLETE',
        400,
      );
    }

    let createdPartnerDoc: IPartnerDocument | null = null;
    let finalAppDoc: IPartnerApplicationDocument | null = null;

    try {
      await withTransaction(async (session) => {
        // 1. Load application inside transaction session
        const app = await PartnerApplicationModel.findById(objectId).session(session);
        if (!app) {
          throw new PartnerApplicationError(
            'Partner application not found',
            'APPLICATION_NOT_FOUND',
            404,
          );
        }

        if (app.status === 'APPROVED') {
          throw new PartnerApplicationError(
            'Partner application has already been approved',
            'INVALID_STATE_TRANSITION',
            400,
          );
        }

        if (app.status !== 'SUBMITTED' && app.status !== 'UNDER_REVIEW') {
          throw new PartnerApplicationError(
            `Cannot approve partner application with status "${app.status}"`,
            'INVALID_STATE_TRANSITION',
            400,
          );
        }

        // 2. Validate service area assignment
        if (!app.serviceAreaIds || app.serviceAreaIds.length === 0) {
          throw new PartnerApplicationError(
            'Partner application must have at least one assigned service area for approval',
            'NO_ACTIVE_SERVICE_AREA',
            400,
          );
        }

        // 3. Acquire Level 1 Guard on ServiceAreas in deterministic sorted order
        const sortedAreaIds = [...app.serviceAreaIds].sort((a, b) =>
          a.toString().localeCompare(b.toString()),
        );

        for (const sId of sortedAreaIds) {
          const guardResult = await ServiceAreaModel.updateOne(
            { _id: sId, isActive: true },
            { $inc: { guardVersion: 1 } },
            { session },
          );

          if (guardResult.matchedCount === 0) {
            throw new PartnerApplicationError(
              `Assigned service area "${sId.toString()}" is inactive or does not exist`,
              'NO_ACTIVE_SERVICE_AREA',
              400,
            );
          }
        }

        // 4. Partner organization business phone collision pre-check within session
        const businessPhoneExists = await PartnerModel.exists({ phone: app.phone }).session(
          session,
        );
        if (businessPhoneExists) {
          throw new PartnerApplicationError(
            'A partner organisation with this business phone already exists',
            'PARTNER_PHONE_EXISTS',
            409,
          );
        }

        // 5. Atomic state update on PartnerApplication
        const lockedApp = await PartnerApplicationModel.findOneAndUpdate(
          { _id: app._id, status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] } },
          {
            $set: { status: 'APPROVED' },
            $push: {
              auditHistory: {
                action: 'APPLICATION_APPROVED',
                performedBy: staffObjectId,
                timestamp: new Date(),
                previousStatus: app.status,
                newStatus: 'APPROVED',
                reason: input.reason,
                metadata: { checklist: input.checklist },
              },
            },
          },
          { session, new: true },
        );

        if (!lockedApp) {
          const recheckStatus = await PartnerApplicationModel.findById(app._id).session(session);
          if (recheckStatus?.status === 'APPROVED') {
            throw new PartnerApplicationError(
              'Partner application has already been approved',
              'INVALID_STATE_TRANSITION',
              400,
            );
          }
          throw new PartnerApplicationError(
            'Partner application was concurrently modified by another transaction',
            'CONCURRENT_MODIFICATION',
            409,
          );
        }

        // 6. Create operational PartnerModel directly in status: 'ACTIVE'
        const createdPartners = await PartnerModel.create(
          [
            {
              businessName: app.businessName,
              legalName: app.legalName,
              phone: app.phone,
              email: app.email,
              deliveryMode: app.deliveryMode,
              serviceAreaIds: app.serviceAreaIds,
              status: 'ACTIVE',
              coverageVersion: 0,
              metadata: {
                ...(app.metadata as Record<string, unknown>),
                applicationId: app._id,
              },
            },
          ],
          { session },
        );

        const partner = createdPartners[0];
        if (!partner) {
          throw new PartnerApplicationError(
            'Failed to create operational partner record',
            'TRANSACTION_ABORTED',
            500,
          );
        }

        // 7. Store created Partner ID on the application document
        lockedApp.partnerId = partner._id;
        await PartnerApplicationModel.updateOne(
          { _id: lockedApp._id },
          { $set: { partnerId: partner._id } },
          { session },
        );

        // 8. Create primary partner UserModel
        try {
          await UserModel.create(
            [
              {
                phone: app.initialUser.phone,
                email: app.initialUser.email || undefined,
                userType: UserType.PARTNER,
                status: UserStatus.ACTIVE,
                roles: ['PARTNER_OPERATOR'],
                partnerId: partner._id,
                metadata: {
                  contactName: app.initialUser.contactName,
                  applicationId: app._id,
                },
              },
            ],
            { session },
          );
        } catch (userErr: unknown) {
          const mongoErr = userErr as {
            code?: number;
            message?: string;
            keyPattern?: Record<string, unknown>;
          };
          if (mongoErr?.code === 11000) {
            const keyPattern = mongoErr.keyPattern;
            const msg = mongoErr.message || '';
            if (keyPattern?.phone || msg.includes('phone')) {
              throw new PartnerApplicationError(
                'A partner operator account with this contact phone already exists',
                'PHONE_ALREADY_REGISTERED',
                409,
              );
            }
            if (keyPattern?.email || msg.includes('email')) {
              throw new PartnerApplicationError(
                'A user account with this email address already exists',
                'EMAIL_ALREADY_REGISTERED',
                409,
              );
            }
          }
          throw userErr;
        }

        // 9. Append initial immutable operational PartnerAuditLogModel record
        await PartnerAuditLogModel.create(
          [
            {
              partnerId: partner._id,
              staffUserId: staffObjectId,
              action: 'PARTNER_STATUS_CHANGED',
              previousState: { status: null },
              newState: { status: 'ACTIVE' },
              reason: `Application approved and operational partner created: ${input.reason}`,
              metadata: {
                staffEmail: staffContext.email,
                staffPhone: staffContext.phone,
                ipAddress: staffContext.ipAddress,
                userAgent: staffContext.userAgent,
                correlationId: staffContext.correlationId,
              },
            },
          ],
          { session },
        );

        createdPartnerDoc = partner;
        finalAppDoc = lockedApp;
      });
    } catch (txErr: unknown) {
      if (txErr instanceof PartnerApplicationError) {
        throw txErr;
      }

      // Reconcile ambiguous commit result:
      // If error occurred during commit (e.g. UnknownTransactionCommitResult or network partition), inspect persisted state
      const errWithLabels = txErr as {
        errorLabels?: string[];
        hasErrorLabel?: (label: string) => boolean;
        name?: string;
      };
      const isCommitError =
        Boolean(errWithLabels?.errorLabels?.includes?.('UnknownTransactionCommitResult')) ||
        Boolean(errWithLabels?.hasErrorLabel?.('UnknownTransactionCommitResult')) ||
        errWithLabels?.name === 'MongoNetworkError' ||
        errWithLabels?.name === 'MongoServerSelectionError';

      if (isCommitError) {
        const recheckApp = await PartnerApplicationModel.findById(objectId);
        if (recheckApp && recheckApp.status === 'APPROVED' && recheckApp.partnerId) {
          const recheckPartner = await PartnerModel.findById(recheckApp.partnerId);
          if (recheckPartner && recheckPartner.status === 'ACTIVE') {
            logger.info(
              { applicationId: objectId, partnerId: recheckPartner._id },
              'Ambiguous commit reconciled: application and partner confirmed successfully persisted',
            );
            const partnerDetail = await this.formatPartnerAdminDetail(recheckPartner);
            return {
              application: this.formatApplicationDto(recheckApp),
              partner: partnerDetail,
            };
          }
        }
      }
      throw txErr;
    }

    if (!finalAppDoc || !createdPartnerDoc) {
      throw new PartnerApplicationError(
        'Transaction completed without returning operational entities',
        'TRANSACTION_ABORTED',
        500,
      );
    }

    logger.info(
      {
        applicationId: (finalAppDoc as IPartnerApplicationDocument)._id,
        partnerId: (createdPartnerDoc as IPartnerDocument)._id,
        staffId: staffContext.id,
      },
      'Partner application approved and operational partner activated successfully',
    );

    const partnerDetail = await this.formatPartnerAdminDetail(createdPartnerDoc);
    return {
      application: this.formatApplicationDto(finalAppDoc),
      partner: partnerDetail,
    };
  }
}

export const partnerApplicationService = new PartnerApplicationService();
