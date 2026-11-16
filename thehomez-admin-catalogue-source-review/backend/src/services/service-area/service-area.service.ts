import mongoose from 'mongoose';
import {
  PINCODE_REGEX,
  MAX_PINCODES_PER_SERVICE_AREA,
  MAX_SERVICE_AREAS_PER_PARTNER,
  type IServiceArea,
  type IServiceAreaCheckResponse,
  type ICreateServiceAreaDto,
  type IUpdateServiceAreaDto,
  type IServiceAreaPartnerItem,
  type IPartnerServiceAreaItem,
} from '@thehomez/shared-types';
import { ServiceAreaModel, type IServiceAreaDocument } from '../../models/service-area.model.js';
import { PartnerModel, type IPartnerDocument } from '../../models/partner.model.js';
import { logger } from '../../logger/logger.js';

export class ServiceAreaError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'SERVICE_AREA_ERROR',
    public readonly statusCode: number = 400,
    public readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'ServiceAreaError';
  }
}

export interface IServiceAreaListQuery {
  city?: string;
  state?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export interface IPaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class ServiceAreaService {
  /**
   * Normalizes a single Indian 6-digit PIN code.
   * Throws ServiceAreaError if invalid.
   */
  public normalizePincode(pincode: unknown): string {
    if (typeof pincode !== 'string') {
      throw new ServiceAreaError(
        'PIN code must be a 6-digit numeric string',
        'INVALID_PINCODE',
        400,
      );
    }

    const trimmed = pincode.trim();
    if (!PINCODE_REGEX.test(trimmed)) {
      throw new ServiceAreaError(
        `Invalid Indian postal PIN code format: "${pincode}". Must be exactly 6 numeric digits starting with 1-9.`,
        'INVALID_PINCODE',
        400,
      );
    }

    return trimmed;
  }

  /**
   * Validates and normalizes an array of PIN codes.
   * Ensures bounds and rejects duplicates.
   */
  public normalizePincodes(pincodes: unknown[]): string[] {
    if (!Array.isArray(pincodes)) {
      throw new ServiceAreaError('PIN codes must be an array of strings', 'INVALID_PAYLOAD', 400);
    }

    if (pincodes.length > MAX_PINCODES_PER_SERVICE_AREA) {
      throw new ServiceAreaError(
        `PIN codes array exceeds maximum allowed technical limit of ${MAX_PINCODES_PER_SERVICE_AREA}`,
        'PAYLOAD_TOO_LARGE',
        400,
      );
    }

    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const rawPin of pincodes) {
      const pin = this.normalizePincode(rawPin);
      if (seen.has(pin)) {
        throw new ServiceAreaError(
          `Duplicate PIN code "${pin}" provided within service area payload`,
          'DUPLICATE_PINCODE_IN_PAYLOAD',
          400,
        );
      }
      seen.add(pin);
      normalized.push(pin);
    }

    return normalized;
  }

  /**
   * Public Customer Serviceability Check:
   * Resolves whether a PIN code is covered by an active service area.
   * Strips all internal operational metadata and vendor partner identifiers.
   */
  public async checkPincodeServiceability(pincode: string): Promise<IServiceAreaCheckResponse> {
    const normalizedPin = this.normalizePincode(pincode);

    const serviceArea = await ServiceAreaModel.findOne({
      pincodes: normalizedPin,
      isActive: true,
    }).lean<IServiceAreaDocument>();

    if (!serviceArea) {
      return {
        serviceable: false,
        pincode: normalizedPin,
      };
    }

    return {
      serviceable: true,
      pincode: normalizedPin,
      serviceArea: {
        id: serviceArea._id.toString(),
        code: serviceArea.code,
        name: serviceArea.name,
        city: serviceArea.city,
        state: serviceArea.state,
      },
    };
  }

  /**
   * Conflict Detection:
   * Verifies that none of the target PIN codes are already covered by another active service area.
   */
  public async findActivePincodeConflicts(
    pincodes: string[],
    excludeAreaId?: string | mongoose.Types.ObjectId,
  ): Promise<{ conflictingPincodes: string[]; conflictingAreaCode: string } | null> {
    if (pincodes.length === 0) return null;

    const query: Record<string, unknown> = {
      isActive: true,
      pincodes: { $in: pincodes },
    };

    if (excludeAreaId) {
      query._id = { $ne: new mongoose.Types.ObjectId(excludeAreaId.toString()) };
    }

    const conflictingArea = await ServiceAreaModel.findOne(query).lean<IServiceAreaDocument>();
    if (!conflictingArea) return null;

    const conflictingPincodes = pincodes.filter((p) => conflictingArea.pincodes.includes(p));

    return {
      conflictingPincodes,
      conflictingAreaCode: conflictingArea.code,
    };
  }

  /**
   * Converts a database document to public shared entity contract.
   */
  private formatServiceArea(doc: IServiceAreaDocument): IServiceArea {
    return {
      id: doc._id.toString(),
      code: doc.code,
      name: doc.name,
      city: doc.city,
      state: doc.state,
      countryCode: doc.countryCode,
      pincodes: doc.pincodes,
      deliveryRadiusKm: doc.deliveryRadiusKm,
      isActive: doc.isActive,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  /**
   * Administrative: Create a new service area.
   */
  public async createServiceArea(dto: ICreateServiceAreaDto): Promise<IServiceArea> {
    const code = dto.code.trim().toUpperCase();
    const normalizedPins = this.normalizePincodes(dto.pincodes);
    const isActive = dto.isActive !== undefined ? dto.isActive : true;

    // 1. Check code uniqueness with case-insensitive collation
    const existingCode = await ServiceAreaModel.findOne({ code })
      .collation({ locale: 'en', strength: 2 })
      .lean();
    if (existingCode) {
      throw new ServiceAreaError(
        `Service area with code "${code}" already exists`,
        'SERVICE_AREA_CODE_EXISTS',
        409,
      );
    }

    // 2. If creating as active, check for active PIN coverage conflict
    if (isActive) {
      const conflict = await this.findActivePincodeConflicts(normalizedPins);
      if (conflict) {
        throw new ServiceAreaError(
          `PIN code coverage conflict: PIN(s) [${conflict.conflictingPincodes.join(', ')}] are already assigned to active service area "${conflict.conflictingAreaCode}". An active PIN code cannot be ambiguously assigned to multiple active service areas.`,
          'PIN_COVERAGE_CONFLICT',
          409,
        );
      }
    }

    const newArea = new ServiceAreaModel({
      code,
      name: dto.name.trim(),
      city: dto.city.trim(),
      state: dto.state.trim(),
      countryCode: (dto.countryCode || 'IN').trim().toUpperCase(),
      pincodes: normalizedPins,
      deliveryRadiusKm: dto.deliveryRadiusKm,
      isActive,
    });

    try {
      await newArea.save();
    } catch (err: unknown) {
      const mongoErr = err as {
        code?: number;
        message?: string;
        keyPattern?: Record<string, unknown>;
      } | null;
      if (mongoErr?.code === 11000) {
        const errMsg = mongoErr.message ?? '';
        const keyPattern = mongoErr.keyPattern;
        if (
          keyPattern?.pincodes ||
          errMsg.includes('unique_active_pincodes') ||
          errMsg.includes('pincodes')
        ) {
          throw new ServiceAreaError(
            'PIN code coverage conflict: One or more PIN codes are already assigned to an active service area.',
            'PIN_COVERAGE_CONFLICT',
            409,
          );
        }
        if (keyPattern?.code || errMsg.includes('unique_code') || errMsg.includes('code')) {
          throw new ServiceAreaError(
            `Service area with code "${code}" already exists`,
            'SERVICE_AREA_CODE_EXISTS',
            409,
          );
        }
      }
      throw err;
    }

    logger.info(
      { serviceAreaId: newArea._id, code: newArea.code, pincodesCount: normalizedPins.length },
      'Service area created successfully',
    );

    return this.formatServiceArea(newArea);
  }

  /**
   * Administrative: List service areas with pagination and filtering.
   */
  public async getServiceAreas(
    query: IServiceAreaListQuery,
  ): Promise<IPaginatedResult<IServiceArea>> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (query.city) {
      filter.city = new RegExp(`^${query.city.trim()}$`, 'i');
    }
    if (query.state) {
      filter.state = new RegExp(`^${query.state.trim()}$`, 'i');
    }
    if (query.isActive !== undefined) {
      filter.isActive = query.isActive;
    }

    const [items, total] = await Promise.all([
      ServiceAreaModel.find(filter).sort({ code: 1 }).skip(skip).limit(limit),
      ServiceAreaModel.countDocuments(filter),
    ]);

    return {
      items: items.map((doc) => this.formatServiceArea(doc)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Administrative: Get service area details by ID.
   */
  public async getServiceAreaById(id: string): Promise<IServiceArea> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ServiceAreaError('Invalid service area ID format', 'INVALID_ID', 400);
    }

    const area = await ServiceAreaModel.findById(id);
    if (!area) {
      throw new ServiceAreaError('Service area not found', 'SERVICE_AREA_NOT_FOUND', 404);
    }

    return this.formatServiceArea(area);
  }

  /**
   * Administrative: Update an existing service area.
   */
  public async updateServiceArea(id: string, dto: IUpdateServiceAreaDto): Promise<IServiceArea> {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ServiceAreaError('Invalid service area ID format', 'INVALID_ID', 400);
    }

    const area = await ServiceAreaModel.findById(id);
    if (!area) {
      throw new ServiceAreaError('Service area not found', 'SERVICE_AREA_NOT_FOUND', 404);
    }

    // Check code uniqueness if changing code with case-insensitive collation
    if (dto.code) {
      const targetCode = dto.code.trim().toUpperCase();
      if (targetCode !== area.code) {
        const existing = await ServiceAreaModel.findOne({
          code: targetCode,
          _id: { $ne: area._id },
        })
          .collation({ locale: 'en', strength: 2 })
          .lean();
        if (existing) {
          throw new ServiceAreaError(
            `Service area with code "${targetCode}" already exists`,
            'SERVICE_AREA_CODE_EXISTS',
            409,
          );
        }
        area.code = targetCode;
      }
    }

    if (dto.name !== undefined) area.name = dto.name.trim();
    if (dto.city !== undefined) area.city = dto.city.trim();
    if (dto.state !== undefined) area.state = dto.state.trim();
    if (dto.countryCode !== undefined) area.countryCode = dto.countryCode.trim().toUpperCase();
    if (dto.deliveryRadiusKm !== undefined) area.deliveryRadiusKm = dto.deliveryRadiusKm;

    const nextIsActive = dto.isActive !== undefined ? dto.isActive : area.isActive;
    const nextPincodes =
      dto.pincodes !== undefined ? this.normalizePincodes(dto.pincodes) : area.pincodes;

    // If service area is active or being activated, ensure no PIN conflict with other active service areas
    if (nextIsActive) {
      const conflict = await this.findActivePincodeConflicts(nextPincodes, area._id);
      if (conflict) {
        throw new ServiceAreaError(
          `PIN code coverage conflict: PIN(s) [${conflict.conflictingPincodes.join(', ')}] are already assigned to active service area "${conflict.conflictingAreaCode}". An active PIN code cannot be ambiguously assigned to multiple active service areas.`,
          'PIN_COVERAGE_CONFLICT',
          409,
        );
      }
    }

    area.isActive = nextIsActive;
    area.pincodes = nextPincodes;

    try {
      await area.save();
    } catch (err: unknown) {
      const mongoErr = err as {
        code?: number;
        message?: string;
        keyPattern?: Record<string, unknown>;
      } | null;
      if (mongoErr?.code === 11000) {
        const errMsg = mongoErr.message ?? '';
        const keyPattern = mongoErr.keyPattern;
        if (
          keyPattern?.pincodes ||
          errMsg.includes('unique_active_pincodes') ||
          errMsg.includes('pincodes')
        ) {
          throw new ServiceAreaError(
            'PIN code coverage conflict: One or more PIN codes are already assigned to an active service area.',
            'PIN_COVERAGE_CONFLICT',
            409,
          );
        }
        if (keyPattern?.code || errMsg.includes('unique_code') || errMsg.includes('code')) {
          throw new ServiceAreaError(
            `Service area with code "${area.code}" already exists`,
            'SERVICE_AREA_CODE_EXISTS',
            409,
          );
        }
      }
      throw err;
    }

    logger.info(
      { serviceAreaId: area._id, code: area.code, isActive: area.isActive },
      'Service area updated successfully',
    );

    return this.formatServiceArea(area);
  }

  /**
   * Administrative: Inspect active partners servicing this service area.
   * Derives coverage directly from authoritative Partner.serviceAreaIds.
   */
  public async getPartnersForServiceArea(
    serviceAreaId: string,
  ): Promise<IServiceAreaPartnerItem[]> {
    if (!mongoose.Types.ObjectId.isValid(serviceAreaId)) {
      throw new ServiceAreaError('Invalid service area ID format', 'INVALID_ID', 400);
    }

    const area = await ServiceAreaModel.findById(serviceAreaId).lean();
    if (!area) {
      throw new ServiceAreaError('Service area not found', 'SERVICE_AREA_NOT_FOUND', 404);
    }

    const partners = await PartnerModel.find({
      serviceAreaIds: new mongoose.Types.ObjectId(serviceAreaId),
      status: 'ACTIVE',
    })
      .select('_id businessName phone status')
      .lean<IPartnerDocument[]>();

    return partners.map((p) => ({
      partnerId: p._id.toString(),
      businessName: p.businessName,
      phone: p.phone,
      status: p.status,
    }));
  }

  /**
   * Administrative: Assign or update service areas for a partner.
   * Authoritative source: Partner.serviceAreaIds.
   */
  public async assignPartnerServiceAreas(
    partnerId: string,
    serviceAreaIds: string[],
  ): Promise<IPartnerDocument> {
    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      throw new ServiceAreaError('Invalid partner ID format', 'INVALID_ID', 400);
    }

    const partner = await PartnerModel.findById(partnerId);
    if (!partner) {
      throw new ServiceAreaError('Partner not found', 'PARTNER_NOT_FOUND', 404);
    }

    if (!Array.isArray(serviceAreaIds)) {
      throw new ServiceAreaError('serviceAreaIds must be an array of IDs', 'INVALID_PAYLOAD', 400);
    }

    if (serviceAreaIds.length > MAX_SERVICE_AREAS_PER_PARTNER) {
      throw new ServiceAreaError(
        `Exceeded maximum service area assignments per partner (${MAX_SERVICE_AREAS_PER_PARTNER})`,
        'PAYLOAD_TOO_LARGE',
        400,
      );
    }

    // Validate all IDs
    const objectIds: mongoose.Types.ObjectId[] = [];
    const seenIds = new Set<string>();

    for (const rawId of serviceAreaIds) {
      if (!mongoose.Types.ObjectId.isValid(rawId)) {
        throw new ServiceAreaError(
          `Invalid service area ID format: "${rawId}"`,
          'INVALID_SERVICE_AREA_ID',
          400,
        );
      }
      const strId = rawId.toString();
      if (!seenIds.has(strId)) {
        seenIds.add(strId);
        objectIds.push(new mongoose.Types.ObjectId(strId));
      }
    }

    // If assigning non-empty areas, verify they all exist and are active
    if (objectIds.length > 0) {
      const existingAreas = await ServiceAreaModel.find({
        _id: { $in: objectIds },
      }).lean<IServiceAreaDocument[]>();

      if (existingAreas.length !== objectIds.length) {
        const foundIds = new Set(existingAreas.map((a) => a._id.toString()));
        const missingIds = objectIds.map((id) => id.toString()).filter((id) => !foundIds.has(id));
        throw new ServiceAreaError(
          `One or more service areas do not exist: [${missingIds.join(', ')}]`,
          'SERVICE_AREA_NOT_FOUND',
          404,
        );
      }

      // Ensure all assigned service areas are ACTIVE
      const inactiveAreas = existingAreas.filter((a) => !a.isActive);
      if (inactiveAreas.length > 0) {
        const inactiveCodes = inactiveAreas.map((a) => a.code);
        throw new ServiceAreaError(
          `Cannot assign inactive service area(s) [${inactiveCodes.join(', ')}] to a partner. Service areas must be activated first.`,
          'INACTIVE_SERVICE_AREA_ASSIGNMENT',
          400,
        );
      }
    }

    partner.serviceAreaIds = objectIds;
    await partner.save();

    logger.info(
      { partnerId: partner._id, assignedCount: objectIds.length },
      'Partner service areas assigned successfully',
    );

    return partner;
  }

  /**
   * Retrieve service areas assigned to a partner.
   * Protects partner data with query-level tenant isolation.
   */
  public async getPartnerServiceAreas(partnerId: string): Promise<IPartnerServiceAreaItem[]> {
    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      throw new ServiceAreaError('Invalid partner ID format', 'INVALID_ID', 400);
    }

    const partner = await PartnerModel.findById(partnerId).lean<IPartnerDocument>();
    if (!partner) {
      throw new ServiceAreaError('Partner not found', 'PARTNER_NOT_FOUND', 404);
    }

    if (!partner.serviceAreaIds || partner.serviceAreaIds.length === 0) {
      return [];
    }

    const areas = await ServiceAreaModel.find({
      _id: { $in: partner.serviceAreaIds },
    }).lean<IServiceAreaDocument[]>();

    return areas.map((a) => ({
      id: a._id.toString(),
      code: a.code,
      name: a.name,
      city: a.city,
      state: a.state,
      pincodesCount: a.pincodes.length,
      isActive: a.isActive,
    }));
  }

  /**
   * Idempotent Development & Testing Seed:
   * Seeds the 5 confirmed Bengaluru test fixture PIN codes.
   */
  public async seedBengaluruServiceAreas(): Promise<IServiceAreaDocument[]> {
    const seedDefinitions = [
      {
        code: 'BLR-CENTRAL',
        name: 'Bengaluru Central (GPO)',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        pincodes: ['560001'],
        deliveryRadiusKm: 15,
        isActive: true,
      },
      {
        code: 'BLR-EAST',
        name: 'Bengaluru East (Marathahalli)',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        pincodes: ['560037'],
        deliveryRadiusKm: 20,
        isActive: true,
      },
      {
        code: 'BLR-SOUTH',
        name: 'Bengaluru South (Electronic City / Madivala)',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        pincodes: ['560068'],
        deliveryRadiusKm: 25,
        isActive: true,
      },
      {
        code: 'BLR-NORTH',
        name: 'Bengaluru North (Yelahanka)',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        pincodes: ['560064'],
        deliveryRadiusKm: 20,
        isActive: true,
      },
      {
        code: 'BLR-WEST',
        name: 'Bengaluru West (Yeshwanthpur / Mahalakshmi)',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        pincodes: ['560086'],
        deliveryRadiusKm: 18,
        isActive: true,
      },
    ];

    const results: IServiceAreaDocument[] = [];

    for (const def of seedDefinitions) {
      const area = await ServiceAreaModel.findOneAndUpdate(
        { code: def.code },
        { $set: def },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      results.push(area);
    }

    logger.info({ seededCount: results.length }, 'Bengaluru service areas seeded idempotently');
    return results;
  }
}

export const serviceAreaService = new ServiceAreaService();
