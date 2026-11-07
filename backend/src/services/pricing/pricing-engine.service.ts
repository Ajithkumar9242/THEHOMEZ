import { Types } from 'mongoose';
import {
  type IPricingCalculationRequestDto,
  type IPricingCalculationResponseDto,
  type IUserPrincipal,
  type IB2BVolumeTier,
  PINCODE_REGEX,
  PermissionCode,
  UserType,
  UserStatus,
  ExactDecimalQuantity,
  calculateExactSubtotalPaise,
  calculateSavingsPaise,
} from '@thehomez/shared-types';
import { ProductModel } from '../../models/product.model.js';
import { ProductVariantModel } from '../../models/product-variant.model.js';
import { ServiceAreaModel } from '../../models/service-area.model.js';
import { ProductPricingModel } from '../../models/product-pricing.model.js';
import { UserModel, type IUserDocument } from '../../models/user.model.js';
import { RbacService } from '../rbac/rbac.service.js';
import { PricingError } from './pricing-errors.js';

export interface IAuthContextInput {
  principal?: IUserPrincipal | null;
  user?: IUserDocument | null;
  userId?: string | null;
}

export type AuthContext =
  IAuthContextInput | IUserPrincipal | IUserDocument | string | null | undefined;

export class PricingEngineService {
  /**
   * Resolves the customer segment strictly from server-side source of truth.
   * Client-supplied segment claims are never trusted or inspected.
   *
   * An account receives B2B wholesale pricing if and only if:
   * 1. The account exists in MongoDB.
   * 2. The account status is ACTIVE.
   * 3. The account holds the 'B2B_CUSTOMER' role in the database.
   *
   * Otherwise, the customer receives retail B2C rates.
   */
  public async resolveCustomerSegment(authContext: AuthContext): Promise<'B2C' | 'B2B'> {
    if (!authContext) {
      return 'B2C';
    }

    let userId: string | null = null;

    if (typeof authContext === 'string') {
      userId = authContext;
    } else if ('_id' in authContext && authContext._id) {
      userId = authContext._id.toString();
    } else if ('id' in authContext && authContext.id) {
      userId = authContext.id;
    } else if ('userId' in authContext && authContext.userId) {
      userId = authContext.userId;
    } else if ('principal' in authContext && authContext.principal?.id) {
      userId = authContext.principal.id;
    } else if ('user' in authContext && authContext.user?._id) {
      userId = authContext.user._id.toString();
    }

    if (!userId || !Types.ObjectId.isValid(userId)) {
      return 'B2C';
    }

    // Always load fresh UserModel from database to enforce instant revocation (AC-PRICE-31)
    const freshUser = await UserModel.findById(userId);
    if (!freshUser) {
      return 'B2C';
    }

    if (freshUser.status !== UserStatus.ACTIVE) {
      return 'B2C';
    }

    const roles = freshUser.roles || [];
    if (roles.includes('B2B_CUSTOMER')) {
      return 'B2B';
    }

    return 'B2C';
  }

  private readonly rbacService = new RbacService();

  /**
   * Checks if the caller has administrative preview permission (catalog:read).
   * Validates both principal claims and fresh database records for STAFF users.
   * Non-staff identities (CUSTOMER, PARTNER) are strictly disallowed from administrative preview.
   */
  public async isAdministrativePreview(authContext: AuthContext): Promise<boolean> {
    if (!authContext) return false;

    let userId: string | null = null;
    let permissions: string[] | null = null;

    if (typeof authContext === 'string') {
      userId = authContext;
    } else if (typeof authContext === 'object') {
      if ('permissions' in authContext && Array.isArray(authContext.permissions)) {
        permissions = authContext.permissions as string[];
      } else if ('principal' in authContext && Array.isArray(authContext.principal?.permissions)) {
        permissions = authContext.principal.permissions as string[];
      }

      if ('id' in authContext && authContext.id) {
        userId = authContext.id;
      } else if ('_id' in authContext && authContext._id) {
        userId = authContext._id.toString();
      } else if ('userId' in authContext && authContext.userId) {
        userId = authContext.userId;
      } else if ('principal' in authContext && authContext.principal?.id) {
        userId = authContext.principal.id;
      } else if ('user' in authContext && authContext.user?._id) {
        userId = authContext.user._id.toString();
      }
    }

    // If permissions array was provided directly on principal, check CATALOG_READ
    if (permissions) {
      return permissions.includes(PermissionCode.CATALOG_READ);
    }

    // Otherwise, if userId is available, resolve fresh user and verify STAFF userType
    if (userId && Types.ObjectId.isValid(userId)) {
      const user = await UserModel.findById(userId);
      if (!user || user.status !== UserStatus.ACTIVE || user.userType !== UserType.STAFF) {
        return false;
      }
      const userPermissions = await this.rbacService.getEffectivePermissions(user.roles || []);
      return userPermissions.includes(PermissionCode.CATALOG_READ);
    }

    return false;
  }

  /**
   * Resolves delivery PIN code to an active service area via ServiceAreaModel.
   * Throws domain error if PIN is malformed or unserviceable.
   */
  public async resolveServiceArea(
    deliveryPincode?: string | null,
  ): Promise<{ serviceAreaId: Types.ObjectId | null; deliveryPincode: string | null }> {
    if (!deliveryPincode) {
      return { serviceAreaId: null, deliveryPincode: null };
    }

    const trimmedPin = deliveryPincode.trim();
    if (!PINCODE_REGEX.test(trimmedPin)) {
      throw new PricingError(
        'Delivery PIN code must be a 6-digit numeric string',
        'INVALID_DELIVERY_PINCODE',
        400,
      );
    }

    const serviceArea = await ServiceAreaModel.findOne({
      pincodes: trimmedPin,
      isActive: true,
    });

    if (!serviceArea) {
      throw new PricingError(
        `Delivery PIN code '${trimmedPin}' is not covered by any active service area`,
        'PINCODE_NOT_SERVICEABLE',
        400,
      );
    }

    return { serviceAreaId: serviceArea._id, deliveryPincode: trimmedPin };
  }

  /**
   * Authoritative calculation engine for catalogue prices.
   *
   * Evaluates product sellability, trusted delivery PIN serviceability,
   * fresh database customer segment, volume tier selection, BigInt HALF_UP subtotal,
   * and customer savings against MRP.
   */
  public async calculateEffectivePrice(
    request: IPricingCalculationRequestDto,
    authContext?: AuthContext,
  ): Promise<IPricingCalculationResponseDto> {
    // 1. Zero Client Trust: Reject arbitrary client-supplied serviceAreaId
    if (
      'serviceAreaId' in request &&
      (request as Record<string, unknown>).serviceAreaId !== undefined &&
      (request as Record<string, unknown>).serviceAreaId !== null
    ) {
      throw new PricingError(
        'Client-supplied serviceAreaId is strictly forbidden on calculation endpoint',
        'CLIENT_SUPPLIED_SERVICE_AREA_FORBIDDEN',
        400,
      );
    }

    // 2. Resolve delivery PIN serviceability
    const { serviceAreaId, deliveryPincode } = await this.resolveServiceArea(
      request.deliveryPincode,
    );

    // 3. Resolve customer segment from fresh database principal
    const customerSegment = await this.resolveCustomerSegment(authContext);
    const isAdminPreview = await this.isAdministrativePreview(authContext);

    // 4. Validate & Load Target Product Entity
    if (!request.productId || !Types.ObjectId.isValid(request.productId)) {
      throw new PricingError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }

    const product = await ProductModel.findById(request.productId);
    if (!product) {
      throw new PricingError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }

    // Lifecycle check (draft/inactive products concealed unless admin preview)
    if (!isAdminPreview && (product.status !== 'ACTIVE' || !product.publishedAt)) {
      throw new PricingError('Product is not available', 'PRODUCT_NOT_AVAILABLE', 404);
    }

    let targetVariantId: string | null = null;
    let unitCode: string;
    let quantityPrecision: number;
    let minOrderQuantity: string;
    let maxOrderQuantity: string | null;
    let stepIncrement: string;

    if (product.hasVariants) {
      // Multi-variant parent container cannot be priced directly
      if (!request.variantId) {
        throw new PricingError(
          'Parent container product cannot be priced directly without a variantId',
          'PARENT_CONTAINER_CANNOT_HAVE_PRICE',
          400,
        );
      }

      if (!Types.ObjectId.isValid(request.variantId)) {
        throw new PricingError('Product variant not found', 'VARIANT_NOT_FOUND', 404);
      }

      const variant = await ProductVariantModel.findById(request.variantId);
      if (!variant) {
        throw new PricingError('Product variant not found', 'VARIANT_NOT_FOUND', 404);
      }

      if (!variant.productId.equals(product._id)) {
        throw new PricingError(
          'Variant does not belong to the specified product',
          'VARIANT_DOES_NOT_BELONG_TO_PRODUCT',
          400,
        );
      }

      if (!isAdminPreview && (variant.status !== 'ACTIVE' || !variant.publishedAt)) {
        throw new PricingError('Product variant is not available', 'PRODUCT_NOT_AVAILABLE', 404);
      }

      if (
        !variant.unitCode ||
        variant.quantityPrecision === undefined ||
        variant.quantityPrecision === null ||
        !variant.minOrderQuantity ||
        !variant.stepIncrement
      ) {
        throw new PricingError('Variant unit configuration is incomplete', 'VALIDATION_ERROR', 400);
      }

      targetVariantId = variant._id.toString();
      unitCode = variant.unitCode;
      quantityPrecision = variant.quantityPrecision;
      minOrderQuantity = variant.minOrderQuantity;
      maxOrderQuantity = variant.maxOrderQuantity ?? null;
      stepIncrement = variant.stepIncrement;
    } else {
      // Standalone single-SKU product
      if (request.variantId) {
        throw new PricingError(
          'Standalone single product cannot have variant price',
          'SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_PRICE',
          400,
        );
      }

      if (
        !product.unitCode ||
        product.quantityPrecision === undefined ||
        product.quantityPrecision === null ||
        !product.minOrderQuantity ||
        !product.stepIncrement
      ) {
        throw new PricingError('Product unit configuration is incomplete', 'VALIDATION_ERROR', 400);
      }

      targetVariantId = null;
      unitCode = product.unitCode;
      quantityPrecision = product.quantityPrecision;
      minOrderQuantity = product.minOrderQuantity;
      maxOrderQuantity = product.maxOrderQuantity ?? null;
      stepIncrement = product.stepIncrement;
    }

    // 5. Validate Requested Quantity against physical unit rules
    if (typeof request.quantity !== 'string' || request.quantity.trim().length === 0) {
      throw new PricingError('Quantity is required', 'QUANTITY_MALFORMED', 400);
    }

    const validationResult = ExactDecimalQuantity.validate(request.quantity, {
      unitCode,
      quantityPrecision,
      minOrderQuantity,
      maxOrderQuantity,
      stepIncrement,
    });

    if (!validationResult.isValid) {
      throw new PricingError(
        validationResult.message || 'Invalid quantity',
        validationResult.errorCode || 'QUANTITY_MALFORMED',
        400,
      );
    }

    // 6. Resolve Pricing Record (Regional Override takes precedence over Global per Decision #31 & #38)
    let activePricing = null;
    let isServiceAreaOverride = false;

    if (serviceAreaId) {
      const regionalScope = targetVariantId ? 'VARIANT_REGIONAL' : 'STANDALONE_REGIONAL';
      activePricing = await ProductPricingModel.findOne({
        productId: product._id,
        variantId: targetVariantId ? new Types.ObjectId(targetVariantId) : null,
        serviceAreaId,
        pricingScope: regionalScope,
        isActive: true,
      });

      if (activePricing) {
        isServiceAreaOverride = true;
      }
    }

    if (!activePricing) {
      const globalScope = targetVariantId ? 'VARIANT_GLOBAL' : 'STANDALONE_GLOBAL';
      activePricing = await ProductPricingModel.findOne({
        productId: product._id,
        variantId: targetVariantId ? new Types.ObjectId(targetVariantId) : null,
        serviceAreaId: null,
        pricingScope: globalScope,
        isActive: true,
      });

      isServiceAreaOverride = false;
    }

    if (!activePricing) {
      throw new PricingError(
        'Product has no active pricing configuration',
        'PRODUCT_NOT_PRICED',
        404,
      );
    }

    // 7. Resolve Effective Unit Price & Applicable Volume Tier (Decision #30 & #38)
    let unitPricePaise: number;
    let pricingTierApplied: string;
    let tierMinQuantity: string | null = null;

    if (customerSegment === 'B2B' && activePricing.b2bPricePaise !== null) {
      // Verified B2B Wholesale Pricing with Volume Tier Evaluation
      const scaledOrderQty = ExactDecimalQuantity.toScaledBigInt(
        request.quantity,
        quantityPrecision,
      );

      // Sort tiers by minQuantity ascending to establish stable 1-based tier naming
      const sortedTiers = [...(activePricing.b2bTiers || [])]
        .map((t, idx) => ({
          tier: t,
          tierName: `TIER_${idx + 1}`,
          scaledMin: ExactDecimalQuantity.toScaledBigInt(t.minQuantity, quantityPrecision),
        }))
        .sort((a, b) => (a.scaledMin < b.scaledMin ? -1 : a.scaledMin > b.scaledMin ? 1 : 0));

      // Find highest qualifying tier
      let qualifyingTier: { tier: IB2BVolumeTier; tierName: string } | null = null;
      for (let i = sortedTiers.length - 1; i >= 0; i--) {
        const candidate = sortedTiers[i];
        if (candidate && scaledOrderQty >= candidate.scaledMin) {
          qualifyingTier = candidate;
          break;
        }
      }

      if (qualifyingTier) {
        unitPricePaise = qualifyingTier.tier.pricePaise;
        pricingTierApplied = qualifyingTier.tierName;
        tierMinQuantity = qualifyingTier.tier.minQuantity;
      } else {
        unitPricePaise = activePricing.b2bPricePaise;
        pricingTierApplied = 'BASE_B2B';
        tierMinQuantity = null;
      }
    } else {
      // Standard Retail B2C Price (or Verified B2B fallback when no B2B price is configured)
      unitPricePaise = activePricing.b2cPricePaise;
      pricingTierApplied = 'STANDARD_B2C';
      tierMinQuantity = null;
    }

    // 8. Calculate Line Subtotal using BigInt HALF_UP Rounding (Decision #39)
    const subtotalPaise = calculateExactSubtotalPaise(
      unitPricePaise,
      request.quantity,
      quantityPrecision,
      'HALF_UP',
    );

    // 9. Calculate MRP Subtotal & Customer Monetary Savings (Decision #32)
    let mrpSubtotalPaise: number | null = null;
    let savingsPaise: number | null = null;

    if (activePricing.b2cMrpPaise !== null && activePricing.b2cMrpPaise !== undefined) {
      mrpSubtotalPaise = calculateExactSubtotalPaise(
        activePricing.b2cMrpPaise,
        request.quantity,
        quantityPrecision,
        'HALF_UP',
      );
      savingsPaise = calculateSavingsPaise(subtotalPaise, mrpSubtotalPaise);
    }

    // 10. Construct & Return Authoritative Calculation Response
    return {
      productId: product._id.toString(),
      variantId: targetVariantId,
      serviceAreaId: serviceAreaId ? serviceAreaId.toString() : null,
      deliveryPincode: deliveryPincode || null,
      unitCode,
      quantity: request.quantity.trim(),
      customerSegment,
      pricingTierApplied,
      tierMinQuantity,
      unitPricePaise,
      subtotalPaise,
      mrpSubtotalPaise,
      savingsPaise,
      currency: 'INR',
      isServiceAreaOverride,
    };
  }
}

export const pricingEngineService = new PricingEngineService();
