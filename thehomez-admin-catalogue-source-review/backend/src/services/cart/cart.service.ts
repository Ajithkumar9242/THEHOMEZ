import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  CART_ERROR_CODES,
  ExactDecimalQuantity,
  GUEST_CART_TTL_DAYS,
  MAX_CART_ITEMS,
  PINCODE_REGEX,
  calculateExactSubtotalPaise,
  calculateSavingsPaise,
  type CartItemStatus,
  type CartLocalizationState,
  type CartOwnerType,
  type CartPriceDriftDirection,
  type IAddCartItemRequestDto,
  type IAcknowledgeCartPricesRequestDto,
  type IB2BVolumeTier,
  type ICartItemDto,
  type ICartItemPriceDriftDto,
  type ICartSummaryDto,
  type ICartValidationIssueDto,
  type ICartValidationResultDto,
  type ICommerceServiceAreaSummary,
  type IUpdateCartItemQuantityRequestDto,
  type IUpdateCartLocationRequestDto,
  type IValidateCartRequestDto,
} from '@thehomez/shared-types';
import { CustomerAddressModel } from '../../models/customer-address.model.js';
import { withTransaction } from '../../database/transaction.js';
import { CartModel, type ICartDocument, type ICartItemSubdocument } from '../../models/cart.model.js';
import { ProductModel, type IProductDocument } from '../../models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../../models/product-variant.model.js';
import {
  ProductPricingModel,
  type IProductPricingDocument,
} from '../../models/product-pricing.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../../models/service-area.model.js';
import { PartnerModel } from '../../models/partner.model.js';
import {
  PartnerProductModel,
  type IPartnerProductDocument,
} from '../../models/partner-product.model.js';
import {
  type PricingEngineService,
  pricingEngineService as defaultPricingEngineService,
} from '../pricing/pricing-engine.service.js';
import { PricingError } from '../pricing/pricing-errors.js';
import { CartError } from './cart.errors.js';
import { CartValidationSnapshotModel } from '../../models/cart-validation-snapshot.model.js';
import { CART_VALIDATION_SNAPSHOT_TTL_MINUTES } from '@thehomez/shared-types';

export type CartOwnerIdentity =
  | { ownerType: 'USER'; userId: string }
  | { ownerType: 'GUEST'; sessionTokenHash: string };

interface IResolvedSellableTarget {
  product: IProductDocument;
  variant: IProductVariantDocument | null;
  targetVariantId: string | null;
  unitCode: string;
  quantityPrecision: number;
  minOrderQuantity: string;
  maxOrderQuantity: string | null;
  stepIncrement: string;
}

interface IPricingResolutionResult {
  unitPricePaise: number;
  lineSubtotalPaise: number;
  mrpSubtotalPaise: number | null;
  savingsPaise: number | null;
  pricingTierApplied: string;
  tierMinQuantity: string | null;
  isServiceAreaOverride: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const GUEST_TTL_MS = GUEST_CART_TTL_DAYS * MS_PER_DAY;
const SAFE_MAX_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function isDuplicateKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === 11000;
}

function normalizeVariantAttributes(raw: unknown): Record<string, string> {
  if (!raw) {
    return {};
  }
  if (raw instanceof Map) {
    return Object.fromEntries(raw.entries()) as Record<string, string>;
  }
  if (typeof raw === 'object') {
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    return Object.fromEntries(entries);
  }
  return {};
}

function toServiceAreaSummary(sa: IServiceAreaDocument): ICommerceServiceAreaSummary {
  return {
    id: sa._id.toString(),
    code: sa.code,
    name: sa.name,
    city: sa.city,
    state: sa.state,
  };
}

function sameVariantRef(
  a: Types.ObjectId | null | undefined,
  b: Types.ObjectId | null | undefined,
): boolean {
  if (!a && !b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.equals(b);
}

export class CartService {
  private readonly ownerLocks = new Map<string, Promise<void>>();

  constructor(
    private readonly pricingEngine: PricingEngineService = defaultPricingEngineService,
  ) {}

  /**
   * Serializes mutating operations per cart owner in this process so concurrent updates
   * compose deterministically alongside MongoDB multi-document transactions.
   */
  private async withOwnerLock<T>(ownerKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.ownerLocks.get(ownerKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(
      () => current,
      () => current,
    );
    this.ownerLocks.set(ownerKey, tail);

    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.ownerLocks.get(ownerKey) === tail) {
        this.ownerLocks.delete(ownerKey);
      }
    }
  }

  private getOwnerLockKey(owner: CartOwnerIdentity): string {
    if (owner.ownerType === 'USER') {
      return `USER:${owner.userId}`;
    }
    return `GUEST:${owner.sessionTokenHash}`;
  }

  private buildOwnerFilter(owner: CartOwnerIdentity): FilterQuery<ICartDocument> {
    if (owner.ownerType === 'USER') {
      if (!Types.ObjectId.isValid(owner.userId)) {
        throw new CartError(
          'Access denied: valid customer identity is required',
          CART_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED,
          403,
        );
      }
      return {
        ownerType: 'USER',
        userId: new Types.ObjectId(owner.userId),
      };
    }

    return {
      ownerType: 'GUEST',
      sessionTokenHash: owner.sessionTokenHash,
    };
  }

  private computeGuestExpiresAt(): Date {
    return new Date(Date.now() + GUEST_TTL_MS);
  }

  /**
   * Executes a cart mutation inside withOwnerLock + withTransaction, retrying once if
   * concurrent first-write creation across processes trips a unique index race.
   */
  private async runTransactionalMutation(
    owner: CartOwnerIdentity,
    mutate: (session: ClientSession) => Promise<ICartDocument | null>,
  ): Promise<ICartSummaryDto> {
    const ownerKey = this.getOwnerLockKey(owner);

    const savedCart = await this.withOwnerLock(ownerKey, async () => {
      let attempt = 0;
      while (true) {
        attempt += 1;
        try {
          return await withTransaction((session) => mutate(session));
        } catch (err) {
          if (isDuplicateKeyError(err) && attempt < 3) {
            continue;
          }
          throw err;
        }
      }
    });

    if (!savedCart) {
      return this.buildEmptyCartSummary(owner, null);
    }

    return this.hydrateCartDocument(savedCart, owner);
  }

  /**
   * Validates that target product (and variant when applicable) is ACTIVE, published,
   * properly matched, and has complete unit ordering configuration.
   */
  private async resolveSellableTarget(
    productId: string,
    variantId: string | null | undefined,
    session?: ClientSession,
  ): Promise<IResolvedSellableTarget> {
    if (!Types.ObjectId.isValid(productId)) {
      throw new CartError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }

    const productQuery = ProductModel.findById(productId);
    if (session) {
      productQuery.session(session);
    }
    const product = await productQuery;

    if (!product) {
      throw new CartError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }

    if (product.status !== 'ACTIVE' || !product.publishedAt) {
      throw new CartError('Product is not available', 'PRODUCT_NOT_AVAILABLE', 404);
    }

    if (product.hasVariants) {
      if (!variantId) {
        throw new CartError(
          'Variant selection is required for multi-variant product',
          'PARENT_CONTAINER_CANNOT_HAVE_PRICE',
          400,
        );
      }

      if (!Types.ObjectId.isValid(variantId)) {
        throw new CartError('Product variant not found', 'VARIANT_NOT_FOUND', 404);
      }

      const variantQuery = ProductVariantModel.findById(variantId);
      if (session) {
        variantQuery.session(session);
      }
      const variant = await variantQuery;

      if (!variant) {
        throw new CartError('Product variant not found', 'VARIANT_NOT_FOUND', 404);
      }

      if (!variant.productId.equals(product._id)) {
        throw new CartError(
          'Variant does not belong to the specified product',
          'VARIANT_DOES_NOT_BELONG_TO_PRODUCT',
          400,
        );
      }

      if (variant.status !== 'ACTIVE' || !variant.publishedAt) {
        throw new CartError('Product variant is not available', 'PRODUCT_NOT_AVAILABLE', 404);
      }

      if (
        !variant.unitCode ||
        variant.quantityPrecision === undefined ||
        variant.quantityPrecision === null ||
        !variant.minOrderQuantity ||
        !variant.stepIncrement
      ) {
        throw new CartError('Variant unit configuration is incomplete', 'VALIDATION_ERROR', 400);
      }

      return {
        product,
        variant,
        targetVariantId: variant._id.toString(),
        unitCode: variant.unitCode,
        quantityPrecision: variant.quantityPrecision,
        minOrderQuantity: variant.minOrderQuantity,
        maxOrderQuantity: variant.maxOrderQuantity ?? null,
        stepIncrement: variant.stepIncrement,
      };
    }

    if (variantId) {
      throw new CartError(
        'Standalone single product does not support variantId',
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
      throw new CartError('Product unit configuration is incomplete', 'VALIDATION_ERROR', 400);
    }

    return {
      product,
      variant: null,
      targetVariantId: null,
      unitCode: product.unitCode,
      quantityPrecision: product.quantityPrecision,
      minOrderQuantity: product.minOrderQuantity,
      maxOrderQuantity: product.maxOrderQuantity ?? null,
      stepIncrement: product.stepIncrement,
    };
  }

  /**
   * Computes final quantity string using exact BigInt arithmetic and validates all unit bounds.
   */
  private computeAndValidateTargetQuantity(params: {
    mode: 'INCREMENT' | 'SET';
    existingQuantity: string | null;
    incomingQuantity: string;
    target: IResolvedSellableTarget;
  }): string {
    const { mode, existingQuantity, incomingQuantity, target } = params;
    const constraints = {
      unitCode: target.unitCode,
      quantityPrecision: target.quantityPrecision,
      minOrderQuantity: target.minOrderQuantity,
      maxOrderQuantity: target.maxOrderQuantity,
      stepIncrement: target.stepIncrement,
    };

    if (mode === 'SET' || existingQuantity === null) {
      const validation = ExactDecimalQuantity.validate(incomingQuantity, constraints);
      if (!validation.isValid) {
        throw new CartError(
          validation.message || 'Invalid quantity',
          validation.errorCode || CART_ERROR_CODES.QUANTITY_MALFORMED,
          400,
        );
      }
      return incomingQuantity.trim();
    }

    // INCREMENT against an existing line item: validate incoming decimal precision/value first,
    // sum via BigInt, and re-validate stepIncrement + maxOrderQuantity on the resulting sum.
    let incomingScaled: bigint;
    try {
      incomingScaled = ExactDecimalQuantity.toScaledBigInt(
        incomingQuantity,
        target.quantityPrecision,
      );
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : CART_ERROR_CODES.QUANTITY_MALFORMED;
      throw new CartError(
        code === 'QUANTITY_MUST_BE_INTEGER'
          ? `Quantity '${incomingQuantity}' must be an integer for discrete unit '${target.unitCode}'`
          : code === 'QUANTITY_PRECISION_EXCEEDED'
            ? `Quantity '${incomingQuantity}' exceeds allowed precision of ${target.quantityPrecision} decimal places`
            : 'Quantity must be a valid positive decimal string',
        code,
        400,
      );
    }

    if (incomingScaled <= 0n) {
      throw new CartError(
        'Increment quantity must be greater than zero',
        CART_ERROR_CODES.QUANTITY_BELOW_MINIMUM,
        400,
      );
    }

    let existingScaled: bigint;
    try {
      existingScaled = ExactDecimalQuantity.toScaledBigInt(
        existingQuantity,
        target.quantityPrecision,
      );
    } catch {
      throw new CartError(
        'Existing cart quantity no longer satisfies current unit precision rules; please set a new quantity',
        'UNIT_CONSTRAINTS_CHANGED',
        400,
      );
    }

    const summedQuantity = ExactDecimalQuantity.fromScaledBigInt(
      existingScaled + incomingScaled,
      target.quantityPrecision,
    );

    const validation = ExactDecimalQuantity.validate(summedQuantity, constraints);
    if (!validation.isValid) {
      throw new CartError(
        validation.message || 'Combined cart quantity exceeds unit constraints',
        validation.errorCode || CART_ERROR_CODES.QUANTITY_MALFORMED,
        400,
      );
    }

    return summedQuantity;
  }

  /**
   * Resolves live effective price for an item during add/update mutations so we verify
   * active pricing exists and capture `acknowledgedUnitPricePaise`.
   *
   * When cart PIN is null or unserviceable, evaluates global pricing (`deliveryPincode: null`)
   * so pricing lookup does not fail on unserviceable areas.
   */
  private async resolveAuthoritativeUnitPricePaise(params: {
    owner: CartOwnerIdentity;
    productId: string;
    variantId: string | null;
    quantity: string;
    effectivePincode: string | null;
    session?: ClientSession;
  }): Promise<number> {
    const { owner, productId, variantId, quantity, effectivePincode, session } = params;

    let serviceablePincode: string | null = null;
    if (effectivePincode) {
      const saQuery = ServiceAreaModel.findOne({
        pincodes: effectivePincode,
        isActive: true,
      }).select({ _id: 1 });
      if (session) {
        saQuery.session(session);
      }
      const sa = await saQuery;
      if (sa) {
        serviceablePincode = effectivePincode;
      }
    }

    try {
      const result = await this.pricingEngine.calculateEffectivePrice(
        {
          productId,
          variantId,
          quantity,
          deliveryPincode: serviceablePincode,
        },
        owner.ownerType === 'USER' ? owner.userId : null,
      );

      if (!Number.isSafeInteger(result.unitPricePaise) || result.unitPricePaise <= 0) {
        throw new CartError(
          'Product does not have a valid positive price',
          'PRODUCT_NOT_PRICED',
          404,
        );
      }

      return result.unitPricePaise;
    } catch (err) {
      if (err instanceof CartError) {
        throw err;
      }
      if (err instanceof PricingError) {
        throw new CartError(err.message, err.code, err.statusCode);
      }
      throw err;
    }
  }

  /**
   * Evaluates price selection and BigInt HALF_UP subtotals from pre-fetched pricing documents.
   */
  private computeHydratedItemPricing(params: {
    productId: Types.ObjectId;
    variantId: Types.ObjectId | null;
    quantity: string;
    quantityPrecision: number;
    customerSegment: 'B2C' | 'B2B';
    serviceAreaId: Types.ObjectId | null;
    pricingDocs: IProductPricingDocument[];
  }): IPricingResolutionResult | null {
    const {
      productId,
      variantId,
      quantity,
      quantityPrecision,
      customerSegment,
      serviceAreaId,
      pricingDocs,
    } = params;

    const matching = pricingDocs.filter(
      (doc) => doc.productId.equals(productId) && sameVariantRef(doc.variantId, variantId),
    );

    if (matching.length === 0) {
      return null;
    }

    let selected: IProductPricingDocument | undefined;
    let isServiceAreaOverride = false;

    if (serviceAreaId) {
      selected = matching.find((p) => p.serviceAreaId && p.serviceAreaId.equals(serviceAreaId));
      if (selected) {
        isServiceAreaOverride = true;
      }
    }

    if (!selected) {
      selected = matching.find((p) => p.serviceAreaId === null);
      isServiceAreaOverride = false;
    }

    if (!selected) {
      return null;
    }

    let unitPricePaise: number;
    let pricingTierApplied: string;
    let tierMinQuantity: string | null = null;

    if (customerSegment === 'B2B' && selected.b2bPricePaise !== null) {
      const scaledOrderQty = ExactDecimalQuantity.toScaledBigInt(quantity, quantityPrecision);

      const sortedTiers = [...(selected.b2bTiers || [])]
        .map((t, idx) => ({
          tier: t,
          tierName: `TIER_${idx + 1}`,
          scaledMin: ExactDecimalQuantity.toScaledBigInt(t.minQuantity, quantityPrecision),
        }))
        .sort((a, b) => (a.scaledMin < b.scaledMin ? -1 : a.scaledMin > b.scaledMin ? 1 : 0));

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
        unitPricePaise = selected.b2bPricePaise;
        pricingTierApplied = 'BASE_B2B';
        tierMinQuantity = null;
      }
    } else {
      unitPricePaise = selected.b2cPricePaise;
      pricingTierApplied = 'STANDARD_B2C';
      tierMinQuantity = null;
    }

    if (!Number.isSafeInteger(unitPricePaise) || unitPricePaise <= 0) {
      return null;
    }

    const lineSubtotalPaise = calculateExactSubtotalPaise(
      unitPricePaise,
      quantity,
      quantityPrecision,
      'HALF_UP',
    );

    let mrpSubtotalPaise: number | null = null;
    let savingsPaise: number | null = null;
    if (selected.b2cMrpPaise !== null && selected.b2cMrpPaise !== undefined) {
      mrpSubtotalPaise = calculateExactSubtotalPaise(
        selected.b2cMrpPaise,
        quantity,
        quantityPrecision,
        'HALF_UP',
      );
      savingsPaise = calculateSavingsPaise(lineSubtotalPaise, mrpSubtotalPaise);
    }

    return {
      unitPricePaise,
      lineSubtotalPaise,
      mrpSubtotalPaise,
      savingsPaise,
      pricingTierApplied,
      tierMinQuantity,
      isServiceAreaOverride,
    };
  }

  private buildPriceDrift(
    acknowledgedUnitPricePaise: number | null,
    currentUnitPricePaise: number,
  ): ICartItemPriceDriftDto {
    if (acknowledgedUnitPricePaise === null) {
      return {
        hasChanged: false,
        acknowledgedUnitPricePaise: null,
        currentUnitPricePaise,
        deltaPaise: 0,
        direction: 'UNCHANGED',
      };
    }

    const deltaPaise = currentUnitPricePaise - acknowledgedUnitPricePaise;
    const direction: CartPriceDriftDirection =
      deltaPaise > 0 ? 'INCREASED' : deltaPaise < 0 ? 'DECREASED' : 'UNCHANGED';

    return {
      hasChanged: deltaPaise !== 0,
      acknowledgedUnitPricePaise,
      currentUnitPricePaise,
      deltaPaise,
      direction,
    };
  }

  private async buildEmptyCartSummary(
    owner: CartOwnerIdentity,
    pincode: string | null,
    cartMeta?: { cartId: string; version: number; updatedAt: Date },
  ): Promise<ICartSummaryDto> {
    const customerSegment = await this.pricingEngine.resolveCustomerSegment(
      owner.ownerType === 'USER' ? owner.userId : null,
    );

    let localizationState: CartLocalizationState = 'UNLOCALIZED';
    let isServiceable: boolean | null = null;
    let serviceArea: ICommerceServiceAreaSummary | null = null;

    if (pincode) {
      const saDoc = await ServiceAreaModel.findOne({ pincodes: pincode, isActive: true });
      if (saDoc) {
        localizationState = 'SERVICEABLE';
        isServiceable = true;
        serviceArea = toServiceAreaSummary(saDoc);
      } else {
        localizationState = 'UNSERVICEABLE';
        isServiceable = false;
        serviceArea = null;
      }
    }

    return {
      cartId: cartMeta?.cartId ?? null,
      ownerType: owner.ownerType as CartOwnerType,
      version: cartMeta?.version ?? 0,
      customerSegment,
      pincode,
      localizationState,
      isServiceable,
      serviceArea,
      items: [],
      totalItemCount: 0,
      validItemCount: 0,
      materialSubtotalPaise: 0,
      currency: 'INR',
      pricingBasis: 'GST_EXCLUSIVE_NET',
      pricingBasisDisclosure: 'GST_EXCLUSIVE_EXCLUDING_DELIVERY',
      hasBlockingIssues: false,
      hasUnacknowledgedPriceChanges: false,
      isValidForCheckout: false,
      updatedAt: cartMeta ? cartMeta.updatedAt.toISOString() : null,
    };
  }

  /**
   * Batch-hydrates a persisted Cart document into `ICartSummaryDto` using O(1) bounded queries,
   * live server pricing, exact BigInt subtotals, and strict supplier anonymity.
   */
  public async hydrateCartDocument(
    cart: ICartDocument,
    owner: CartOwnerIdentity,
    pincodeOverride?: string | null,
  ): Promise<ICartSummaryDto> {
    const effectivePincode = pincodeOverride !== undefined ? pincodeOverride : (cart.pincode ?? null);

    if (cart.items.length === 0) {
      return this.buildEmptyCartSummary(owner, effectivePincode, {
        cartId: cart._id.toString(),
        version: cart.version,
        updatedAt: cart.updatedAt,
      });
    }

    // 1. Resolve fresh customer segment from UserModel + service area from effectivePincode
    const [customerSegment, serviceAreaDoc] = await Promise.all([
      this.pricingEngine.resolveCustomerSegment(owner.ownerType === 'USER' ? owner.userId : null),
      effectivePincode
        ? ServiceAreaModel.findOne({ pincodes: effectivePincode, isActive: true })
        : Promise.resolve(null),
    ]);

    const pincode = effectivePincode;
    const localizationState: CartLocalizationState = !pincode
      ? 'UNLOCALIZED'
      : serviceAreaDoc
        ? 'SERVICEABLE'
        : 'UNSERVICEABLE';
    const isServiceable: boolean | null =
      localizationState === 'UNLOCALIZED' ? null : localizationState === 'SERVICEABLE';
    const serviceAreaSummary = serviceAreaDoc ? toServiceAreaSummary(serviceAreaDoc) : null;

    // 2. Batch-fetch Products, Variants, Pricing, and (if SERVICEABLE) Partner Availability
    const productIds = Array.from(new Set(cart.items.map((item) => item.productId.toString()))).map(
      (id) => new Types.ObjectId(id),
    );
    const variantIds = Array.from(
      new Set(cart.items.map((item) => item.variantId?.toString()).filter(Boolean) as string[]),
    ).map((id) => new Types.ObjectId(id));

    const pricingFilter: FilterQuery<IProductPricingDocument> = {
      productId: { $in: productIds },
      isActive: true,
      ...(serviceAreaDoc
        ? { $or: [{ serviceAreaId: null }, { serviceAreaId: serviceAreaDoc._id }] }
        : { serviceAreaId: null }),
    };

    const [products, variants, pricingDocs, activePartnerIds] = await Promise.all([
      ProductModel.find({ _id: { $in: productIds } }),
      variantIds.length > 0 ? ProductVariantModel.find({ _id: { $in: variantIds } }) : [],
      ProductPricingModel.find(pricingFilter),
      serviceAreaDoc
        ? PartnerModel.find({ status: 'ACTIVE', serviceAreaIds: serviceAreaDoc._id }).distinct(
            '_id',
          )
        : Promise.resolve([] as Types.ObjectId[]),
    ]);

    const availabilityDocs: IPartnerProductDocument[] =
      serviceAreaDoc && activePartnerIds.length > 0
        ? await PartnerProductModel.find({
            partnerId: { $in: activePartnerIds },
            serviceAreaId: serviceAreaDoc._id,
            productId: { $in: productIds },
            isAvailable: true,
          }).select({ productId: 1, variantId: 1, minLeadTimeHours: 1 })
        : [];

    const productMap = new Map<string, IProductDocument>(
      products.map((p) => [p._id.toString(), p]),
    );
    const variantMap = new Map<string, IProductVariantDocument>(
      variants.map((v) => [v._id.toString(), v]),
    );

    const hydratedItems: ICartItemDto[] = [];
    let materialSubtotalBigInt = 0n;

    for (const line of cart.items) {
      const product = productMap.get(line.productId.toString()) ?? null;
      const variant = line.variantId ? (variantMap.get(line.variantId.toString()) ?? null) : null;

      // Base display metadata with safe non-empty fallbacks if entity was hard-deleted
      const title = product?.title || 'Unavailable Product';
      const brand = product?.brand || 'Unknown';
      const slug = product?.slug || 'unavailable-product';
      const sku = product?.hasVariants ? (variant?.sku ?? null) : (product?.sku ?? null);
      const imageUrl = variant?.images?.[0] ?? product?.images?.[0] ?? null;
      const variantTitle = variant ? variant.title : null;
      const variantAttributes = variant ? normalizeVariantAttributes(variant.attributes) : {};

      const unitSource = product?.hasVariants ? variant : product;
      const unitCode = unitSource?.unitCode || 'UNIT';
      const quantityPrecision =
        unitSource?.quantityPrecision !== undefined && unitSource?.quantityPrecision !== null
          ? unitSource.quantityPrecision
          : 0;
      const minOrderQuantity = unitSource?.minOrderQuantity || '1';
      const maxOrderQuantity = unitSource?.maxOrderQuantity ?? null;
      const stepIncrement = unitSource?.stepIncrement || '1';

      const acknowledgedUnitPricePaise = line.acknowledgedUnitPricePaise ?? null;

      // Determine tri-state availability defaults aligned with Decisions #48 & #50
      const availabilityUnknown = localizationState === 'UNLOCALIZED';
      let isAvailable: boolean | null = availabilityUnknown ? null : false;
      let minLeadTimeHours: number | null = null;

      // Evaluate blocking item states cleanly in canonical precedence
      let itemStatus: CartItemStatus | null = null;
      let statusMessage: string | null = null;

      if (
        !product ||
        product.status !== 'ACTIVE' ||
        !product.publishedAt ||
        (product.hasVariants && !line.variantId) ||
        (!product.hasVariants && line.variantId !== null)
      ) {
        itemStatus = 'PRODUCT_UNAVAILABLE';
        statusMessage = 'This product is no longer available';
      } else if (
        product.hasVariants &&
        (!variant ||
          !variant.productId.equals(product._id) ||
          variant.status !== 'ACTIVE' ||
          !variant.publishedAt)
      ) {
        itemStatus = 'VARIANT_UNAVAILABLE';
        statusMessage = 'Selected product variant is no longer available';
      } else if (
        !unitSource?.unitCode ||
        unitSource.quantityPrecision === undefined ||
        unitSource.quantityPrecision === null ||
        !unitSource.minOrderQuantity ||
        !unitSource.stepIncrement
      ) {
        itemStatus = 'UNIT_CONSTRAINTS_CHANGED';
        statusMessage = 'Product unit ordering constraints have changed';
      } else {
        const qtyValidation = ExactDecimalQuantity.validate(line.quantity, {
          unitCode,
          quantityPrecision,
          minOrderQuantity,
          maxOrderQuantity,
          stepIncrement,
        });
        if (!qtyValidation.isValid) {
          itemStatus = 'UNIT_CONSTRAINTS_CHANGED';
          statusMessage =
            qtyValidation.message || 'Quantity no longer meets product ordering constraints';
        }
      }

      let pricingResult: IPricingResolutionResult | null = null;
      if (itemStatus === null) {
        pricingResult = this.computeHydratedItemPricing({
          productId: line.productId,
          variantId: line.variantId ?? null,
          quantity: line.quantity,
          quantityPrecision,
          customerSegment,
          serviceAreaId: serviceAreaDoc ? serviceAreaDoc._id : null,
          pricingDocs,
        });

        if (!pricingResult) {
          itemStatus = 'NOT_PRICED';
          statusMessage = 'Pricing is currently unavailable for this item';
        } else if (localizationState === 'UNLOCALIZED') {
          itemStatus = 'UNLOCALIZED';
          isAvailable = null;
          minLeadTimeHours = null;
          statusMessage = 'Set delivery PIN code to verify local availability';
        } else if (localizationState === 'UNSERVICEABLE') {
          itemStatus = 'UNSERVICEABLE_AREA';
          isAvailable = false;
          minLeadTimeHours = null;
          statusMessage = 'Delivery is not available in this PIN code';
        } else {
          const matchingAvailability = availabilityDocs.filter(
            (doc) =>
              doc.productId.equals(line.productId) &&
              sameVariantRef(doc.variantId, line.variantId ?? null),
          );

          if (matchingAvailability.length === 0) {
            itemStatus = 'OUT_OF_STOCK_IN_AREA';
            isAvailable = false;
            minLeadTimeHours = null;
            statusMessage = 'Currently out of stock in the selected delivery area';
          } else {
            itemStatus = 'VALID';
            isAvailable = true;
            minLeadTimeHours = Math.min(
              ...matchingAvailability.map((doc) => doc.minLeadTimeHours),
            );
            statusMessage = null;
          }
        }
      }

      const isValidForCheckout = itemStatus === 'VALID';

      if (
        pricingResult &&
        (itemStatus === 'VALID' || itemStatus === 'UNLOCALIZED')
      ) {
        materialSubtotalBigInt += BigInt(pricingResult.lineSubtotalPaise);
      }

      if (materialSubtotalBigInt > SAFE_MAX_BIGINT) {
        throw new CartError(
          'Cart subtotal exceeds safe monetary boundary',
          'VALIDATION_ERROR',
          400,
        );
      }

      hydratedItems.push({
        itemId: line._id.toString(),
        productId: line.productId.toString(),
        variantId: line.variantId ? line.variantId.toString() : null,
        sku,
        title,
        brand,
        slug,
        imageUrl,
        variantTitle,
        variantAttributes,
        unitCode,
        quantityPrecision,
        minOrderQuantity,
        maxOrderQuantity,
        stepIncrement,
        quantity: line.quantity,
        pricingTierApplied: pricingResult?.pricingTierApplied ?? null,
        tierMinQuantity: pricingResult?.tierMinQuantity ?? null,
        unitPricePaise: pricingResult?.unitPricePaise ?? null,
        lineSubtotalPaise: pricingResult?.lineSubtotalPaise ?? null,
        mrpSubtotalPaise: pricingResult?.mrpSubtotalPaise ?? null,
        savingsPaise: pricingResult?.savingsPaise ?? null,
        isServiceAreaOverride: pricingResult?.isServiceAreaOverride ?? false,
        acknowledgedUnitPricePaise,
        priceDrift: pricingResult
          ? this.buildPriceDrift(acknowledgedUnitPricePaise, pricingResult.unitPricePaise)
          : null,
        isAvailable,
        availabilityUnknown,
        minLeadTimeHours,
        itemStatus,
        isValidForCheckout,
        statusMessage,
        addedAt: line.addedAt.toISOString(),
      });
    }

    const totalItemCount = hydratedItems.length;
    const validItemCount = hydratedItems.filter((item) => item.isValidForCheckout).length;
    const hasBlockingIssues = hydratedItems.some((item) => !item.isValidForCheckout);
    const hasUnacknowledgedPriceChanges = hydratedItems.some(
      (item) => item.priceDrift?.hasChanged === true,
    );
    const isValidForCheckout =
      totalItemCount > 0 &&
      localizationState === 'SERVICEABLE' &&
      !hasBlockingIssues &&
      !hasUnacknowledgedPriceChanges;

    return {
      cartId: cart._id.toString(),
      ownerType: owner.ownerType as CartOwnerType,
      version: cart.version,
      customerSegment,
      pincode,
      localizationState,
      isServiceable,
      serviceArea: serviceAreaSummary,
      items: hydratedItems,
      totalItemCount,
      validItemCount,
      materialSubtotalPaise: Number(materialSubtotalBigInt),
      currency: 'INR',
      pricingBasis: 'GST_EXCLUSIVE_NET',
      pricingBasisDisclosure: 'GST_EXCLUSIVE_EXCLUDING_DELIVERY',
      hasBlockingIssues,
      hasUnacknowledgedPriceChanges,
      isValidForCheckout,
      updatedAt: cart.updatedAt.toISOString(),
    };
  }

  /**
   * Retrieves the customer's or guest's live-hydrated cart summary.
   */
  public async getCart(owner: CartOwnerIdentity): Promise<ICartSummaryDto> {
    const ownerFilter = this.buildOwnerFilter(owner);
    const cart = await CartModel.findOne(ownerFilter);

    if (!cart) {
      return this.buildEmptyCartSummary(owner, null);
    }

    return this.hydrateCartDocument(cart, owner);
  }

  /**
   * Adds a product/variant line item or increments/sets its quantity cleanly inside a transaction.
   */
  public async addItem(
    owner: CartOwnerIdentity,
    dto: IAddCartItemRequestDto,
  ): Promise<ICartSummaryDto> {
    const ownerFilter = this.buildOwnerFilter(owner);

    return this.runTransactionalMutation(owner, async (session) => {
      const target = await this.resolveSellableTarget(dto.productId, dto.variantId, session);
      const existingCart = await CartModel.findOne(ownerFilter).session(session);

      if (dto.expectedVersion !== undefined) {
        const currentVersion = existingCart ? existingCart.version : 0;
        if (currentVersion !== dto.expectedVersion) {
          throw new CartError(
            'Cart version conflict; please refresh and retry',
            CART_ERROR_CODES.CART_VERSION_CONFLICT,
            409,
          );
        }
      }

      const nextPincode =
        dto.pincode !== undefined ? dto.pincode : (existingCart?.pincode ?? null);

      const targetVariantObjId = target.targetVariantId
        ? new Types.ObjectId(target.targetVariantId)
        : null;

      const existingItem = existingCart?.items.find(
        (item) =>
          item.productId.equals(target.product._id) &&
          sameVariantRef(item.variantId, targetVariantObjId),
      );

      if (!existingItem && (existingCart?.items.length ?? 0) >= MAX_CART_ITEMS) {
        throw new CartError(
          `Cart cannot exceed ${MAX_CART_ITEMS} distinct items`,
          CART_ERROR_CODES.CART_MAX_ITEMS_EXCEEDED,
          400,
        );
      }

      const mode = dto.mode ?? 'INCREMENT';
      const finalQuantity = this.computeAndValidateTargetQuantity({
        mode,
        existingQuantity: existingItem ? existingItem.quantity : null,
        incomingQuantity: dto.quantity,
        target,
      });

      const authoritativeUnitPricePaise = await this.resolveAuthoritativeUnitPricePaise({
        owner,
        productId: target.product._id.toString(),
        variantId: target.targetVariantId,
        quantity: finalQuantity,
        effectivePincode: nextPincode,
        session,
      });

      if (!existingCart) {
        const newItem: ICartItemSubdocument = {
          _id: new Types.ObjectId(),
          productId: target.product._id,
          variantId: targetVariantObjId,
          quantity: finalQuantity,
          acknowledgedUnitPricePaise: authoritativeUnitPricePaise,
          acknowledgedPincode: nextPincode,
          addedAt: new Date(),
        };

        const [created] = await CartModel.create(
          [
            {
              ownerType: owner.ownerType,
              userId: owner.ownerType === 'USER' ? new Types.ObjectId(owner.userId) : null,
              sessionTokenHash: owner.ownerType === 'GUEST' ? owner.sessionTokenHash : null,
              pincode: nextPincode,
              items: [newItem],
              version: 1,
              expiresAt: owner.ownerType === 'GUEST' ? this.computeGuestExpiresAt() : null,
            },
          ],
          { session },
        );

        return created!;
      }

      const versionCondition: FilterQuery<ICartDocument> = {
        _id: existingCart._id,
        version: existingCart.version,
      };

      let updated: ICartDocument | null;

      if (existingItem) {
        updated = await CartModel.findOneAndUpdate(
          {
            ...versionCondition,
            'items._id': existingItem._id,
          },
          {
            $set: {
              'items.$.quantity': finalQuantity,
              'items.$.acknowledgedUnitPricePaise': authoritativeUnitPricePaise,
              'items.$.acknowledgedPincode': nextPincode,
              pincode: nextPincode,
              ...(owner.ownerType === 'GUEST' ? { expiresAt: this.computeGuestExpiresAt() } : {}),
            },
            $inc: { version: 1 },
          },
          { new: true, runValidators: true, session },
        );
      } else {
        const newItem: ICartItemSubdocument = {
          _id: new Types.ObjectId(),
          productId: target.product._id,
          variantId: targetVariantObjId,
          quantity: finalQuantity,
          acknowledgedUnitPricePaise: authoritativeUnitPricePaise,
          acknowledgedPincode: nextPincode,
          addedAt: new Date(),
        };

        updated = await CartModel.findOneAndUpdate(
          versionCondition,
          {
            $push: { items: newItem },
            $set: {
              pincode: nextPincode,
              ...(owner.ownerType === 'GUEST' ? { expiresAt: this.computeGuestExpiresAt() } : {}),
            },
            $inc: { version: 1 },
          },
          { new: true, runValidators: true, session },
        );
      }

      if (!updated) {
        throw new CartError(
          'Cart version conflict; please refresh and retry',
          CART_ERROR_CODES.CART_VERSION_CONFLICT,
          409,
        );
      }

      return updated;
    });
  }

  /**
   * Replaces exact quantity of an owned line item inside a transaction.
   */
  public async updateItemQuantity(
    owner: CartOwnerIdentity,
    itemId: string,
    dto: IUpdateCartItemQuantityRequestDto,
  ): Promise<ICartSummaryDto> {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new CartError('Cart item not found', CART_ERROR_CODES.CART_ITEM_NOT_FOUND, 404);
    }

    const ownerFilter = this.buildOwnerFilter(owner);
    const itemObjectId = new Types.ObjectId(itemId);

    return this.runTransactionalMutation(owner, async (session) => {
      const existingCart = await CartModel.findOne(ownerFilter).session(session);
      if (!existingCart) {
        throw new CartError('Cart item not found', CART_ERROR_CODES.CART_ITEM_NOT_FOUND, 404);
      }

      const existingItem = existingCart.items.find((item) => item._id.equals(itemObjectId));
      if (!existingItem) {
        throw new CartError('Cart item not found', CART_ERROR_CODES.CART_ITEM_NOT_FOUND, 404);
      }

      if (dto.expectedVersion !== undefined && existingCart.version !== dto.expectedVersion) {
        throw new CartError(
          'Cart version conflict; please refresh and retry',
          CART_ERROR_CODES.CART_VERSION_CONFLICT,
          409,
        );
      }

      const target = await this.resolveSellableTarget(
        existingItem.productId.toString(),
        existingItem.variantId ? existingItem.variantId.toString() : null,
        session,
      );

      const finalQuantity = this.computeAndValidateTargetQuantity({
        mode: 'SET',
        existingQuantity: null,
        incomingQuantity: dto.quantity,
        target,
      });

      const authoritativeUnitPricePaise = await this.resolveAuthoritativeUnitPricePaise({
        owner,
        productId: target.product._id.toString(),
        variantId: target.targetVariantId,
        quantity: finalQuantity,
        effectivePincode: existingCart.pincode ?? null,
        session,
      });

      const updated = await CartModel.findOneAndUpdate(
        {
          _id: existingCart._id,
          version: existingCart.version,
          'items._id': itemObjectId,
        },
        {
          $set: {
            'items.$.quantity': finalQuantity,
            'items.$.acknowledgedUnitPricePaise': authoritativeUnitPricePaise,
            'items.$.acknowledgedPincode': existingCart.pincode ?? null,
            ...(owner.ownerType === 'GUEST' ? { expiresAt: this.computeGuestExpiresAt() } : {}),
          },
          $inc: { version: 1 },
        },
        { new: true, runValidators: true, session },
      );

      if (!updated) {
        throw new CartError(
          'Cart version conflict; please refresh and retry',
          CART_ERROR_CODES.CART_VERSION_CONFLICT,
          409,
        );
      }

      return updated;
    });
  }

  /**
   * Removes an owned line item (even if its underlying product was later deactivated/archived).
   */
  public async removeItem(
    owner: CartOwnerIdentity,
    itemId: string,
    expectedVersion?: number,
  ): Promise<ICartSummaryDto> {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new CartError('Cart item not found', CART_ERROR_CODES.CART_ITEM_NOT_FOUND, 404);
    }

    const ownerFilter = this.buildOwnerFilter(owner);
    const itemObjectId = new Types.ObjectId(itemId);

    return this.runTransactionalMutation(owner, async (session) => {
      const existingCart = await CartModel.findOne(ownerFilter).session(session);
      if (!existingCart) {
        throw new CartError('Cart item not found', CART_ERROR_CODES.CART_ITEM_NOT_FOUND, 404);
      }

      const hasItem = existingCart.items.some((item) => item._id.equals(itemObjectId));
      if (!hasItem) {
        throw new CartError('Cart item not found', CART_ERROR_CODES.CART_ITEM_NOT_FOUND, 404);
      }

      if (expectedVersion !== undefined && existingCart.version !== expectedVersion) {
        throw new CartError(
          'Cart version conflict; please refresh and retry',
          CART_ERROR_CODES.CART_VERSION_CONFLICT,
          409,
        );
      }

      const updated = await CartModel.findOneAndUpdate(
        {
          _id: existingCart._id,
          version: existingCart.version,
        },
        {
          $pull: { items: { _id: itemObjectId } },
          ...(owner.ownerType === 'GUEST'
            ? { $set: { expiresAt: this.computeGuestExpiresAt() } }
            : {}),
          $inc: { version: 1 },
        },
        { new: true, runValidators: true, session },
      );

      if (!updated) {
        throw new CartError(
          'Cart version conflict; please refresh and retry',
          CART_ERROR_CODES.CART_VERSION_CONFLICT,
          409,
        );
      }

      return updated;
    });
  }

  /**
   * Updates or clears (`pincode: null`) the persisted delivery PIN and returns re-evaluated cart.
   */
  public async updateLocation(
    owner: CartOwnerIdentity,
    dto: IUpdateCartLocationRequestDto,
  ): Promise<ICartSummaryDto> {
    if (dto.pincode !== null && !PINCODE_REGEX.test(dto.pincode)) {
      throw new CartError(
        'Pincode must be a valid 6-digit Indian postal code',
        'INVALID_DELIVERY_PINCODE',
        400,
      );
    }

    const ownerFilter = this.buildOwnerFilter(owner);

    return this.runTransactionalMutation(owner, async (session) => {
      const existingCart = await CartModel.findOne(ownerFilter).session(session);

      if (dto.expectedVersion !== undefined) {
        const currentVersion = existingCart ? existingCart.version : 0;
        if (currentVersion !== dto.expectedVersion) {
          throw new CartError(
            'Cart version conflict; please refresh and retry',
            CART_ERROR_CODES.CART_VERSION_CONFLICT,
            409,
          );
        }
      }

      if (!existingCart) {
        const [created] = await CartModel.create(
          [
            {
              ownerType: owner.ownerType,
              userId: owner.ownerType === 'USER' ? new Types.ObjectId(owner.userId) : null,
              sessionTokenHash: owner.ownerType === 'GUEST' ? owner.sessionTokenHash : null,
              pincode: dto.pincode,
              items: [],
              version: 1,
              expiresAt: owner.ownerType === 'GUEST' ? this.computeGuestExpiresAt() : null,
            },
          ],
          { session },
        );

        return created!;
      }

      const updated = await CartModel.findOneAndUpdate(
        {
          _id: existingCart._id,
          version: existingCart.version,
        },
        {
          $set: {
            pincode: dto.pincode,
            ...(owner.ownerType === 'GUEST' ? { expiresAt: this.computeGuestExpiresAt() } : {}),
          },
          $inc: { version: 1 },
        },
        { new: true, runValidators: true, session },
      );

      if (!updated) {
        throw new CartError(
          'Cart version conflict; please refresh and retry',
          CART_ERROR_CODES.CART_VERSION_CONFLICT,
          409,
        );
      }

      return updated;
    });
  }

  /**
   * Empties all line items from the cart while preserving cart location PIN and ownership.
   */
  public async clearCart(
    owner: CartOwnerIdentity,
    expectedVersion?: number,
  ): Promise<ICartSummaryDto> {
    const ownerFilter = this.buildOwnerFilter(owner);

    return this.runTransactionalMutation(owner, async (session) => {
      const existingCart = await CartModel.findOne(ownerFilter).session(session);

      if (!existingCart) {
        if (expectedVersion !== undefined && expectedVersion !== 0) {
          throw new CartError(
            'Cart version conflict; please refresh and retry',
            CART_ERROR_CODES.CART_VERSION_CONFLICT,
            409,
          );
        }
        return null;
      }

      if (expectedVersion !== undefined && existingCart.version !== expectedVersion) {
        throw new CartError(
          'Cart version conflict; please refresh and retry',
          CART_ERROR_CODES.CART_VERSION_CONFLICT,
          409,
        );
      }

      const updated = await CartModel.findOneAndUpdate(
        {
          _id: existingCart._id,
          version: existingCart.version,
        },
        {
          $set: {
            items: [],
            ...(owner.ownerType === 'GUEST' ? { expiresAt: this.computeGuestExpiresAt() } : {}),
          },
          $inc: { version: 1 },
        },
        { new: true, runValidators: true, session },
      );

      if (!updated) {
        throw new CartError(
          'Cart version conflict; please refresh and retry',
          CART_ERROR_CODES.CART_VERSION_CONFLICT,
          409,
        );
      }

      return updated;
    });
  }
  /**
   * Validates the current cart against authoritative backend data without mutating cart state.
   *
   * - Resolves the effective pincode from (dto.pincode ?? addressId lookup ?? cart.pincode).
   * - Re-checks product/variant status, pricing, unit constraints, and partner availability.
   * - Returns ICartValidationResultDto with blockingReasons (BLOCKING) and priceChangedItems (WARNING).
   * - If expectedVersion is provided and mismatches, throws 409 CART_VERSION_CONFLICT.
   * - Does not modify CartModel or business entities. Public calls persist an
   *   expiring server-side validation snapshot as an intentional infrastructure write.
   * - Internal callers may disable snapshot persistence while retaining the same
   *   authoritative evaluation logic.
   */
  public async validateCart(
    owner: CartOwnerIdentity,
    dto: IValidateCartRequestDto,
    options: { persistSnapshot?: boolean } = {},
  ): Promise<ICartValidationResultDto> {
    const ownerFilter = this.buildOwnerFilter(owner);
    const cart = await CartModel.findOne(ownerFilter);

    // ---- Version check (optional) ----
    if (dto.expectedVersion !== undefined) {
      const currentVersion = cart ? cart.version : 0;
      if (currentVersion !== dto.expectedVersion) {
        throw new CartError(
          'Cart version conflict; please refresh and retry',
          CART_ERROR_CODES.CART_VERSION_CONFLICT,
          409,
        );
      }
    }

    // ---- Resolve effective pincode ----
    let evaluatedPincode: string | null = null;

    if (dto.pincode !== undefined && dto.pincode !== null) {
      evaluatedPincode = dto.pincode;
    } else if (dto.addressId !== undefined && dto.addressId !== null) {
      if (owner.ownerType !== 'USER') {
        throw new CartError(
          'Customer authentication is required to validate with a saved addressId',
          CART_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED,
          403,
        );
      }

      const addressDoc = await CustomerAddressModel.findOne({
        _id: new Types.ObjectId(dto.addressId),
        userId: new Types.ObjectId(owner.userId),
      }).select({ pincode: 1 });

      if (!addressDoc) {
        throw new CartError('Delivery address not found', 'ADDRESS_NOT_FOUND', 404);
      }

      evaluatedPincode = addressDoc.pincode;
    } else {
      evaluatedPincode = cart?.pincode ?? null;
    }

    // ---- Empty-cart fast path ----
    if (!cart || cart.items.length === 0) {
      const cartSummary = cart
        ? await this.hydrateCartDocument(cart, owner, evaluatedPincode)
        : await this.buildEmptyCartSummary(owner, evaluatedPincode);

      const blockingReasons: ICartValidationIssueDto[] = [
        {
          code: 'CART_EMPTY',
          severity: 'BLOCKING',
          itemId: null,
          message: 'Cart is empty',
        },
      ];

      let localizationState: CartLocalizationState = 'UNLOCALIZED';
      let isServiceable: boolean | null = null;

      if (evaluatedPincode) {
        const sa = await ServiceAreaModel.findOne({ pincodes: evaluatedPincode, isActive: true });
        if (sa) {
          localizationState = 'SERVICEABLE';
          isServiceable = true;
        } else {
          localizationState = 'UNSERVICEABLE';
          isServiceable = false;
          blockingReasons.push({
            code: 'PINCODE_UNSERVICEABLE',
            severity: 'BLOCKING',
            itemId: null,
            message: 'Delivery is not available in the specified PIN code',
          });
        }
      }

      return {
        isValidForCheckout: false,
        evaluatedPincode,
        localizationState,
        isServiceable,
        blockingReasons,
        priceChangedItems: [],
        cart: cartSummary,
      };
    }

    // ---- Localization state for evaluated pincode ----
    const customerSegment = await this.pricingEngine.resolveCustomerSegment(
      owner.ownerType === 'USER' ? owner.userId : null,
    );

    const serviceAreaDoc = evaluatedPincode
      ? await ServiceAreaModel.findOne({ pincodes: evaluatedPincode, isActive: true })
      : null;

    const localizationState: CartLocalizationState = !evaluatedPincode
      ? 'UNLOCALIZED'
      : serviceAreaDoc
        ? 'SERVICEABLE'
        : 'UNSERVICEABLE';

    const isServiceable: boolean | null =
      localizationState === 'UNLOCALIZED' ? null : localizationState === 'SERVICEABLE';

    // ---- Batch-fetch catalog data ----
    const productIds = Array.from(
      new Set(cart.items.map((item) => item.productId.toString())),
    ).map((id) => new Types.ObjectId(id));

    const variantIds = Array.from(
      new Set(cart.items.map((item) => item.variantId?.toString()).filter(Boolean) as string[]),
    ).map((id) => new Types.ObjectId(id));

    const pricingFilter: FilterQuery<IProductPricingDocument> = {
      productId: { $in: productIds },
      isActive: true,
      ...(serviceAreaDoc
        ? { $or: [{ serviceAreaId: null }, { serviceAreaId: serviceAreaDoc._id }] }
        : { serviceAreaId: null }),
    };

    const [products, variants, pricingDocs, activePartnerIds] = await Promise.all([
      ProductModel.find({ _id: { $in: productIds } }),
      variantIds.length > 0 ? ProductVariantModel.find({ _id: { $in: variantIds } }) : [],
      ProductPricingModel.find(pricingFilter),
      serviceAreaDoc
        ? PartnerModel.find({ status: 'ACTIVE', serviceAreaIds: serviceAreaDoc._id }).distinct('_id')
        : Promise.resolve([] as Types.ObjectId[]),
    ]);

    const availabilityDocs: IPartnerProductDocument[] =
      serviceAreaDoc && activePartnerIds.length > 0
        ? await PartnerProductModel.find({
            partnerId: { $in: activePartnerIds },
            serviceAreaId: serviceAreaDoc._id,
            productId: { $in: productIds },
            isAvailable: true,
          }).select({ productId: 1, variantId: 1, minLeadTimeHours: 1 })
        : [];

    const productMap = new Map<string, IProductDocument>(
      products.map((p) => [p._id.toString(), p]),
    );
    const variantMap = new Map<string, IProductVariantDocument>(
      variants.map((v) => [v._id.toString(), v]),
    );

    // ---- Evaluate each item and collect issues ----
    const blockingReasons: ICartValidationIssueDto[] = [];
    const priceChangedItems: ICartValidationIssueDto[] = [];

    for (const line of cart.items) {
      const product = productMap.get(line.productId.toString()) ?? null;
      const variant = line.variantId ? (variantMap.get(line.variantId.toString()) ?? null) : null;
      const itemId = line._id.toString();
      const productId = line.productId.toString();
      const variantId = line.variantId ? line.variantId.toString() : null;

      const unitSource = product?.hasVariants ? variant : product;
      const unitCode = unitSource?.unitCode || 'UNIT';
      const quantityPrecision =
        unitSource?.quantityPrecision !== undefined && unitSource?.quantityPrecision !== null
          ? unitSource.quantityPrecision
          : 0;
      const minOrderQuantity = unitSource?.minOrderQuantity || '1';
      const maxOrderQuantity = unitSource?.maxOrderQuantity ?? null;
      const stepIncrement = unitSource?.stepIncrement || '1';

      // 1. Product/variant existence and status
      if (
        !product ||
        product.status !== 'ACTIVE' ||
        !product.publishedAt ||
        (product.hasVariants && !line.variantId) ||
        (!product.hasVariants && line.variantId !== null)
      ) {
        blockingReasons.push({
          code: 'PRODUCT_UNAVAILABLE',
          severity: 'BLOCKING',
          itemId,
          productId,
          variantId,
          message: 'This product is no longer available',
        });
        continue;
      }

      if (
        product.hasVariants &&
        (!variant ||
          !variant.productId.equals(product._id) ||
          variant.status !== 'ACTIVE' ||
          !variant.publishedAt)
      ) {
        blockingReasons.push({
          code: 'VARIANT_UNAVAILABLE',
          severity: 'BLOCKING',
          itemId,
          productId,
          variantId,
          message: 'Selected product variant is no longer available',
        });
        continue;
      }

      // 2. Unit constraints
      if (
        !unitSource?.unitCode ||
        unitSource.quantityPrecision === undefined ||
        unitSource.quantityPrecision === null ||
        !unitSource.minOrderQuantity ||
        !unitSource.stepIncrement
      ) {
        blockingReasons.push({
          code: 'UNIT_CONSTRAINTS_CHANGED',
          severity: 'BLOCKING',
          itemId,
          productId,
          variantId,
          message: 'Product unit ordering constraints have changed',
        });
        continue;
      }

      const qtyValidation = ExactDecimalQuantity.validate(line.quantity, {
        unitCode,
        quantityPrecision,
        minOrderQuantity,
        maxOrderQuantity,
        stepIncrement,
      });
      if (!qtyValidation.isValid) {
        blockingReasons.push({
          code: 'UNIT_CONSTRAINTS_CHANGED',
          severity: 'BLOCKING',
          itemId,
          productId,
          variantId,
          message: qtyValidation.message || 'Quantity no longer meets product ordering constraints',
        });
        continue;
      }

      // 3. Pricing
      const pricingResult = this.computeHydratedItemPricing({
        productId: line.productId,
        variantId: line.variantId ?? null,
        quantity: line.quantity,
        quantityPrecision,
        customerSegment,
        serviceAreaId: serviceAreaDoc ? serviceAreaDoc._id : null,
        pricingDocs,
      });

      if (!pricingResult) {
        blockingReasons.push({
          code: 'NOT_PRICED',
          severity: 'BLOCKING',
          itemId,
          productId,
          variantId,
          message: 'Pricing is currently unavailable for this item',
        });
        continue;
      }

      // 4. Localization — if unlocalized, items cannot be fully validated but are not blocking
      if (localizationState === 'UNLOCALIZED') {
        continue;
      }

      if (localizationState === 'UNSERVICEABLE') {
        blockingReasons.push({
          code: 'UNSERVICEABLE_AREA',
          severity: 'BLOCKING',
          itemId,
          productId,
          variantId,
          message: 'Delivery is not available in this PIN code',
        });
        continue;
      }

      // 5. Partner availability in service area
      const matchingAvailability = availabilityDocs.filter(
        (doc) =>
          doc.productId.equals(line.productId) &&
          sameVariantRef(doc.variantId, line.variantId ?? null),
      );

      if (matchingAvailability.length === 0) {
        blockingReasons.push({
          code: 'OUT_OF_STOCK_IN_AREA',
          severity: 'BLOCKING',
          itemId,
          productId,
          variantId,
          message: 'Currently out of stock in the selected delivery area',
        });
        continue;
      }

      // 6. Price drift detection (WARNING, not BLOCKING)
      const acknowledgedUnitPricePaise = line.acknowledgedUnitPricePaise ?? null;
      const currentUnitPricePaise = pricingResult.unitPricePaise;

      if (
        acknowledgedUnitPricePaise !== null &&
        acknowledgedUnitPricePaise !== currentUnitPricePaise
      ) {
        priceChangedItems.push({
          code: 'PRICE_CHANGED',
          severity: 'WARNING',
          itemId,
          productId,
          variantId,
          message:
            currentUnitPricePaise > acknowledgedUnitPricePaise
              ? 'Item price has increased since it was added to your cart'
              : 'Item price has decreased since it was added to your cart',
          acknowledgedUnitPricePaise,
          currentUnitPricePaise,
        });
      }
    }

    // ---- Add cart-level localization blocking reason ----
    if (localizationState === 'UNSERVICEABLE') {
      const alreadyHasPincodeIssue = blockingReasons.some((r) => r.code === 'PINCODE_UNSERVICEABLE');
      if (!alreadyHasPincodeIssue) {
        blockingReasons.unshift({
          code: 'PINCODE_UNSERVICEABLE',
          severity: 'BLOCKING',
          itemId: null,
          message: 'Delivery is not available in the specified PIN code',
        });
      }
    } else if (localizationState === 'UNLOCALIZED') {
      blockingReasons.unshift({
        code: 'CART_UNLOCALIZED',
        severity: 'BLOCKING',
        itemId: null,
        message: 'Please set a delivery PIN code to verify availability',
      });
    }

    const cartSummary = await this.hydrateCartDocument(cart, owner, evaluatedPincode);

    const hasUnacknowledgedPriceChanges = priceChangedItems.length > 0;
    const isValidForCheckout =
      cart.items.length > 0 &&
      localizationState === 'SERVICEABLE' &&
      blockingReasons.length === 0 &&
      !hasUnacknowledgedPriceChanges;

    const result: ICartValidationResultDto = {
      isValidForCheckout,
      evaluatedPincode,
      localizationState,
      isServiceable,
      blockingReasons,
      priceChangedItems,
      cart: cartSummary,
    };
    if (options.persistSnapshot !== false && cart && cart.items.length > 0 && evaluatedPincode &&
        localizationState === 'SERVICEABLE' && cartSummary.items.every((item) => Number.isSafeInteger(item.unitPricePaise) && item.unitPricePaise! > 0)) {
      const pricesById = new Map(cartSummary.items.map((item) => [item.itemId, item.unitPricePaise]));
      const snapshot = await CartValidationSnapshotModel.create({
        ownerType: owner.ownerType,
        userId: owner.ownerType === 'USER' ? new Types.ObjectId(owner.userId) : null,
        sessionTokenHash: owner.ownerType === 'GUEST' ? owner.sessionTokenHash : null,
        cartId: cart._id, cartVersion: cart.version,
        addressId: dto.addressId ? new Types.ObjectId(dto.addressId) : null,
        pincode: evaluatedPincode,
        items: cart.items.map((item) => {
          const hydrated = cartSummary.items.find((entry) => entry.itemId === item._id.toString())!;
          return { itemId: item._id, productId: item.productId, variantId: item.variantId ?? null,
            quantity: item.quantity, unitCode: hydrated.unitCode, quantityPrecision: hydrated.quantityPrecision,
            unitPricePaise: pricesById.get(item._id.toString())! };
        }),
        expiresAt: new Date(Date.now() + CART_VALIDATION_SNAPSHOT_TTL_MINUTES * 60_000),
      });
      result.validationSnapshotId = snapshot._id.toString();
      result.validationSnapshotExpiresAt = snapshot.expiresAt.toISOString();
    }
    return result;
  }

  /**
   * Acknowledges price changes for specified cart items (or all items) by updating
   * acknowledgedUnitPricePaise to the current authoritative price.
   *
   * - If itemIds omitted, acknowledges all items.
   * - Rejects non-existent itemIds with 404 CART_ITEM_NOT_FOUND.
   * - Uses withOwnerLock + withTransaction for atomicity.
   * - Increments cart version.
   * - Returns updated hydrated ICartSummaryDto.
   */
  public async acknowledgePrices(
    owner: CartOwnerIdentity,
    dto: IAcknowledgeCartPricesRequestDto,
  ): Promise<ICartSummaryDto> {
    const cartBeforeSnapshot = await CartModel.findOne(this.buildOwnerFilter(owner));
    if (!cartBeforeSnapshot) throw new CartError('Cart not found', CART_ERROR_CODES.CART_ITEM_NOT_FOUND, 404);
    if (!dto.validationSnapshotId) {
      throw new CartError('A current validation snapshot is required to acknowledge prices',
        CART_ERROR_CODES.VALIDATION_SNAPSHOT_NOT_FOUND, 422);
    }
    if (dto.expectedVersion !== undefined && cartBeforeSnapshot.version !== dto.expectedVersion) {
      throw new CartError('Cart version conflict; please refresh and retry', CART_ERROR_CODES.CART_VERSION_CONFLICT, 409);
    }
    const snapshotOwner = owner.ownerType === 'USER'
      ? { ownerType: 'USER', userId: new Types.ObjectId(owner.userId) }
      : { ownerType: 'GUEST', sessionTokenHash: owner.sessionTokenHash };
    const snapshot = await CartValidationSnapshotModel.findOne({
      _id: new Types.ObjectId(dto.validationSnapshotId), ...snapshotOwner,
    });
    if (!snapshot) throw new CartError('Validation snapshot not found', CART_ERROR_CODES.VALIDATION_SNAPSHOT_NOT_FOUND, 404);
    if (snapshot.expiresAt <= new Date()) throw new CartError('Validation snapshot expired', CART_ERROR_CODES.VALIDATION_SNAPSHOT_EXPIRED, 410);
    const preflightCart = cartBeforeSnapshot;
    if (!preflightCart || !preflightCart._id.equals(snapshot.cartId) || preflightCart.version !== snapshot.cartVersion ||
        (dto.expectedVersion !== undefined && dto.expectedVersion !== snapshot.cartVersion)) {
      throw new CartError('Validation snapshot no longer matches the current cart', CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE, 409);
    }
    const live = await this.validateCart(owner, {
      ...(snapshot.addressId ? { addressId: snapshot.addressId.toString() } : { pincode: snapshot.pincode ?? undefined }),
      expectedVersion: snapshot.cartVersion,
    }, { persistSnapshot: false });
    const liveById = new Map(live.cart.items.map((item) => [item.itemId, item]));
    const snapshotIds = snapshot.items.map((i) => i.itemId.toString()).sort();
    const currentIds = preflightCart.items.map((i) => i._id.toString()).sort();
    if (snapshotIds.join('|') !== currentIds.join('|') || snapshot.pincode !== live.evaluatedPincode ||
        snapshot.items.some((i) => {
          const now = liveById.get(i.itemId.toString());
          const line = preflightCart.items.find((entry) => entry._id.equals(i.itemId));
          return !now || !line || line.quantity !== i.quantity || !line.productId.equals(i.productId) ||
            (line.variantId?.toString() ?? null) !== (i.variantId?.toString() ?? null) ||
            now.unitPricePaise !== i.unitPricePaise || now.unitCode !== i.unitCode ||
            now.quantityPrecision !== i.quantityPrecision;
        })) {
      throw new CartError('Prices or cart context changed after validation; validate again', CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE, 409, live.priceChangedItems);
    }
    const ownerFilter = this.buildOwnerFilter(owner);
    const ownerKey = this.getOwnerLockKey(owner);

    const savedCart = await this.withOwnerLock(ownerKey, () =>
      withTransaction(async (session) => {
        const cart = await CartModel.findOne(ownerFilter).session(session);

        if (!cart) {
          throw new CartError(
            'Cart not found',
            CART_ERROR_CODES.CART_ITEM_NOT_FOUND,
            404,
          );
        }

        if (!cart._id.equals(snapshot.cartId) || cart.version !== snapshot.cartVersion) {
          throw new CartError('Validation snapshot no longer matches the current cart',
            CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE, 409);
        }

        if (dto.expectedVersion !== undefined && cart.version !== dto.expectedVersion) {
          throw new CartError(
            'Cart version conflict; please refresh and retry',
            CART_ERROR_CODES.CART_VERSION_CONFLICT,
            409,
          );
        }

        if (snapshot.addressId) {
          if (owner.ownerType !== 'USER') {
            throw new CartError('Saved address validation snapshots are customer-only',
              CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE, 409);
          }
          const currentAddress = await CustomerAddressModel.findOne({
            _id: snapshot.addressId,
            userId: new Types.ObjectId(owner.userId),
          }).select({ pincode: 1 }).session(session);
          if (!currentAddress || currentAddress.pincode !== snapshot.pincode) {
            throw new CartError('Saved address PIN changed after validation; validate again',
              CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE, 409);
          }
        }

        // Determine target item IDs
        const targetItemIds =
          dto.itemIds !== undefined && dto.itemIds.length > 0
            ? dto.itemIds
            : cart.items.map((item) => item._id.toString());

        // Validate all requested itemIds exist in the cart
        for (const id of targetItemIds) {
          const found = cart.items.some((item) => item._id.toString() === id);
          if (!found) {
            throw new CartError(
              'Cart item not found',
              CART_ERROR_CODES.CART_ITEM_NOT_FOUND,
              404,
            );
          }
        }

        const targetItemIdSet = new Set(targetItemIds);
        const targetItems = cart.items.filter((item) => targetItemIdSet.has(item._id.toString()));

        // Batch-fetch pricing, products, and variants for target items
        const productIds = Array.from(
          new Set(targetItems.map((item) => item.productId.toString())),
        ).map((id) => new Types.ObjectId(id));

        const variantIds = Array.from(
          new Set(targetItems.map((item) => item.variantId?.toString()).filter(Boolean) as string[]),
        ).map((id) => new Types.ObjectId(id));

        const serviceAreaDoc = snapshot.pincode
          ? await ServiceAreaModel.findOne({ pincodes: snapshot.pincode, isActive: true }).session(session)
          : null;
        if (!serviceAreaDoc) {
          throw new CartError('The validated service area is no longer available',
            CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE, 409);
        }

        const pricingFilter: FilterQuery<IProductPricingDocument> = {
          productId: { $in: productIds },
          isActive: true,
          ...(serviceAreaDoc
            ? { $or: [{ serviceAreaId: null }, { serviceAreaId: serviceAreaDoc._id }] }
            : { serviceAreaId: null }),
        };

        const [pricingDocs, fetchedProducts, fetchedVariants] = await Promise.all([
          ProductPricingModel.find(pricingFilter).session(session),
          productIds.length > 0
            ? ProductModel.find({ _id: { $in: productIds } }).session(session)
            : Promise.resolve([] as IProductDocument[]),
          variantIds.length > 0
            ? ProductVariantModel.find({ _id: { $in: variantIds } }).session(session)
            : Promise.resolve([] as IProductVariantDocument[]),
        ]);

        const customerSegment = await this.pricingEngine.resolveCustomerSegment(
          owner.ownerType === 'USER' ? owner.userId : null,
        );

        const productMap = new Map<string, IProductDocument>(
          fetchedProducts.map((p) => [p._id.toString(), p]),
        );
        const variantMap = new Map<string, IProductVariantDocument>(
          fetchedVariants.map((v) => [v._id.toString(), v]),
        );

        // Build arrayFilters for atomic batch update
        const arrayFilters: Record<string, unknown>[] = [];
        const setFields: Record<string, unknown> = { expiresAt: this.computeGuestExpiresAt() };

        for (let i = 0; i < targetItems.length; i++) {
          const item = targetItems[i]!;
          const product = productMap.get(item.productId.toString()) ?? null;
          const variant = item.variantId
            ? (variantMap.get(item.variantId.toString()) ?? null)
            : null;
          const unitSource = product?.hasVariants ? variant : product;
          const quantityPrecision = unitSource?.quantityPrecision ?? 0;

          const snapshotItem = snapshot.items.find((entry) => entry.itemId.equals(item._id));
          const itemStillSellable = !!product && product.status === 'ACTIVE' && !!product.publishedAt &&
            (product.hasVariants
              ? !!variant && variant.productId.equals(product._id) && variant.status === 'ACTIVE' && !!variant.publishedAt
              : item.variantId === null);
          const quantityStillValid = !!unitSource?.unitCode && unitSource.quantityPrecision !== undefined &&
            unitSource.minOrderQuantity && unitSource.stepIncrement && ExactDecimalQuantity.validate(item.quantity, {
              unitCode: unitSource.unitCode,
              quantityPrecision,
              minOrderQuantity: unitSource.minOrderQuantity,
              maxOrderQuantity: unitSource.maxOrderQuantity ?? null,
              stepIncrement: unitSource.stepIncrement,
            }).isValid;
          if (!snapshotItem || !itemStillSellable || !quantityStillValid ||
              !snapshotItem.productId.equals(item.productId) ||
              (snapshotItem.variantId?.toString() ?? null) !== (item.variantId?.toString() ?? null) ||
              snapshotItem.quantity !== item.quantity || snapshotItem.unitCode !== unitSource?.unitCode ||
              snapshotItem.quantityPrecision !== quantityPrecision) {
            throw new CartError('Item or unit context changed after validation; validate again',
              CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE, 409);
          }

          const pricingResult = this.computeHydratedItemPricing({
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
            quantityPrecision,
            customerSegment,
            serviceAreaId: serviceAreaDoc ? serviceAreaDoc._id : null,
            pricingDocs,
          });

          const currentPrice = pricingResult?.unitPricePaise;
          if (!snapshotItem || currentPrice === undefined || currentPrice !== snapshotItem.unitPricePaise) {
            throw new CartError('Authoritative price changed after validation; validate again',
              CART_ERROR_CODES.VALIDATION_SNAPSHOT_STALE, 409);
          }

          const filterAlias = `ackElem${i}`;
          arrayFilters.push({ [`${filterAlias}._id`]: item._id });
          setFields[`items.$[${filterAlias}].acknowledgedUnitPricePaise`] = currentPrice;
          setFields[`items.$[${filterAlias}].acknowledgedPincode`] = snapshot.pincode;
        }

        if (arrayFilters.length === 0) {
          // Nothing to update on item watermarks: increment version (and refresh guest TTL if applicable)
          return CartModel.findOneAndUpdate(
            { _id: cart._id, version: cart.version },
            {
              ...(Object.keys(setFields).length > 0 ? { $set: setFields } : {}),
              $inc: { version: 1 },
            },
            { new: true, session },
          );
        }

        return CartModel.findOneAndUpdate(
          { _id: cart._id, version: cart.version },
          {
            $set: setFields,
            $inc: { version: 1 },
          },
          { new: true, runValidators: true, session, arrayFilters },
        );
      }),
    );

    if (!savedCart) {
      throw new CartError(
        'Cart version conflict; please refresh and retry',
        CART_ERROR_CODES.CART_VERSION_CONFLICT,
        409,
      );
    }

    return this.hydrateCartDocument(savedCart, owner, snapshot.pincode);
  }
}

export const cartService = new CartService();
