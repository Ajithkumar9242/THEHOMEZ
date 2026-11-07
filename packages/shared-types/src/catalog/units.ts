/**
 * Standard Units of Measure for Building Materials and Construction Products
 * Confirmed in SRS Section 5.5 (FR-CAT-004) and Section 9.1
 */
export enum UnitOfMeasure {
  PIECE = 'PIECE', // Discrete hardware items, tools, electrical fixtures
  BAG = 'BAG', // Cement, dry-mix plaster, wall putty
  KG = 'KG', // Aggregates, small hardware, binding wire, fasteners
  TONNE = 'TONNE', // Bulk TMT steel bars, structural beams, bulk cement
  METRE = 'METRE', // Wires, cables, conduit pipes, perimeter fencing
  BOX = 'BOX', // Ceramic tiles, screws, lighting fixtures
  BUNDLE = 'BUNDLE', // Cut TMT lengths, PVC pipes, wooden battens
  SQ_FT = 'SQ_FT', // Flooring tiles, granite, false ceiling panels
  CFT = 'CFT', // Coarse sand, quarry dust, river gravel
}

/**
 * Physical Dimension Classification
 */
export type UnitClassification = 'COUNT' | 'MASS' | 'LENGTH' | 'AREA' | 'VOLUME';

/**
 * Unit Master Entity Interface
 */
export interface IUnit {
  id: string;
  code: string;
  name: string;
  symbol: string;
  singularLabel: string;
  pluralLabel: string;
  description?: string;
  classification: UnitClassification;
  isDiscrete: boolean;
  allowedMaxPrecision: number;
  isActive: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * DTO for updating unit master metadata
 */
export interface IUpdateUnitDto {
  name?: string;
  symbol?: string;
  singularLabel?: string;
  pluralLabel?: string;
  description?: string;
  allowedMaxPrecision?: number;
  isActive?: boolean;
}

/**
 * Query parameters for unit discovery
 */
export interface IUnitQueryDto {
  classification?: UnitClassification;
  activeOnly?: boolean;
}

/**
 * Universal Unit Conversion Rate Interface
 */
export interface IUnitConversionRate {
  fromUnit: string;
  toUnit: string;
  factor: number;
  precision: number;
  formula: string;
}

/**
 * DTO for converting a quantity between units
 */
export interface IConvertUnitDto {
  fromUnit: string;
  toUnit: string;
  quantity: string;
}

/**
 * Conversion Result Interface
 */
export interface IConvertUnitResult {
  fromUnit: string;
  toUnit: string;
  sourceQuantity: string;
  convertedQuantity: string;
  precision: number;
  formatted: string;
}

/**
 * DTO for validating a proposed order quantity
 */
export interface IValidateQuantityDto {
  productId: string;
  variantId?: string;
  quantity: string;
}

/**
 * Result of quantity validation against product/variant rules
 */
export interface IValidateQuantityResult {
  isValid: boolean;
  quantity: string;
  unitCode?: string;
  singularLabel?: string;
  pluralLabel?: string;
  constraints?: {
    minOrderQuantity: string;
    maxOrderQuantity?: string | null;
    stepIncrement: string;
    quantityPrecision: number;
  };
  errors?: Array<{
    code: string;
    message: string;
  }>;
}
