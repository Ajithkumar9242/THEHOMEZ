import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  safeIntegerQuerySchema,
  storefrontPageSchema,
  storefrontLimitSchema,
  storefrontPincodeQuerySchema,
  storefrontSlugSchema,
  storefrontSortSchema,
  storefrontProductQuerySchema,
  storefrontProductSlugParamSchema,
  storefrontProductDetailQuerySchema,
  storefrontSearchQuerySchema,
} from '../src/routes/storefront.schemas.js';

describe('Milestone 4 Step 7: Subtask 7.1B — Storefront Request Validation Schemas & Boundaries', () => {
  const validPincode = '560037';
  const validSlug = 'ultratech-super-cement';

  // =========================================================================
  // 1. Safe Integer Query Parsing (Safe conversion, zero silent coercion)
  // =========================================================================
  describe('1. Safe Integer Query Parsing (safeIntegerQuerySchema)', () => {
    it('accepts safe numeric and string integers', () => {
      expect(safeIntegerQuerySchema.parse(0)).toBe(0);
      expect(safeIntegerQuerySchema.parse('0')).toBe(0);
      expect(safeIntegerQuerySchema.parse(500)).toBe(500);
      expect(safeIntegerQuerySchema.parse('500')).toBe(500);
      expect(safeIntegerQuerySchema.parse('  12000  ')).toBe(12000);
      expect(safeIntegerQuerySchema.parse(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('rejects decimal / floating-point inputs (no silent truncation)', () => {
      expect(() => safeIntegerQuerySchema.parse(1.5)).toThrow(ZodError);
      expect(() => safeIntegerQuerySchema.parse('1.5')).toThrow(ZodError);
      expect(() => safeIntegerQuerySchema.parse('120.00')).toThrow(ZodError);
    });

    it('rejects negative values', () => {
      expect(() => safeIntegerQuerySchema.parse(-1)).toThrow(ZodError);
      expect(() => safeIntegerQuerySchema.parse('-50')).toThrow(ZodError);
    });

    it('rejects scientific notation', () => {
      expect(() => safeIntegerQuerySchema.parse('1e5')).toThrow(ZodError);
      expect(() => safeIntegerQuerySchema.parse('2.5e3')).toThrow(ZodError);
    });

    it('rejects non-numeric strings or invalid formats', () => {
      expect(() => safeIntegerQuerySchema.parse('abc')).toThrow(ZodError);
      expect(() => safeIntegerQuerySchema.parse('')).toThrow(ZodError);
      expect(() => safeIntegerQuerySchema.parse('   ')).toThrow(ZodError);
      expect(() => safeIntegerQuerySchema.parse('12a34')).toThrow(ZodError);
    });

    it('rejects unsafe integers exceeding Number.MAX_SAFE_INTEGER', () => {
      expect(() => safeIntegerQuerySchema.parse('99999999999999999999999999')).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 2. Pagination Bounds (Page & Limit)
  // =========================================================================
  describe('2. Pagination Schemas (storefrontPageSchema & storefrontLimitSchema)', () => {
    it('defaults page to 1 when omitted', () => {
      expect(storefrontPageSchema.parse(undefined)).toBe(1);
    });

    it('accepts valid page >= 1', () => {
      expect(storefrontPageSchema.parse(1)).toBe(1);
      expect(storefrontPageSchema.parse('5')).toBe(5);
      expect(storefrontPageSchema.parse(100)).toBe(100);
    });

    it('rejects page < 1', () => {
      expect(() => storefrontPageSchema.parse(0)).toThrow(ZodError);
      expect(() => storefrontPageSchema.parse('0')).toThrow(ZodError);
      expect(() => storefrontPageSchema.parse(-1)).toThrow(ZodError);
    });

    it('defaults limit to 20 when omitted', () => {
      expect(storefrontLimitSchema.parse(undefined)).toBe(20);
    });

    it('accepts valid limit between 1 and 50 (AC-DISCOV-18)', () => {
      expect(storefrontLimitSchema.parse(1)).toBe(1);
      expect(storefrontLimitSchema.parse('20')).toBe(20);
      expect(storefrontLimitSchema.parse(50)).toBe(50);
      expect(storefrontLimitSchema.parse('50')).toBe(50);
    });

    it('rejects limit < 1 or limit > 50 (AC-DISCOV-18)', () => {
      expect(() => storefrontLimitSchema.parse(0)).toThrow(ZodError);
      expect(() => storefrontLimitSchema.parse('0')).toThrow(ZodError);
      expect(() => storefrontLimitSchema.parse(51)).toThrow(ZodError);
      expect(() => storefrontLimitSchema.parse('100')).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 3. PIN Code & Slug Validation (AC-DISCOV-05)
  // =========================================================================
  describe('3. PIN Code & Slug Schemas (AC-DISCOV-05)', () => {
    it('accepts valid 6-digit Indian postal PIN code', () => {
      expect(storefrontPincodeQuerySchema.parse(validPincode)).toBe(validPincode);
      expect(storefrontPincodeQuerySchema.parse('  560037  ')).toBe('560037');
      expect(storefrontPincodeQuerySchema.parse('110001')).toBe('110001');
    });

    it('rejects invalid PIN formats (AC-DISCOV-05)', () => {
      expect(() => storefrontPincodeQuerySchema.parse('123')).toThrow(ZodError); // < 6 digits
      expect(() => storefrontPincodeQuerySchema.parse('1234567')).toThrow(ZodError); // > 6 digits
      expect(() => storefrontPincodeQuerySchema.parse('012345')).toThrow(ZodError); // starts with 0
      expect(() => storefrontPincodeQuerySchema.parse('56003A')).toThrow(ZodError); // alphanumeric
      expect(() => storefrontPincodeQuerySchema.parse('')).toThrow(ZodError);
    });

    it('accepts valid lowercase hyphenated slugs', () => {
      expect(storefrontSlugSchema.parse(validSlug)).toBe(validSlug);
      expect(storefrontSlugSchema.parse('cement')).toBe('cement');
      expect(storefrontSlugSchema.parse('tata-tiscon-550d-tmt-bars')).toBe(
        'tata-tiscon-550d-tmt-bars',
      );
    });

    it('rejects uppercase, spaces, or illegal punctuation in slugs', () => {
      expect(() => storefrontSlugSchema.parse('UltraTech-Super-Cement')).toThrow(ZodError);
      expect(() => storefrontSlugSchema.parse('cement with spaces')).toThrow(ZodError);
      expect(() => storefrontSlugSchema.parse('cement--double-hyphen')).toThrow(ZodError);
      expect(() => storefrontSlugSchema.parse('cement_underscores')).toThrow(ZodError);
      expect(() => storefrontSlugSchema.parse('')).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 4. Sorting Options
  // =========================================================================
  describe('4. Storefront Sorting Schema (storefrontSortSchema)', () => {
    it('defaults sort to "featured"', () => {
      expect(storefrontSortSchema.parse(undefined)).toBe('featured');
    });

    it('accepts all approved sort options', () => {
      const options = [
        'featured',
        'newest',
        'price_asc',
        'price_desc',
        'title_asc',
        'title_desc',
      ] as const;
      for (const opt of options) {
        expect(storefrontSortSchema.parse(opt)).toBe(opt);
      }
    });

    it('rejects unapproved sort options', () => {
      expect(() => storefrontSortSchema.parse('random')).toThrow(ZodError);
      expect(() => storefrontSortSchema.parse('popularity')).toThrow(ZodError);
      expect(() => storefrontSortSchema.parse('')).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 5. Product Listing Query Schema (storefrontProductQuerySchema)
  // =========================================================================
  describe('5. Product Listing Query Schema (storefrontProductQuerySchema)', () => {
    it('parses empty query with all defaults applied', () => {
      const result = storefrontProductQuerySchema.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.sort).toBe('featured');
      expect(result.includeFacets).toBe(false);
      expect(result.pincode).toBeUndefined();
      expect(result.inStockOnly).toBeUndefined();
    });

    it('parses unlocalized query with category, brand, and sorting filters', () => {
      const query = {
        category: 'cement',
        subcategory: 'ppc-cement',
        brand: 'UltraTech',
        sort: 'price_asc',
        page: '2',
        limit: '30',
      };
      const result = storefrontProductQuerySchema.parse(query);
      expect(result.category).toBe('cement');
      expect(result.subcategory).toBe('ppc-cement');
      expect(result.brand).toBe('UltraTech');
      expect(result.sort).toBe('price_asc');
      expect(result.page).toBe(2);
      expect(result.limit).toBe(30);
    });

    it('parses localized query with pincode and inStockOnly', () => {
      const query = {
        pincode: '560037',
        inStockOnly: 'true',
      };
      const result = storefrontProductQuerySchema.parse(query);
      expect(result.pincode).toBe('560037');
      expect(result.inStockOnly).toBe(true);
    });

    it('rejects inStockOnly=true when pincode is missing', () => {
      expect(() =>
        storefrontProductQuerySchema.parse({
          inStockOnly: 'true',
          // pincode omitted!
        }),
      ).toThrowError(/inStockOnly filter requires a valid pincode/);
    });

    it('allows inStockOnly=false without pincode', () => {
      const result = storefrontProductQuerySchema.parse({
        inStockOnly: 'false',
      });
      expect(result.inStockOnly).toBe(false);
    });

    it('accepts valid price range filters (minPricePaise <= maxPricePaise)', () => {
      const query = {
        minPricePaise: '10000',
        maxPricePaise: '50000',
      };
      const result = storefrontProductQuerySchema.parse(query);
      expect(result.minPricePaise).toBe(10000);
      expect(result.maxPricePaise).toBe(50000);
    });

    it('rejects maxPricePaise < minPricePaise', () => {
      expect(() =>
        storefrontProductQuerySchema.parse({
          minPricePaise: '60000',
          maxPricePaise: '40000',
        }),
      ).toThrowError(/maxPricePaise must be greater than or equal to minPricePaise/);
    });

    it('rejects unrecognized query parameters (.strict() security invariant)', () => {
      expect(() =>
        storefrontProductQuerySchema.parse({
          injectedField: 'malicious',
          partnerId: '672b1234abcd5678ef901234',
        }),
      ).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 6. Product Detail Request Schemas (Slug Param & Query)
  // =========================================================================
  describe('6. Product Detail Schemas (storefrontProductSlugParamSchema & storefrontProductDetailQuerySchema)', () => {
    it('accepts valid product slug path parameter', () => {
      const result = storefrontProductSlugParamSchema.parse({ slug: validSlug });
      expect(result.slug).toBe(validSlug);
    });

    it('rejects invalid product slug path parameter', () => {
      expect(() => storefrontProductSlugParamSchema.parse({ slug: 'INVALID_SLUG' })).toThrow(
        ZodError,
      );
      expect(() => storefrontProductSlugParamSchema.parse({ slug: '' })).toThrow(ZodError);
    });

    it('accepts optional pincode in detail query', () => {
      expect(storefrontProductDetailQuerySchema.parse({})).toEqual({});
      expect(storefrontProductDetailQuerySchema.parse({ pincode: '560037' })).toEqual({
        pincode: '560037',
      });
    });

    it('rejects invalid pincode in detail query', () => {
      expect(() => storefrontProductDetailQuerySchema.parse({ pincode: '123' })).toThrow(ZodError);
    });
  });

  // =========================================================================
  // 7. Storefront Keyword Search Query Schema (storefrontSearchQuerySchema)
  // =========================================================================
  describe('7. Keyword Search Query Schema (storefrontSearchQuerySchema)', () => {
    it('accepts valid search query with keyword "q"', () => {
      const result = storefrontSearchQuerySchema.parse({ q: 'cement' });
      expect(result.q).toBe('cement');
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.sort).toBe('featured');
    });

    it('accepts search query with minimum 2 characters (AC-DISCOV-16)', () => {
      const result = storefrontSearchQuerySchema.parse({ q: 'tmt' });
      expect(result.q).toBe('tmt');
      const min2 = storefrontSearchQuerySchema.parse({ q: 're' });
      expect(min2.q).toBe('re');
    });

    it('rejects search query shorter than 2 characters (AC-DISCOV-16)', () => {
      expect(() => storefrontSearchQuerySchema.parse({ q: 'a' })).toThrowError(
        /Search query must be at least 2 characters/,
      );
      expect(() => storefrontSearchQuerySchema.parse({ q: '' })).toThrow(ZodError);
      expect(() => storefrontSearchQuerySchema.parse({ q: '   ' })).toThrow(ZodError);
    });

    it('rejects search query exceeding 100 characters (AC-DISCOV-16)', () => {
      const longQuery = 'x'.repeat(101);
      expect(() => storefrontSearchQuerySchema.parse({ q: longQuery })).toThrowError(
        /Search query cannot exceed 100 characters/,
      );
    });

    it('rejects missing search query "q"', () => {
      expect(() => storefrontSearchQuerySchema.parse({})).toThrow(ZodError);
    });

    it('enforces inStockOnly requires pincode in search as well', () => {
      expect(() =>
        storefrontSearchQuerySchema.parse({
          q: 'cement',
          inStockOnly: 'true',
        }),
      ).toThrowError(/inStockOnly filter requires a valid pincode/);
    });

    it('enforces maxPricePaise >= minPricePaise in search as well', () => {
      expect(() =>
        storefrontSearchQuerySchema.parse({
          q: 'cement',
          minPricePaise: '50000',
          maxPricePaise: '20000',
        }),
      ).toThrowError(/maxPricePaise must be greater than or equal to minPricePaise/);
    });

    it('rejects unexpected fields in search query', () => {
      expect(() =>
        storefrontSearchQuerySchema.parse({
          q: 'cement',
          injected: 'hack',
        }),
      ).toThrow(ZodError);
    });
  });
});
