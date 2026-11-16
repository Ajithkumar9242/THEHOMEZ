import { UnitModel } from '../models/unit.model.js';
import { logger } from '../logger/logger.js';
import type { UnitClassification } from '@thehomez/shared-types';

export interface IApprovedUnitSeed {
  code: string;
  name: string;
  symbol: string;
  singularLabel: string;
  pluralLabel: string;
  description: string;
  classification: UnitClassification;
  isDiscrete: boolean;
  allowedMaxPrecision: number;
  isActive: boolean;
  isSystem: boolean;
}

export const APPROVED_UNITS: readonly IApprovedUnitSeed[] = [
  {
    code: 'PIECE',
    name: 'Piece',
    symbol: 'pc',
    singularLabel: 'Piece',
    pluralLabel: 'Pieces',
    description: 'Discrete countable items, hardware fixtures, and tools',
    classification: 'COUNT',
    isDiscrete: true,
    allowedMaxPrecision: 0,
    isActive: true,
    isSystem: true,
  },
  {
    code: 'BAG',
    name: 'Bag',
    symbol: 'bag',
    singularLabel: 'Bag',
    pluralLabel: 'Bags',
    description: 'Cement, dry-mix plaster, and wall putty packaging',
    classification: 'COUNT',
    isDiscrete: true,
    allowedMaxPrecision: 0,
    isActive: true,
    isSystem: true,
  },
  {
    code: 'BOX',
    name: 'Box',
    symbol: 'box',
    singularLabel: 'Box',
    pluralLabel: 'Boxes',
    description: 'Cartons of ceramic tiles, fasteners, and lighting fixtures',
    classification: 'COUNT',
    isDiscrete: true,
    allowedMaxPrecision: 0,
    isActive: true,
    isSystem: true,
  },
  {
    code: 'BUNDLE',
    name: 'Bundle',
    symbol: 'bdl',
    singularLabel: 'Bundle',
    pluralLabel: 'Bundles',
    description: 'Standard packaged bundles of cut rebar lengths, PVC pipes, or battens',
    classification: 'COUNT',
    isDiscrete: true,
    allowedMaxPrecision: 0,
    isActive: true,
    isSystem: true,
  },
  {
    code: 'KG',
    name: 'Kilogram',
    symbol: 'kg',
    singularLabel: 'Kilogram',
    pluralLabel: 'Kilograms',
    description: 'Binding wire, fasteners, nails, and packaged small aggregates',
    classification: 'MASS',
    isDiscrete: false,
    allowedMaxPrecision: 3,
    isActive: true,
    isSystem: true,
  },
  {
    code: 'TONNE',
    name: 'Metric Tonne',
    symbol: 't',
    singularLabel: 'Metric Tonne',
    pluralLabel: 'Metric Tonnes',
    description: 'Bulk structural steel, rebar, commercial bulk cement, and heavy freight',
    classification: 'MASS',
    isDiscrete: false,
    allowedMaxPrecision: 3,
    isActive: true,
    isSystem: true,
  },
  {
    code: 'METRE',
    name: 'Metre',
    symbol: 'm',
    singularLabel: 'Metre',
    pluralLabel: 'Metres',
    description: 'Electrical wires, cables, plumbing pipes, and conduit lengths',
    classification: 'LENGTH',
    isDiscrete: false,
    allowedMaxPrecision: 2,
    isActive: true,
    isSystem: true,
  },
  {
    code: 'SQ_FT',
    name: 'Square Foot',
    symbol: 'sq ft',
    singularLabel: 'Square Foot',
    pluralLabel: 'Square Feet',
    description: 'Flooring tiles, granite slabs, marble, and false ceiling panels',
    classification: 'AREA',
    isDiscrete: false,
    allowedMaxPrecision: 2,
    isActive: true,
    isSystem: true,
  },
  {
    code: 'CFT',
    name: 'Cubic Foot',
    symbol: 'cft',
    singularLabel: 'Cubic Foot',
    pluralLabel: 'Cubic Feet',
    description: 'Bulk river sand, coarse aggregates, quarry dust, and gravel',
    classification: 'VOLUME',
    isDiscrete: false,
    allowedMaxPrecision: 2,
    isActive: true,
    isSystem: true,
  },
] as const;

/**
 * Idempotently seeds the 9 approved construction units.
 * Uses bulkWrite with upsert to prevent duplicates or race conditions.
 */
export async function seedApprovedUnits(): Promise<{
  upsertedCount: number;
  modifiedCount: number;
  matchedCount: number;
}> {
  logger.info('Starting idempotent seeding of approved construction units...');

  const operations = APPROVED_UNITS.map((unit) => ({
    updateOne: {
      filter: { code: unit.code },
      update: {
        $setOnInsert: {
          code: unit.code,
          classification: unit.classification,
          isDiscrete: unit.isDiscrete,
          isSystem: true,
        },
        $set: {
          name: unit.name,
          symbol: unit.symbol,
          singularLabel: unit.singularLabel,
          pluralLabel: unit.pluralLabel,
          description: unit.description,
          allowedMaxPrecision: unit.allowedMaxPrecision,
          isActive: unit.isActive,
        },
      },
      upsert: true,
    },
  }));

  const bulkResult = await UnitModel.bulkWrite(operations, { ordered: false });

  logger.info(
    {
      upserted: bulkResult.upsertedCount,
      modified: bulkResult.modifiedCount,
      matched: bulkResult.matchedCount,
    },
    'Approved construction units seed completed successfully',
  );

  return {
    upsertedCount: bulkResult.upsertedCount,
    modifiedCount: bulkResult.modifiedCount,
    matchedCount: bulkResult.matchedCount,
  };
}
