import {
  DECIMAL_STRING_REGEX,
  ExactDecimalQuantity,
  MAX_B2B_VOLUME_TIERS,
  MAX_QUANTITY_STRING_LENGTH,
  type IB2BVolumeTier,
} from '@thehomez/shared-types';

export interface UnitRules {
  unitCode?: string | null;
  quantityPrecision?: number | null;
  minOrderQuantity?: string | null;
  maxOrderQuantity?: string | null;
  stepIncrement?: string | null;
}

export interface TierValidationResult {
  isValid: boolean;
  error?: string;
  field?: 'minQuantity' | 'price' | 'tiers';
  tierIndex?: number;
}

/**
 * Validates a single quantity string against physical unit constraints.
 */
export function validateQuantityInput(
  value: string | undefined | null,
  unitRules: UnitRules,
  options: { isTierQuantity?: boolean } = {},
): { isValid: boolean; error?: string } {
  if (value === undefined || value === null || value.trim().length === 0) {
    return { isValid: false, error: 'Quantity is required' };
  }

  const str = value.trim();

  if (str.length > MAX_QUANTITY_STRING_LENGTH) {
    return {
      isValid: false,
      error: `Quantity cannot exceed ${MAX_QUANTITY_STRING_LENGTH} characters`,
    };
  }

  if (!DECIMAL_STRING_REGEX.test(str)) {
    return {
      isValid: false,
      error: 'Quantity must be a canonical non-negative decimal string without leading zeros',
    };
  }

  const precision = unitRules.quantityPrecision ?? 0;
  const [, fractionalPart = ''] = str.split('.');

  if (fractionalPart.length > precision) {
    return {
      isValid: false,
      error:
        precision === 0
          ? 'This discrete unit requires whole integer quantities (0 decimal places)'
          : `Quantity exceeds the allowed unit precision of ${precision} decimal places`,
    };
  }

  try {
    const scaledQty = ExactDecimalQuantity.toScaledBigInt(str, precision);

    if (unitRules.minOrderQuantity) {
      const scaledMoq = ExactDecimalQuantity.toScaledBigInt(unitRules.minOrderQuantity, precision);
      if (options.isTierQuantity) {
        if (scaledQty <= scaledMoq) {
          return {
            isValid: false,
            error: `Tier volume quantity must be strictly greater than MOQ (${unitRules.minOrderQuantity})`,
          };
        }
      } else if (scaledQty < scaledMoq) {
        return {
          isValid: false,
          error: `Quantity cannot be less than MOQ (${unitRules.minOrderQuantity})`,
        };
      }

      if (unitRules.stepIncrement) {
        const scaledStep = ExactDecimalQuantity.toScaledBigInt(unitRules.stepIncrement, precision);
        const delta = scaledQty - scaledMoq;
        if (delta % scaledStep !== 0n) {
          return {
            isValid: false,
            error: `Quantity must align with formula: MOQ (${unitRules.minOrderQuantity}) + n × Step (${unitRules.stepIncrement})`,
          };
        }
      }
    }

    if (unitRules.maxOrderQuantity) {
      const scaledMax = ExactDecimalQuantity.toScaledBigInt(unitRules.maxOrderQuantity, precision);
      if (scaledQty > scaledMax) {
        return {
          isValid: false,
          error: `Quantity cannot exceed maximum order quantity (${unitRules.maxOrderQuantity})`,
        };
      }
    }

    return { isValid: true };
  } catch {
    return { isValid: false, error: 'Quantity could not be parsed' };
  }
}

/**
 * Validates a list of B2B wholesale volume discount tiers against all backend commercial and unit rules.
 */
export function validateVolumeTiers(
  tiers: IB2BVolumeTier[],
  baseB2bPricePaise: number | null | undefined,
  unitRules: UnitRules,
): TierValidationResult {
  if (tiers.length === 0) {
    return { isValid: true };
  }

  if (baseB2bPricePaise === null || baseB2bPricePaise === undefined) {
    return {
      isValid: false,
      error: 'Base B2B price is required as the baseline tier anchor when volume tiers are defined',
      field: 'tiers',
    };
  }

  if (tiers.length > MAX_B2B_VOLUME_TIERS) {
    return {
      isValid: false,
      error: `Volume discount schedule cannot exceed ${MAX_B2B_VOLUME_TIERS} tiers`,
      field: 'tiers',
    };
  }

  const precision = unitRules.quantityPrecision ?? 0;
  let prevScaledQty: bigint | null = null;
  let prevPricePaise = baseB2bPricePaise;

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!;

    // Validate tier quantity
    const qtyCheck = validateQuantityInput(tier.minQuantity, unitRules, { isTierQuantity: true });
    if (!qtyCheck.isValid) {
      return {
        isValid: false,
        error: `Tier ${i + 1}: ${qtyCheck.error}`,
        field: 'minQuantity',
        tierIndex: i,
      };
    }

    const scaledTierQty = ExactDecimalQuantity.toScaledBigInt(tier.minQuantity.trim(), precision);

    // Validate tier price
    if (!Number.isSafeInteger(tier.pricePaise) || tier.pricePaise < 0) {
      return {
        isValid: false,
        error: `Tier ${i + 1}: Price must be a valid non-negative monetary value`,
        field: 'price',
        tierIndex: i,
      };
    }

    // Monotonicity validations
    if (i === 0) {
      if (tier.pricePaise > baseB2bPricePaise) {
        return {
          isValid: false,
          error: `Tier 1 unit rate cannot exceed the base wholesale rate`,
          field: 'price',
          tierIndex: 0,
        };
      }
    } else {
      if (prevScaledQty !== null && scaledTierQty <= prevScaledQty) {
        return {
          isValid: false,
          error: `Tier ${i + 1} minimum quantity must be strictly greater than Tier ${i} quantity`,
          field: 'minQuantity',
          tierIndex: i,
        };
      }

      if (tier.pricePaise > prevPricePaise) {
        return {
          isValid: false,
          error: `Tier ${i + 1} unit rate cannot exceed Tier ${i} unit rate (rates must be monotonically non-increasing)`,
          field: 'price',
          tierIndex: i,
        };
      }
    }

    prevScaledQty = scaledTierQty;
    prevPricePaise = tier.pricePaise;
  }

  return { isValid: true };
}
