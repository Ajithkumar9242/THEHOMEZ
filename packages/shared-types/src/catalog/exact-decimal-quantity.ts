import {
  DECIMAL_STRING_REGEX,
  MAX_QUANTITY_STRING_LENGTH,
  type IQuantityConstraints,
} from './unit-rules.js';

export interface IQuantityValidationResult {
  isValid: boolean;
  errorCode?: string;
  message?: string;
}

/**
 * Exact Decimal Arithmetic and Bounded Quantity Validation Utility
 *
 * Implements exact decimal string parsing, scaled BigInt conversion,
 * and minimum-anchored increment verification with zero floating-point operations.
 */
export class ExactDecimalQuantity {
  public static readonly DECIMAL_STRING_REGEX = DECIMAL_STRING_REGEX;
  public static readonly MAX_QUANTITY_STRING_LENGTH = MAX_QUANTITY_STRING_LENGTH;

  /**
   * Converts a canonical decimal string into an exact scaled BigInt.
   *
   * @param value Canonical decimal string (e.g. "12.50")
   * @param precision Target decimal precision scale factor (0 to 3)
   * @returns Scaled BigInt (e.g. "12.50" with precision 2 -> 1250n)
   */
  public static toScaledBigInt(value: string, precision: number): bigint {
    if (typeof value !== 'string') {
      throw new Error('QUANTITY_MALFORMED');
    }

    const str = value.trim();
    if (
      str.length === 0 ||
      str.length > this.MAX_QUANTITY_STRING_LENGTH ||
      !this.DECIMAL_STRING_REGEX.test(str)
    ) {
      throw new Error('QUANTITY_MALFORMED');
    }

    const [wholePart, fractionalPart = ''] = str.split('.');

    // Enforce precision boundary on fractional part
    if (fractionalPart.length > precision) {
      if (precision === 0 && fractionalPart.length > 0) {
        throw new Error('QUANTITY_MUST_BE_INTEGER');
      }
      throw new Error('QUANTITY_PRECISION_EXCEEDED');
    }

    const paddedFraction = fractionalPart.padEnd(precision, '0');
    return BigInt(wholePart + paddedFraction);
  }

  /**
   * Formats a scaled BigInt back into a canonical decimal string with exact precision.
   *
   * @param scaled Scaled BigInt value
   * @param precision Decimal precision
   * @returns Canonical decimal string
   */
  public static fromScaledBigInt(scaled: bigint, precision: number): string {
    if (scaled < 0n) {
      throw new Error('QUANTITY_MALFORMED');
    }

    if (precision === 0) {
      return scaled.toString();
    }

    const str = scaled.toString().padStart(precision + 1, '0');
    const whole = str.slice(0, str.length - precision);
    const fraction = str.slice(str.length - precision);
    return `${whole}.${fraction}`;
  }

  /**
   * Validates that a quantity string conforms to the allowed precision.
   */
  public static validatePrecision(value: string, precision: number): boolean {
    try {
      this.toScaledBigInt(value, precision);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validates that quantity aligns with:
   * quantity = minOrderQuantity + n * stepIncrement (where n is non-negative integer)
   */
  public static validateStepIncrement(
    quantityStr: string,
    moqStr: string,
    stepStr: string,
    precision: number,
  ): boolean {
    try {
      const scaledQty = this.toScaledBigInt(quantityStr, precision);
      const scaledMoq = this.toScaledBigInt(moqStr, precision);
      const scaledStep = this.toScaledBigInt(stepStr, precision);

      if (scaledQty < scaledMoq || scaledStep <= 0n) {
        return false;
      }

      const delta = scaledQty - scaledMoq;
      return delta % scaledStep === 0n;
    } catch {
      return false;
    }
  }

  /**
   * Full deterministic validation of quantity against product ordering constraints.
   */
  public static validate(
    inputQuantity: string,
    constraints: IQuantityConstraints,
  ): IQuantityValidationResult {
    try {
      const p = constraints.quantityPrecision;
      const scaledQty = this.toScaledBigInt(inputQuantity, p);
      const scaledMoq = this.toScaledBigInt(constraints.minOrderQuantity, p);
      const scaledStep = this.toScaledBigInt(constraints.stepIncrement, p);

      if (scaledMoq <= 0n) {
        return {
          isValid: false,
          errorCode: 'INVALID_MOQ_CONFIGURATION',
          message: 'Minimum order quantity must be strictly greater than 0',
        };
      }

      if (scaledStep <= 0n) {
        return {
          isValid: false,
          errorCode: 'INVALID_STEP_CONFIGURATION',
          message: 'Step increment must be strictly greater than 0',
        };
      }

      if (scaledQty < scaledMoq) {
        return {
          isValid: false,
          errorCode: 'QUANTITY_BELOW_MINIMUM',
          message: `Quantity '${inputQuantity}' is below minimum order quantity of ${constraints.minOrderQuantity}`,
        };
      }

      if (constraints.maxOrderQuantity !== null && constraints.maxOrderQuantity !== undefined) {
        const scaledMax = this.toScaledBigInt(constraints.maxOrderQuantity, p);
        if (scaledQty > scaledMax) {
          return {
            isValid: false,
            errorCode: 'QUANTITY_ABOVE_MAXIMUM',
            message: `Quantity '${inputQuantity}' exceeds maximum order quantity of ${constraints.maxOrderQuantity}`,
          };
        }
      }

      const delta = scaledQty - scaledMoq;
      if (delta % scaledStep !== 0n) {
        return {
          isValid: false,
          errorCode: 'QUANTITY_STEP_INVALID',
          message: `Quantity '${inputQuantity}' must equal minOrderQuantity (${constraints.minOrderQuantity}) plus a multiple of stepIncrement (${constraints.stepIncrement})`,
        };
      }

      return { isValid: true };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      if (errorMessage === 'QUANTITY_MUST_BE_INTEGER') {
        return {
          isValid: false,
          errorCode: 'QUANTITY_MUST_BE_INTEGER',
          message: `Quantity '${inputQuantity}' must be an integer for discrete unit '${constraints.unitCode}'`,
        };
      }
      if (errorMessage === 'QUANTITY_PRECISION_EXCEEDED') {
        return {
          isValid: false,
          errorCode: 'QUANTITY_PRECISION_EXCEEDED',
          message: `Quantity '${inputQuantity}' exceeds allowed precision of ${constraints.quantityPrecision} decimal places`,
        };
      }
      return {
        isValid: false,
        errorCode: 'QUANTITY_MALFORMED',
        message:
          'Quantity must be a valid positive decimal string without exponents or leading zeros',
      };
    }
  }
}
