import { Types } from 'mongoose';
import {
  UserType,
  UserStatus,
  type IAdminCustomerListItemDto,
  type IAdminCustomerDetailDto,
  type IAdminCustomerListResponseDto,
  type ICustomerAddressDto,
  type ICommerceServiceAreaSummary,
} from '@thehomez/shared-types';
import { UserModel, type IUserDocument } from '../../models/user.model.js';
import {
  CustomerAddressModel,
  type ICustomerAddressDocument,
} from '../../models/customer-address.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../../models/service-area.model.js';
import { RefreshTokenModel } from '../../models/refresh-token.model.js';
import { CustomerAuditLogModel } from '../../models/customer-audit-log.model.js';
import { withTransaction } from '../../database/transaction.js';
import { logger } from '../../logger/logger.js';
import { AdminCustomerError } from './admin-customer.errors.js';
import type {
  AdminCustomerQuery,
  UpdateCustomerStatusInput,
  UpdateCustomerB2bStatusInput,
} from '../../routes/admin-customer.schemas.js';

type ServiceAreaSummaryProjection = Pick<
  IServiceAreaDocument,
  '_id' | 'code' | 'name' | 'city' | 'state' | 'pincodes'
>;

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

export class AdminCustomerService {
  private parseCustomerObjectId(id: string): Types.ObjectId {
    if (!id || !Types.ObjectId.isValid(id)) {
      throw new AdminCustomerError(
        'Customer ID must be a valid 24-character hexadecimal ObjectId',
        'INVALID_CUSTOMER_ID',
        400,
      );
    }
    return new Types.ObjectId(id);
  }

  private async resolveServiceAreasByPincodes(
    pincodes: string[],
  ): Promise<Map<string, ICommerceServiceAreaSummary>> {
    const uniquePincodes = [...new Set(pincodes)];
    const serviceAreaByPincode = new Map<string, ICommerceServiceAreaSummary>();

    if (uniquePincodes.length === 0) {
      return serviceAreaByPincode;
    }

    const activeAreas = await ServiceAreaModel.find({
      isActive: true,
      pincodes: { $in: uniquePincodes },
    })
      .select('_id code name city state pincodes')
      .lean<ServiceAreaSummaryProjection[]>();

    const targetPins = new Set(uniquePincodes);
    for (const area of activeAreas) {
      const summary: ICommerceServiceAreaSummary = {
        id: area._id.toString(),
        code: area.code,
        name: area.name,
        city: area.city,
        state: area.state,
      };
      for (const pin of area.pincodes) {
        if (targetPins.has(pin)) {
          serviceAreaByPincode.set(pin, summary);
        }
      }
    }

    return serviceAreaByPincode;
  }

  private mapAddressToDto(
    doc: ICustomerAddressDocument,
    serviceArea: ICommerceServiceAreaSummary | null,
  ): ICustomerAddressDto {
    const createdAt =
      doc.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : new Date(doc.createdAt).toISOString();
    const updatedAt =
      doc.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : new Date(doc.updatedAt).toISOString();

    return {
      id: doc._id.toString(),
      label: doc.label,
      recipientName: doc.recipientName,
      phone: doc.phone,
      streetAddress: doc.streetAddress,
      landmark: doc.landmark ?? null,
      city: doc.city,
      state: doc.state,
      pincode: doc.pincode,
      siteContactPerson:
        doc.siteContactPerson && doc.siteContactPerson.name && doc.siteContactPerson.phone
          ? {
              name: doc.siteContactPerson.name,
              phone: doc.siteContactPerson.phone,
            }
          : null,
      heavyVehicleAccessInstructions: doc.heavyVehicleAccessInstructions ?? null,
      isDefault: Boolean(doc.isDefault),
      isServiceable: serviceArea !== null,
      serviceArea,
      createdAt,
      updatedAt,
    };
  }

  /**
   * API 1: Paginated Customer Directory
   * Scoped strictly to UserType.CUSTOMER.
   */
  public async listCustomers(query: AdminCustomerQuery): Promise<IAdminCustomerListResponseDto> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    // 1. Base Filter strictly scoped to CUSTOMER
    const filter: Record<string, unknown> = {
      userType: UserType.CUSTOMER,
    };

    // 2. Status filter
    if (query.status) {
      filter.status = query.status;
    }

    // 3. Commercial Segment filter
    if (query.segment === 'B2B') {
      filter.roles = 'B2B_CUSTOMER';
    } else if (query.segment === 'B2C') {
      filter.roles = { $ne: 'B2B_CUSTOMER' };
    }

    // 4. Safe Search filter (escapes regex characters to prevent ReDoS / injection)
    if (query.search) {
      const trimmed = query.search.trim();
      const escaped = escapeRegex(trimmed);
      const searchConditions: Record<string, unknown>[] = [
        { phone: { $regex: escaped, $options: 'i' } },
        { email: { $regex: escaped, $options: 'i' } },
      ];

      if (Types.ObjectId.isValid(trimmed)) {
        searchConditions.unshift({ _id: new Types.ObjectId(trimmed) });
      }

      filter.$or = searchConditions;
    }

    // 5. Deterministic Sort with secondary tiebreaker
    const sortField = query.sortBy || 'createdAt';
    const sortDirection = query.sortOrder === 'asc' ? 1 : -1;
    const sortMap: Record<string, 1 | -1> = {
      [sortField]: sortDirection,
      _id: -1,
    };

    // 6. Query DB with pagination
    const [total, userDocs] = await Promise.all([
      UserModel.countDocuments(filter),
      UserModel.find(filter)
        .sort(sortMap)
        .skip(skip)
        .limit(limit)
        .select('_id phone email status roles lastLoginAt createdAt updatedAt')
        .lean<IUserDocument[]>(),
    ]);

    // 7. Batch enrichment for delivery site addresses
    const userIds = userDocs.map((u) => u._id);
    const addressDocs =
      userIds.length > 0
        ? await CustomerAddressModel.find({ userId: { $in: userIds } })
            .select('userId city pincode isDefault updatedAt')
            .lean<ICustomerAddressDocument[]>()
        : [];

    const addressesByUser = new Map<
      string,
      { count: number; defaultCity: string | null; defaultPincode: string | null }
    >();

    for (const addr of addressDocs) {
      const uKey = addr.userId.toString();
      const existing = addressesByUser.get(uKey) || {
        count: 0,
        defaultCity: null,
        defaultPincode: null,
      };
      existing.count += 1;
      if (addr.isDefault || existing.defaultCity === null) {
        existing.defaultCity = addr.city;
        existing.defaultPincode = addr.pincode;
      }
      addressesByUser.set(uKey, existing);
    }

    // 8. Transform to Safe DTO
    const items: IAdminCustomerListItemDto[] = userDocs.map((doc) => {
      const uId = doc._id.toString();
      const addrInfo = addressesByUser.get(uId) || {
        count: 0,
        defaultCity: null,
        defaultPincode: null,
      };

      const roles = doc.roles || [];
      const isB2B = roles.includes('B2B_CUSTOMER') && doc.status === UserStatus.ACTIVE;

      return {
        id: uId,
        phone: doc.phone,
        email: doc.email ?? null,
        status: doc.status,
        roles,
        customerSegment: isB2B ? 'B2B' : 'B2C',
        addressCount: addrInfo.count,
        defaultCity: addrInfo.defaultCity,
        defaultPincode: addrInfo.defaultPincode,
        lastLoginAt: doc.lastLoginAt ? new Date(doc.lastLoginAt).toISOString() : null,
        createdAt: new Date(doc.createdAt).toISOString(),
        updatedAt: new Date(doc.updatedAt).toISOString(),
      };
    });

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
   * API 2: Customer Detail Inspection
   */
  public async getCustomerById(customerId: string): Promise<IAdminCustomerDetailDto> {
    const customerObjectId = this.parseCustomerObjectId(customerId);

    const doc = await UserModel.findOne({
      _id: customerObjectId,
      userType: UserType.CUSTOMER,
    }).lean<IUserDocument>();

    if (!doc) {
      throw new AdminCustomerError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
    }

    const addressDocs = await CustomerAddressModel.find({ userId: customerObjectId })
      .sort({ isDefault: -1, updatedAt: -1, _id: -1 })
      .lean<ICustomerAddressDocument[]>();

    const serviceAreaByPincode = await this.resolveServiceAreasByPincodes(
      addressDocs.map((a) => a.pincode),
    );

    const addresses = addressDocs.map((a) =>
      this.mapAddressToDto(a, serviceAreaByPincode.get(a.pincode) ?? null),
    );

    const roles = doc.roles || [];
    const isB2B = roles.includes('B2B_CUSTOMER') && doc.status === UserStatus.ACTIVE;

    return {
      id: doc._id.toString(),
      phone: doc.phone,
      email: doc.email ?? null,
      status: doc.status,
      roles,
      customerSegment: isB2B ? 'B2B' : 'B2C',
      metadata: projectSafeMetadata(doc.metadata as Record<string, unknown>),
      addresses,
      lastLoginAt: doc.lastLoginAt ? new Date(doc.lastLoginAt).toISOString() : null,
      createdAt: new Date(doc.createdAt).toISOString(),
      updatedAt: new Date(doc.updatedAt).toISOString(),
    };
  }

  /**
   * API 3: Customer Address Inspection (Read-Only)
   */
  public async getCustomerAddresses(customerId: string): Promise<ICustomerAddressDto[]> {
    const customerObjectId = this.parseCustomerObjectId(customerId);

    const customer = await UserModel.findOne({
      _id: customerObjectId,
      userType: UserType.CUSTOMER,
    })
      .select('_id')
      .lean();

    if (!customer) {
      throw new AdminCustomerError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
    }

    const addressDocs = await CustomerAddressModel.find({ userId: customerObjectId })
      .sort({ isDefault: -1, updatedAt: -1, _id: -1 })
      .lean<ICustomerAddressDocument[]>();

    const serviceAreaByPincode = await this.resolveServiceAreasByPincodes(
      addressDocs.map((a) => a.pincode),
    );

    return addressDocs.map((a) =>
      this.mapAddressToDto(a, serviceAreaByPincode.get(a.pincode) ?? null),
    );
  }

  /**
   * API 4: Customer Account Status Mutation
   * Supported: ACTIVE -> SUSPENDED, SUSPENDED -> ACTIVE.
   * Atomically revokes refresh tokens on suspension and logs audit trail.
   */
  public async updateCustomerStatus(
    customerId: string,
    input: UpdateCustomerStatusInput,
    staffUser: { id: string; email?: string; phone?: string },
  ): Promise<IAdminCustomerDetailDto> {
    const customerObjectId = this.parseCustomerObjectId(customerId);

    if (customerId === staffUser.id) {
      throw new AdminCustomerError(
        'Staff members cannot suspend their own identity',
        'SELF_SUSPENSION_PROHIBITED',
        400,
      );
    }

    await withTransaction(async (session) => {
      const customer = await UserModel.findOne({
        _id: customerObjectId,
        userType: UserType.CUSTOMER,
      }).session(session);

      if (!customer) {
        throw new AdminCustomerError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
      }

      if (customer.status === input.status) {
        throw new AdminCustomerError(
          `Customer account is already ${input.status.toLowerCase()}`,
          'INVALID_STATE_TRANSITION',
          400,
        );
      }

      if (customer.status !== UserStatus.ACTIVE && customer.status !== UserStatus.SUSPENDED) {
        throw new AdminCustomerError(
          `Cannot transition customer from ${customer.status} to ${input.status}`,
          'INVALID_STATE_TRANSITION',
          400,
        );
      }

      const previousStatus = customer.status;
      customer.status = input.status === 'ACTIVE' ? UserStatus.ACTIVE : UserStatus.SUSPENDED;
      await customer.save({ session });

      // If suspended, revoke all active customer refresh tokens
      if (input.status === 'SUSPENDED') {
        await RefreshTokenModel.updateMany(
          { userId: customerObjectId, userType: UserType.CUSTOMER, isRevoked: false },
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

      // Record immutable audit log
      await CustomerAuditLogModel.create(
        [
          {
            staffUserId: new Types.ObjectId(staffUser.id),
            targetCustomerId: customerObjectId,
            action: 'CUSTOMER_STATUS_CHANGED',
            previousState: { status: previousStatus },
            newState: { status: input.status },
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
        targetCustomerId: customerId,
        newStatus: input.status,
      },
      'Customer account status updated by staff',
    );

    return this.getCustomerById(customerId);
  }

  /**
   * API 5: B2B Wholesale Customer Verification
   * Adds or removes 'B2B_CUSTOMER' role and records verification metadata.
   */
  public async updateB2bStatus(
    customerId: string,
    input: UpdateCustomerB2bStatusInput,
    staffUser: { id: string; email?: string; phone?: string },
  ): Promise<IAdminCustomerDetailDto> {
    const customerObjectId = this.parseCustomerObjectId(customerId);

    await withTransaction(async (session) => {
      const customer = await UserModel.findOne({
        _id: customerObjectId,
        userType: UserType.CUSTOMER,
      }).session(session);

      if (!customer) {
        throw new AdminCustomerError('Customer not found', 'CUSTOMER_NOT_FOUND', 404);
      }

      const currentRoles = customer.roles || [];
      const hasB2BRole = currentRoles.includes('B2B_CUSTOMER');
      const previousState = { isB2B: hasB2BRole, roles: [...currentRoles] };

      let newRoles = [...currentRoles];
      if (input.isB2B) {
        if (!hasB2BRole) {
          newRoles.push('B2B_CUSTOMER');
        }
      } else {
        newRoles = newRoles.filter((r) => r !== 'B2B_CUSTOMER');
      }

      customer.roles = newRoles;

      const currentMetadata = (customer.metadata as Record<string, unknown>) || {};
      const b2bVerification = {
        isB2B: input.isB2B,
        companyName: input.companyName
          ? input.companyName.trim()
          : (currentMetadata.companyName as string) || undefined,
        gstin: input.gstin ? input.gstin.trim() : (currentMetadata.gstin as string) || undefined,
        verifiedByStaffId: staffUser.id,
        verifiedAt: new Date().toISOString(),
        reason: input.reason.trim(),
      };

      customer.metadata = {
        ...currentMetadata,
        b2bVerification,
        ...(input.companyName ? { companyName: input.companyName.trim() } : {}),
        ...(input.gstin ? { gstin: input.gstin.trim() } : {}),
      };

      customer.markModified('roles');
      customer.markModified('metadata');
      await customer.save({ session });

      // Record immutable audit log
      await CustomerAuditLogModel.create(
        [
          {
            staffUserId: new Types.ObjectId(staffUser.id),
            targetCustomerId: customerObjectId,
            action: input.isB2B ? 'CUSTOMER_B2B_VERIFIED' : 'CUSTOMER_B2B_REVOKED',
            previousState,
            newState: { isB2B: input.isB2B, roles: newRoles },
            reason: input.reason.trim(),
            metadata: {
              companyName: input.companyName,
              gstin: input.gstin,
              staffEmail: staffUser.email,
            },
          },
        ],
        { session },
      );
    });

    logger.info(
      {
        staffUserId: staffUser.id,
        targetCustomerId: customerId,
        isB2B: input.isB2B,
      },
      'Customer B2B verification status updated by staff',
    );

    return this.getCustomerById(customerId);
  }
}

export const adminCustomerService = new AdminCustomerService();
