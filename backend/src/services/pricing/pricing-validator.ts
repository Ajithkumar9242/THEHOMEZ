import {
  type ICreatePricingDto,
  type IQuantityConstraints,
  MAX_B2B_VOLUME_TIERS,
  ExactDecimalQuantity,
} from '@thehomez/shared-types';
import { PricingError } from './pricing-errors.js';

export class PricingValidator {
  /**
   * Asserts that a monetary value is a valid safe non-negative integer in paise.
   */
  public static assertSafeMoneyPaise(value: unknown, fieldName: string): asserts value is number {
    if (typeof value !== 'number') {
      throw new PricingError(
        `Field '${fieldName}' must be a JavaScript number`,
        'INVALID_MONEY_PAISE',
        400,
      );
    }

    if (Number.isNaN(value)) {
      throw new PricingError(`Field '${fieldName}' cannot be NaN`, 'INVALID_MONEY_PAISE', 400);
    }

    if (!Number.isFinite(value)) {
      throw new PricingError(
        `Field '${fieldName}' must be a finite number`,
        'INVALID_MONEY_PAISE',
        400,
      );
    }

    if (!Number.isInteger(value)) {
      throw new PricingError(
        `Field '${fieldName}' must be an integer (fractional paise not permitted)`,
        'INVALID_MONEY_PAISE',
        400,
      );
    }

    if (!Number.isSafeInteger(value)) {
      throw new PricingError(
        `Field '${fieldName}' exceeds maximum safe integer`,
        'INVALID_MONEY_PAISE',
        400,
      );
    }

    if (value < 0) {
      throw new PricingError(`Field '${fieldName}' cannot be negative`, 'INVALID_MONEY_PAISE', 400);
    }
  }

  /**
   * Validates a pricing configuration payload against business invariants,
   * monetary limits, MRP bounds, B2B wholesale rules, and physical construction unit constraints.
   */
  public static validatePricingPayload(
    payload: ICreatePricingDto,
    unitRules: IQuantityConstraints,
    isUpdate = false,
  ): void {
    // 1. Validate b2cPricePaise
    if (!isUpdate || payload.b2cPricePaise !== undefined) {
      this.assertSafeMoneyPaise(payload.b2cPricePaise, 'b2cPricePaise');
    }

    // 2. Validate b2cMrpPaise
    if (payload.b2cMrpPaise !== null && payload.b2cMrpPaise !== undefined) {
      this.assertSafeMoneyPaise(payload.b2cMrpPaise, 'b2cMrpPaise');
      if (payload.b2cPricePaise !== undefined && payload.b2cMrpPaise < payload.b2cPricePaise) {
        throw new PricingError(
          `b2cMrpPaise (${payload.b2cMrpPaise}) cannot be less than selling price b2cPricePaise (${payload.b2cPricePaise})`,
          'MRP_LESS_THAN_SELLING_PRICE',
          400,
        );
      }
    }

    // 3. Validate b2bPricePaise
    if (payload.b2bPricePaise !== null && payload.b2bPricePaise !== undefined) {
      this.assertSafeMoneyPaise(payload.b2bPricePaise, 'b2bPricePaise');

      if (payload.b2cPricePaise !== undefined && payload.b2bPricePaise > payload.b2cPricePaise) {
        if (!payload.allowB2bExceedsB2c) {
          throw new PricingError(
            `b2bPricePaise (${payload.b2bPricePaise}) exceeds b2cPricePaise (${payload.b2cPricePaise}) without allowB2bExceedsB2c override`,
            'B2B_PRICE_EXCEEDS_B2C',
            400,
          );
        }
      }
    }

    // 4. Validate b2bTiers
    const tiers = payload.b2bTiers || [];
    if (tiers.length > 0) {
      // Mandatory baseline B2B price check (Decision #30)
      if (payload.b2bPricePaise === null || payload.b2bPricePaise === undefined) {
        throw new PricingError(
          'b2bPricePaise is required as the baseline tier anchor when b2bTiers are defined',
          'B2B_BASE_PRICE_REQUIRED_FOR_TIERS',
          400,
        );
      }

      if (tiers.length > MAX_B2B_VOLUME_TIERS) {
        throw new PricingError(
          `b2bTiers cannot exceed ${MAX_B2B_VOLUME_TIERS} volume slabs`,
          'MAX_TIERS_EXCEEDED',
          400,
        );
      }

      const precision = unitRules.quantityPrecision;
      const scaledMoq = ExactDecimalQuantity.toScaledBigInt(unitRules.minOrderQuantity, precision);
      const scaledStep = ExactDecimalQuantity.toScaledBigInt(unitRules.stepIncrement, precision);

      let prevScaledQty: bigint | null = null;
      let prevPricePaise: number = payload.b2bPricePaise;

      for (const [i, tier] of tiers.entries()) {
        // Format & regex check
        if (
          typeof tier.minQuantity !== 'string' ||
          tier.minQuantity.trim().length === 0 ||
          tier.minQuantity.trim().length > 15 ||
          !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(tier.minQuantity.trim())
        ) {
          throw new PricingError(
            `Tier ${i + 1} minQuantity '${tier.minQuantity}' is malformed`,
            'TIER_QUANTITY_MALFORMED',
            400,
          );
        }

        const trimmedMinQty = tier.minQuantity.trim();
        const [, fractionPart = ''] = trimmedMinQty.split('.');

        // Unit precision check
        if (fractionPart.length > precision) {
          throw new PricingError(
            `Tier ${i + 1} minQuantity '${trimmedMinQty}' exceeds allowed unit precision of ${precision} decimal places`,
            'TIER_PRECISION_EXCEEDED',
            400,
          );
        }

        const scaledTierQty = ExactDecimalQuantity.toScaledBigInt(trimmedMinQty, precision);

        // Tier minimum-anchored step alignment: minQuantity = MOQ + n * Step (Decision #36)
        // Must be strictly greater than MOQ
        if (scaledTierQty <= scaledMoq) {
          throw new PricingError(
            `Tier ${i + 1} minQuantity '${trimmedMinQty}' must be strictly greater than MOQ (${unitRules.minOrderQuantity})`,
            'TIER_QUANTITY_STEP_MISMATCH',
            400,
          );
        }

        const delta = scaledTierQty - scaledMoq;
        if (delta % scaledStep !== 0n) {
          throw new PricingError(
            `Tier ${i + 1} minQuantity '${trimmedMinQty}' must align with formula: MOQ (${unitRules.minOrderQuantity}) + n * Step (${unitRules.stepIncrement})`,
            'TIER_QUANTITY_STEP_MISMATCH',
            400,
          );
        }

        // Validate tier price
        this.assertSafeMoneyPaise(tier.pricePaise, `b2bTiers[${i}].pricePaise`);

        // Monotonicity checks
        if (i === 0) {
          // Tier 1 price must be <= base B2B price
          if (tier.pricePaise > payload.b2bPricePaise) {
            throw new PricingError(
              `Tier 1 pricePaise (${tier.pricePaise}) cannot exceed base b2bPricePaise (${payload.b2bPricePaise})`,
              'TIER_MONOTONICITY_VIOLATION',
              400,
            );
          }
        } else {
          // Tier quantity must be strictly increasing
          if (prevScaledQty !== null && scaledTierQty <= prevScaledQty) {
            throw new PricingError(
              `Tier ${i + 1} minQuantity '${trimmedMinQty}' must be strictly greater than previous tier quantity`,
              'TIER_MONOTONICITY_VIOLATION',
              400,
            );
          }

          // Tier price must be monotonically non-increasing (Tier_k <= Tier_k-1)
          if (tier.pricePaise > prevPricePaise) {
            throw new PricingError(
              `Tier ${i + 1} pricePaise (${tier.pricePaise}) cannot exceed previous tier price (${prevPricePaise})`,
              'TIER_MONOTONICITY_VIOLATION',
              400,
            );
          }
        }

        prevScaledQty = scaledTierQty;
        prevPricePaise = tier.pricePaise;
      }
    }

    // 5. Validate changeReason
    if (
      typeof payload.changeReason !== 'string' ||
      payload.changeReason.trim().length === 0 ||
      payload.changeReason.trim().length > 500
    ) {
      throw new PricingError(
        'changeReason is required, non-empty, and must not exceed 500 characters',
        'VALIDATION_ERROR',
        400,
      );
    }
  }
}
