import type { ClientSession } from 'mongoose';
import { UnitModel } from '../../models/unit.model.js';
import { ExactDecimalQuantity } from '@thehomez/shared-types';

export class UnitValidationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'UnitValidationError';
  }
}

export interface IValidateUnitConfigInput {
  unitCode?: string | null;
  quantityPrecision?: number | null;
  minOrderQuantity?: string | null;
  maxOrderQuantity?: string | null;
  stepIncrement?: string | null;
}

export class UnitValidator {
  /**
   * Validates unit code existence, classification, precision limits, and ordering bounds.
   */
  public static async validateConfiguration(
    input: IValidateUnitConfigInput,
    session?: ClientSession,
  ): Promise<void> {
    if (!input.unitCode) {
      return;
    }

    const unit = await UnitModel.findOne({
      code: input.unitCode.trim().toUpperCase(),
      isActive: true,
    }).session(session || null);

    if (!unit) {
      throw new UnitValidationError(
        `Unit with code "${input.unitCode}" does not exist or is inactive`,
        'UNIT_NOT_FOUND',
        400,
      );
    }

    const precision = input.quantityPrecision ?? 0;

    if (unit.isDiscrete && precision > 0) {
      throw new UnitValidationError(
        `Discrete unit "${unit.code}" cannot have decimal precision`,
        'DISCRETE_UNIT_CANNOT_HAVE_DECIMAL_PRECISION',
        400,
      );
    }

    if (precision > unit.allowedMaxPrecision) {
      throw new UnitValidationError(
        `Precision ${precision} exceeds maximum allowed precision of ${unit.allowedMaxPrecision} for unit "${unit.code}"`,
        'PRECISION_EXCEEDS_UNIT_MAXIMUM',
        400,
      );
    }

    if (input.minOrderQuantity !== undefined && input.minOrderQuantity !== null) {
      try {
        const scaledMoq = ExactDecimalQuantity.toScaledBigInt(input.minOrderQuantity, precision);
        if (scaledMoq <= 0n) {
          throw new UnitValidationError(
            'minOrderQuantity must be strictly positive',
            'INVALID_MOQ_CONFIGURATION',
            400,
          );
        }
      } catch (err: unknown) {
        if (err instanceof UnitValidationError) throw err;
        const msg = err instanceof Error ? err.message : '';
        throw new UnitValidationError(
          msg || 'Invalid minOrderQuantity',
          msg || 'QUANTITY_MALFORMED',
          400,
        );
      }
    }

    if (input.stepIncrement !== undefined && input.stepIncrement !== null) {
      try {
        const scaledStep = ExactDecimalQuantity.toScaledBigInt(input.stepIncrement, precision);
        if (scaledStep <= 0n) {
          throw new UnitValidationError(
            'stepIncrement must be strictly positive',
            'INVALID_STEP_CONFIGURATION',
            400,
          );
        }
      } catch (err: unknown) {
        if (err instanceof UnitValidationError) throw err;
        const msg = err instanceof Error ? err.message : '';
        throw new UnitValidationError(
          msg || 'Invalid stepIncrement',
          msg || 'QUANTITY_MALFORMED',
          400,
        );
      }
    }

    if (
      input.maxOrderQuantity !== undefined &&
      input.maxOrderQuantity !== null &&
      input.minOrderQuantity !== undefined &&
      input.minOrderQuantity !== null
    ) {
      try {
        const scaledMoq = ExactDecimalQuantity.toScaledBigInt(input.minOrderQuantity, precision);
        const scaledMax = ExactDecimalQuantity.toScaledBigInt(input.maxOrderQuantity, precision);
        if (scaledMax < scaledMoq) {
          throw new UnitValidationError(
            'maxOrderQuantity must be greater than or equal to minOrderQuantity',
            'VALIDATION_ERROR',
            400,
          );
        }
      } catch (err: unknown) {
        if (err instanceof UnitValidationError) throw err;
        const msg = err instanceof Error ? err.message : '';
        throw new UnitValidationError(
          msg || 'Invalid maxOrderQuantity',
          msg || 'QUANTITY_MALFORMED',
          400,
        );
      }
    }
  }
}
