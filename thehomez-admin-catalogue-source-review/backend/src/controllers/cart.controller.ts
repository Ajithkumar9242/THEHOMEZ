import type { Request, Response, NextFunction } from 'express';
import {
  CART_ERROR_CODES,
  CART_SESSION_TOKEN_HEADER,
  UserType,
  guestCartTokenHeaderSchema,
  type IAcknowledgeCartPricesRequestDto,
  type IAddCartItemRequestDto,
  type IApiResponse,
  type ICartSummaryDto,
  type ICartValidationResultDto,
  type IUpdateCartItemQuantityRequestDto,
  type IUpdateCartLocationRequestDto,
  type IValidateCartRequestDto,
} from '@thehomez/shared-types';
import {
  CartError,
  type CartOwnerIdentity,
  type CartService,
  cartService,
} from '../services/cart/index.js';
import { hashToken } from '../services/token/token.service.js';

export class CartController {
  constructor(private readonly service: CartService = cartService) {
    this.getCart = this.getCart.bind(this);
    this.addItem = this.addItem.bind(this);
    this.updateItemQuantity = this.updateItemQuantity.bind(this);
    this.removeItem = this.removeItem.bind(this);
    this.updateLocation = this.updateLocation.bind(this);
    this.clearCart = this.clearCart.bind(this);
    this.validateCart = this.validateCart.bind(this);
    this.acknowledgePrices = this.acknowledgePrices.bind(this);
  }

  private resolveCartOwner(req: Request): CartOwnerIdentity {
    if (req.user) {
      const userId = req.customerFilter?.userId;
      if (!userId || req.user.userType !== UserType.CUSTOMER) {
        throw new CartError(
          'Access denied: customer identity is required for this operation',
          CART_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED,
          403,
        );
      }
      return {
        ownerType: 'USER',
        userId,
      };
    }

    const rawHeader = req.headers[CART_SESSION_TOKEN_HEADER.toLowerCase()];
    if (rawHeader === undefined || rawHeader === null || rawHeader === '') {
      throw new CartError(
        `${CART_SESSION_TOKEN_HEADER} header is required for unauthenticated cart access`,
        CART_ERROR_CODES.CART_TOKEN_REQUIRED,
        400,
      );
    }

    if (Array.isArray(rawHeader)) {
      throw new CartError(
        `${CART_SESSION_TOKEN_HEADER} must be a single valid UUID v4 token`,
        CART_ERROR_CODES.INVALID_CART_TOKEN,
        400,
      );
    }

    const parsed = guestCartTokenHeaderSchema.safeParse(rawHeader);
    if (!parsed.success) {
      throw new CartError(
        `${CART_SESSION_TOKEN_HEADER} must be a valid UUID v4`,
        CART_ERROR_CODES.INVALID_CART_TOKEN,
        400,
      );
    }

    return {
      ownerType: 'GUEST',
      sessionTokenHash: hashToken(parsed.data),
    };
  }

  private forwardError(req: Request, next: NextFunction, err: unknown): void {
    if (err instanceof CartError) {
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
      'Customer cart operation failed due to an unexpected error',
    );

    next(new CartError('Unable to process cart request at this time', 'INTERNAL_SERVER_ERROR', 500));
  }

  /**
   * GET /api/v1/cart
   */
  public async getCart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const owner = this.resolveCartOwner(req);
      const summary = await this.service.getCart(owner);

      const response: IApiResponse<ICartSummaryDto> = {
        success: true,
        data: summary,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * POST /api/v1/cart/items
   */
  public async addItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const owner = this.resolveCartOwner(req);
      const dto = req.body as IAddCartItemRequestDto;
      const summary = await this.service.addItem(owner, dto);

      const response: IApiResponse<ICartSummaryDto> = {
        success: true,
        data: summary,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * PATCH /api/v1/cart/items/:itemId
   */
  public async updateItemQuantity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const owner = this.resolveCartOwner(req);
      const itemId = String(req.params.itemId);
      const dto = req.body as IUpdateCartItemQuantityRequestDto;
      const summary = await this.service.updateItemQuantity(owner, itemId, dto);

      const response: IApiResponse<ICartSummaryDto> = {
        success: true,
        data: summary,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * DELETE /api/v1/cart/items/:itemId
   */
  public async removeItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const owner = this.resolveCartOwner(req);
      const itemId = String(req.params.itemId);
      const expectedVersion =
        typeof req.query.expectedVersion === 'number' ? req.query.expectedVersion : undefined;
      const summary = await this.service.removeItem(owner, itemId, expectedVersion);

      const response: IApiResponse<ICartSummaryDto> = {
        success: true,
        data: summary,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * PATCH /api/v1/cart/location
   */
  public async updateLocation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const owner = this.resolveCartOwner(req);
      const dto = req.body as IUpdateCartLocationRequestDto;
      const summary = await this.service.updateLocation(owner, dto);

      const response: IApiResponse<ICartSummaryDto> = {
        success: true,
        data: summary,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * POST /api/v1/cart/clear
   */
  public async clearCart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const owner = this.resolveCartOwner(req);
      const body = (req.body || {}) as { expectedVersion?: number };
      const summary = await this.service.clearCart(owner, body.expectedVersion);

      const response: IApiResponse<ICartSummaryDto> = {
        success: true,
        data: summary,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * POST /api/v1/cart/validate
   *
   * Read-only operation. Validates the cart against authoritative backend data and
   * returns ICartValidationResultDto. Does not mutate cart state.
   */
  public async validateCart(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const owner = this.resolveCartOwner(req);
      const dto = req.body as IValidateCartRequestDto;
      const result = await this.service.validateCart(owner, dto);

      const response: IApiResponse<ICartValidationResultDto> = {
        success: true,
        data: result,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }

  /**
   * POST /api/v1/cart/acknowledge-prices
   *
   * Mutation: sets acknowledgedUnitPricePaise to current authoritative price for specified items.
   * Returns updated ICartSummaryDto.
   */
  public async acknowledgePrices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const owner = this.resolveCartOwner(req);
      const dto = req.body as IAcknowledgeCartPricesRequestDto;
      const summary = await this.service.acknowledgePrices(owner, dto);

      const response: IApiResponse<ICartSummaryDto> = {
        success: true,
        data: summary,
      };

      res.status(200).json(response);
    } catch (err) {
      this.forwardError(req, next, err);
    }
  }
}

export const cartController = new CartController();
