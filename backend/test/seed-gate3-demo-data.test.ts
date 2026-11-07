import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import {
  seedDemoData,
  cleanupDemoData,
  assertSafeEnvironment,
  parseMongoUri,
  APPROVED_LOCAL_HOSTS,
  DEMO_PRODUCTS,
  DEMO_TAG,
  DEMO_SKU_PREFIX,
  DEMO_SLUG_PREFIX,
  DEMO_ADMIN_PHONE,
  DEMO_PARTNER_PHONE,
  DEMO_SERVICE_AREA_CODE,
  DEMO_SERVICEABLE_PIN,
  DEMO_UNSERVICEABLE_PIN,
} from '../src/scripts/seed-gate3-demo-data.js';
import { ProductModel } from '../src/models/product.model.js';
import { ProductVariantModel } from '../src/models/product-variant.model.js';
import { ProductPricingModel } from '../src/models/product-pricing.model.js';
import { SkuRegistryModel } from '../src/models/sku-registry.model.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { PartnerProductModel } from '../src/models/partner-product.model.js';
import { UserModel } from '../src/models/user.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { storefrontDiscoveryService } from '../src/services/catalog/storefront-discovery.service.js';

describe('Milestone 4 Step 7: Gate 3 Demo Dataset Seed & Storefront Verification', () => {
  beforeAll(async () => {
    await connectDatabase();
    // Clean up any lingering demo data before starting suite
    await cleanupDemoData({ confirm: true });
  });

  afterAll(async () => {
    // Clean up demo data after suite completes to keep working tree clean
    await cleanupDemoData({ confirm: true });
    await disconnectDatabase();
  });

  describe('1. Safety Guards and Dry-Run Previews', () => {
    describe('parseMongoUri', () => {
      it('correctly parses local IPv4 connection strings with replicaSet query', () => {
        const parsed = parseMongoUri(
          'mongodb://127.0.0.1:27017/thehomez?replicaSet=rs0&directConnection=true',
        );
        expect(parsed.protocol).toBe('mongodb');
        expect(parsed.hosts).toEqual(['127.0.0.1']);
        expect(parsed.databaseName).toBe('thehomez');
        expect(parsed.sanitizedUri).toBe(
          'mongodb://127.0.0.1:27017/thehomez?replicaSet=rs0&directConnection=true',
        );
      });

      it('correctly parses localhost URI', () => {
        const parsed = parseMongoUri('mongodb://localhost:27017/thehomez');
        expect(parsed.protocol).toBe('mongodb');
        expect(parsed.hosts).toEqual(['localhost']);
        expect(parsed.databaseName).toBe('thehomez');
      });

      it('correctly parses IPv6 connection strings with brackets [::1]', () => {
        const parsed = parseMongoUri('mongodb://[::1]:27017/thehomez');
        expect(parsed.protocol).toBe('mongodb');
        expect(parsed.hosts).toEqual(['::1']);
        expect(parsed.databaseName).toBe('thehomez');
      });

      it('correctly parses IPv6 connection strings without brackets ::1', () => {
        const parsed = parseMongoUri('mongodb://::1:27017/thehomez');
        expect(parsed.protocol).toBe('mongodb');
        expect(parsed.hosts).toEqual(['::1']);
        expect(parsed.databaseName).toBe('thehomez');
      });

      it('correctly parses and sanitizes remote cluster URI stripping credentials', () => {
        const parsed = parseMongoUri(
          'mongodb+srv://admin_user:superSecretPassword@cluster0.demo.mongodb.net/thehomez-demo?retryWrites=true',
        );
        expect(parsed.protocol).toBe('mongodb+srv');
        expect(parsed.hosts).toEqual(['cluster0.demo.mongodb.net']);
        expect(parsed.databaseName).toBe('thehomez-demo');
        expect(parsed.sanitizedUri).toBe(
          'mongodb+srv://cluster0.demo.mongodb.net/thehomez-demo?retryWrites=true',
        );
        expect(parsed.sanitizedUri).not.toContain('admin_user');
        expect(parsed.sanitizedUri).not.toContain('superSecretPassword');
      });
    });

    describe('assertSafeEnvironment', () => {
      it('permits approved local development hosts (localhost, 127.0.0.1, ::1)', () => {
        expect(() => assertSafeEnvironment({}, 'mongodb://localhost:27017/thehomez')).not.toThrow();
        expect(() => assertSafeEnvironment({}, 'mongodb://127.0.0.1:27017/thehomez')).not.toThrow();
        expect(() => assertSafeEnvironment({}, 'mongodb://[::1]:27017/thehomez')).not.toThrow();
        expect(() => assertSafeEnvironment({}, 'mongodb://::1:27017/thehomez')).not.toThrow();
      });

      it('permanently blocks execution when NODE_ENV is set to production regardless of host', () => {
        const originalEnv = process.env.NODE_ENV;
        try {
          process.env.NODE_ENV = 'production';
          expect(() => assertSafeEnvironment({}, 'mongodb://127.0.0.1:27017/thehomez')).toThrow(
            /permanently prohibited in production environments/,
          );
          expect(() =>
            assertSafeEnvironment(
              { allowRemoteDemoDb: true },
              'mongodb://remote-demo-cluster.mongodb.net/thehomez-demo',
            ),
          ).toThrow(/permanently prohibited in production environments/);
        } finally {
          process.env.NODE_ENV = originalEnv;
        }
      });

      it('rejects remote MongoDB hosts by default when NODE_ENV is development or unset', () => {
        const originalEnv = process.env.NODE_ENV;
        try {
          process.env.NODE_ENV = 'development';
          expect(() =>
            assertSafeEnvironment({}, 'mongodb+srv://remote-cluster.mongodb.net/thehomez-demo'),
          ).toThrow(/Remote MongoDB host\(s\) detected/);

          delete process.env.NODE_ENV;
          expect(() =>
            assertSafeEnvironment({}, 'mongodb+srv://remote-cluster.mongodb.net/thehomez-demo'),
          ).toThrow(/Remote MongoDB host\(s\) detected/);
        } finally {
          process.env.NODE_ENV = originalEnv;
        }
      });

      it('permits remote MongoDB host when allowRemoteDemoDb is explicitly true and database name contains "demo"', () => {
        expect(() =>
          assertSafeEnvironment(
            { allowRemoteDemoDb: true },
            'mongodb+srv://remote-cluster.mongodb.net/thehomez-demo',
          ),
        ).not.toThrow();

        expect(() =>
          assertSafeEnvironment(
            { allowRemoteDemoDb: true },
            'mongodb://remote-host:27017/thehomez_demo_staging',
          ),
        ).not.toThrow();
      });

      it('rejects remote MongoDB host even with allowRemoteDemoDb if database name contains "prod" or "production"', () => {
        expect(() =>
          assertSafeEnvironment(
            { allowRemoteDemoDb: true },
            'mongodb+srv://remote-cluster.mongodb.net/thehomez-prod',
          ),
        ).toThrow(/strictly forbids targeting production databases/);

        expect(() =>
          assertSafeEnvironment(
            { allowRemoteDemoDb: true },
            'mongodb+srv://remote-cluster.mongodb.net/production-thehomez-demo',
          ),
        ).toThrow(/strictly forbids targeting production databases/);
      });

      it('rejects remote MongoDB host even with allowRemoteDemoDb if database name does not contain "demo"', () => {
        expect(() =>
          assertSafeEnvironment(
            { allowRemoteDemoDb: true },
            'mongodb+srv://remote-cluster.mongodb.net/thehomez',
          ),
        ).toThrow(/requires an explicit demo database name containing 'demo'/);

        expect(() =>
          assertSafeEnvironment(
            { allowRemoteDemoDb: true },
            'mongodb+srv://remote-cluster.mongodb.net/catalog_staging',
          ),
        ).toThrow(/requires an explicit demo database name containing 'demo'/);
      });
    });

    it('dry-run mode does not write any records to the database', async () => {
      // Record initial collection counts
      const [initialProds, initialVariants, initialPricings, initialPartners] = await Promise.all([
        ProductModel.countDocuments({ slug: new RegExp(`^${DEMO_SLUG_PREFIX}`) }),
        ProductVariantModel.countDocuments({ sku: new RegExp(`^${DEMO_SKU_PREFIX}`) }),
        ProductPricingModel.countDocuments({}),
        PartnerModel.countDocuments({ phone: DEMO_PARTNER_PHONE }),
      ]);

      expect(initialProds).toBe(0);
      expect(initialVariants).toBe(0);
      expect(initialPartners).toBe(0);

      // Execute in dry-run mode (confirm: false)
      const summary = await seedDemoData({ confirm: false, dryRun: true });

      expect(summary.mode).toBe('DRY_RUN');
      expect(summary.productsAffected).toBe(DEMO_PRODUCTS.length);
      expect(summary.variantsAffected).toBe(6); // 4 Tata Tiscon + 2 Supreme CPVC
      expect(summary.details.length).toBeGreaterThan(0);

      // Verify zero records were written
      const [postProds, postVariants, postPricings, postPartners] = await Promise.all([
        ProductModel.countDocuments({ slug: new RegExp(`^${DEMO_SLUG_PREFIX}`) }),
        ProductVariantModel.countDocuments({ sku: new RegExp(`^${DEMO_SKU_PREFIX}`) }),
        ProductPricingModel.countDocuments({}),
        PartnerModel.countDocuments({ phone: DEMO_PARTNER_PHONE }),
      ]);

      expect(postProds).toBe(0);
      expect(postVariants).toBe(0);
      expect(postPricings).toBe(initialPricings);
      expect(postPartners).toBe(0);
    });
  });

  describe('2. Seed Execution & Data Integrity', () => {
    it('seeds the complete demo dataset when confirm=true', async () => {
      const summary = await seedDemoData({ confirm: true, dryRun: false });

      expect(summary.mode).toBe('EXECUTE');
      expect(summary.productsAffected).toBe(5);
      expect(summary.variantsAffected).toBe(6);
      expect(summary.pricingRecordsAffected).toBeGreaterThanOrEqual(10);
      expect(summary.availabilityRecordsAffected).toBeGreaterThanOrEqual(9);
      expect(summary.skuRegistryRecordsAffected).toBeGreaterThanOrEqual(9);

      // Verify Demo Staff User
      const demoUser = await UserModel.findOne({ phone: DEMO_ADMIN_PHONE });
      expect(demoUser).toBeDefined();
      expect(demoUser?.userType).toBe('STAFF');
      expect(demoUser?.roles).toContain('ADMIN');

      // Verify Demo Partner
      const demoPartner = await PartnerModel.findOne({ phone: DEMO_PARTNER_PHONE });
      expect(demoPartner).toBeDefined();
      expect(demoPartner?.status).toBe('ACTIVE');

      // Verify Service Area
      const serviceArea = await ServiceAreaModel.findOne({ code: DEMO_SERVICE_AREA_CODE });
      expect(serviceArea).toBeDefined();
      expect(serviceArea?.pincodes).toContain(DEMO_SERVICEABLE_PIN);

      // Verify Products
      const products = await ProductModel.find({
        slug: { $in: DEMO_PRODUCTS.map((p) => p.slug) },
      });
      expect(products.length).toBe(5);

      // Verify Standalone Product: UltraTech Cement
      const cement = products.find(
        (p) => p.slug === `${DEMO_SLUG_PREFIX}ultratech-super-cement-50kg`,
      );
      expect(cement).toBeDefined();
      expect(cement?.hasVariants).toBe(false);
      expect(cement?.unitCode).toBe('BAG');
      expect(cement?.quantityPrecision).toBe(0);
      expect(cement?.sku).toBe(`${DEMO_SKU_PREFIX}CEM-ULT-50KG`);

      // Verify Multi-Variant Product: Tata Tiscon
      const steel = products.find(
        (p) => p.slug === `${DEMO_SLUG_PREFIX}tata-tiscon-550d-tmt-rebars`,
      );
      expect(steel).toBeDefined();
      expect(steel?.hasVariants).toBe(true);
      expect(steel?.sku).toBeNull();

      const steelVariants = await ProductVariantModel.find({ productId: steel?._id });
      expect(steelVariants.length).toBe(4);
      expect(steelVariants.map((v) => v.sku)).toEqual(
        expect.arrayContaining([
          `${DEMO_SKU_PREFIX}STL-TISCON-8MM`,
          `${DEMO_SKU_PREFIX}STL-TISCON-10MM`,
          `${DEMO_SKU_PREFIX}STL-TISCON-12MM`,
          `${DEMO_SKU_PREFIX}STL-TISCON-16MM`,
        ]),
      );

      // Verify SKU Registry cross-collection indexing
      const skuEntries = await SkuRegistryModel.find({
        sku: new RegExp(`^${DEMO_SKU_PREFIX}`),
      });
      expect(skuEntries.length).toBe(9); // 3 standalone products + 6 variants
      for (const entry of skuEntries) {
        expect(entry.status).toBe('ASSIGNED');
        expect(entry.normalizedSku).toBe(entry.sku.toUpperCase());
      }
    });

    it('is completely idempotent when executed multiple times', async () => {
      // Re-run seed with confirm: true
      const secondSummary = await seedDemoData({ confirm: true, dryRun: false });

      expect(secondSummary.mode).toBe('EXECUTE');
      expect(secondSummary.productsAffected).toBe(0); // None newly created
      expect(secondSummary.variantsAffected).toBe(0);

      // Product and variant counts must remain unchanged
      const productCount = await ProductModel.countDocuments({
        slug: new RegExp(`^${DEMO_SLUG_PREFIX}`),
      });
      const variantCount = await ProductVariantModel.countDocuments({
        sku: new RegExp(`^${DEMO_SKU_PREFIX}`),
      });

      expect(productCount).toBe(5);
      expect(variantCount).toBe(6);
    });
  });

  describe('3. Storefront Integration & Business Rules Verification', () => {
    it('returns all 5 demo products in storefront product list', async () => {
      const response = await storefrontDiscoveryService.listProducts({
        limit: 20,
      });

      expect(response.items.length).toBeGreaterThanOrEqual(5);
      const demoSlugs = response.items.map((item) => item.slug);
      for (const p of DEMO_PRODUCTS) {
        expect(demoSlugs).toContain(p.slug);
      }
    });

    it('demonstrates tri-state localization: unlocalized vs serviceable vs unserviceable PIN', async () => {
      const cementSlug = `${DEMO_SLUG_PREFIX}ultratech-super-cement-50kg`;

      // 1. Unlocalized (no PIN code provided)
      const unlocalized = await storefrontDiscoveryService.getProductBySlug(cementSlug);
      expect(unlocalized.localization.isLocalized).toBe(false);
      expect(unlocalized.product.availability.availabilityUnknown).toBe(true);
      expect(unlocalized.product.availability.isAvailable).toBeNull();
      expect(unlocalized.product.availability.message).toMatch(/Enter delivery PIN code/i);

      // 2. Localized Serviceable (560001 - Bengaluru Central)
      const serviceable = await storefrontDiscoveryService.getProductBySlug(
        cementSlug,
        DEMO_SERVICEABLE_PIN,
      );
      expect(serviceable.localization.isLocalized).toBe(true);
      expect(serviceable.localization.isServiceable).toBe(true);
      expect(serviceable.product.availability.availabilityUnknown).toBe(false);
      expect(serviceable.product.availability.isAvailable).toBe(true);
      expect(serviceable.product.availability.minLeadTimeHours).toBe(12);

      // 3. Localized Unserviceable (570001 - Mysore)
      const unserviceable = await storefrontDiscoveryService.getProductBySlug(
        cementSlug,
        DEMO_UNSERVICEABLE_PIN,
      );
      expect(unserviceable.localization.isLocalized).toBe(true);
      expect(unserviceable.localization.isServiceable).toBe(false);
      expect(unserviceable.product.availability.isAvailable).toBe(false);
      expect(unserviceable.product.availability.message).toMatch(
        /Delivery not available in this area/i,
      );
    });

    it('demonstrates regional price override precedence in Bengaluru Central', async () => {
      const cementSlug = `${DEMO_SLUG_PREFIX}ultratech-super-cement-50kg`;

      // Unlocalized uses Global B2C price (₹390.00 = 39,000 paise)
      const globalView = await storefrontDiscoveryService.getProductBySlug(cementSlug);
      expect(globalView.product.pricing.pricePaise).toBe(39000);
      expect(globalView.product.pricing.isRegionalOverride).toBe(false);

      // Localized with 560001 uses Regional Override price (₹380.00 = 38,000 paise)
      const regionalView = await storefrontDiscoveryService.getProductBySlug(
        cementSlug,
        DEMO_SERVICEABLE_PIN,
      );
      expect(regionalView.product.pricing.pricePaise).toBe(38000);
      expect(regionalView.product.pricing.isRegionalOverride).toBe(true);
      expect(regionalView.product.pricing.mrpPaise).toBe(42000);
      expect(regionalView.product.pricing.savingsPaise).toBe(4000);
    });

    it('demonstrates multi-variant neutral selection and in-stock vs out-of-stock variants', async () => {
      const steelSlug = `${DEMO_SLUG_PREFIX}tata-tiscon-550d-tmt-rebars`;

      const response = await storefrontDiscoveryService.getProductBySlug(
        steelSlug,
        DEMO_SERVICEABLE_PIN,
      );

      expect(response.product.hasVariants).toBe(true);
      expect(response.variants).toBeDefined();
      expect(response.variants!.length).toBe(4);

      // 8mm, 10mm, 12mm are IN STOCK (lead time 24h)
      const var8mm = response.variants!.find((v) => v.sku === `${DEMO_SKU_PREFIX}STL-TISCON-8MM`);
      expect(var8mm?.availability.isAvailable).toBe(true);
      expect(var8mm?.availability.minLeadTimeHours).toBe(24);

      // 16mm is OUT OF STOCK (isAvailable: false)
      const var16mm = response.variants!.find((v) => v.sku === `${DEMO_SKU_PREFIX}STL-TISCON-16MM`);
      expect(var16mm?.availability.isAvailable).toBe(false);
      expect(var16mm?.availability.availablePartnerCount).toBe(0);
    });

    it('demonstrates B2C retail vs B2B wholesale pricing with volume tiers', async () => {
      const cementSlug = `${DEMO_SLUG_PREFIX}ultratech-super-cement-50kg`;

      // 1. Unauthenticated B2C user
      const b2cView = await storefrontDiscoveryService.getProductBySlug(
        cementSlug,
        DEMO_SERVICEABLE_PIN,
      );
      expect(b2cView.product.pricing.customerSegment).toBe('B2C');
      expect(b2cView.product.pricing.hasVolumeTiers).toBe(false);
      expect(b2cView.product.pricing.b2bTiers).toBeUndefined();
      expect(b2cView.product.pricing.pricePaise).toBe(38000); // Regional B2C price

      // 2. Authenticated B2B Contractor
      // Create temporary B2B user
      const b2bUserId = new mongoose.Types.ObjectId();
      await UserModel.create({
        _id: b2bUserId,
        phone: '+919777700001',
        userType: 'CUSTOMER',
        status: 'ACTIVE',
        roles: ['B2B_CUSTOMER'],
      });

      try {
        const b2bView = await storefrontDiscoveryService.getProductBySlug(
          cementSlug,
          DEMO_SERVICEABLE_PIN,
          { userId: b2bUserId.toString(), roles: ['B2B_CUSTOMER'] },
        );

        expect(b2bView.product.pricing.customerSegment).toBe('B2B');
        expect(b2bView.product.pricing.hasVolumeTiers).toBe(true);
        expect(b2bView.product.pricing.pricePaise).toBe(36000); // Regional B2B base price (₹360)
        expect(b2bView.product.pricing.retailBenchmarkPaise).toBe(38000); // B2C benchmark price (₹380)
        expect(b2bView.product.pricing.b2bTiers).toHaveLength(2);
        expect(b2bView.product.pricing.b2bTiers![0]).toEqual({
          minQuantity: '50',
          pricePaise: 35000, // ₹350
        });
        expect(b2bView.product.pricing.b2bTiers![1]).toEqual({
          minQuantity: '200',
          pricePaise: 34000, // ₹340
        });
      } finally {
        await UserModel.deleteOne({ _id: b2bUserId });
      }
    });
  });

  describe('4. Targeted Cleanup Strategy', () => {
    it('rejects cleanup execution when confirm is explicitly false', async () => {
      await expect(cleanupDemoData({ confirm: false })).rejects.toThrow(
        /Demo data cleanup requires explicit confirmation/,
      );
    });

    it('cleanupDemoData removes only demo-tagged records without modifying other data', async () => {
      // Execute cleanup
      const cleanupSummary = await cleanupDemoData({ confirm: true });

      expect(cleanupSummary.mode).toBe('CLEANUP');
      expect(cleanupSummary.productsAffected).toBe(5);
      expect(cleanupSummary.variantsAffected).toBe(6);
      expect(cleanupSummary.partnersAffected).toBe(1);
      expect(cleanupSummary.usersAffected).toBe(1);

      // Verify records are gone
      const remainingProds = await ProductModel.countDocuments({
        slug: new RegExp(`^${DEMO_SLUG_PREFIX}`),
      });
      const remainingVariants = await ProductVariantModel.countDocuments({
        sku: new RegExp(`^${DEMO_SKU_PREFIX}`),
      });
      const remainingSkus = await SkuRegistryModel.countDocuments({
        sku: new RegExp(`^${DEMO_SKU_PREFIX}`),
      });
      const remainingPartner = await PartnerModel.countDocuments({
        phone: DEMO_PARTNER_PHONE,
      });

      expect(remainingProds).toBe(0);
      expect(remainingVariants).toBe(0);
      expect(remainingSkus).toBe(0);
      expect(remainingPartner).toBe(0);
    });

    it('cleanup preserves non-demo inventory, users, and partners (cleanup isolation)', async () => {
      // 1. Seed demo data first
      await seedDemoData({ confirm: true, dryRun: false });

      // 2. Create non-demo user, partner, product, and partner-product
      const nonDemoUserId = new mongoose.Types.ObjectId();
      const nonDemoPartnerId = new mongoose.Types.ObjectId();
      const nonDemoProductId = new mongoose.Types.ObjectId();
      const nonDemoPhone = '+919111199999';
      const nonDemoPartnerPhone = '+919333399999';

      await UserModel.deleteOne({ phone: nonDemoPhone });
      await PartnerModel.deleteOne({ phone: nonDemoPartnerPhone });
      await ProductModel.deleteOne({ slug: 'genuine-construction-cement' });

      await UserModel.create({
        _id: nonDemoUserId,
        phone: nonDemoPhone,
        userType: 'CUSTOMER',
        status: 'ACTIVE',
        metadata: { tag: 'PRODUCTION_SAMPLE' },
      });

      const nonDemoServiceArea = await ServiceAreaModel.findOne({ code: DEMO_SERVICE_AREA_CODE });

      await PartnerModel.create({
        _id: nonDemoPartnerId,
        businessName: 'Genuine Hardware Ltd',
        phone: nonDemoPartnerPhone,
        email: 'genuine@example.com',
        serviceAreaIds: [nonDemoServiceArea!._id],
        status: 'ACTIVE',
        metadata: { tag: 'GENUINE_PARTNER' },
      });

      const rootCat = await CategoryModel.findOne({ slug: 'civil-construction' });
      const subCat = await CategoryModel.findOne({ slug: 'cement' });

      await ProductModel.create({
        _id: nonDemoProductId,
        slug: 'genuine-construction-cement',
        title: 'Genuine Brand Cement',
        brand: 'Genuine Brand',
        categoryId: rootCat!._id,
        subcategoryId: subCat!._id,
        hasVariants: false,
        sku: 'THZ-CEM-GENUINE-001',
        status: 'ACTIVE',
        publishedAt: new Date(),
        publishedBy: nonDemoUserId,
        images: ['https://example.com/cement.jpg'],
        specifications: {},
        createdBy: nonDemoUserId,
        updatedBy: nonDemoUserId,
      });

      await PartnerProductModel.create({
        partnerId: nonDemoPartnerId,
        productId: nonDemoProductId,
        serviceAreaId: nonDemoServiceArea!._id,
        isAvailable: true,
        minLeadTimeHours: 12,
        createdBy: nonDemoUserId,
        updatedBy: nonDemoUserId,
      });

      try {
        // Run demo cleanup
        const cleanupSummary = await cleanupDemoData({ confirm: true });
        expect(cleanupSummary.mode).toBe('CLEANUP');
        expect(cleanupSummary.productsAffected).toBe(5);

        // Verify non-demo records still exist!
        const preservedUser = await UserModel.findById(nonDemoUserId);
        const preservedPartner = await PartnerModel.findById(nonDemoPartnerId);
        const preservedProduct = await ProductModel.findById(nonDemoProductId);
        const preservedPartnerProduct = await PartnerProductModel.findOne({
          partnerId: nonDemoPartnerId,
          productId: nonDemoProductId,
        });

        expect(preservedUser).not.toBeNull();
        expect(preservedPartner).not.toBeNull();
        expect(preservedProduct).not.toBeNull();
        expect(preservedPartnerProduct).not.toBeNull();
      } finally {
        // Clean up test non-demo entities
        await PartnerProductModel.deleteMany({ partnerId: nonDemoPartnerId });
        await ProductModel.deleteOne({ _id: nonDemoProductId });
        await PartnerModel.deleteOne({ _id: nonDemoPartnerId });
        await UserModel.deleteOne({ _id: nonDemoUserId });
      }
    });

    it('prevents natural-key collisions from overwriting existing non-demo records', async () => {
      const rootCat = await CategoryModel.findOne({ slug: 'civil-construction' });
      const subCat = await CategoryModel.findOne({ slug: 'cement' });
      const dummyId = new mongoose.Types.ObjectId();

      // Ensure demo records are cleaned up before testing non-demo collision injection
      await cleanupDemoData({ confirm: true });

      // 1. Create a non-demo user with the demo admin phone number
      await UserModel.deleteOne({ phone: DEMO_ADMIN_PHONE });
      const collidingUser = await UserModel.create({
        phone: DEMO_ADMIN_PHONE,
        userType: 'STAFF',
        status: 'ACTIVE',
        roles: ['ADMIN'],
        metadata: { tag: 'EXISTING_ORG_USER' }, // NOT DEMO_TAG
      });

      try {
        await expect(seedDemoData({ confirm: false, dryRun: true })).rejects.toThrow(
          /Conflict: Existing user found with phone.*Natural-key collision prevented/,
        );
      } finally {
        await UserModel.deleteOne({ _id: collidingUser._id });
      }

      // 2. Create a non-demo partner with the demo partner phone number
      await PartnerModel.deleteOne({ phone: DEMO_PARTNER_PHONE });
      const collidingPartner = await PartnerModel.create({
        businessName: 'Existing Real Business',
        phone: DEMO_PARTNER_PHONE,
        email: 'real@thehomez.com',
        serviceAreaIds: [],
        status: 'ACTIVE',
        metadata: { tag: 'EXISTING_ORG_PARTNER' }, // NOT DEMO_TAG
      });

      try {
        await expect(seedDemoData({ confirm: false, dryRun: true })).rejects.toThrow(
          /Conflict: Existing partner found with phone.*Natural-key collision prevented/,
        );
      } finally {
        await PartnerModel.deleteOne({ _id: collidingPartner._id });
      }

      // 3. Create a non-demo product with an un-prefixed slug or non-demo SKU
      await ProductModel.deleteOne({ slug: DEMO_PRODUCTS[0].slug });
      const collidingProduct = await ProductModel.create({
        slug: DEMO_PRODUCTS[0].slug,
        title: 'Colliding Non-Demo Cement',
        brand: 'Pre-existing Brand',
        categoryId: rootCat!._id,
        subcategoryId: subCat!._id,
        hasVariants: false,
        sku: 'GENUINE-NON-DEMO-SKU', // does not start with DEMO-
        status: 'ACTIVE',
        images: ['https://example.com/cement.jpg'],
        specifications: {},
        createdBy: dummyId,
        updatedBy: dummyId,
      });

      try {
        await expect(seedDemoData({ confirm: false, dryRun: true })).rejects.toThrow(
          /Conflict: Existing non-demo product found.*Natural-key collision prevented/,
        );
      } finally {
        await ProductModel.deleteOne({ _id: collidingProduct._id });
      }
    });
  });
});
