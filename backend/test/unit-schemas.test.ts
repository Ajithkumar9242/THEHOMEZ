import { describe, it, expect } from 'vitest';
import {
  createUnitSchema,
  unitQuerySchema,
  updateUnitSchema,
  unitCodeParamSchema,
} from '../src/routes/unit.schemas.js';

describe('Unit Schemas & Validation Governance (Unit Tests)', () => {
  describe('unitCodeParamSchema', () => {
    it('accepts valid uppercase canonical unit codes', () => {
      const validCodes = ['KG', 'TONNE', 'SQ_FT', 'CUBIC_METRE', 'BOX_10'];
      for (const code of validCodes) {
        const result = unitCodeParamSchema.safeParse({ code });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid unit codes', () => {
      const invalidCodes = ['a', 'k-g', 'TOOLONGUNITCODENAME123456789', 'SQ FT', 'pc!'];
      for (const code of invalidCodes) {
        const result = unitCodeParamSchema.safeParse({ code });
        expect(result.success).toBe(false);
      }
    });
  });

  describe('unitQuerySchema', () => {
    it('defaults activeOnly to true when not provided', () => {
      const result = unitQuerySchema.parse({});
      expect(result.activeOnly).toBe(true);
    });

    it('parses activeOnly=false when explicitly requested', () => {
      const result = unitQuerySchema.parse({ activeOnly: 'false' });
      expect(result.activeOnly).toBe(false);
    });

    it('parses valid classification and optional search term', () => {
      const result = unitQuerySchema.parse({
        classification: 'MASS',
        activeOnly: 'true',
        search: 'Tonne',
      });
      expect(result.classification).toBe('MASS');
      expect(result.activeOnly).toBe(true);
      expect(result.search).toBe('Tonne');
    });

    it('rejects invalid classifications', () => {
      const result = unitQuerySchema.safeParse({ classification: 'TEMPERATURE' });
      expect(result.success).toBe(false);
    });
  });

  describe('createUnitSchema', () => {
    it('validates a valid continuous unit configuration', () => {
      const input = {
        code: 'sq_mtr',
        name: 'Square Metre',
        symbol: 'm²',
        singularLabel: 'Square Metre',
        pluralLabel: 'Square Metres',
        description: 'Surface and tiling area measurement',
        classification: 'AREA',
        isDiscrete: false,
        allowedMaxPrecision: 2,
        isActive: true,
      };

      const result = createUnitSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.code).toBe('SQ_MTR'); // transformed uppercase
        expect(result.data.allowedMaxPrecision).toBe(2);
      }
    });

    it('validates a valid discrete count unit configuration', () => {
      const input = {
        code: 'PALLET',
        name: 'Pallet',
        symbol: 'plt',
        singularLabel: 'Pallet',
        pluralLabel: 'Pallets',
        classification: 'COUNT',
        isDiscrete: true,
        allowedMaxPrecision: 0,
      };

      const result = createUnitSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.code).toBe('PALLET');
        expect(result.data.isDiscrete).toBe(true);
        expect(result.data.allowedMaxPrecision).toBe(0);
      }
    });

    it('rejects discrete unit with decimal precision > 0', () => {
      const input = {
        code: 'BOX',
        name: 'Box',
        symbol: 'bx',
        singularLabel: 'Box',
        pluralLabel: 'Boxes',
        classification: 'COUNT',
        isDiscrete: true,
        allowedMaxPrecision: 2, // VIOLATION
      };

      const result = createUnitSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects COUNT classification configured as continuous', () => {
      const input = {
        code: 'COUNT_ITEM',
        name: 'Count Item',
        symbol: 'ci',
        singularLabel: 'Item',
        pluralLabel: 'Items',
        classification: 'COUNT',
        isDiscrete: false, // VIOLATION
        allowedMaxPrecision: 0,
      };

      const result = createUnitSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects allowedMaxPrecision greater than 3', () => {
      const input = {
        code: 'MICRO_UNIT',
        name: 'Micro Unit',
        symbol: 'mu',
        singularLabel: 'Micro',
        pluralLabel: 'Micros',
        classification: 'MASS',
        isDiscrete: false,
        allowedMaxPrecision: 4, // VIOLATION (ceiling is 3)
      };

      const result = createUnitSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects negative allowedMaxPrecision', () => {
      const input = {
        code: 'NEG_UNIT',
        name: 'Neg Unit',
        symbol: 'nu',
        singularLabel: 'Neg',
        pluralLabel: 'Negs',
        classification: 'MASS',
        isDiscrete: false,
        allowedMaxPrecision: -1,
      };

      const result = createUnitSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('updateUnitSchema', () => {
    it('accepts partial metadata updates', () => {
      const input = {
        name: 'Updated Name',
        symbol: 'upd',
        allowedMaxPrecision: 1,
        isActive: false,
      };

      const result = updateUnitSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('rejects unknown / client-injected fields due to strict()', () => {
      const input = {
        name: 'Updated Name',
        unknownField: 'malicious',
      };

      const result = updateUnitSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});
