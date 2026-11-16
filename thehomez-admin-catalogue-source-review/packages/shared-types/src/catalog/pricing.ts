import { assertValidMoneyPaise, type MoneyPaise } from '../common/money.js';
import { ExactDecimalQuantity } from './exact-decimal-quantity.js';

/**
 * Maximum permitted volume discount slabs per product/variant pricing schedule.
 */
export const MAX_B2B_VOLUME_TIERS = 10;

/**
 * Scope Discriminator for Product Pricing.
 *
 * Defines the target commercial entity and geographic tier for the pricing record.
 * Strictly enforced across Mongoose schemas and partial unique indexes.
 */
export type PricingScope =
  'STANDALONE_GLOBAL' | 'STANDALONE_REGIONAL' | 'VARIANT_GLOBAL' | 'VARIANT_REGIONAL';

/**
 * Audit actions for price modification history.
 */
export type PriceHistoryAction = 'CREATED' | 'UPDATED' | 'DEACTIVATED';

/**
 * Deterministic monetary rounding modes for fractional paise line-item calculation.
 *
 * Formally approved under Business Decision #39 (Option A: Commercial Half-Up).
 */
export type MonetaryRoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL';

/**
 * Authoritative monetary rounding mode applied across all catalogue pricing evaluations.
 * Strictly 'HALF_UP' (Commercial Half-Up rounding) per approved Business Decision #39.
 */
export const DEFAULT_MONETARY_ROUNDING_MODE: MonetaryRoundingMode = 'HALF_UP';

/**
 * B2B Wholesale Volume Discount Slab.
 *
 * Defines a bulk order quantity threshold and the corresponding discounted
 * unit rate in integer minor units (Paise in INR).
 */
export interface IB2BVolumeTier {
  /**
   * Minimum qualifying order quantity as a canonical decimal string
   * (e.g. "100", "5.000"). Must satisfy physical unit precision and
   * minimum-anchored increment step (minQuantity = MOQ + n * Step).
   */
  minQuantity: string;

  /**
   * Discounted unit selling price per unit of measure, represented
   * strictly in integer minor units (Paise). Uniform GST-exclusive net rate.
   */
  pricePaise: MoneyPaise;
}

/**
 * Product Pricing Entity Interface (Persisted Entity / Read Contract).
 *
 * Authoritative catalogue commercial price definition for standalone products
 * or product variants, supporting dual B2C retail and B2B wholesale tiers.
 *
 * In accordance with approved Decision #32:
 * All stored prices represent uniform GST-exclusive net commercial values.
 * Client callers cannot supply or control identity, status, audit, scope,
 * or version fields; these are managed exclusively by the backend domain model.
 */
export interface IProductPricing {
  id: string;
  productId: string;
  variantId: string | null;
  serviceAreaId: string | null;
  pricingScope: PricingScope;
  currency: 'INR';

  /**
   * Mandatory retail consumer selling price per unit of measure,
   * stored strictly in integer minor units (Paise). GST-exclusive net rate per Decision #32.
   */
  b2cPricePaise: MoneyPaise;

  /**
   * Optional Maximum Retail Price (MRP) per unit of measure in integer minor units (Paise).
   * If provided, must be >= b2cPricePaise.
   * Stored on the exact same uniform GST-exclusive net basis as selling price per Decision #32.
   */
  b2cMrpPaise: MoneyPaise | null;

  /**
   * Optional baseline wholesale selling price per unit of measure for
   * verified commercial contractor accounts. If b2bTiers are defined,
   * b2bPricePaise is mandatory as the baseline tier anchor.
   * Stored on the exact same uniform GST-exclusive net basis per Decision #32.
   */
  b2bPricePaise: MoneyPaise | null;

  /**
   * Optional array of up to 10 bulk volume discount slabs.
   * Tiers must enforce strictly increasing minQuantity and
   * monotonically non-increasing pricePaise.
   */
  b2bTiers: IB2BVolumeTier[];

  isActive: boolean;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * DTO for creating or defining pricing for a product or variant (Admin).
 *
 * Strictly isolates permitted client-writable creation fields.
 * Excludes all server-managed identity, status, audit, scope, and version fields.
 */
export interface ICreatePricingDto {
  /**
   * Optional service area identifier for regional price overrides.
   * Omit or pass null for global platform default pricing.
   */
  serviceAreaId?: string | null;

  /**
   * Currency code. Strictly 'INR'. Defaults to 'INR' if omitted.
   */
  currency?: 'INR';

  /**
   * Mandatory B2C retail selling price in integer minor units (Paise).
   * Stored strictly as a GST-exclusive net rate per Decision #32.
   */
  b2cPricePaise: MoneyPaise;

  /**
   * Optional Maximum Retail Price (MRP) in integer minor units (Paise).
   * Must be >= b2cPricePaise if provided.
   * Stored on the exact same GST-exclusive net basis as selling price per Decision #32.
   */
  b2cMrpPaise?: MoneyPaise | null;

  /**
   * Optional B2B wholesale base price in integer minor units (Paise).
   * Mandatory if b2bTiers is non-empty.
   * Stored on the exact same GST-exclusive net basis per Decision #32.
   */
  b2bPricePaise?: MoneyPaise | null;

  /**
   * Optional B2B bulk volume discount tiers (max 10).
   */
  b2bTiers?: IB2BVolumeTier[];

  /**
   * Administrative override flag permitting b2bPricePaise > b2cPricePaise
   * during temporary retail clearance events.
   *
   * SAFEGUARD: This flag DOES NOT grant authority on its own.
   * The executing user must possess administrative `pricing:write` permission,
   * and a non-empty `changeReason` is mandatory. Client-supplied flags from
   * non-privileged callers are strictly rejected.
   */
  allowB2bExceedsB2c?: boolean;

  /**
   * Mandatory business justification recorded in the immutable audit log.
   * Strictly required for all price creation and modification per Decision #33.
   */
  changeReason: string;
}

/**
 * Backward-compatible alias for ICreatePricingDto used in idempotent PUT operations.
 */
export type ISetPricingDto = ICreatePricingDto;

/**
 * DTO for updating an existing pricing record (Admin).
 *
 * Correctly distinguishes optional patch fields from mandatory audit fields.
 * Server-controlled identity, scope, product/variant linkage, version,
 * and creation audit fields cannot be modified.
 */
export interface IUpdatePricingDto {
  b2cPricePaise?: MoneyPaise;
  b2cMrpPaise?: MoneyPaise | null;
  b2bPricePaise?: MoneyPaise | null;
  b2bTiers?: IB2BVolumeTier[];
  isActive?: boolean;

  /**
   * Administrative override flag permitting b2bPricePaise > b2cPricePaise
   * during temporary retail clearance events.
   *
   * SAFEGUARD: This flag DOES NOT grant authority on its own.
   * The executing user must possess administrative `pricing:write` permission,
   * and a non-empty `changeReason` is mandatory.
   */
  allowB2bExceedsB2c?: boolean;

  /**
   * Mandatory business justification recorded in the immutable audit log.
   * Required for every update and deactivation per Decision #33.
   */
  changeReason: string;
}

/**
 * DTO for requesting real-time authoritative price calculation.
 *
 * Zero Client Trust:
 * Client provides product/variant identification, delivery PIN, and quantity.
 * Customer segment and B2B eligibility are resolved strictly server-side
 * from authenticated session credentials. Client-supplied segment claims
 * are strictly ignored and discarded.
 *
 * Deterministic Monetary Rounding:
 * Rounding policy is strictly server-enforced ('HALF_UP' per approved Decision #39).
 * Client-selected rounding modes are prohibited and excluded from this contract.
 */
export interface IPricingCalculationRequestDto {
  productId: string;
  variantId?: string | null;

  /**
   * Customer delivery PIN code (6-digit Indian postal code).
   * Used to resolve trusted service area and check serviceability.
   * If omitted, calculations evaluate global base pricing.
   * Arbitrary client-supplied serviceAreaId is strictly forbidden.
   */
  deliveryPincode?: string | null;

  /**
   * Requested order quantity as a canonical decimal string
   * (e.g. "12", "0.50"). Must satisfy unit precision and increment rules.
   */
  quantity: string;
}

/**
 * Response payload returned by the authoritative price calculation endpoint.
 */
export interface IPricingCalculationResponseDto {
  productId: string;
  variantId: string | null;
  serviceAreaId: string | null;
  deliveryPincode: string | null;
  unitCode: string;
  quantity: string;
  customerSegment: 'B2C' | 'B2B';

  /**
   * Identifier of the pricing tier applied:
   * 'STANDARD_B2C' | 'BASE_B2B' | 'TIER_1' | 'TIER_2' ...
   */
  pricingTierApplied: string;

  /**
   * The minimum quantity threshold of the tier applied, or null if base rate.
   */
  tierMinQuantity: string | null;

  /**
   * Effective unit selling price in integer minor units (Paise).
   * Uniform GST-exclusive net rate per Decision #32.
   */
  unitPricePaise: MoneyPaise;

  /**
   * Total line item subtotal in integer minor units (Paise),
   * calculated using exact BigInt scaled arithmetic with deterministic rounding.
   * Uniform GST-exclusive net amount per Decision #32.
   */
  subtotalPaise: MoneyPaise;

  /**
   * Optional total MRP value in integer minor units (Paise) if MRP is configured.
   * Uniform GST-exclusive net amount per Decision #32.
   */
  mrpSubtotalPaise?: MoneyPaise | null;

  /**
   * Customer monetary savings in integer minor units (Paise) compared to MRP:
   * max(0, mrpSubtotalPaise - subtotalPaise).
   * Evaluated on the uniform GST-exclusive net commercial basis.
   */
  savingsPaise?: MoneyPaise | null;

  currency: 'INR';

  /**
   * Indicates whether this calculation resolved a regional service-area override
   * (true) or fell back to the global base price (false).
   */
  isServiceAreaOverride: boolean;
}

/**
 * Immutable Historical Price Revision Entry.
 */
export interface IPriceHistory {
  id: string;
  pricingId: string;
  productId: string;
  variantId: string | null;
  serviceAreaId: string | null;
  pricingScope: PricingScope;
  action: PriceHistoryAction;
  previousB2cPricePaise?: MoneyPaise | null;
  newB2cPricePaise: MoneyPaise;
  previousB2cMrpPaise?: MoneyPaise | null;
  newB2cMrpPaise?: MoneyPaise | null;
  previousB2bPricePaise?: MoneyPaise | null;
  newB2bPricePaise?: MoneyPaise | null;
  previousTiers: IB2BVolumeTier[];
  newTiers: IB2BVolumeTier[];
  changeReason: string;
  changedBy: string;
  createdAt: string;
}

/**
 * Query parameters for administrative price history lookup.
 */
export interface IPriceHistoryQueryDto {
  variantId?: string;
  page?: number;
  limit?: number;
}

/**
 * Calculates exact line-item subtotal in safe integer MoneyPaise from an integer
 * unit price (in Paise) and a canonical decimal quantity string.
 *
 * Prevents floating-point precision loss by using scaled BigInt arithmetic.
 *
 * Mathematical formulation:
 * scaledQty = ExactDecimalQuantity.toScaledBigInt(quantity, precision) = Q * 10^P
 * divisor = 10^P
 * rawProduct = unitPricePaise * scaledQty = unitPricePaise * Q * 10^P
 * unroundedSubtotal = rawProduct / divisor
 *
 * When fractional paise exist (rawProduct % divisor !== 0n), deterministic rounding
 * is applied according to the specified MonetaryRoundingMode.
 *
 * Example:
 * unitPricePaise = 1001 (₹10.01)
 * quantity = "0.5", precision = 1 (scaledQty = 5n, divisor = 10n)
 * rawProduct = 5005n (500.5 paise)
 * HALF_UP rounding -> 501 paise (safe integer)
 *
 * @param unitPricePaise Unit price in integer minor units (Paise)
 * @param quantity Canonical decimal quantity string
 * @param precision Decimal precision of the unit (0 to 3)
 * @param roundingMode Rounding mode (defaults to 'HALF_UP' per approved Decision #39)
 * @returns Safe integer MoneyPaise
 */
export function calculateExactSubtotalPaise(
  unitPricePaise: MoneyPaise,
  quantity: string,
  precision: number,
  roundingMode: MonetaryRoundingMode = DEFAULT_MONETARY_ROUNDING_MODE,
): MoneyPaise {
  if (typeof unitPricePaise !== 'number') {
    throw new TypeError(
      `Invalid unitPricePaise: ${String(unitPricePaise)}. Must be a JavaScript number.`,
    );
  }

  if (Number.isNaN(unitPricePaise)) {
    throw new RangeError('unitPricePaise cannot be NaN');
  }

  if (!Number.isFinite(unitPricePaise)) {
    throw new RangeError('unitPricePaise must be finite (cannot be Infinity or -Infinity)');
  }

  if (!Number.isInteger(unitPricePaise)) {
    throw new RangeError(
      `Invalid unitPricePaise: ${unitPricePaise}. Fractional paise not permitted.`,
    );
  }

  if (!Number.isSafeInteger(unitPricePaise)) {
    throw new RangeError(`Invalid unitPricePaise: ${unitPricePaise}. Must be a safe integer.`);
  }

  if (unitPricePaise < 0) {
    throw new RangeError('unitPricePaise cannot be negative');
  }

  if (
    typeof precision !== 'number' ||
    !Number.isInteger(precision) ||
    precision < 0 ||
    precision > 3
  ) {
    throw new RangeError('Precision must be an integer between 0 and 3');
  }

  if (typeof quantity !== 'string' || quantity.trim().startsWith('-')) {
    throw new RangeError('Quantity cannot be negative');
  }

  const scaledQty = ExactDecimalQuantity.toScaledBigInt(quantity, precision);
  if (scaledQty <= 0n) {
    throw new RangeError('Quantity must be strictly greater than 0');
  }

  const divisor = 10n ** BigInt(precision);
  const rawProduct = BigInt(unitPricePaise) * scaledQty;

  const quotient = rawProduct / divisor;
  const remainder = rawProduct % divisor;

  let finalPaise: bigint;

  if (remainder === 0n) {
    finalPaise = quotient;
  } else {
    switch (roundingMode) {
      case 'HALF_UP': {
        // Commercial rounding: round half up away from 0
        const halfDivisor = divisor / 2n;
        finalPaise = remainder >= halfDivisor ? quotient + 1n : quotient;
        break;
      }
      case 'HALF_EVEN': {
        // Banker's rounding: round half to nearest even integer
        const halfDivisor = divisor / 2n;
        if (remainder > halfDivisor) {
          finalPaise = quotient + 1n;
        } else if (remainder < halfDivisor) {
          finalPaise = quotient;
        } else {
          // Exact tie: round to nearest even quotient
          finalPaise = quotient % 2n === 0n ? quotient : quotient + 1n;
        }
        break;
      }
      case 'FLOOR': {
        // Customer-favorable truncation
        finalPaise = quotient;
        break;
      }
      case 'CEIL': {
        // Platform-favorable ceiling
        finalPaise = quotient + 1n;
        break;
      }
      default: {
        throw new Error(`Unsupported rounding mode: ${roundingMode}`);
      }
    }
  }

  if (finalPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Calculated subtotal exceeds Number.MAX_SAFE_INTEGER');
  }

  const result = Number(finalPaise);
  assertValidMoneyPaise(result);
  return result;
}

/**
 * Calculates customer monetary savings in integer minor units (Paise)
 * against MRP, given total subtotal and MRP subtotal.
 *
 * In accordance with Decision #32, both subtotal and MRP share the exact
 * same GST-exclusive net commercial tax basis.
 *
 * Returns null if mrpSubtotalPaise is null or undefined.
 * Returns 0 if subtotalPaise >= mrpSubtotalPaise.
 */
export function calculateSavingsPaise(
  subtotalPaise: MoneyPaise,
  mrpSubtotalPaise?: MoneyPaise | null,
): MoneyPaise | null {
  if (mrpSubtotalPaise === null || mrpSubtotalPaise === undefined) {
    return null;
  }
  assertValidMoneyPaise(subtotalPaise);
  assertValidMoneyPaise(mrpSubtotalPaise);

  const savings = mrpSubtotalPaise - subtotalPaise;
  return savings > 0 ? savings : 0;
}
