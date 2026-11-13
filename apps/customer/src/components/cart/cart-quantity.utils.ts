/**
 * Exact Decimal Quantity & Cart Error Utilities
 *
 * Strictly uses `@thehomez/shared-types` `ExactDecimalQuantity` (`BigInt` scaling)
 * so cart/PDP quantity stepping, bounds checking, and canonical formatting NEVER
 * suffer from IEEE-754 floating-point drift or silently alter submitted values.
 */

import {
  ExactDecimalQuantity,
  type CartValidationIssueCode,
  type ICartItemDto,
  type IQuantityConstraints,
  type IQuantityValidationResult,
} from '@thehomez/shared-types';
import { CartApiError } from '../../api/cart-client.js';

export function buildConstraintsFromCartItem(item: ICartItemDto): IQuantityConstraints {
  return {
    unitCode: item.unitCode,
    quantityPrecision: item.quantityPrecision,
    minOrderQuantity: item.minOrderQuantity,
    maxOrderQuantity: item.maxOrderQuantity,
    stepIncrement: item.stepIncrement,
  };
}

/**
 * Validates a quantity string against unit/MOQ/max/step rules without silently rounding.
 */
export function validateCartQuantity(
  quantityStr: string,
  constraints: IQuantityConstraints,
): IQuantityValidationResult {
  const trimmed = quantityStr.trim();
  if (!trimmed) {
    return {
      isValid: false,
      errorCode: 'QUANTITY_MALFORMED',
      message: `Enter a quantity of at least ${constraints.minOrderQuantity} ${constraints.unitCode}.`,
    };
  }
  return ExactDecimalQuantity.validate(trimmed, constraints);
}

/**
 * Formats a canonical quantity string only if it already conforms to `constraints.quantityPrecision`.
 * Returns null if the value violates precision or decimal syntax (never silently truncates).
 */
export function tryFormatCanonicalQuantity(
  quantityStr: string,
  precision: number,
): string | null {
  try {
    const scaled = ExactDecimalQuantity.toScaledBigInt(quantityStr.trim(), precision);
    return ExactDecimalQuantity.fromScaledBigInt(scaled, precision);
  } catch {
    return null;
  }
}

/**
 * Computes the next stepped quantity string using exact scaled BigInt arithmetic.
 * Aligns cleanly to `minOrderQuantity + n * stepIncrement` and clamps to `[min, max]`.
 */
export function stepExactQuantity(
  currentStr: string,
  constraints: IQuantityConstraints,
  direction: 1 | -1,
): string {
  const p = constraints.quantityPrecision;
  let minScaled: bigint;
  let stepScaled: bigint;
  try {
    minScaled = ExactDecimalQuantity.toScaledBigInt(constraints.minOrderQuantity, p);
    stepScaled = ExactDecimalQuantity.toScaledBigInt(constraints.stepIncrement, p);
  } catch {
    return constraints.minOrderQuantity;
  }

  if (stepScaled <= 0n) {
    return constraints.minOrderQuantity;
  }

  let maxScaled: bigint | null = null;
  if (constraints.maxOrderQuantity !== null && constraints.maxOrderQuantity !== undefined) {
    try {
      maxScaled = ExactDecimalQuantity.toScaledBigInt(constraints.maxOrderQuantity, p);
    } catch {
      maxScaled = null;
    }
  }

  let currentScaled: bigint;
  try {
    currentScaled = ExactDecimalQuantity.toScaledBigInt(currentStr.trim(), p);
  } catch {
    currentScaled = minScaled;
  }

  let nextScaled: bigint;
  if (currentScaled < minScaled) {
    nextScaled = minScaled;
  } else {
    const deltaFromMin = currentScaled - minScaled;
    const remainder = deltaFromMin % stepScaled;

    if (direction > 0) {
      // Advance to the next step boundary above currentScaled
      nextScaled = remainder === 0n ? currentScaled + stepScaled : currentScaled + (stepScaled - remainder);
    } else {
      // Retreat to the previous step boundary below currentScaled
      nextScaled = remainder === 0n ? currentScaled - stepScaled : currentScaled - remainder;
    }
  }

  if (nextScaled < minScaled) {
    nextScaled = minScaled;
  }
  if (maxScaled !== null && nextScaled > maxScaled) {
    nextScaled = maxScaled;
  }

  return ExactDecimalQuantity.fromScaledBigInt(nextScaled, p);
}

/**
 * Checks whether decrementing from `currentStr` would stay >= MOQ or whether it is already at/below MOQ.
 */
export function isAtOrBelowMinimumQuantity(
  currentStr: string,
  constraints: IQuantityConstraints,
): boolean {
  try {
    const p = constraints.quantityPrecision;
    const currScaled = ExactDecimalQuantity.toScaledBigInt(currentStr.trim(), p);
    const minScaled = ExactDecimalQuantity.toScaledBigInt(constraints.minOrderQuantity, p);
    return currScaled <= minScaled;
  } catch {
    return false;
  }
}

/**
 * Checks whether incrementing from `currentStr` is blocked because quantity is at/above maximum.
 */
export function isAtOrAboveMaximumQuantity(
  currentStr: string,
  constraints: IQuantityConstraints,
): boolean {
  if (constraints.maxOrderQuantity === null || constraints.maxOrderQuantity === undefined) {
    return false;
  }
  try {
    const p = constraints.quantityPrecision;
    const currScaled = ExactDecimalQuantity.toScaledBigInt(currentStr.trim(), p);
    const maxScaled = ExactDecimalQuantity.toScaledBigInt(constraints.maxOrderQuantity, p);
    return currScaled >= maxScaled;
  } catch {
    return false;
  }
}

/**
 * Maps backend `CartApiError` codes & Zod details into clear customer-facing messages.
 */
export function mapCartApiErrorMessage(err: unknown): string {
  if (err instanceof CartApiError) {
    if (err.details && err.details.length > 0 && err.details[0]?.message) {
      return err.details[0].message;
    }

    switch (err.code) {
      case 'CART_VERSION_CONFLICT':
        return 'Your cart changed in another tab or session. We refreshed your cart—please review and retry.';
      case 'CART_MAX_ITEMS_EXCEEDED':
        return 'Your cart has reached the maximum of 50 distinct line items.';
      case 'CART_VARIANT_SELECTION_REQUIRED':
        return 'Please choose a product option (variant) before adding this item to your cart.';
      case 'CART_PRODUCT_UNAVAILABLE':
      case 'CART_VARIANT_UNAVAILABLE':
        return err.message || 'This item is currently unavailable for purchase.';
      case 'CART_ITEM_NOT_PRICED':
        return err.message || 'Pricing for this item is currently unavailable in your area.';
      case 'CART_INVALID_QUANTITY':
      case 'CART_QUANTITY_BELOW_MOQ':
      case 'CART_QUANTITY_ABOVE_MAX':
      case 'CART_QUANTITY_STEP_MISMATCH':
      case 'CART_QUANTITY_PRECISION_INVALID':
        return err.message;
      case 'ADDRESS_NOT_FOUND':
        return 'The selected delivery address could not be found. Please choose another address or enter a delivery PIN.';
      case 'CART_ITEM_NOT_FOUND':
        return 'One or more items in your cart are no longer present. Please refresh and review your cart.';
      case 'CUSTOMER_IDENTITY_REQUIRED':
        return 'Please sign in with your customer account to validate with a saved delivery address.';
      case 'HTTP_429':
      case 'RATE_LIMIT_EXCEEDED':
        return 'Too many cart requests in a short time. Please wait a moment and try again.';
      case 'NETWORK_ERROR':
        return err.message;
      default:
        return err.message || 'Unable to update your cart right now. Please try again.';
    }
  }

  if (err instanceof Error && err.message) {
    return err.message;
  }
  return 'An unexpected error occurred while accessing your cart.';
}

export interface PriceDriftComparison {
  direction: 'INCREASED' | 'DECREASED' | 'UNCHANGED' | 'INITIAL_OBSERVED';
  deltaPaise: number;
}

/**
 * Classifies price drift direction and absolute paise difference without duplicating UI math.
 */
export function getPriceDriftComparison(
  acknowledgedUnitPricePaise: number | null | undefined,
  currentUnitPricePaise: number | null | undefined,
): PriceDriftComparison {
  if (currentUnitPricePaise === null || currentUnitPricePaise === undefined) {
    return { direction: 'UNCHANGED', deltaPaise: 0 };
  }
  if (acknowledgedUnitPricePaise === null || acknowledgedUnitPricePaise === undefined) {
    return { direction: 'INITIAL_OBSERVED', deltaPaise: 0 };
  }
  const diff = currentUnitPricePaise - acknowledgedUnitPricePaise;
  if (diff > 0) {
    return { direction: 'INCREASED', deltaPaise: diff };
  }
  if (diff < 0) {
    return { direction: 'DECREASED', deltaPaise: Math.abs(diff) };
  }
  return { direction: 'UNCHANGED', deltaPaise: 0 };
}

/**
 * Provides a clear, non-invented customer recovery suggestion for each backend validation issue code.
 */
export function getValidationIssueGuidance(code: CartValidationIssueCode): string {
  switch (code) {
    case 'CART_EMPTY':
      return 'Add materials from the catalog before validating.';
    case 'CART_UNLOCALIZED':
    case 'UNLOCALIZED':
      return 'Set a delivery PIN or choose a saved site address to check local pricing and serviceability.';
    case 'PINCODE_UNSERVICEABLE':
    case 'UNSERVICEABLE_AREA':
      return 'Change your delivery PIN or choose another saved address to check serviceability.';
    case 'PRODUCT_UNAVAILABLE':
    case 'VARIANT_UNAVAILABLE':
    case 'NOT_PRICED':
      return 'Remove this unavailable item or change your delivery PIN / product option.';
    case 'OUT_OF_STOCK_IN_AREA':
      return 'Item is out of stock in the evaluated delivery area. Remove it or check another delivery PIN.';
    case 'UNIT_CONSTRAINTS_CHANGED':
      return 'Adjust the item quantity to match its updated MOQ, step increment, and maximum limit.';
    case 'PRICE_CHANGED':
      return 'Review the updated unit price and accept the change to continue.';
    default:
      return 'Review the item details and re-validate your cart.';
  }
}
