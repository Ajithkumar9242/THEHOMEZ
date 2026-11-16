import type { Request, Response, NextFunction } from 'express';
import {
  ADDRESS_ERROR_CODES,
  UserType,
  type IApiResponse,
  type ICreateCustomerAddressDto,
  type ICustomerAddressDto,
  type IDeleteCustomerAddressResponseDto,
  type IUpdateCustomerAddressDto,
} from '@thehomez/shared-types';
import {
  CustomerAddressError,
  type CustomerAddressService,
  customerAddressService,
} from '../services/customer-address/index.js';

export class CustomerAddressController {
  constructor(private readonly service: CustomerAddressService = customerAddressService) {
    this.listAddresses = this.listAddresses.bind(this);
    this.createAddress = this.createAddress.bind(this);
    this.getAddressById = this.getAddressById.bind(this);
    this.updateAddress = this.updateAddress.bind(this);
    this.setDefaultAddress = this.setDefaultAddress.bind(this);
    this.deleteAddress = this.deleteAddress.bind(this);
  }

  private getCustomerUserId(req: Request): string {
    const userId = req.customerFilter?.userId;
    if (!userId || req.user?.userType !== UserType.CUSTOMER) {
      throw new CustomerAddressError(
        'Access denied: customer identity is required for this operation',
        ADDRESS_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED,
        403,
      );
    }
    return userId;
  }

  private forwardError(req: Request, next: NextFunction, err: unknown): void {
    if (err instanceof CustomerAddressError) {
      next(err);
      return;
    }

    req.log?.error(
      {
        errName: err instanceof Error ? err.name : 'UnknownError',
        errCode:
          typeof err === 'object' && err !== null && 'code' in err
            ? (err as { code?: unknown }).code
            : undefined,
      },
      'Customer address operation failed due to an unexpected error',
    );

    next(
      new CustomerAddressError(
        'Unable to process address request at this time',
        'INTERNAL_SERVER_ERROR',
        500,
      ),
    );
  }

  /**
   * Customer: List all saved delivery site addresses for the authenticated customer.
   * GET /api/v1/customer/addresses
   */
  public async listAddresses(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getCustomerUserId(req);
      const addresses = await this.service.listAddresses(userId);

      const response: IApiResponse<ICustomerAddressDto[]> = {
        success: true,
        data: addresses,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * Customer: Create a new delivery site address.
   * POST /api/v1/customer/addresses
   */
  public async createAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getCustomerUserId(req);
      const dto = req.body as ICreateCustomerAddressDto;
      const address = await this.service.createAddress(userId, dto);

      const response: IApiResponse<ICustomerAddressDto> = {
        success: true,
        data: address,
      };

      res.status(201).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * Customer: Retrieve a single owned delivery site address by ID.
   * GET /api/v1/customer/addresses/:addressId
   */
  public async getAddressById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getCustomerUserId(req);
      const addressId = String(req.params.addressId);
      const address = await this.service.getAddressById(userId, addressId);

      const response: IApiResponse<ICustomerAddressDto> = {
        success: true,
        data: address,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * Customer: Update an existing owned delivery site address.
   * PUT /api/v1/customer/addresses/:addressId
   */
  public async updateAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getCustomerUserId(req);
      const addressId = String(req.params.addressId);
      const dto = req.body as IUpdateCustomerAddressDto;
      const address = await this.service.updateAddress(userId, addressId, dto);

      const response: IApiResponse<ICustomerAddressDto> = {
        success: true,
        data: address,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * Customer: Atomically mark an owned delivery site address as the default address.
   * PATCH /api/v1/customer/addresses/:addressId/default
   */
  public async setDefaultAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getCustomerUserId(req);
      const addressId = String(req.params.addressId);
      const address = await this.service.setDefaultAddress(userId, addressId);

      const response: IApiResponse<ICustomerAddressDto> = {
        success: true,
        data: address,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * Customer: Delete an owned delivery site address.
   * DELETE /api/v1/customer/addresses/:addressId
   */
  public async deleteAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = this.getCustomerUserId(req);
      const addressId = String(req.params.addressId);
      const result = await this.service.deleteAddress(userId, addressId);

      const response: IApiResponse<IDeleteCustomerAddressResponseDto> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }
}

export const customerAddressController = new CustomerAddressController();
