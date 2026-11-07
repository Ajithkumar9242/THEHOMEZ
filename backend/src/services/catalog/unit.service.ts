import { Types } from 'mongoose';
import {
  type IUnit,
  type IUpdateUnitDto,
  type IUnitQueryDto,
  type IUnitConversionRate,
  type IConvertUnitDto,
  type IConvertUnitResult,
  type IValidateQuantityDto,
  type IValidateQuantityResult,
  type IQuantityConstraints,
  ExactDecimalQuantity,
  validateCanonicalDecimalString,
} from '@thehomez/shared-types';
import { UnitModel, type IUnitDocument } from '../../models/unit.model.js';
import { ProductModel } from '../../models/product.model.js';
import { ProductVariantModel } from '../../models/product-variant.model.js';
import { CategoryModel } from '../../models/category.model.js';
import { withTransaction } from '../../database/transaction.js';

export class UnitError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'UnitError';
  }
}

export const UNIVERSAL_CONVERSIONS: IUnitConversionRate[] = [
  {
    fromUnit: 'TONNE',
    toUnit: 'KG',
    factor: 1000,
    precision: 3,
    formula: '1 TONNE = 1000 KG',
  },
  {
    fromUnit: 'KG',
    toUnit: 'TONNE',
    factor: 0.001,
    precision: 3,
    formula: '1 KG = 0.001 TONNE',
  },
];

export class UnitService {
  /**
   * Transforms a Mongoose Unit document into standard IUnit DTO.
   */
  public static toUnitDto(doc: IUnitDocument): IUnit {
    return {
      id: doc._id.toString(),
      code: doc.code,
      name: doc.name,
      symbol: doc.symbol,
      singularLabel: doc.singularLabel,
      pluralLabel: doc.pluralLabel,
      description: doc.description,
      classification: doc.classification,
      isDiscrete: doc.isDiscrete,
      allowedMaxPrecision: doc.allowedMaxPrecision,
      isActive: doc.isActive,
      isSystem: doc.isSystem,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  /**
   * Formats a quantity value with commas and unit symbol.
   */
  private static formatQuantityDisplay(quantity: string, unitSymbol: string): string {
    const parts = quantity.split('.');
    const intPart = (parts[0] ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const decPart = parts[1] ?? '';
    if (decPart.length > 0 && !/^0+$/.test(decPart)) {
      return `${intPart}.${decPart} ${unitSymbol}`;
    }
    return `${intPart} ${unitSymbol}`;
  }

  /**
   * Retrieves all approved construction units with optional classification and active status filter.
   */
  public async listUnits(query?: IUnitQueryDto): Promise<IUnit[]> {
    const filter: Record<string, unknown> = {};

    if (query?.classification) {
      filter.classification = query.classification;
    }

    if (query?.activeOnly !== false) {
      filter.isActive = true;
    }

    const docs = await UnitModel.find(filter).sort({ code: 1 });
    return docs.map(UnitService.toUnitDto);
  }

  /**
   * Retrieves single unit by code.
   */
  public async getUnitByCode(code: string): Promise<IUnit> {
    const normalized = code.trim().toUpperCase();
    const doc = await UnitModel.findOne({ code: normalized });
    if (!doc) {
      throw new UnitError(`Unit with code "${code}" not found`, 'UNIT_NOT_FOUND', 404);
    }
    return UnitService.toUnitDto(doc);
  }

  /**
   * Updates unit metadata (Admin only).
   */
  public async updateUnit(code: string, dto: IUpdateUnitDto): Promise<IUnit> {
    const normalized = code.trim().toUpperCase();
    return await withTransaction(async (session) => {
      // Acquire coordination lock on unit document
      const unit = await UnitModel.findOneAndUpdate(
        { code: normalized },
        { $inc: { version: 1 } },
        { session, new: true },
      );
      if (!unit) {
        throw new UnitError(`Unit with code "${code}" not found`, 'UNIT_NOT_FOUND', 404);
      }

      // Protect immutable fields
      const raw = dto as Record<string, unknown>;
      if (
        (raw.code !== undefined && raw.code !== unit.code) ||
        (raw.classification !== undefined && raw.classification !== unit.classification) ||
        (raw.isDiscrete !== undefined && raw.isDiscrete !== unit.isDiscrete)
      ) {
        throw new UnitError(
          'code, classification, and isDiscrete fields are strictly immutable',
          'CANNOT_MODIFY_IMMUTABLE_UNIT_FIELD',
          400,
        );
      }

      // Controlled precision ceiling
      if (dto.allowedMaxPrecision !== undefined) {
        if (unit.isDiscrete && dto.allowedMaxPrecision !== 0) {
          throw new UnitError(
            `Discrete unit "${unit.code}" cannot have decimal precision`,
            'DISCRETE_UNIT_CANNOT_HAVE_DECIMAL_PRECISION',
            400,
          );
        }
        if (dto.allowedMaxPrecision < 0 || dto.allowedMaxPrecision > 3) {
          throw new UnitError(
            'allowedMaxPrecision must be an integer between 0 and 3',
            'INVALID_UNIT_PRECISION',
            400,
          );
        }

        if (dto.allowedMaxPrecision < unit.allowedMaxPrecision) {
          const inUseFilter = {
            unitCode: unit.code,
            quantityPrecision: { $gt: dto.allowedMaxPrecision },
            $or: [{ status: 'ACTIVE' }, { status: 'INACTIVE', publishedAt: { $ne: null } }],
          };
          const prodInUse = await ProductModel.exists(inUseFilter).session(session);
          const variantInUse = await ProductVariantModel.exists(inUseFilter).session(session);
          if (prodInUse || variantInUse) {
            throw new UnitError(
              'Cannot lower allowedMaxPrecision below precision already in use by products or variants',
              'PRECISION_IN_USE_BY_PRODUCTS',
              400,
            );
          }
        }
        unit.allowedMaxPrecision = dto.allowedMaxPrecision;
      }

      // Deactivation guard
      if (dto.isActive === false && unit.isActive === true) {
        const activeFilter = {
          unitCode: unit.code,
          $or: [{ status: 'ACTIVE' }, { status: 'INACTIVE', publishedAt: { $ne: null } }],
        };
        const activeProducts = await ProductModel.countDocuments(activeFilter).session(session);
        const activeVariants =
          await ProductVariantModel.countDocuments(activeFilter).session(session);
        if (activeProducts > 0 || activeVariants > 0) {
          throw new UnitError(
            'Cannot deactivate unit that is currently in use by active or published products or variants',
            'UNIT_IN_USE_BY_ACTIVE_PRODUCTS',
            400,
          );
        }
        unit.isActive = false;
      } else if (dto.isActive === true) {
        unit.isActive = true;
      }

      if (dto.name !== undefined) unit.name = dto.name.trim();
      if (dto.symbol !== undefined) unit.symbol = dto.symbol.trim();
      if (dto.singularLabel !== undefined) unit.singularLabel = dto.singularLabel.trim();
      if (dto.pluralLabel !== undefined) unit.pluralLabel = dto.pluralLabel.trim();
      if (dto.description !== undefined) unit.description = dto.description.trim();

      await unit.save({ session });
      return UnitService.toUnitDto(unit);
    });
  }

  /**
   * Returns list of approved universal unit conversion rates.
   */
  public getUniversalConversions(): IUnitConversionRate[] {
    return UNIVERSAL_CONVERSIONS;
  }

  /**
   * Converts a quantity between two units using exact decimal scaled arithmetic.
   */
  public async convertQuantity(dto: IConvertUnitDto): Promise<IConvertUnitResult> {
    if (!dto.quantity || typeof dto.quantity !== 'string') {
      throw new UnitError('Quantity must be a non-empty string', 'INVALID_QUANTITY_STRING', 400);
    }
    validateCanonicalDecimalString(dto.quantity);

    const fromCode = dto.fromUnit.trim().toUpperCase();
    const toCode = dto.toUnit.trim().toUpperCase();

    const fromUnit = await UnitModel.findOne({ code: fromCode, isActive: true });
    if (!fromUnit) {
      throw new UnitError(`Source unit "${fromCode}" not found or inactive`, 'UNIT_NOT_FOUND', 404);
    }

    const toUnit = await UnitModel.findOne({ code: toCode, isActive: true });
    if (!toUnit) {
      throw new UnitError(`Target unit "${toCode}" not found or inactive`, 'UNIT_NOT_FOUND', 404);
    }

    // Identity conversion
    if (fromCode === toCode) {
      ExactDecimalQuantity.toScaledBigInt(dto.quantity, toUnit.allowedMaxPrecision);
      return {
        fromUnit: fromCode,
        toUnit: toCode,
        sourceQuantity: dto.quantity,
        convertedQuantity: dto.quantity,
        precision: toUnit.allowedMaxPrecision,
        formatted: UnitService.formatQuantityDisplay(dto.quantity, toUnit.code),
      };
    }

    // Cross-dimensional prohibition
    if (fromUnit.classification !== toUnit.classification) {
      throw new UnitError(
        `Conversion from '${fromCode}' (${fromUnit.classification}) to '${toCode}' (${toUnit.classification}) is prohibited without material density`,
        'INVALID_CROSS_DIMENSIONAL_CONVERSION',
        400,
        {
          fromUnit: fromCode,
          fromClassification: fromUnit.classification,
          toUnit: toCode,
          toClassification: toUnit.classification,
        },
      );
    }

    // Universal fixed conversion logic
    if (fromCode === 'TONNE' && toCode === 'KG') {
      ExactDecimalQuantity.toScaledBigInt(dto.quantity, fromUnit.allowedMaxPrecision);
      const scaledVal = ExactDecimalQuantity.toScaledBigInt(dto.quantity, 3);
      const kgScaled = scaledVal * 1000n;
      const convertedQuantity = ExactDecimalQuantity.fromScaledBigInt(
        kgScaled,
        toUnit.allowedMaxPrecision,
      );
      return {
        fromUnit: fromCode,
        toUnit: toCode,
        sourceQuantity: dto.quantity,
        convertedQuantity,
        precision: toUnit.allowedMaxPrecision,
        formatted: UnitService.formatQuantityDisplay(convertedQuantity, toUnit.code),
      };
    }

    if (fromCode === 'KG' && toCode === 'TONNE') {
      ExactDecimalQuantity.toScaledBigInt(dto.quantity, fromUnit.allowedMaxPrecision);
      const scaledVal = ExactDecimalQuantity.toScaledBigInt(dto.quantity, 3);
      if (scaledVal % 1000n !== 0n) {
        throw new UnitError(
          `Converted quantity exceeds target unit precision limit of ${toUnit.allowedMaxPrecision} without rounding`,
          'CONVERSION_PRECISION_LOSS',
          400,
        );
      }
      const tonneScaled = scaledVal / 1000n;
      const convertedQuantity = ExactDecimalQuantity.fromScaledBigInt(
        tonneScaled,
        toUnit.allowedMaxPrecision,
      );
      return {
        fromUnit: fromCode,
        toUnit: toCode,
        sourceQuantity: dto.quantity,
        convertedQuantity,
        precision: toUnit.allowedMaxPrecision,
        formatted: UnitService.formatQuantityDisplay(convertedQuantity, toUnit.code),
      };
    }

    throw new UnitError(
      `Conversion from '${fromCode}' to '${toCode}' is not supported`,
      'UNSUPPORTED_UNIT_CONVERSION',
      400,
    );
  }

  /**
   * Validates a proposed ordering quantity against product/variant configuration.
   */
  public async validateOrderQuantity(
    dto: IValidateQuantityDto,
    userHasCatalogRead: boolean = false,
  ): Promise<IValidateQuantityResult> {
    if (!dto.productId || !Types.ObjectId.isValid(dto.productId)) {
      throw new UnitError('Valid productId is required', 'VALIDATION_ERROR', 400);
    }

    const product = await ProductModel.findById(dto.productId);
    if (!product) {
      throw new UnitError('Product not found', 'PRODUCT_NOT_FOUND', 404);
    }

    if (!userHasCatalogRead) {
      if (product.status !== 'ACTIVE') {
        throw new UnitError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      }
      const rootCat = await CategoryModel.findById(product.categoryId);
      const subCat = await CategoryModel.findById(product.subcategoryId);
      if (!rootCat || !rootCat.isActive || !subCat || !subCat.isActive) {
        throw new UnitError('Product not found', 'PRODUCT_NOT_FOUND', 404);
      }
    }

    let target: {
      unitCode?: string | null;
      quantityPrecision?: number | null;
      minOrderQuantity?: string | null;
      maxOrderQuantity?: string | null;
      stepIncrement?: string | null;
    };

    if (product.hasVariants) {
      if (!dto.variantId) {
        throw new UnitError(
          'variantId is required for products with variants',
          'VARIANT_REQUIRED',
          400,
        );
      }
      if (!Types.ObjectId.isValid(dto.variantId)) {
        throw new UnitError('Valid variantId is required', 'VALIDATION_ERROR', 400);
      }
      const variant = await ProductVariantModel.findOne({
        _id: new Types.ObjectId(dto.variantId),
        productId: product._id,
      });
      if (!variant) {
        throw new UnitError('Variant not found', 'VARIANT_NOT_FOUND', 404);
      }
      if (!userHasCatalogRead && variant.status !== 'ACTIVE') {
        throw new UnitError('Variant not found', 'VARIANT_NOT_FOUND', 404);
      }
      target = variant;
    } else {
      if (dto.variantId) {
        throw new UnitError(
          'variantId is not permitted for products without variants',
          'VARIANT_NOT_ALLOWED',
          400,
        );
      }
      target = product;
    }

    if (
      !target.unitCode ||
      target.quantityPrecision === undefined ||
      target.quantityPrecision === null ||
      !target.minOrderQuantity ||
      !target.stepIncrement
    ) {
      return {
        isValid: false,
        quantity: dto.quantity,
        errors: [
          {
            code: 'UNCONFIGURED_UNIT',
            message: 'Product does not have complete quantity configuration',
          },
        ],
      };
    }

    const unit = await UnitModel.findOne({ code: target.unitCode });
    const constraints: IQuantityConstraints = {
      unitCode: target.unitCode,
      quantityPrecision: target.quantityPrecision,
      minOrderQuantity: target.minOrderQuantity,
      maxOrderQuantity: target.maxOrderQuantity ?? null,
      stepIncrement: target.stepIncrement,
    };

    const validation = ExactDecimalQuantity.validate(dto.quantity, constraints);
    if (!validation.isValid) {
      return {
        isValid: false,
        quantity: dto.quantity,
        unitCode: target.unitCode,
        singularLabel: unit?.singularLabel,
        pluralLabel: unit?.pluralLabel,
        constraints: {
          minOrderQuantity: target.minOrderQuantity,
          maxOrderQuantity: target.maxOrderQuantity ?? null,
          stepIncrement: target.stepIncrement,
          quantityPrecision: target.quantityPrecision,
        },
        errors: [
          {
            code: validation.errorCode || 'QUANTITY_INVALID',
            message: validation.message || 'Quantity is invalid',
          },
        ],
      };
    }

    return {
      isValid: true,
      quantity: dto.quantity,
      unitCode: target.unitCode,
      singularLabel: unit?.singularLabel,
      pluralLabel: unit?.pluralLabel,
      constraints: {
        minOrderQuantity: target.minOrderQuantity,
        maxOrderQuantity: target.maxOrderQuantity ?? null,
        stepIncrement: target.stepIncrement,
        quantityPrecision: target.quantityPrecision,
      },
    };
  }
}

export const unitService = new UnitService();
