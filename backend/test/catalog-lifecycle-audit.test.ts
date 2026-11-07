import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { CategoryModel } from '../src/models/category.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { ProductVariantModel } from '../src/models/product-variant.model.js';
import { ProductPricingModel } from '../src/models/product-pricing.model.js';
import { PriceHistoryModel } from '../src/models/price-history.model.js';
import { SkuRegistryModel } from '../src/models/sku-registry.model.js';
import { UserModel } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { PricingService } from '../src/services/pricing/pricing.service.js';
import { PricingEngineService } from '../src/services/pricing/pricing-engine.service.js';
import { ProductService } from '../src/services/catalog/product.service.js';
import { ProductVariantService } from '../src/services/catalog/product-variant.service.js';
import { seedApprovedUnits } from '../src/seeds/units.seed.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';
import type { Application } from 'express';

describe('Milestone 4 Step 5.7: Independent Verification & Security Audit Suite', () => {
  let app: Application;
  let tokenService: TokenService;
  let pricingService: PricingService;
  let pricingEngineService: PricingEngineService;
  let productService: ProductService;
  let productVariantService: ProductVariantService;
  let isDbConnected = false;

  // Test Principals
  let catalogWriterUser: InstanceType<typeof UserModel>;
  let _catalogWriterToken: string;

  let catalogPublisherUser: InstanceType<typeof UserModel>;
  let catalogPublisherToken: string;

  let readOnlyUser: InstanceType<typeof UserModel>;
  let readOnlyToken: string;

  let b2bCustomerUser: InstanceType<typeof UserModel>;
  let _b2bCustomerToken: string;

  let regularCustomerUser: InstanceType<typeof UserModel>;
  let _regularCustomerToken: string;

  // Test Categories
  let testRootCategory: InstanceType<typeof CategoryModel>;
  let testSubcategory: InstanceType<typeof CategoryModel>;

  // Test Service Area
  let testServiceArea: InstanceType<typeof ServiceAreaModel>;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = true;
    } catch (err) {
      console.warn('MongoDB connection unavailable for audit testing:', err);
    }

    tokenService = new TokenService();
    pricingService = new PricingService();
    pricingEngineService = new PricingEngineService();
    productService = new ProductService();
    productVariantService = new ProductVariantService();
    app = createApp();

    if (isDbConnected) {
      await seedApprovedUnits();
      await cleanDatabase();
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await cleanDatabase();
      await disconnectDatabase();
    }
  });

  async function cleanDatabase() {
    await ProductModel.deleteMany({ slug: { $regex: /^test-audit-/ } });
    await ProductVariantModel.deleteMany({});
    await SkuRegistryModel.deleteMany({ sku: { $regex: /^THZ-/ } });
    await ProductPricingModel.deleteMany({});
    await mongoose.connection.collection('price_history').deleteMany({});
    await CategoryModel.deleteMany({ slug: { $regex: /^test-audit-/ } });
    await UserModel.deleteMany({ phone: { $regex: /^\+919777/ } });
    await RoleModel.deleteMany({ code: { $regex: /^AUDIT_TEST_/ } });
    await ServiceAreaModel.deleteMany({ code: { $regex: /^AUDIT-SA-/ } });
  }

  beforeEach(async () => {
    if (!isDbConnected) return;

    await cleanDatabase();

    // 1. Seed Active Categories
    testRootCategory = await CategoryModel.create({
      slug: 'test-audit-root',
      name: 'Test Audit Root',
      level: 0,
      displayOrder: 1,
      isActive: true,
      version: 0,
    });

    testSubcategory = await CategoryModel.create({
      slug: 'test-audit-sub',
      name: 'Test Audit Subcategory',
      parentId: testRootCategory._id,
      level: 1,
      displayOrder: 1,
      isActive: true,
      version: 0,
    });

    // 2. Seed Service Area
    testServiceArea = await ServiceAreaModel.create({
      name: 'Audit Service Area',
      code: 'AUDIT-SA-01',
      city: 'Bangalore',
      state: 'Karnataka',
      pincodes: ['560066', '560067'],
      isActive: true,
    });

    // 3. Seed Roles & Principals
    await RoleModel.findOneAndUpdate(
      { code: 'AUDIT_TEST_WRITER' },
      {
        code: 'AUDIT_TEST_WRITER',
        name: 'Audit Writer Role',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [
          PermissionCode.CATALOG_READ,
          PermissionCode.CATALOG_WRITE,
          PermissionCode.PRICING_READ,
          PermissionCode.PRICING_WRITE,
        ],
      },
      { upsert: true, new: true },
    );

    await RoleModel.findOneAndUpdate(
      { code: 'AUDIT_TEST_PUBLISHER' },
      {
        code: 'AUDIT_TEST_PUBLISHER',
        name: 'Audit Publisher Role',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [
          PermissionCode.CATALOG_READ,
          PermissionCode.CATALOG_WRITE,
          PermissionCode.CATALOG_PUBLISH,
          PermissionCode.PRICING_READ,
          PermissionCode.PRICING_WRITE,
        ],
      },
      { upsert: true, new: true },
    );

    await RoleModel.findOneAndUpdate(
      { code: 'AUDIT_TEST_READONLY' },
      {
        code: 'AUDIT_TEST_READONLY',
        name: 'Audit ReadOnly Role',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.CATALOG_READ, PermissionCode.PRICING_READ],
      },
      { upsert: true, new: true },
    );

    await RoleModel.findOneAndUpdate(
      { code: 'B2B_CUSTOMER' },
      {
        code: 'B2B_CUSTOMER',
        name: 'B2B Customer Role',
        userType: UserType.CUSTOMER,
        isSystemManaged: true,
        permissions: [PermissionCode.CATALOG_READ],
      },
      { upsert: true, new: true },
    );

    catalogWriterUser = (await UserModel.findOneAndUpdate(
      { phone: '+919777000001' },
      {
        phone: '+919777000001',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['AUDIT_TEST_WRITER'],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;

    catalogPublisherUser = (await UserModel.findOneAndUpdate(
      { phone: '+919777000002' },
      {
        phone: '+919777000002',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['AUDIT_TEST_PUBLISHER'],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;

    readOnlyUser = (await UserModel.findOneAndUpdate(
      { phone: '+919777000003' },
      {
        phone: '+919777000003',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['AUDIT_TEST_READONLY'],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;

    b2bCustomerUser = (await UserModel.findOneAndUpdate(
      { phone: '+919777000004' },
      {
        phone: '+919777000004',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: ['B2B_CUSTOMER'],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;

    regularCustomerUser = (await UserModel.findOneAndUpdate(
      { phone: '+919777000005' },
      {
        phone: '+919777000005',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      },
      { upsert: true, new: true },
    )) as InstanceType<typeof UserModel>;

    _catalogWriterToken = tokenService.signAccessToken(catalogWriterUser);
    catalogPublisherToken = tokenService.signAccessToken(catalogPublisherUser);
    readOnlyToken = tokenService.signAccessToken(readOnlyUser);
    _b2bCustomerToken = tokenService.signAccessToken(b2bCustomerUser);
    _regularCustomerToken = tokenService.signAccessToken(regularCustomerUser);
  });

  async function setProductPricing(
    productId: string,
    dto: {
      b2cPricePaise: number;
      b2bPricePaise?: number;
      b2bTiers?: Array<{ minQuantity: string; pricePaise: number }>;
      changeReason?: string;
    },
    user = catalogPublisherUser,
  ) {
    return await pricingService.setPricing(
      { productId },
      {
        b2cPricePaise: dto.b2cPricePaise,
        b2bPricePaise: dto.b2bPricePaise,
        b2bTiers: dto.b2bTiers,
        changeReason: dto.changeReason || 'Audit test pricing update',
      },
      user._id.toString(),
    );
  }

  async function setVariantPricing(
    productId: string,
    variantId: string,
    dto: {
      b2cPricePaise: number;
      b2bPricePaise?: number;
      b2bTiers?: Array<{ minQuantity: string; pricePaise: number }>;
      changeReason?: string;
    },
    user = catalogPublisherUser,
  ) {
    return await pricingService.setPricing(
      { productId, variantId },
      {
        b2cPricePaise: dto.b2cPricePaise,
        b2bPricePaise: dto.b2bPricePaise,
        b2bTiers: dto.b2bTiers,
        changeReason: dto.changeReason || 'Audit test variant pricing update',
      },
      user._id.toString(),
    );
  }

  async function createStandalone(slug: string) {
    return await productService.createProduct(
      {
        title: `Audit Standalone ${slug}`,
        brand: 'AuditBrand',
        slug,
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: false,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        images: ['https://assets.thehomez.in/sample-standalone.webp'],
      },
      catalogWriterUser._id.toString(),
    );
  }

  async function createParent(slug: string) {
    return await productService.createProduct(
      {
        title: `Audit Parent ${slug}`,
        brand: 'AuditBrand',
        slug,
        categoryId: testRootCategory._id.toString(),
        subcategoryId: testSubcategory._id.toString(),
        hasVariants: true,
        unitCode: 'PIECE',
        quantityPrecision: 0,
        minOrderQuantity: '1',
        stepIncrement: '1',
        images: ['https://assets.thehomez.in/sample-parent.webp'],
      },
      catalogWriterUser._id.toString(),
    );
  }

  // =========================================================================
  // CHECK 1: Parent/Variant Lifecycle State Machine & Ordering
  // =========================================================================
  describe('CHECK 1 — Parent/Variant Lifecycle State Machine', () => {
    it('Executes the exact valid sequence 1-6 with zero circular deadlock', async () => {
      // 1. Create multi-variant parent container (DRAFT)
      const parent = await createParent('test-audit-seq-parent');
      expect(parent.status).toBe('DRAFT');
      expect(parent.hasVariants).toBe(true);

      // Verify container cannot receive standalone pricing directly
      await expect(
        setProductPricing(parent.id, {
          b2cPricePaise: 50000,
          changeReason: 'Should be rejected',
        }),
      ).rejects.toThrow('Standalone pricing cannot be assigned to multi-variant parent products');

      // 2. Create draft variant (DRAFT)
      const variant = await productVariantService.createVariant(
        parent.id,
        {
          title: 'Audit Variant Seq 1',
          attributes: { size: 'Large' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        },
        catalogWriterUser._id.toString(),
      );
      expect(variant.status).toBe('DRAFT');

      // Variant cannot be activated without pricing
      await expect(
        productVariantService.updateVariant(parent.id, variant.id, { status: 'ACTIVE' }, [
          PermissionCode.CATALOG_PUBLISH,
        ]),
      ).rejects.toThrow('Cannot activate variant: an active global B2C pricing record');

      // Parent cannot be published yet (no active priced variants)
      await expect(
        productService.publishProduct(parent.id, catalogPublisherUser._id.toString()),
      ).rejects.toThrow('Cannot publish multi-variant product without at least one active variant');

      // 3. Assign global pricing to variant
      const pricing = await setVariantPricing(parent.id, variant.id, {
        b2cPricePaise: 75000,
        changeReason: 'Initial variant global pricing',
      });
      expect(pricing.isActive).toBe(true);

      // 4. Activate the variant (Zero circular dependency: variant activation does NOT require active parent!)
      const activatedVariant = await productVariantService.updateVariant(
        parent.id,
        variant.id,
        { status: 'ACTIVE' },
        [PermissionCode.CATALOG_PUBLISH],
      );
      expect(activatedVariant.status).toBe('ACTIVE');

      // 5. Publish the parent (Succeeds now that at least one variant is ACTIVE with active global pricing)
      const publishedParent = await productService.publishProduct(
        parent.id,
        catalogPublisherUser._id.toString(),
      );
      expect(publishedParent.status).toBe('ACTIVE');
      expect(publishedParent.publishedAt).not.toBeNull();

      // 6. Making the parent discoverable publicly
      const publicDoc = await productService.getPublicProductBySlug(parent.slug);
      expect(publicDoc.product.id).toBe(parent.id);
      expect(publicDoc.variants).toHaveLength(1);
      expect(publicDoc.variants[0].id).toBe(variant.id);
    });

    it('Standalone product publication remains fully functional', async () => {
      const product = await createStandalone('test-audit-standalone-func');

      // Assign global pricing
      await setProductPricing(product.id, {
        b2cPricePaise: 30000,
        changeReason: 'Initial standalone global pricing',
      });

      // Publish product
      const published = await productService.publishProduct(
        product.id,
        catalogPublisherUser._id.toString(),
      );
      expect(published.status).toBe('ACTIVE');

      // Discoverable publicly
      const publicDoc = await productService.getPublicProductBySlug(product.slug);
      expect(publicDoc.product.id).toBe(product.id);
    });
  });

  // =========================================================================
  // CHECK 2: Live Concurrency against MongoDB replica set rs0
  // =========================================================================
  describe('CHECK 2 — Concurrent Lifecycle & Pricing Mutations against rs0', () => {
    it('Price update vs product archival: no archived entity retains active pricing', async () => {
      const product = await createStandalone('test-audit-conc-prod-price');
      await setProductPricing(product.id, {
        b2cPricePaise: 40000,
        changeReason: 'Initial pricing',
      });

      // Execute concurrent price update and product archival
      const [pricingResult, archiveResult] = await Promise.allSettled([
        setProductPricing(product.id, {
          b2cPricePaise: 45000,
          changeReason: 'Concurrent price update',
        }),
        productService.archiveProduct(product.id, catalogPublisherUser._id.toString()),
      ]);

      // At least one operation completed
      expect(pricingResult.status === 'fulfilled' || archiveResult.status === 'fulfilled').toBe(
        true,
      );

      // Final state invariant: Product must be ARCHIVED and pricing must NOT remain active
      const finalProd = await ProductModel.findById(product.id);
      expect(finalProd?.status).toBe('ARCHIVED');

      const activePricings = await ProductPricingModel.find({
        productId: new Types.ObjectId(product.id),
        isActive: true,
      });
      expect(activePricings).toHaveLength(0);
    }, 60000);

    it('Price update vs variant archival: variant pricing is deactivated without dangling active prices', async () => {
      const parent = await createParent('test-audit-conc-var-price');
      const variant = await productVariantService.createVariant(
        parent.id,
        {
          title: 'Conc Variant',
          attributes: { size: 'Default' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        },
        catalogWriterUser._id.toString(),
      );

      await setVariantPricing(parent.id, variant.id, {
        b2cPricePaise: 60000,
        changeReason: 'Initial variant price',
      });

      // Execute concurrent price update and variant archival
      await Promise.allSettled([
        setVariantPricing(parent.id, variant.id, {
          b2cPricePaise: 65000,
          changeReason: 'Concurrent price update',
        }),
        productVariantService.archiveVariant(
          parent.id,
          variant.id,
          catalogPublisherUser._id.toString(),
        ),
      ]);

      const finalVariant = await ProductVariantModel.findById(variant.id);
      expect(finalVariant?.status).toBe('ARCHIVED');

      const activePricings = await ProductPricingModel.find({
        variantId: new Types.ObjectId(variant.id),
        isActive: true,
      });
      expect(activePricings).toHaveLength(0);
    });

    it('Variant activation vs parent archival: variant does not remain active under archived parent', async () => {
      const parent = await createParent('test-audit-conc-act-arch');
      const variant = await productVariantService.createVariant(
        parent.id,
        {
          title: 'ActArch Variant',
          attributes: { size: 'Default' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        },
        catalogWriterUser._id.toString(),
      );

      await setVariantPricing(parent.id, variant.id, {
        b2cPricePaise: 80000,
        changeReason: 'Variant price',
      });

      // Concurrently attempt variant activation and parent archival
      await Promise.allSettled([
        productVariantService.updateVariant(parent.id, variant.id, { status: 'ACTIVE' }, [
          PermissionCode.CATALOG_PUBLISH,
        ]),
        productService.archiveProduct(parent.id, catalogPublisherUser._id.toString()),
      ]);

      const finalParent = await ProductModel.findById(parent.id);
      expect(finalParent?.status).toBe('ARCHIVED');

      const finalVariant = await ProductVariantModel.findById(variant.id);
      expect(finalVariant?.status).toBe('ARCHIVED');

      const activePricings = await ProductPricingModel.find({
        productId: new Types.ObjectId(parent.id),
        isActive: true,
      });
      expect(activePricings).toHaveLength(0);
    });

    it('Variant update vs parent archival: metadata update cannot reactivate or leave inconsistent variant under archived parent', async () => {
      const parent = await createParent('test-audit-conc-var-upd-arch');
      const variant = await productVariantService.createVariant(
        parent.id,
        {
          title: 'Initial Variant Title',
          attributes: { size: 'Medium', color: 'Steel Grey' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        },
        catalogWriterUser._id.toString(),
      );

      const pricing = await setVariantPricing(parent.id, variant.id, {
        b2cPricePaise: 95000,
        changeReason: 'Initial price for update vs archive concurrency test',
      });

      // Activate variant and publish parent
      await productVariantService.updateVariant(parent.id, variant.id, { status: 'ACTIVE' }, [
        PermissionCode.CATALOG_PUBLISH,
      ]);
      await productService.publishProduct(parent.id, catalogPublisherUser._id.toString());

      // Concurrently execute Operation A (Variant metadata update) and Operation B (Parent archival)
      const [updateResult, archiveResult] = await Promise.allSettled([
        productVariantService.updateVariant(
          parent.id,
          variant.id,
          {
            title: 'Updated Concurrently Variant Title',
            attributes: { size: 'ExtraLarge', color: 'Midnight Blue' },
          },
          [PermissionCode.CATALOG_WRITE],
        ),
        productService.archiveProduct(parent.id, catalogPublisherUser._id.toString()),
      ]);

      // At least one operation completed and archiveResult must be fulfilled
      expect(archiveResult.status).toBe('fulfilled');

      // 1. Parent product is ARCHIVED
      const finalParent = await ProductModel.findById(parent.id);
      expect(finalParent?.status).toBe('ARCHIVED');

      // 2. Variant is ARCHIVED through parent cascade
      const finalVariant = await ProductVariantModel.findById(variant.id);
      expect(finalVariant?.status).toBe('ARCHIVED');

      // 3. Metadata update cannot leave variant active or inconsistent
      // If update won the race, attributes updated before parent cascade set status to ARCHIVED.
      // If archive won the race, update was rejected with HTTP 400 'Cannot modify variant of archived parent product'.
      if (updateResult.status === 'fulfilled') {
        expect(finalVariant?.title).toBe('Updated Concurrently Variant Title');
      } else {
        expect(updateResult.reason.message).toContain(
          'Cannot modify variant of archived parent product',
        );
      }

      // 4 & 5. No active pricing records remain for the archived variant or parent
      const activeVariantPricings = await ProductPricingModel.find({
        variantId: new Types.ObjectId(variant.id),
        isActive: true,
      });
      expect(activeVariantPricings).toHaveLength(0);

      const activeParentPricings = await ProductPricingModel.find({
        productId: new Types.ObjectId(parent.id),
        isActive: true,
      });
      expect(activeParentPricings).toHaveLength(0);

      // 6 & 7. PriceHistory contains exactly one DEACTIVATED entry per actual pricing transition (no duplicates)
      const deactHistory = await PriceHistoryModel.find({
        variantId: new Types.ObjectId(variant.id),
        action: 'DEACTIVATED',
      });
      expect(deactHistory).toHaveLength(1);

      // 8 & 9. No lost version updates (pricing incremented exactly once from version 1 to 2)
      const finalPricing = await ProductPricingModel.findById(pricing.id);
      expect(finalPricing?.isActive).toBe(false);
      expect(finalPricing?.version).toBe(2);
    });

    it('Two simultaneous archival requests: idempotent, no duplicate PriceHistory or lost version', async () => {
      const product = await createStandalone('test-audit-conc-double-arch');
      await setProductPricing(product.id, {
        b2cPricePaise: 55000,
        changeReason: 'Pricing for double archival test',
      });

      // Run two simultaneous archival requests on the same product
      const [res1, res2] = await Promise.all([
        productService.archiveProduct(product.id, catalogPublisherUser._id.toString()),
        productService.archiveProduct(product.id, catalogPublisherUser._id.toString()),
      ]);

      expect(res1.status).toBe('ARCHIVED');
      expect(res2.status).toBe('ARCHIVED');

      // Product is archived
      const finalProd = await ProductModel.findById(product.id);
      expect(finalProd?.status).toBe('ARCHIVED');

      // Pricing is deactivated and has version 2 (incremented exactly once)
      const pricing = await ProductPricingModel.findOne({
        productId: new Types.ObjectId(product.id),
      });
      expect(pricing?.isActive).toBe(false);
      expect(pricing?.version).toBe(2);

      // PriceHistory contains exactly 1 DEACTIVATED record (no duplicate history records)
      const deactHistory = await PriceHistoryModel.find({
        productId: new Types.ObjectId(product.id),
        action: 'DEACTIVATED',
      });
      expect(deactHistory).toHaveLength(1);
    });
  });

  // =========================================================================
  // CHECK 3: Draft Deletion and Historical Retrieval
  // =========================================================================
  describe('CHECK 3 — Draft Deletion & Historical Retrieval', () => {
    it('Deletes ProductPricing records but permanently preserves PriceHistory queryable by productId/variantId', async () => {
      const product = await createStandalone('test-audit-draft-deletion');

      // 1. Initial pricing (creates PriceHistory action = CREATED)
      await setProductPricing(product.id, {
        b2cPricePaise: 25000,
        changeReason: 'First draft price',
      });

      // 2. Update pricing (creates PriceHistory action = UPDATED)
      await setProductPricing(product.id, {
        b2cPricePaise: 28000,
        changeReason: 'Second draft price update',
      });

      // 3. Delete draft product
      await productService.deleteDraftProduct(product.id, catalogWriterUser._id.toString());

      // Product is deleted
      const prodCheck = await ProductModel.findById(product.id);
      expect(prodCheck).toBeNull();

      // ProductPricing documents are deleted
      const pricingDocs = await ProductPricingModel.find({
        productId: new Types.ObjectId(product.id),
      });
      expect(pricingDocs).toHaveLength(0);

      // PriceHistory documents are permanently preserved
      const historyDocs = await PriceHistoryModel.find({
        productId: new Types.ObjectId(product.id),
      }).sort({ createdAt: 1 });

      expect(historyDocs).toHaveLength(2);
      expect(historyDocs[0].action).toBe('CREATED');
      expect(historyDocs[0].newB2cPricePaise).toBe(25000);
      expect(historyDocs[1].action).toBe('UPDATED');
      expect(historyDocs[1].newB2cPricePaise).toBe(28000);

      // Immutability: Attempting update or delete on PriceHistory throws error
      await expect(
        PriceHistoryModel.updateOne(
          { _id: historyDocs[0]._id },
          { $set: { changeReason: 'tampered' } },
        ),
      ).rejects.toThrow('PRICE_HISTORY_IMMUTABLE');

      await expect(PriceHistoryModel.deleteOne({ _id: historyDocs[0]._id })).rejects.toThrow(
        'PRICE_HISTORY_IMMUTABLE',
      );
    });
  });

  // =========================================================================
  // CHECK 4: Unit Mutation & Regional Pricing Tier Invariants
  // =========================================================================
  describe('CHECK 4 — Unit Mutation & Pricing Tier Invariants', () => {
    it('Validates unit mutation on standalone product against STANDALONE_REGIONAL B2B volume tiers', async () => {
      const product = await createStandalone('test-audit-unit-reg-prod');

      // Seed global pricing without tiers
      await ProductPricingModel.create({
        productId: new Types.ObjectId(product.id),
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 10000,
        isActive: true,
        version: 1,
        createdBy: catalogPublisherUser._id,
        updatedBy: catalogPublisherUser._id,
      });

      // Seed STANDALONE_REGIONAL pricing with B2B tiers: minQuantity = '10' (valid for step '1')
      await ProductPricingModel.create({
        productId: new Types.ObjectId(product.id),
        serviceAreaId: testServiceArea._id,
        pricingScope: 'STANDALONE_REGIONAL',
        currency: 'INR',
        b2cPricePaise: 11000,
        b2bPricePaise: 9500,
        b2bTiers: [{ minQuantity: '10', pricePaise: 9000 }],
        isActive: true,
        version: 1,
        createdBy: catalogPublisherUser._id,
        updatedBy: catalogPublisherUser._id,
      });

      // Attempt unit mutation with stepIncrement: '4' (1, 5, 9, 13 -> violates minQuantity '10')
      await expect(
        productService.updateProduct(
          product.id,
          { stepIncrement: '4' },
          catalogWriterUser._id.toString(),
        ),
      ).rejects.toThrow('incompatible with updated unit configuration');

      // Compatible mutation (stepIncrement: '3' -> 1, 4, 7, 10 -> matches '10') succeeds
      const updated = await productService.updateProduct(
        product.id,
        { stepIncrement: '3' },
        catalogWriterUser._id.toString(),
      );
      expect(updated.stepIncrement).toBe('3');

      // Verify regional pricing tiers were not modified or deleted
      const regPricing = await ProductPricingModel.findOne({
        productId: new Types.ObjectId(product.id),
        pricingScope: 'STANDALONE_REGIONAL',
      });
      expect(regPricing?.b2bTiers).toHaveLength(1);
      expect(regPricing?.b2bTiers[0].minQuantity).toBe('10');
    });

    it('Validates unit mutation on variant against VARIANT_REGIONAL B2B volume tiers', async () => {
      const parent = await createParent('test-audit-unit-reg-var');
      const variant = await productVariantService.createVariant(
        parent.id,
        {
          title: 'Reg Tier Variant',
          attributes: { size: 'Default' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        },
        catalogWriterUser._id.toString(),
      );

      // Seed VARIANT_REGIONAL pricing with tier minQuantity = '10'
      await ProductPricingModel.create({
        productId: new Types.ObjectId(parent.id),
        variantId: new Types.ObjectId(variant.id),
        serviceAreaId: testServiceArea._id,
        pricingScope: 'VARIANT_REGIONAL',
        currency: 'INR',
        b2cPricePaise: 15000,
        b2bPricePaise: 13000,
        b2bTiers: [{ minQuantity: '10', pricePaise: 12000 }],
        isActive: true,
        version: 1,
        createdBy: catalogPublisherUser._id,
        updatedBy: catalogPublisherUser._id,
      });

      // Attempt variant unit mutation with stepIncrement: '4'
      await expect(
        productVariantService.updateVariant(parent.id, variant.id, { stepIncrement: '4' }, [
          PermissionCode.CATALOG_WRITE,
        ]),
      ).rejects.toThrow('incompatible with updated unit configuration');

      // Compatible mutation (stepIncrement: '3')
      const updated = await productVariantService.updateVariant(
        parent.id,
        variant.id,
        { stepIncrement: '3' },
        [PermissionCode.CATALOG_WRITE],
      );
      expect(updated.stepIncrement).toBe('3');
    });
  });

  // =========================================================================
  // CHECK 5: Pricing Uniqueness and Database Indexes
  // =========================================================================
  describe('CHECK 5 — Pricing Uniqueness & Database Indexes', () => {
    it('Verifies authoritative unique and query indexes on live collections', async () => {
      // 1. product_pricings indexes
      await ProductPricingModel.syncIndexes();
      const pricingIndexes = await ProductPricingModel.collection.indexes();
      const pricingIndexNames = pricingIndexes.map((idx) => idx.name);

      expect(pricingIndexNames).toContain('unique_standalone_global_pricing');
      expect(pricingIndexNames).toContain('unique_standalone_regional_pricing');
      expect(pricingIndexNames).toContain('unique_variant_global_pricing');
      expect(pricingIndexNames).toContain('unique_variant_regional_pricing');
      expect(pricingIndexNames).toContain('idx_pricing_scope_active');

      // 2. price_history indexes
      await PriceHistoryModel.syncIndexes();
      const historyIndexes = await PriceHistoryModel.collection.indexes();
      const historyIndexNames = historyIndexes.map((idx) => idx.name);
      expect(historyIndexNames).toContain('idx_price_history_lookup');

      // 3. products indexes
      await ProductModel.syncIndexes();
      const productIndexes = await ProductModel.collection.indexes();
      const productIndexNames = productIndexes.map((idx) => idx.name);
      expect(productIndexNames).toContain('unique_product_slug_ci');

      // 4. product_variants indexes
      await ProductVariantModel.syncIndexes();
      const variantIndexes = await ProductVariantModel.collection.indexes();
      const variantIndexNames = variantIndexes.map((idx) => idx.name);
      expect(variantIndexNames).toContain('productId_1_status_1');

      // 5. sku_registry indexes
      await SkuRegistryModel.syncIndexes();
      const skuIndexes = await SkuRegistryModel.collection.indexes();
      const skuIndexNames = skuIndexes.map((idx) => idx.name);
      expect(skuIndexNames).toContain('unique_normalized_sku');
      expect(skuIndexNames).toContain('unique_entity_ownership');
    });

    it('Database enforces uniqueness: duplicate active scope causes E11000 duplicate key error', async () => {
      const product = await createStandalone('test-audit-unique-e11000');

      // First active global pricing doc
      await ProductPricingModel.create({
        productId: new Types.ObjectId(product.id),
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 20000,
        isActive: true,
        version: 1,
        createdBy: catalogPublisherUser._id,
        updatedBy: catalogPublisherUser._id,
      });

      // Second active global pricing doc for the same product must violate unique index
      let duplicateError: unknown = null;
      try {
        await ProductPricingModel.create({
          productId: new Types.ObjectId(product.id),
          pricingScope: 'STANDALONE_GLOBAL',
          currency: 'INR',
          b2cPricePaise: 22000,
          isActive: true,
          version: 1,
          createdBy: catalogPublisherUser._id,
          updatedBy: catalogPublisherUser._id,
        });
      } catch (err) {
        duplicateError = err;
      }

      expect(duplicateError).not.toBeNull();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((duplicateError as any).code).toBe(11000);
    });
  });

  // =========================================================================
  // CHECK 6: Authorization and Tenant Isolation
  // =========================================================================
  describe('CHECK 6 — Authorization & Tenant Isolation', () => {
    it('Requires CATALOG_PUBLISH permission to publish products', async () => {
      const product = await createStandalone('test-audit-auth-publish');
      await setProductPricing(product.id, {
        b2cPricePaise: 30000,
        changeReason: 'Price',
      });

      // Attempt publish with read-only token -> 403 Forbidden
      const res = await request(app)
        .post(`/api/v1/products/${product.id}/publish`)
        .set('Authorization', `Bearer ${readOnlyToken}`);

      expect(res.status).toBe(403);
    });

    it('Requires CATALOG_WRITE permission to archive products', async () => {
      const product = await createStandalone('test-audit-auth-archive');

      // Attempt archive with read-only token -> 403 Forbidden
      const res = await request(app)
        .post(`/api/v1/products/${product.id}/archive`)
        .set('Authorization', `Bearer ${readOnlyToken}`);

      expect(res.status).toBe(403);
    });

    it('PriceHistory actor attribution strictly derives from authenticated token, ignoring payload spoofing', async () => {
      const product = await createStandalone('test-audit-auth-spoof');

      // 1. Injected fields (changedBy, updatedBy) are rejected by strict request validation
      const spoofId = new Types.ObjectId().toString();
      const spoofRes = await request(app)
        .put(`/api/v1/products/${product.id}/pricing`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`)
        .send({
          b2cPricePaise: 50000,
          changeReason: 'Valid reason',
          changedBy: spoofId,
          updatedBy: spoofId,
        });

      expect(spoofRes.status).toBe(400); // Strict schema rejects unknown fields!

      // 2. Legitimate pricing request derives changedBy/updatedBy strictly from token
      const validRes = await request(app)
        .put(`/api/v1/products/${product.id}/pricing`)
        .set('Authorization', `Bearer ${catalogPublisherToken}`)
        .send({
          b2cPricePaise: 50000,
          changeReason: 'Valid legitimate reason',
        });

      expect(validRes.status).toBe(200);

      // Inspect persisted pricing and history
      const pricing = await ProductPricingModel.findOne({
        productId: new Types.ObjectId(product.id),
      });
      expect(pricing?.updatedBy.toString()).toBe(catalogPublisherUser._id.toString());
      expect(pricing?.updatedBy.toString()).not.toBe(spoofId);

      const history = await PriceHistoryModel.findOne({
        productId: new Types.ObjectId(product.id),
      });
      expect(history?.changedBy.toString()).toBe(catalogPublisherUser._id.toString());
      expect(history?.changedBy.toString()).not.toBe(spoofId);
    });
  });

  // =========================================================================
  // CHECK 7: Storefront and Pricing Calculation Consistency Matrix
  // =========================================================================
  describe('CHECK 7 — Storefront & Pricing Calculation Consistency Matrix', () => {
    it('1. Unpriced standalone: omitted from listing, 404 on slug, 404 in calculation', async () => {
      const p = await createStandalone('test-audit-matrix-unpriced');
      // Force ACTIVE to test discovery guard
      await ProductModel.updateOne(
        { _id: p.id },
        { $set: { status: 'ACTIVE', publishedAt: new Date() } },
      );

      const listRes = await request(app).get('/api/v1/products/public');
      const slugs = listRes.body.data.items.map((i: { slug: string }) => i.slug);
      expect(slugs).not.toContain(p.slug);

      const slugRes = await request(app).get(`/api/v1/products/public/${p.slug}`);
      expect(slugRes.status).toBe(404);

      await expect(
        pricingEngineService.calculateEffectivePrice({
          productId: p.id,
          quantity: '1',
        }),
      ).rejects.toThrow();
    });

    it('2. Regional-only standalone: omitted from global listing, 404 on slug without regional coverage', async () => {
      const p = await createStandalone('test-audit-matrix-reg-only');
      await ProductModel.updateOne(
        { _id: p.id },
        { $set: { status: 'ACTIVE', publishedAt: new Date() } },
      );

      await ProductPricingModel.create({
        productId: new Types.ObjectId(p.id),
        serviceAreaId: testServiceArea._id,
        pricingScope: 'STANDALONE_REGIONAL',
        currency: 'INR',
        b2cPricePaise: 42000,
        isActive: true,
        version: 1,
        createdBy: catalogPublisherUser._id,
        updatedBy: catalogPublisherUser._id,
      });

      const slugRes = await request(app).get(`/api/v1/products/public/${p.slug}`);
      expect(slugRes.status).toBe(404);

      // Calculation without delivery PIN code fails because no global pricing exists
      await expect(
        pricingEngineService.calculateEffectivePrice({
          productId: p.id,
          quantity: '1',
        }),
      ).rejects.toThrow();
    });

    it('3. Inactive standalone: 404 on slug, not available in calculation', async () => {
      const p = await createStandalone('test-audit-matrix-inactive');
      await ProductPricingModel.create({
        productId: new Types.ObjectId(p.id),
        pricingScope: 'STANDALONE_GLOBAL',
        currency: 'INR',
        b2cPricePaise: 35000,
        isActive: true,
        version: 1,
        createdBy: catalogPublisherUser._id,
        updatedBy: catalogPublisherUser._id,
      });

      // Product is DRAFT (inactive)
      const slugRes = await request(app).get(`/api/v1/products/public/${p.slug}`);
      expect(slugRes.status).toBe(404);

      await expect(
        pricingEngineService.calculateEffectivePrice({
          productId: p.id,
          quantity: '1',
        }),
      ).rejects.toThrow('Product is not available');
    });

    it('4. Archived standalone: 404 on slug, not available in calculation', async () => {
      const p = await createStandalone('test-audit-matrix-archived');
      await ProductModel.updateOne({ _id: p.id }, { $set: { status: 'ARCHIVED' } });

      const slugRes = await request(app).get(`/api/v1/products/public/${p.slug}`);
      expect(slugRes.status).toBe(404);

      await expect(
        pricingEngineService.calculateEffectivePrice({
          productId: p.id,
          quantity: '1',
        }),
      ).rejects.toThrow('Product is not available');
    });

    it('5. Multi-variant parent with 0 active priced variants: 404 on slug', async () => {
      const parent = await createParent('test-audit-matrix-parent-zero');
      await ProductModel.updateOne(
        { _id: parent.id },
        { $set: { status: 'ACTIVE', publishedAt: new Date() } },
      );

      const slugRes = await request(app).get(`/api/v1/products/public/${parent.slug}`);
      expect(slugRes.status).toBe(404);
    });

    it('6. Multi-variant parent with 1 active priced variant: discoverable, active variant sellable', async () => {
      const parent = await createParent('test-audit-matrix-parent-one');
      const variant = await productVariantService.createVariant(
        parent.id,
        {
          title: 'Active Variant One',
          attributes: { size: 'One' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        },
        catalogWriterUser._id.toString(),
      );

      await setVariantPricing(parent.id, variant.id, {
        b2cPricePaise: 48000,
        changeReason: 'Pricing for matrix check 6',
      });

      await productVariantService.updateVariant(parent.id, variant.id, { status: 'ACTIVE' }, [
        PermissionCode.CATALOG_PUBLISH,
      ]);

      await productService.publishProduct(parent.id, catalogPublisherUser._id.toString());

      // Discoverable
      const slugRes = await request(app).get(`/api/v1/products/public/${parent.slug}`);
      expect(slugRes.status).toBe(200);

      // Sellable via calculation
      const calcRes = await pricingEngineService.calculateEffectivePrice({
        productId: parent.id,
        variantId: variant.id,
        quantity: '1',
      });
      expect(calcRes.unitPricePaise).toBe(48000);
      expect(calcRes.subtotalPaise).toBe(48000);
    });

    it('7. Inactive variant with active pricing: variant calculation returns 404', async () => {
      const parent = await createParent('test-audit-matrix-inact-var');
      const variant = await productVariantService.createVariant(
        parent.id,
        {
          title: 'Draft Variant',
          attributes: { size: 'Draft' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        },
        catalogWriterUser._id.toString(),
      );

      await setVariantPricing(parent.id, variant.id, {
        b2cPricePaise: 50000,
        changeReason: 'Draft variant price',
      });

      // Parent is published, but variant remains DRAFT
      await ProductModel.updateOne(
        { _id: parent.id },
        { $set: { status: 'ACTIVE', publishedAt: new Date() } },
      );

      await expect(
        pricingEngineService.calculateEffectivePrice({
          productId: parent.id,
          variantId: variant.id,
          quantity: '1',
        }),
      ).rejects.toThrow('Product variant is not available');
    });

    it('8. Archived variant with historical pricing: calculation returns 404', async () => {
      const parent = await createParent('test-audit-matrix-arch-var');
      const variant = await productVariantService.createVariant(
        parent.id,
        {
          title: 'Archived Variant',
          attributes: { size: 'Arch' },
          unitCode: 'PIECE',
          quantityPrecision: 0,
          minOrderQuantity: '1',
          stepIncrement: '1',
        },
        catalogWriterUser._id.toString(),
      );

      // Parent is ACTIVE, but variant is ARCHIVED
      await ProductModel.updateOne(
        { _id: parent.id },
        { $set: { status: 'ACTIVE', publishedAt: new Date() } },
      );
      await ProductVariantModel.updateOne({ _id: variant.id }, { $set: { status: 'ARCHIVED' } });

      await expect(
        pricingEngineService.calculateEffectivePrice({
          productId: parent.id,
          variantId: variant.id,
          quantity: '1',
        }),
      ).rejects.toThrow('Product variant is not available');
    });

    it('9. Verified B2B customer receives wholesale volume tier rate', async () => {
      const product = await createStandalone('test-audit-matrix-b2b');
      await setProductPricing(product.id, {
        b2cPricePaise: 10000,
        b2bPricePaise: 9000,
        b2bTiers: [{ minQuantity: '10', pricePaise: 8000 }],
        changeReason: 'B2B pricing matrix check',
      });

      await productService.publishProduct(product.id, catalogPublisherUser._id.toString());

      // Verified B2B calculation for quantity = 10
      const b2bCalc = await pricingEngineService.calculateEffectivePrice(
        {
          productId: product.id,
          quantity: '10',
        },
        b2bCustomerUser,
      );

      expect(b2bCalc.customerSegment).toBe('B2B');
      expect(b2bCalc.unitPricePaise).toBe(8000);
      expect(b2bCalc.tierMinQuantity).toBe('10');
      expect(b2bCalc.pricingTierApplied).toBe('TIER_1');
      expect(b2bCalc.subtotalPaise).toBe(80000);
    });

    it('10. Unverified B2B customer receives standard retail B2C rate', async () => {
      const product = await createStandalone('test-audit-matrix-b2c-fall');
      await setProductPricing(product.id, {
        b2cPricePaise: 10000,
        b2bPricePaise: 9000,
        b2bTiers: [{ minQuantity: '10', pricePaise: 8000 }],
        changeReason: 'B2B pricing matrix check 10',
      });

      await productService.publishProduct(product.id, catalogPublisherUser._id.toString());

      // Regular customer calculation for quantity = 10
      const b2cCalc = await pricingEngineService.calculateEffectivePrice(
        {
          productId: product.id,
          quantity: '10',
        },
        regularCustomerUser,
      );

      expect(b2cCalc.customerSegment).toBe('B2C');
      expect(b2cCalc.unitPricePaise).toBe(10000); // Standard B2C price
      expect(b2cCalc.tierMinQuantity).toBeNull();
      expect(b2cCalc.pricingTierApplied).toBe('STANDARD_B2C');
      expect(b2cCalc.subtotalPaise).toBe(100000);
    });
  });
});
