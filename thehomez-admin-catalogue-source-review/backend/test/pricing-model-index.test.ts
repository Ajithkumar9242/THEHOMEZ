import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { ProductPricingModel } from '../src/models/product-pricing.model.js';
import { PriceHistoryModel } from '../src/models/price-history.model.js';
import { ProductModel, type IProductDocument } from '../src/models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../src/models/product-variant.model.js';

describe('Milestone 4 Step 5: Substep 5.2 — Database Models & Partial Unique Indexes', () => {
  let isDbConnected = false;

  const dummyUserId = new Types.ObjectId();
  const dummyCategoryId = new Types.ObjectId();
  const dummySubcategoryId = new Types.ObjectId();
  const dummyServiceAreaId1 = new Types.ObjectId();

  let standaloneProduct: IProductDocument;
  let multiVariantParent: IProductDocument;
  let childVariant: IProductVariantDocument;
  let otherProduct: IProductDocument;
  let otherVariant: IProductVariantDocument;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = true;

      if (isDbConnected) {
        await ProductPricingModel.collection.deleteMany({});
        await PriceHistoryModel.collection.deleteMany({});
        await ProductVariantModel.collection.deleteMany({ sku: { $regex: /^TEST-PRICE-/ } });
        await ProductModel.collection.deleteMany({ slug: { $regex: /^test-price-/ } });

        await ProductPricingModel.syncIndexes();
        await PriceHistoryModel.syncIndexes();

        // 1. Create a standalone product (hasVariants: false)
        standaloneProduct = await ProductModel.create({
          slug: 'test-price-cement-ultra',
          title: 'UltraTech Cement 50kg',
          brand: 'UltraTech',
          categoryId: dummyCategoryId,
          subcategoryId: dummySubcategoryId,
          hasVariants: false,
          sku: 'TEST-PRICE-CEM-01',
          status: 'ACTIVE',
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        });

        // 2. Create a multi-variant parent container (hasVariants: true)
        multiVariantParent = await ProductModel.create({
          slug: 'test-price-tmt-steel',
          title: 'Tata Tiscon 500D TMT Rebar',
          brand: 'Tata Tiscon',
          categoryId: dummyCategoryId,
          subcategoryId: dummySubcategoryId,
          hasVariants: true,
          sku: null,
          status: 'ACTIVE',
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        });

        // 3. Create a child variant belonging to multiVariantParent
        childVariant = await ProductVariantModel.create({
          productId: multiVariantParent._id,
          sku: 'TEST-PRICE-TMT-10MM',
          title: 'Tata Tiscon 10mm Rebar',
          status: 'ACTIVE',
          attributes: { diameter: '10mm' },
        });

        // 4. Create another product and variant to test cross-product ownership
        otherProduct = await ProductModel.create({
          slug: 'test-price-jsw-steel',
          title: 'JSW Neosteel TMT Rebar',
          brand: 'JSW',
          categoryId: dummyCategoryId,
          subcategoryId: dummySubcategoryId,
          hasVariants: true,
          sku: null,
          status: 'ACTIVE',
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        });

        otherVariant = await ProductVariantModel.create({
          productId: otherProduct._id,
          sku: 'TEST-PRICE-JSW-12MM',
          title: 'JSW Neosteel 12mm Rebar',
          status: 'ACTIVE',
          attributes: { diameter: '12mm' },
        });
      }
    } catch (err) {
      console.warn('MongoDB connection unavailable:', err);
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await ProductPricingModel.collection.deleteMany({});
      await PriceHistoryModel.collection.deleteMany({});
      await ProductVariantModel.collection.deleteMany({ sku: { $regex: /^TEST-PRICE-/ } });
      await ProductModel.collection.deleteMany({ slug: { $regex: /^test-price-/ } });
      await disconnectDatabase();
    }
  });

  describe('1. Live MongoDB Index Verification (All 4 Partial Unique Indexes)', () => {
    it('verifies that all four partial unique indexes and history index exist in MongoDB replica set', async () => {
      if (!isDbConnected) return;

      const pricingIndexes = await ProductPricingModel.collection.indexes();
      const indexNames = pricingIndexes.map((idx) => idx.name);

      expect(indexNames).toContain('unique_standalone_global_pricing');
      expect(indexNames).toContain('unique_standalone_regional_pricing');
      expect(indexNames).toContain('unique_variant_global_pricing');
      expect(indexNames).toContain('unique_variant_regional_pricing');

      const standaloneGlobal = pricingIndexes.find(
        (idx) => idx.name === 'unique_standalone_global_pricing',
      );
      expect(standaloneGlobal?.unique).toBe(true);
      expect(standaloneGlobal?.partialFilterExpression).toEqual({
        pricingScope: 'STANDALONE_GLOBAL',
      });
      expect(standaloneGlobal?.key).toEqual({ productId: 1 });

      const standaloneRegional = pricingIndexes.find(
        (idx) => idx.name === 'unique_standalone_regional_pricing',
      );
      expect(standaloneRegional?.unique).toBe(true);
      expect(standaloneRegional?.partialFilterExpression).toEqual({
        pricingScope: 'STANDALONE_REGIONAL',
      });
      expect(standaloneRegional?.key).toEqual({ productId: 1, serviceAreaId: 1 });

      const variantGlobal = pricingIndexes.find(
        (idx) => idx.name === 'unique_variant_global_pricing',
      );
      expect(variantGlobal?.unique).toBe(true);
      expect(variantGlobal?.partialFilterExpression).toEqual({
        pricingScope: 'VARIANT_GLOBAL',
      });
      expect(variantGlobal?.key).toEqual({ variantId: 1 });

      const variantRegional = pricingIndexes.find(
        (idx) => idx.name === 'unique_variant_regional_pricing',
      );
      expect(variantRegional?.unique).toBe(true);
      expect(variantRegional?.partialFilterExpression).toEqual({
        pricingScope: 'VARIANT_REGIONAL',
      });
      expect(variantRegional?.key).toEqual({ variantId: 1, serviceAreaId: 1 });

      const historyIndexes = await PriceHistoryModel.collection.indexes();
      const historyIndexNames = historyIndexes.map((idx) => idx.name);
      expect(historyIndexNames).toContain('idx_price_history_lookup');
    });
  });

  describe('2. Scope-Specific Partial Unique Collision Enforcement (E11000)', () => {
    it('enforces STANDALONE_GLOBAL partial unique index: rejects duplicate global price for same product', async () => {
      if (!isDbConnected) return;

      const pId = standaloneProduct._id;

      await ProductPricingModel.create({
        productId: pId,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      // Duplicate insert for same product under STANDALONE_GLOBAL fails with E11000
      await expect(
        ProductPricingModel.create({
          productId: pId,
          variantId: null,
          serviceAreaId: null,
          pricingScope: 'STANDALONE_GLOBAL',
          currency: 'INR',
          b2cPricePaise: 42000,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(/E11000/);
    });

    it('enforces STANDALONE_REGIONAL: permits different service areas, rejects duplicate in same service area', async () => {
      if (!isDbConnected) return;

      const pId = standaloneProduct._id;
      const sArea1 = new Types.ObjectId();
      const sArea2 = new Types.ObjectId();

      // Regional price for Area 1
      const doc1 = await ProductPricingModel.create({
        productId: pId,
        variantId: null,
        serviceAreaId: sArea1,
        pricingScope: 'STANDALONE_REGIONAL',
        currency: 'INR',
        b2cPricePaise: 39000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });
      expect(doc1._id).toBeDefined();

      // Regional price for Area 2 (different area) succeeds
      const doc2 = await ProductPricingModel.create({
        productId: pId,
        variantId: null,
        serviceAreaId: sArea2,
        pricingScope: 'STANDALONE_REGIONAL',
        currency: 'INR',
        b2cPricePaise: 40000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });
      expect(doc2._id).toBeDefined();

      // Duplicate regional price for Area 1 fails with E11000
      await expect(
        ProductPricingModel.create({
          productId: pId,
          variantId: null,
          serviceAreaId: sArea1,
          pricingScope: 'STANDALONE_REGIONAL',
          currency: 'INR',
          b2cPricePaise: 41000,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(/E11000/);
    });

    it('enforces VARIANT_GLOBAL: rejects duplicate global price for same variant', async () => {
      if (!isDbConnected) return;

      const pId = multiVariantParent._id;
      const vId = childVariant._id;

      await ProductPricingModel.create({
        productId: pId,
        variantId: vId,
        serviceAreaId: null,
        pricingScope: 'VARIANT_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 6250000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(
        ProductPricingModel.create({
          productId: pId,
          variantId: vId,
          serviceAreaId: null,
          pricingScope: 'VARIANT_GLOBAL',
          currency: 'INR',
          b2cPricePaise: 6500000,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(/E11000/);
    });

    it('enforces VARIANT_REGIONAL: rejects duplicate variant price in same service area', async () => {
      if (!isDbConnected) return;

      const pId = multiVariantParent._id;
      const vId = childVariant._id;
      const sArea = new Types.ObjectId();

      await ProductPricingModel.create({
        productId: pId,
        variantId: vId,
        serviceAreaId: sArea,
        pricingScope: 'VARIANT_REGIONAL',
        currency: 'INR',
        b2cPricePaise: 6300000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(
        ProductPricingModel.create({
          productId: pId,
          variantId: vId,
          serviceAreaId: sArea,
          pricingScope: 'VARIANT_REGIONAL',
          currency: 'INR',
          b2cPricePaise: 6400000,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(/E11000/);
    });
  });

  describe('3. Pricing Scope & Variant/Product Identity Consistency (Database-Backed)', () => {
    it('accepts valid variant/product pairing in database', async () => {
      if (!isDbConnected) return;

      const doc = new ProductPricingModel({
        productId: multiVariantParent._id,
        variantId: childVariant._id,
        serviceAreaId: null,
        pricingScope: 'VARIANT_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 6250000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).resolves.toBeUndefined();
    });

    it('rejects variant belonging to a different product with VARIANT_DOES_NOT_BELONG_TO_PRODUCT', async () => {
      if (!isDbConnected) return;

      // Attempt to link otherVariant (belongs to otherProduct) under multiVariantParent
      const doc = new ProductPricingModel({
        productId: multiVariantParent._id,
        variantId: otherVariant._id,
        serviceAreaId: null,
        pricingScope: 'VARIANT_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 6250000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(/VARIANT_DOES_NOT_BELONG_TO_PRODUCT/);
    });

    it('rejects nonexistent variantId with VARIANT_NOT_FOUND', async () => {
      if (!isDbConnected) return;

      const nonExistentVariantId = new Types.ObjectId();

      const doc = new ProductPricingModel({
        productId: multiVariantParent._id,
        variantId: nonExistentVariantId,
        serviceAreaId: null,
        pricingScope: 'VARIANT_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 6250000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(/VARIANT_NOT_FOUND/);
    });

    it('rejects missing variant on variant pricing scope with INVALID_PRICING_SCOPE_FIELDS', async () => {
      const doc = new ProductPricingModel({
        productId: multiVariantParent._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'VARIANT_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 6250000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(/INVALID_PRICING_SCOPE_FIELDS/);
    });

    it('rejects standalone pricing with an unexpected variantId with INVALID_PRICING_SCOPE_FIELDS', async () => {
      const doc = new ProductPricingModel({
        productId: standaloneProduct._id,
        variantId: childVariant._id,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(/INVALID_PRICING_SCOPE_FIELDS/);
    });

    it('rejects assigning standalone pricing directly to multi-variant parent with PARENT_CONTAINER_CANNOT_HAVE_PRICE', async () => {
      if (!isDbConnected) return;

      // multiVariantParent has hasVariants: true
      const doc = new ProductPricingModel({
        productId: multiVariantParent._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(/PARENT_CONTAINER_CANNOT_HAVE_PRICE/);
    });

    it('rejects STANDALONE_GLOBAL with a non-null serviceAreaId', async () => {
      const doc = new ProductPricingModel({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: dummyServiceAreaId1,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(/INVALID_PRICING_SCOPE_FIELDS/);
    });

    it('rejects STANDALONE_REGIONAL without serviceAreaId', async () => {
      const doc = new ProductPricingModel({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_REGIONAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(/INVALID_PRICING_SCOPE_FIELDS/);
    });

    it('rejects VARIANT_REGIONAL with missing variantId or serviceAreaId', async () => {
      const missingArea = new ProductPricingModel({
        productId: multiVariantParent._id,
        variantId: childVariant._id,
        serviceAreaId: null,
        pricingScope: 'VARIANT_REGIONAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(missingArea.validate()).rejects.toThrow(/INVALID_PRICING_SCOPE_FIELDS/);

      const missingVariant = new ProductPricingModel({
        productId: multiVariantParent._id,
        variantId: null,
        serviceAreaId: dummyServiceAreaId1,
        pricingScope: 'VARIANT_REGIONAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(missingVariant.validate()).rejects.toThrow(/INVALID_PRICING_SCOPE_FIELDS/);
    });
  });

  describe('4. Monetary Fields & Tier Validation', () => {
    it('accepts valid integer paise and b2cMrpPaise >= b2cPricePaise', async () => {
      const doc = new ProductPricingModel({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        b2cMrpPaise: 42000,
        b2bPricePaise: 35000,
        b2bTiers: [{ minQuantity: '100', pricePaise: 34000 }],
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).resolves.toBeUndefined();
    });

    it('rejects b2cMrpPaise strictly less than b2cPricePaise', async () => {
      const doc = new ProductPricingModel({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 45000,
        b2cMrpPaise: 42000,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(/cannot be less than b2cPricePaise/);
    });

    it('rejects b2bTiers when b2bPricePaise is omitted', async () => {
      const doc = new ProductPricingModel({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        b2bPricePaise: null,
        b2bTiers: [{ minQuantity: '100', pricePaise: 34000 }],
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(
        /b2bPricePaise is mandatory when b2bTiers are configured/,
      );
    });

    it('rejects more than 10 volume tier slabs in b2bTiers', async () => {
      const elevenTiers = Array.from({ length: 11 }, (_, i) => ({
        minQuantity: String((i + 1) * 10),
        pricePaise: 35000 - i * 100,
      }));

      const doc = new ProductPricingModel({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        b2bPricePaise: 36000,
        b2bTiers: elevenTiers,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(/cannot exceed 10 volume slabs/);
    });

    it('rejects fractional paise in tier pricePaise', async () => {
      const doc = new ProductPricingModel({
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 38000,
        b2bPricePaise: 35000,
        b2bTiers: [{ minQuantity: '100', pricePaise: 34000.5 }],
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      await expect(doc.validate()).rejects.toThrow(/Tier pricePaise must be a safe integer/);
    });
  });

  describe('5. Price History Immutability & changeReason Enforcement', () => {
    it('strictly enforces non-empty changeReason for all actions (CREATED, UPDATED, DEACTIVATED)', async () => {
      // 1. Missing changeReason is rejected
      const missingReason = new PriceHistoryModel({
        pricingId: new Types.ObjectId(),
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        action: 'CREATED',
        newB2cPricePaise: 38000,
        changedBy: dummyUserId,
      });
      await expect(missingReason.validate()).rejects.toThrow(/changeReason is required/);

      // 2. Whitespace-only changeReason is rejected
      const whitespaceReason = new PriceHistoryModel({
        pricingId: new Types.ObjectId(),
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        action: 'UPDATED',
        newB2cPricePaise: 38000,
        changeReason: '     ',
        changedBy: dummyUserId,
      });
      await expect(whitespaceReason.validate()).rejects.toThrow(/changeReason is required/);

      // 3. changeReason exceeding 500 characters is rejected
      const longReason = new PriceHistoryModel({
        pricingId: new Types.ObjectId(),
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        action: 'DEACTIVATED',
        newB2cPricePaise: 38000,
        changeReason: 'A'.repeat(501),
        changedBy: dummyUserId,
      });
      await expect(longReason.validate()).rejects.toThrow(/cannot exceed 500 characters/);

      // 4. Valid non-empty changeReason succeeds for CREATED, UPDATED, and DEACTIVATED
      for (const action of ['CREATED', 'UPDATED', 'DEACTIVATED'] as const) {
        const validRecord = new PriceHistoryModel({
          pricingId: new Types.ObjectId(),
          productId: standaloneProduct._id,
          variantId: null,
          serviceAreaId: null,
          pricingScope: 'STANDALONE_GLOBAL',
          action,
          newB2cPricePaise: 38000,
          changeReason: `Valid justification for ${action}`,
          changedBy: dummyUserId,
        });
        await expect(validRecord.validate()).resolves.toBeUndefined();
      }
    });

    it('creates immutable price history record and blocks all ordinary model update and delete APIs', async () => {
      if (!isDbConnected) return;

      const historyRecord = await PriceHistoryModel.create({
        pricingId: new Types.ObjectId(),
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        action: 'CREATED',
        newB2cPricePaise: 38000,
        changeReason: 'Initial price establishment',
        changedBy: dummyUserId,
      });

      expect(historyRecord._id).toBeDefined();
      expect(historyRecord.action).toBe('CREATED');
      expect(historyRecord.newB2cPricePaise).toBe(38000);
      expect(historyRecord.changeReason).toBe('Initial price establishment');

      // 1. Document-level in-place save() modification is blocked
      historyRecord.newB2cPricePaise = 99999;
      await expect(historyRecord.save()).rejects.toThrow(/PRICE_HISTORY_IMMUTABLE/);

      // 2. Query-level updateOne is blocked
      await expect(
        PriceHistoryModel.updateOne(
          { _id: historyRecord._id },
          { $set: { newB2cPricePaise: 50000 } },
        ),
      ).rejects.toThrow(/PRICE_HISTORY_IMMUTABLE/);

      // 3. Query-level updateMany is blocked
      await expect(
        PriceHistoryModel.updateMany(
          { productId: standaloneProduct._id },
          { $set: { newB2cPricePaise: 50000 } },
        ),
      ).rejects.toThrow(/PRICE_HISTORY_IMMUTABLE/);

      // 4. Query-level findOneAndUpdate is blocked
      await expect(
        PriceHistoryModel.findOneAndUpdate(
          { _id: historyRecord._id },
          { $set: { newB2cPricePaise: 50000 } },
        ),
      ).rejects.toThrow(/PRICE_HISTORY_IMMUTABLE/);

      // 5. Query-level replaceOne is blocked
      await expect(
        PriceHistoryModel.replaceOne(
          { _id: historyRecord._id },
          {
            pricingId: new Types.ObjectId(),
            productId: standaloneProduct._id,
            pricingScope: 'STANDALONE_GLOBAL',
            action: 'UPDATED',
            newB2cPricePaise: 50000,
            changeReason: 'Tamper attempt',
            changedBy: dummyUserId,
          },
        ),
      ).rejects.toThrow(/PRICE_HISTORY_IMMUTABLE/);

      // 6. Query-level deleteOne is blocked
      await expect(PriceHistoryModel.deleteOne({ _id: historyRecord._id })).rejects.toThrow(
        /PRICE_HISTORY_IMMUTABLE/,
      );

      // 7. Query-level deleteMany is blocked
      await expect(
        PriceHistoryModel.deleteMany({ productId: standaloneProduct._id }),
      ).rejects.toThrow(/PRICE_HISTORY_IMMUTABLE/);

      // 8. Query-level findOneAndDelete is blocked
      await expect(PriceHistoryModel.findOneAndDelete({ _id: historyRecord._id })).rejects.toThrow(
        /PRICE_HISTORY_IMMUTABLE/,
      );

      // 9. bulkWrite containing updateOne is blocked
      expect(() =>
        PriceHistoryModel.bulkWrite([
          {
            updateOne: {
              filter: { _id: historyRecord._id },
              update: { $set: { newB2cPricePaise: 99999 } },
            },
          },
        ]),
      ).toThrow(
        /PRICE_HISTORY_IMMUTABLE: Price history records cannot be modified or deleted via bulkWrite/,
      );

      // 10. bulkWrite containing deleteOne is blocked
      expect(() =>
        PriceHistoryModel.bulkWrite([
          {
            deleteOne: {
              filter: { _id: historyRecord._id },
            },
          },
        ]),
      ).toThrow(
        /PRICE_HISTORY_IMMUTABLE: Price history records cannot be modified or deleted via bulkWrite/,
      );

      // 11. bulkWrite containing replaceOne is blocked
      expect(() =>
        PriceHistoryModel.bulkWrite([
          {
            replaceOne: {
              filter: { _id: historyRecord._id },
              replacement: {
                pricingId: new Types.ObjectId(),
                productId: standaloneProduct._id,
                variantId: null,
                serviceAreaId: null,
                pricingScope: 'STANDALONE_GLOBAL',
                action: 'UPDATED',
                newB2cPricePaise: 99999,
                changeReason: 'bulk replace tamper',
                changedBy: dummyUserId,
              },
            },
          },
        ]),
      ).toThrow(
        /PRICE_HISTORY_IMMUTABLE: Price history records cannot be modified or deleted via bulkWrite/,
      );

      // 12. bulkWrite containing insertOne is permitted (append-only)
      const bulkInsertRes = await PriceHistoryModel.bulkWrite([
        {
          insertOne: {
            document: {
              pricingId: new Types.ObjectId(),
              productId: standaloneProduct._id,
              variantId: null,
              serviceAreaId: null,
              pricingScope: 'STANDALONE_GLOBAL',
              action: 'CREATED',
              newB2cPricePaise: 38500,
              changeReason: 'bulk insert permitted',
              changedBy: dummyUserId,
            },
          },
        },
      ]);
      expect(bulkInsertRes.insertedCount).toBe(1);

      // 13. bulkSave with modified existing record is blocked
      historyRecord.newB2cPricePaise = 11111;
      expect(() => PriceHistoryModel.bulkSave([historyRecord])).toThrow(
        /PRICE_HISTORY_IMMUTABLE: Price history records cannot be modified via bulkSave/,
      );

      // 14. bulkSave with new record is permitted (append-only)
      const newHistoryDoc = new PriceHistoryModel({
        pricingId: new Types.ObjectId(),
        productId: standaloneProduct._id,
        variantId: null,
        serviceAreaId: null,
        pricingScope: 'STANDALONE_GLOBAL',
        action: 'CREATED',
        newB2cPricePaise: 39000,
        changeReason: 'bulkSave new doc permitted',
        changedBy: dummyUserId,
      });
      const bulkSaveRes = await PriceHistoryModel.bulkSave([newHistoryDoc]);
      expect(bulkSaveRes.insertedCount).toBe(1);
    });
  });
});
