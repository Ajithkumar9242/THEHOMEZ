import mongoose, { Types, type ClientSession } from 'mongoose';
import {
  MAX_ADDRESSES_PER_CUSTOMER,
  ADDRESS_ERROR_CODES,
  UserType,
  UserStatus,
  type ICustomerAddressDto,
  type ICreateCustomerAddressDto,
  type IUpdateCustomerAddressDto,
  type IDeleteCustomerAddressResponseDto,
  type ICommerceServiceAreaSummary,
} from '@thehomez/shared-types';
import {
  CustomerAddressModel,
  type ICustomerAddressDocument,
} from '../../models/customer-address.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../../models/service-area.model.js';
import { UserModel } from '../../models/user.model.js';
import { withTransaction } from '../../database/transaction.js';
import { logger } from '../../logger/logger.js';
import { CustomerAddressError } from './customer-address.errors.js';

type ServiceAreaSummaryProjection = Pick<
  IServiceAreaDocument,
  '_id' | 'code' | 'name' | 'city' | 'state' | 'pincodes'
>;

export class CustomerAddressService {
  /**
   * In-process per-customer async mutex serializing concurrent address mutations
   * for the same customer account while allowing full parallelism across distinct customers.
   * Combined with the MongoDB transaction-level lock on UserModel, this prevents
   * WiredTiger snapshot write-skew on the 20-address cap and single-default invariant.
   */
  private readonly userLocks = new Map<string, Promise<void>>();

  private async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.userLocks.get(userId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(
      () => current,
      () => current,
    );
    this.userLocks.set(userId, chained);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.userLocks.get(userId) === chained) {
        this.userLocks.delete(userId);
      }
    }
  }

  private parseUserObjectId(userId: string): Types.ObjectId {
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new CustomerAddressError(
        'Customer identity is required',
        ADDRESS_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED,
        403,
      );
    }
    return new Types.ObjectId(userId);
  }

  private parseAddressObjectId(addressId: string): Types.ObjectId {
    if (!addressId || !Types.ObjectId.isValid(addressId)) {
      throw new CustomerAddressError('Invalid address ID format', 'INVALID_ADDRESS_ID', 400);
    }
    return new Types.ObjectId(addressId);
  }

  private normalizeOptionalString(value: string | null | undefined): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  /**
   * Acquires a document-level write lock on the owning customer's UserModel record
   * inside the active transaction to serialize concurrent mutations across processes.
   */
  private async lockActiveCustomer(
    userObjectId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const lockedCustomer = await UserModel.findOneAndUpdate(
      {
        _id: userObjectId,
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
      },
      { $set: { updatedAt: new Date() } },
      { session, new: true },
    );

    if (!lockedCustomer) {
      throw new CustomerAddressError(
        'Access denied: active customer identity is required',
        ADDRESS_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED,
        403,
      );
    }
  }

  /**
   * Resolves live active ServiceArea summaries for a batch of PIN codes in a single query.
   * Strips all partner, margin, and internal operational details.
   */
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

  private toDto(
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

  private mapPersistenceError(err: unknown): never {
    if (err instanceof CustomerAddressError) {
      throw err;
    }
    if (err instanceof mongoose.Error.ValidationError) {
      throw new CustomerAddressError('Invalid address data', 'VALIDATION_ERROR', 400);
    }
    if (err instanceof mongoose.Error.CastError) {
      throw new CustomerAddressError('Invalid address identifier', 'INVALID_ADDRESS_ID', 400);
    }
    throw err;
  }

  /**
   * Lists all saved delivery site addresses belonging to the authenticated customer,
   * ordered by default first and then most recently updated, enriched with live serviceability.
   */
  public async listAddresses(userId: string): Promise<ICustomerAddressDto[]> {
    const userObjectId = this.parseUserObjectId(userId);

    const docs = await CustomerAddressModel.find({ userId: userObjectId })
      .sort({ isDefault: -1, updatedAt: -1, _id: -1 })
      .lean<ICustomerAddressDocument[]>();

    const serviceAreaByPincode = await this.resolveServiceAreasByPincodes(
      docs.map((doc) => doc.pincode),
    );

    return docs.map((doc) => this.toDto(doc, serviceAreaByPincode.get(doc.pincode) ?? null));
  }

  /**
   * Retrieves a single delivery site address owned by the authenticated customer.
   * Returns 404 ADDRESS_NOT_FOUND for missing or foreign-owned IDs to prevent IDOR enumeration.
   */
  public async getAddressById(userId: string, addressId: string): Promise<ICustomerAddressDto> {
    const userObjectId = this.parseUserObjectId(userId);
    const addressObjectId = this.parseAddressObjectId(addressId);

    const doc = await CustomerAddressModel.findOne({
      _id: addressObjectId,
      userId: userObjectId,
    }).lean<ICustomerAddressDocument>();

    if (!doc) {
      throw new CustomerAddressError('Address not found', ADDRESS_ERROR_CODES.ADDRESS_NOT_FOUND, 404);
    }

    const serviceAreaByPincode = await this.resolveServiceAreasByPincodes([doc.pincode]);
    return this.toDto(doc, serviceAreaByPincode.get(doc.pincode) ?? null);
  }

  /**
   * Creates a new delivery site address for the authenticated customer,
   * enforcing the 20-address cap and single-default invariant atomically.
   */
  public async createAddress(
    userId: string,
    dto: ICreateCustomerAddressDto,
  ): Promise<ICustomerAddressDto> {
    const userObjectId = this.parseUserObjectId(userId);

    try {
      const created = await this.withUserLock(userId, () =>
        withTransaction(async (session) => {
          await this.lockActiveCustomer(userObjectId, session);

          const existingCount = await CustomerAddressModel.countDocuments({
            userId: userObjectId,
          }).session(session);

          if (existingCount >= MAX_ADDRESSES_PER_CUSTOMER) {
            throw new CustomerAddressError(
              `Cannot save more than ${MAX_ADDRESSES_PER_CUSTOMER} addresses per customer account`,
              ADDRESS_ERROR_CODES.ADDRESS_LIMIT_EXCEEDED,
              400,
            );
          }

          const shouldBeDefault = existingCount === 0 ? true : dto.isDefault === true;

          if (shouldBeDefault && existingCount > 0) {
            await CustomerAddressModel.updateMany(
              { userId: userObjectId, isDefault: true },
              { $set: { isDefault: false } },
              { session },
            );
          }

          const [saved] = await CustomerAddressModel.create(
            [
              {
                userId: userObjectId,
                label: dto.label.trim(),
                recipientName: dto.recipientName.trim(),
                phone: dto.phone.trim(),
                streetAddress: dto.streetAddress.trim(),
                landmark: this.normalizeOptionalString(dto.landmark),
                city: dto.city.trim(),
                state: dto.state.trim(),
                pincode: dto.pincode.trim(),
                siteContactPerson: dto.siteContactPerson
                  ? {
                      name: dto.siteContactPerson.name.trim(),
                      phone: dto.siteContactPerson.phone.trim(),
                    }
                  : null,
                heavyVehicleAccessInstructions: this.normalizeOptionalString(
                  dto.heavyVehicleAccessInstructions,
                ),
                isDefault: shouldBeDefault,
              },
            ],
            { session },
          );

          return saved!;
        }),
      );

      logger.info(
        {
          userId,
          addressId: created._id.toString(),
          isDefault: created.isDefault,
        },
        'Customer delivery address created',
      );

      const serviceAreaByPincode = await this.resolveServiceAreasByPincodes([created.pincode]);
      return this.toDto(created, serviceAreaByPincode.get(created.pincode) ?? null);
    } catch (err: unknown) {
      this.mapPersistenceError(err);
    }
  }

  /**
   * Updates an existing delivery site address owned by the authenticated customer.
   * Atomically updates the default flag when requested.
   */
  public async updateAddress(
    userId: string,
    addressId: string,
    dto: IUpdateCustomerAddressDto,
  ): Promise<ICustomerAddressDto> {
    const userObjectId = this.parseUserObjectId(userId);
    const addressObjectId = this.parseAddressObjectId(addressId);

    try {
      const updated = await this.withUserLock(userId, () =>
        withTransaction(async (session) => {
          await this.lockActiveCustomer(userObjectId, session);

          const address = await CustomerAddressModel.findOne({
            _id: addressObjectId,
            userId: userObjectId,
          }).session(session);

          if (!address) {
            throw new CustomerAddressError(
              'Address not found',
              ADDRESS_ERROR_CODES.ADDRESS_NOT_FOUND,
              404,
            );
          }

          if (dto.label !== undefined) {
            address.label = dto.label.trim();
          }
          if (dto.recipientName !== undefined) {
            address.recipientName = dto.recipientName.trim();
          }
          if (dto.phone !== undefined) {
            address.phone = dto.phone.trim();
          }
          if (dto.streetAddress !== undefined) {
            address.streetAddress = dto.streetAddress.trim();
          }
          if (dto.landmark !== undefined) {
            address.landmark = this.normalizeOptionalString(dto.landmark);
          }
          if (dto.city !== undefined) {
            address.city = dto.city.trim();
          }
          if (dto.state !== undefined) {
            address.state = dto.state.trim();
          }
          if (dto.pincode !== undefined) {
            address.pincode = dto.pincode.trim();
          }
          if (dto.siteContactPerson !== undefined) {
            address.siteContactPerson = dto.siteContactPerson
              ? {
                  name: dto.siteContactPerson.name.trim(),
                  phone: dto.siteContactPerson.phone.trim(),
                }
              : null;
          }
          if (dto.heavyVehicleAccessInstructions !== undefined) {
            address.heavyVehicleAccessInstructions = this.normalizeOptionalString(
              dto.heavyVehicleAccessInstructions,
            );
          }

          if (dto.isDefault === true) {
            await CustomerAddressModel.updateMany(
              { userId: userObjectId, _id: { $ne: address._id }, isDefault: true },
              { $set: { isDefault: false } },
              { session },
            );
            address.isDefault = true;
          } else if (dto.isDefault === false) {
            address.isDefault = false;
          }

          await address.save({ session });
          return address;
        }),
      );

      logger.info(
        {
          userId,
          addressId: updated._id.toString(),
          isDefault: updated.isDefault,
        },
        'Customer delivery address updated',
      );

      const serviceAreaByPincode = await this.resolveServiceAreasByPincodes([updated.pincode]);
      return this.toDto(updated, serviceAreaByPincode.get(updated.pincode) ?? null);
    } catch (err: unknown) {
      this.mapPersistenceError(err);
    }
  }

  /**
   * Atomically sets a specific customer-owned address as the default address,
   * unsetting any prior default in the same transaction.
   */
  public async setDefaultAddress(userId: string, addressId: string): Promise<ICustomerAddressDto> {
    const userObjectId = this.parseUserObjectId(userId);
    const addressObjectId = this.parseAddressObjectId(addressId);

    try {
      const updated = await this.withUserLock(userId, () =>
        withTransaction(async (session) => {
          await this.lockActiveCustomer(userObjectId, session);

          const address = await CustomerAddressModel.findOne({
            _id: addressObjectId,
            userId: userObjectId,
          }).session(session);

          if (!address) {
            throw new CustomerAddressError(
              'Address not found',
              ADDRESS_ERROR_CODES.ADDRESS_NOT_FOUND,
              404,
            );
          }

          await CustomerAddressModel.updateMany(
            { userId: userObjectId, _id: { $ne: address._id }, isDefault: true },
            { $set: { isDefault: false } },
            { session },
          );

          if (!address.isDefault) {
            address.isDefault = true;
            await address.save({ session });
          }

          return address;
        }),
      );

      logger.info(
        {
          userId,
          addressId: updated._id.toString(),
        },
        'Customer default delivery address updated',
      );

      const serviceAreaByPincode = await this.resolveServiceAreasByPincodes([updated.pincode]);
      return this.toDto(updated, serviceAreaByPincode.get(updated.pincode) ?? null);
    } catch (err: unknown) {
      this.mapPersistenceError(err);
    }
  }

  /**
   * Deletes a customer-owned address. If the deleted address was default and other
   * addresses remain, atomically promotes the most recently updated remaining address.
   */
  public async deleteAddress(
    userId: string,
    addressId: string,
  ): Promise<IDeleteCustomerAddressResponseDto> {
    const userObjectId = this.parseUserObjectId(userId);
    const addressObjectId = this.parseAddressObjectId(addressId);

    try {
      const result = await this.withUserLock(userId, () =>
        withTransaction(async (session) => {
          await this.lockActiveCustomer(userObjectId, session);

          const deleted = await CustomerAddressModel.findOneAndDelete(
            { _id: addressObjectId, userId: userObjectId },
            { session },
          );

          if (!deleted) {
            throw new CustomerAddressError(
              'Address not found',
              ADDRESS_ERROR_CODES.ADDRESS_NOT_FOUND,
              404,
            );
          }

          let promotedDefaultAddressId: string | null = null;

          if (deleted.isDefault) {
            const nextDefault = await CustomerAddressModel.findOne({ userId: userObjectId })
              .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
              .session(session);

            if (nextDefault) {
              nextDefault.isDefault = true;
              await nextDefault.save({ session });
              promotedDefaultAddressId = nextDefault._id.toString();
            }
          }

          return {
            deletedAddressId: deleted._id.toString(),
            promotedDefaultAddressId,
          };
        }),
      );

      logger.info(
        {
          userId,
          deletedAddressId: result.deletedAddressId,
          promotedDefaultAddressId: result.promotedDefaultAddressId,
        },
        'Customer delivery address deleted',
      );

      return result;
    } catch (err: unknown) {
      this.mapPersistenceError(err);
    }
  }
}

export const customerAddressService = new CustomerAddressService();
