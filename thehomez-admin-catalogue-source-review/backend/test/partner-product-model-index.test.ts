import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { PartnerProductModel } from '../src/models/partner-product.model.js';
import {
  PartnerAvailabilityHistoryModel,
  type IPartnerAvailabilityHistoryDocument,
} from '../src/models/partner-availability-history.model.js';
import { PartnerModel, type IPartnerDocument } from '../src/models/partner.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../src/models/service-area.model.js';
import { ProductModel, type IProductDocument } from '../src/models/product.model.js';
import {
  ProductVariantModel,
  type IProductVariantDocument,
} from '../src/models/product-variant.model.js';
import { DeliveryMode } from '@thehomez/shared-types';

describe('Milestone 4 Step 6: Subtask 6.2 — Partner Product Availability Models & Indexes', () => {
  let isDbConnected = false;

  const dummyUserId = new Types.ObjectId();
  const dummyCategoryId = new Types.ObjectId();
  const dummySubcategoryId = new Types.ObjectId();

  let activeServiceArea1: IServiceAreaDocument;
  let activeServiceArea2: IServiceAreaDocument;
  let inactiveServiceArea: IServiceAreaDocument;

  let activePartner1: IPartnerDocument;
  let suspendedPartner: IPartnerDocument;

  let activeStandaloneProduct1: IProductDocument;
  let activeStandaloneProduct2: IProductDocument;
  let draftStandaloneProduct: IProductDocument;

  let activeMultiVariantParent: IProductDocument;
  let activeChildVariant1: IProductVariantDocument;
  let activeChildVariant2: IProductVariantDocument;
  let draftChildVariant: IProductVariantDocument;

  let foreignMultiVariantParent: IProductDocument;
  let foreignChildVariant: IProductVariantDocument;

  beforeAll(async () => {
    await connectDatabase();
    isDbConnected = true;

    // Clean test data
    await PartnerProductModel.collection.deleteMany({});
    await PartnerAvailabilityHistoryModel.collection.deleteMany({});
    await ProductVariantModel.collection.deleteMany({ sku: { $regex: /^TEST-AVAIL-/ } });
    await ProductModel.collection.deleteMany({ slug: { $regex: /^test-avail-/ } });
    await PartnerModel.collection.deleteMany({ phone: { $regex: /^\+9198765/ } });
    await ServiceAreaModel.collection.deleteMany({ code: { $regex: /^TEST-SA-AVAIL-/ } });

    // Sync authoritative indexes
    await PartnerProductModel.syncIndexes();
    await PartnerAvailabilityHistoryModel.syncIndexes();

    // 1. Create Service Areas
    activeServiceArea1 = await ServiceAreaModel.create({
      code: 'TEST-SA-AVAIL-1',
      name: 'Test Service Area Avail 1',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincodes: ['560001', '560002'],
      isActive: true,
    });

    activeServiceArea2 = await ServiceAreaModel.create({
      code: 'TEST-SA-AVAIL-2',
      name: 'Test Service Area Avail 2',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincodes: ['560003'],
      isActive: true,
    });

    inactiveServiceArea = await ServiceAreaModel.create({
      code: 'TEST-SA-AVAIL-INACT',
      name: 'Test Service Area Avail Inactive',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincodes: ['560004'],
      isActive: false,
    });

    // 2. Create Partners
    activePartner1 = await PartnerModel.create({
      businessName: 'Active Partner Supplies 1',
      phone: '+919876500001',
      serviceAreaIds: [activeServiceArea1._id, activeServiceArea2._id],
      status: 'ACTIVE',
      deliveryMode: DeliveryMode.PARTNER_MANAGED,
    });

    suspendedPartner = await PartnerModel.create({
      businessName: 'Suspended Partner Supplies',
      phone: '+919876500002',
      serviceAreaIds: [activeServiceArea1._id],
      status: 'SUSPENDED',
      deliveryMode: DeliveryMode.PARTNER_MANAGED,
    });

    // 3. Create Standalone Products (hasVariants: false)
    activeStandaloneProduct1 = await ProductModel.create({
      slug: 'test-avail-cement-53',
      title: 'UltraTech Cement 53 Grade',
      brand: 'UltraTech',
      categoryId: dummyCategoryId,
      subcategoryId: dummySubcategoryId,
      hasVariants: false,
      sku: 'TEST-AVAIL-CEM-53',
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: dummyUserId,
      createdBy: dummyUserId,
      updatedBy: dummyUserId,
    });

    activeStandaloneProduct2 = await ProductModel.create({
      slug: 'test-avail-cement-43',
      title: 'UltraTech Cement 43 Grade',
      brand: 'UltraTech',
      categoryId: dummyCategoryId,
      subcategoryId: dummySubcategoryId,
      hasVariants: false,
      sku: 'TEST-AVAIL-CEM-43',
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: dummyUserId,
      createdBy: dummyUserId,
      updatedBy: dummyUserId,
    });

    draftStandaloneProduct = await ProductModel.create({
      slug: 'test-avail-draft-product',
      title: 'Draft Unreleased Brick',
      brand: 'Wienerberger',
      categoryId: dummyCategoryId,
      subcategoryId: dummySubcategoryId,
      hasVariants: false,
      sku: 'TEST-AVAIL-BRK-DRAFT',
      status: 'DRAFT',
      publishedAt: null,
      createdBy: dummyUserId,
      updatedBy: dummyUserId,
    });

    // 4. Create Multi-Variant Parents & Variants (hasVariants: true)
    activeMultiVariantParent = await ProductModel.create({
      slug: 'test-avail-tata-steel',
      title: 'Tata Tiscon 500D Rebar',
      brand: 'Tata Tiscon',
      categoryId: dummyCategoryId,
      subcategoryId: dummySubcategoryId,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: dummyUserId,
      createdBy: dummyUserId,
      updatedBy: dummyUserId,
    });

    activeChildVariant1 = await ProductVariantModel.create({
      productId: activeMultiVariantParent._id,
      sku: 'TEST-AVAIL-TMT-8MM',
      title: 'Tata Tiscon 8mm Rebar',
      status: 'ACTIVE',
      publishedAt: new Date(),
      attributes: { diameter: '8mm' },
    });

    activeChildVariant2 = await ProductVariantModel.create({
      productId: activeMultiVariantParent._id,
      sku: 'TEST-AVAIL-TMT-12MM',
      title: 'Tata Tiscon 12mm Rebar',
      status: 'ACTIVE',
      publishedAt: new Date(),
      attributes: { diameter: '12mm' },
    });

    draftChildVariant = await ProductVariantModel.create({
      productId: activeMultiVariantParent._id,
      sku: 'TEST-AVAIL-TMT-16MM-DRAFT',
      title: 'Tata Tiscon 16mm Rebar (Draft)',
      status: 'DRAFT',
      publishedAt: null,
      attributes: { diameter: '16mm' },
    });

    // 5. Create Foreign Multi-Variant Parent & Variant for Cross-Belonging tests
    foreignMultiVariantParent = await ProductModel.create({
      slug: 'test-avail-jsw-steel',
      title: 'JSW Neosteel Rebar',
      brand: 'JSW',
      categoryId: dummyCategoryId,
      subcategoryId: dummySubcategoryId,
      hasVariants: true,
      sku: null,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: dummyUserId,
      createdBy: dummyUserId,
      updatedBy: dummyUserId,
    });

    foreignChildVariant = await ProductVariantModel.create({
      productId: foreignMultiVariantParent._id,
      sku: 'TEST-AVAIL-JSW-10MM',
      title: 'JSW 10mm Rebar',
      status: 'ACTIVE',
      publishedAt: new Date(),
      attributes: { diameter: '10mm' },
    });
  });

  afterAll(async () => {
    if (isDbConnected) {
      await PartnerProductModel.collection.deleteMany({});
      await PartnerAvailabilityHistoryModel.collection.deleteMany({});
      await ProductVariantModel.collection.deleteMany({ sku: { $regex: /^TEST-AVAIL-/ } });
      await ProductModel.collection.deleteMany({ slug: { $regex: /^test-avail-/ } });
      await PartnerModel.collection.deleteMany({ phone: { $regex: /^\+9198765/ } });
      await ServiceAreaModel.collection.deleteMany({ code: { $regex: /^TEST-SA-AVAIL-/ } });
      await disconnectDatabase();
    }
  });

  // =========================================================================
  // 1. Live Index Definitions Verification
  // =========================================================================
  describe('1. Live MongoDB Index Definitions against rs0', () => {
    it('creates exactly the approved partial unique and supporting indexes on partner_products', async () => {
      const indexes = await PartnerProductModel.collection.indexes();
      const indexMap = new Map(indexes.map((idx) => [idx.name, idx]));

      // 1. Standalone partial unique index
      const standaloneIdx = indexMap.get('unique_partner_standalone_product_service_area');
      expect(standaloneIdx).toBeDefined();
      expect(standaloneIdx?.unique).toBe(true);
      expect(standaloneIdx?.key).toEqual({ partnerId: 1, productId: 1, serviceAreaId: 1 });
      expect(standaloneIdx?.partialFilterExpression).toEqual({ variantId: null });

      // 2. Variant partial unique index
      const variantIdx = indexMap.get('unique_partner_variant_product_service_area');
      expect(variantIdx).toBeDefined();
      expect(variantIdx?.unique).toBe(true);
      expect(variantIdx?.key).toEqual({
        partnerId: 1,
        productId: 1,
        variantId: 1,
        serviceAreaId: 1,
      });
      expect(variantIdx?.partialFilterExpression).toEqual({ variantId: { $type: 'objectId' } });

      // 3. Storefront resolution supporting index
      const storefrontIdx = indexMap.get('idx_service_area_product_availability');
      expect(storefrontIdx).toBeDefined();
      expect(storefrontIdx?.key).toEqual({
        serviceAreaId: 1,
        productId: 1,
        variantId: 1,
        isAvailable: 1,
      });

      // 4. Partner portal inventory index
      const partnerPortalIdx = indexMap.get('idx_partner_service_area_availability');
      expect(partnerPortalIdx).toBeDefined();
      expect(partnerPortalIdx?.key).toEqual({
        partnerId: 1,
        serviceAreaId: 1,
        isAvailable: 1,
      });
    });

    it('creates the approved chronological query index on partner_availability_history', async () => {
      const indexes = await PartnerAvailabilityHistoryModel.collection.indexes();
      const indexMap = new Map(indexes.map((idx) => [idx.name, idx]));

      const historyIdx = indexMap.get('idx_history_partner_product_created');
      expect(historyIdx).toBeDefined();
      expect(historyIdx?.key).toEqual({ partnerProductId: 1, createdAt: -1 });
    });
  });

  // =========================================================================
  // 2. Standalone Products Availability & Uniqueness
  // =========================================================================
  describe('2. Standalone Product Availability & Partial Uniqueness', () => {
    it('allows distinct standalone products to coexist for the same partner and service area', async () => {
      const doc1 = await PartnerProductModel.create({
        partnerId: activePartner1._id,
        productId: activeStandaloneProduct1._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
        minLeadTimeHours: 2,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      const doc2 = await PartnerProductModel.create({
        partnerId: activePartner1._id,
        productId: activeStandaloneProduct2._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: false,
        minLeadTimeHours: 24,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      expect(doc1._id).toBeDefined();
      expect(doc2._id).toBeDefined();
      expect(doc1.productId.toString()).not.toEqual(doc2.productId.toString());
    });

    it('rejects duplicate standalone records for the same partner, product, and service area', async () => {
      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeStandaloneProduct1._id,
          variantId: null,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(/E11000.*unique_partner_standalone_product_service_area/);
    });

    it('allows the same standalone product to be registered across different service areas for the same partner', async () => {
      const docSA2 = await PartnerProductModel.create({
        partnerId: activePartner1._id,
        productId: activeStandaloneProduct1._id,
        variantId: null,
        serviceAreaId: activeServiceArea2._id,
        isAvailable: true,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      expect(docSA2._id).toBeDefined();
      expect(docSA2.serviceAreaId.toString()).toEqual(activeServiceArea2._id.toString());
    });

    it('catches missing variantId via raw MongoDB insertion and enforces standalone uniqueness', async () => {
      // Direct insertion omitting variantId (raw document without Mongoose default)
      await expect(
        PartnerProductModel.collection.insertOne({
          partnerId: activePartner1._id,
          productId: activeStandaloneProduct1._id,
          // variantId omitted!
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          minLeadTimeHours: 0,
          version: 0,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as unknown as Record<string, unknown>),
      ).rejects.toThrow(/E11000.*unique_partner_standalone_product_service_area/);
    });
  });

  // =========================================================================
  // 3. Variant Availability & Partial Uniqueness
  // =========================================================================
  describe('3. Variant Availability & Partial Uniqueness', () => {
    it('allows different variants of the same parent product to be registered independently', async () => {
      const varDoc1 = await PartnerProductModel.create({
        partnerId: activePartner1._id,
        productId: activeMultiVariantParent._id,
        variantId: activeChildVariant1._id,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
        minLeadTimeHours: 4,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      const varDoc2 = await PartnerProductModel.create({
        partnerId: activePartner1._id,
        productId: activeMultiVariantParent._id,
        variantId: activeChildVariant2._id,
        serviceAreaId: activeServiceArea1._id,
        isAvailable: true,
        minLeadTimeHours: 6,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      expect(varDoc1._id).toBeDefined();
      expect(varDoc2._id).toBeDefined();
      expect(varDoc1.variantId?.toString()).toEqual(activeChildVariant1._id.toString());
      expect(varDoc2.variantId?.toString()).toEqual(activeChildVariant2._id.toString());
    });

    it('rejects duplicate variant records for the same partner, variant, and service area', async () => {
      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeMultiVariantParent._id,
          variantId: activeChildVariant1._id,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: false,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(/E11000.*unique_partner_variant_product_service_area/);
    });

    it('proves variant records do not enter the standalone partial index', async () => {
      // Both activeChildVariant1 and activeChildVariant2 share (activePartner1, activeMultiVariantParent, activeServiceArea1)
      // The standalone index key pattern is { partnerId: 1, productId: 1, serviceAreaId: 1 } (no variantId).
      // If either variant entered the standalone index, the second would have thrown E11000 on the standalone index.
      // Both exist simultaneously in the database without collision.
      const count = await PartnerProductModel.countDocuments({
        partnerId: activePartner1._id,
        productId: activeMultiVariantParent._id,
        serviceAreaId: activeServiceArea1._id,
      });
      expect(count).toBe(2);
    });

    it('proves standalone records do not enter the variant partial index', async () => {
      // Standalone products have variantId: null (BSON Type 10)
      // The variant partial index filter is { variantId: { $type: 'objectId' } } (BSON Type 7)
      // Hence standalone records are completely excluded from the variant partial index.
      const standaloneDocs = await PartnerProductModel.find({
        partnerId: activePartner1._id,
        productId: activeStandaloneProduct1._id,
        variantId: null,
      });
      expect(standaloneDocs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // 4. Concurrency & Optimistic Concurrency Control
  // =========================================================================
  describe('4. Concurrency & Race-Condition Safety', () => {
    it('safely serializes concurrent duplicate creation, granting exactly 1 insertion and rejecting the rest with E11000', async () => {
      const newPartner = await PartnerModel.create({
        businessName: 'Concurrent Race Partner',
        phone: '+919876500009',
        serviceAreaIds: [activeServiceArea1._id],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const concurrentAttempts = Array.from({ length: 6 }, () =>
        PartnerProductModel.create({
          partnerId: newPartner._id,
          productId: activeStandaloneProduct2._id,
          variantId: null,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      );

      const results = await Promise.allSettled(concurrentAttempts);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(5);

      for (const rej of rejected) {
        if (rej.status === 'rejected') {
          expect(rej.reason.message).toMatch(/E11000/);
        }
      }
    });

    it('supports version-based optimistic concurrency control on update', async () => {
      const doc = await PartnerProductModel.create({
        partnerId: activePartner1._id,
        productId: activeStandaloneProduct2._id,
        variantId: null,
        serviceAreaId: activeServiceArea2._id,
        isAvailable: true,
        version: 0,
        createdBy: dummyUserId,
        updatedBy: dummyUserId,
      });

      // Update with matching version succeeds and increments version
      const updated = await PartnerProductModel.findOneAndUpdate(
        { _id: doc._id, partnerId: activePartner1._id, version: 0 },
        { $set: { isAvailable: false, updatedBy: dummyUserId }, $inc: { version: 1 } },
        { new: true },
      );
      expect(updated).not.toBeNull();
      expect(updated?.isAvailable).toBe(false);
      expect(updated?.version).toBe(1);

      // Concurrent update with stale version 0 matches 0 documents
      const staleUpdate = await PartnerProductModel.findOneAndUpdate(
        { _id: doc._id, partnerId: activePartner1._id, version: 0 },
        { $set: { isAvailable: true, updatedBy: dummyUserId }, $inc: { version: 1 } },
        { new: true },
      );
      expect(staleUpdate).toBeNull();
    });
  });

  // =========================================================================
  // 5. Database-Backed Pre-Validate Invariant Guards
  // =========================================================================
  describe('5. Database-Backed Pre-Validate Invariant Guards', () => {
    it('strictly rejects direct availability on a multi-variant parent product (PARENT_CONTAINER_CANNOT_HAVE_AVAILABILITY)', async () => {
      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeMultiVariantParent._id,
          variantId: null,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(
        /PARENT_CONTAINER_CANNOT_HAVE_AVAILABILITY: Standalone availability cannot be assigned to multi-variant parent products/,
      );
    });

    it('strictly rejects supplying a variantId for a standalone product (SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_AVAILABILITY)', async () => {
      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeStandaloneProduct1._id,
          variantId: activeChildVariant1._id,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(
        /SINGLE_PRODUCT_CANNOT_HAVE_VARIANT_AVAILABILITY: Standalone products cannot have variant availability/,
      );
    });

    it('strictly rejects linking a variant belonging to a different parent (VARIANT_DOES_NOT_BELONG_TO_PRODUCT)', async () => {
      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeMultiVariantParent._id,
          variantId: foreignChildVariant._id, // Belongs to foreignMultiVariantParent
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(
        /VARIANT_DOES_NOT_BELONG_TO_PRODUCT: The referenced variant belongs to a different parent product/,
      );
    });

    it('strictly rejects declaring availability in a service area not assigned to the partner (SERVICE_AREA_NOT_ASSIGNED_TO_PARTNER)', async () => {
      // activePartner1 only has activeServiceArea1 and activeServiceArea2
      const unassignedArea = await ServiceAreaModel.create({
        code: 'TEST-SA-AVAIL-UNASSIGNED',
        name: 'Unassigned Test Area',
        city: 'Mysuru',
        state: 'Karnataka',
        pincodes: ['570001'],
        isActive: true,
      });

      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeStandaloneProduct1._id,
          variantId: null,
          serviceAreaId: unassignedArea._id,
          isAvailable: true,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(
        /SERVICE_AREA_NOT_ASSIGNED_TO_PARTNER: Target service area is not assigned to this partner/,
      );
    });

    it('strictly rejects declaring availability in an inactive service area (SERVICE_AREA_NOT_ACTIVE)', async () => {
      // Assign inactiveServiceArea to partner temporarily to test inactive check
      await PartnerModel.findByIdAndUpdate(activePartner1._id, {
        $push: { serviceAreaIds: inactiveServiceArea._id },
      });

      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeStandaloneProduct1._id,
          variantId: null,
          serviceAreaId: inactiveServiceArea._id,
          isAvailable: true,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(/SERVICE_AREA_NOT_ACTIVE: Target service area is currently inactive/);
    });

    it('strictly rejects declaring availability for a suspended partner (PARTNER_NOT_ACTIVE)', async () => {
      await expect(
        PartnerProductModel.create({
          partnerId: suspendedPartner._id,
          productId: activeStandaloneProduct1._id,
          variantId: null,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(
        /PARTNER_NOT_ACTIVE: Cannot configure availability for partner with status SUSPENDED/,
      );
    });

    it('strictly rejects declaring availability for a draft/unpublished product (CANNOT_LINK_UNPUBLISHED_PRODUCT)', async () => {
      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: draftStandaloneProduct._id,
          variantId: null,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(
        /CANNOT_LINK_UNPUBLISHED_PRODUCT: Partner availability can only be configured for active, published products/,
      );
    });

    it('strictly rejects declaring availability for a draft/unpublished variant (CANNOT_LINK_UNPUBLISHED_VARIANT)', async () => {
      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeMultiVariantParent._id,
          variantId: draftChildVariant._id,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(
        /CANNOT_LINK_UNPUBLISHED_VARIANT: Partner availability can only be configured for active, published variants/,
      );
    });

    it('validates bounds on minLeadTimeHours (0 to 720 integer)', async () => {
      // Negative lead time
      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeStandaloneProduct1._id,
          variantId: null,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          minLeadTimeHours: -1,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(/minLeadTimeHours cannot be negative/);

      // Exceeds 720 hours
      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeStandaloneProduct1._id,
          variantId: null,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          minLeadTimeHours: 721,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(/minLeadTimeHours cannot exceed 720/);

      // Non-integer
      await expect(
        PartnerProductModel.create({
          partnerId: activePartner1._id,
          productId: activeStandaloneProduct1._id,
          variantId: null,
          serviceAreaId: activeServiceArea1._id,
          isAvailable: true,
          minLeadTimeHours: 1.5,
          createdBy: dummyUserId,
          updatedBy: dummyUserId,
        }),
      ).rejects.toThrow(/minLeadTimeHours must be an integer/);
    });
  });

  // =========================================================================
  // 6. PartnerAvailabilityHistoryModel Immutability
  // =========================================================================
  describe('6. PartnerAvailabilityHistoryModel Immutability Guards', () => {
    let historyRecord: IPartnerAvailabilityHistoryDocument;

    it('allows inserting an initial history entry with timestamps', async () => {
      historyRecord = await PartnerAvailabilityHistoryModel.create({
        partnerProductId: new Types.ObjectId(),
        partnerId: activePartner1._id,
        productId: activeStandaloneProduct1._id,
        variantId: null,
        serviceAreaId: activeServiceArea1._id,
        previousState: null,
        newState: true,
        reason: 'Initial stock registration',
        changedBy: dummyUserId,
      });

      expect(historyRecord._id).toBeDefined();
      expect(historyRecord.newState).toBe(true);
      expect(historyRecord.createdAt).toBeDefined();
    });

    it('blocks save() on existing document via pre("save") guard', async () => {
      historyRecord.newState = false;
      await expect(historyRecord.save()).rejects.toThrow(
        /PARTNER_AVAILABILITY_HISTORY_IMMUTABLE: Partner availability history records cannot be modified/,
      );
    });

    it('blocks query-level update operations (updateOne, updateMany, findOneAndUpdate)', async () => {
      await expect(
        PartnerAvailabilityHistoryModel.updateOne(
          { _id: historyRecord._id },
          { $set: { newState: false } },
        ),
      ).rejects.toThrow(
        /PARTNER_AVAILABILITY_HISTORY_IMMUTABLE: Partner availability history records cannot be modified or deleted/,
      );

      await expect(
        PartnerAvailabilityHistoryModel.findOneAndUpdate(
          { _id: historyRecord._id },
          { $set: { newState: false } },
        ),
      ).rejects.toThrow(
        /PARTNER_AVAILABILITY_HISTORY_IMMUTABLE: Partner availability history records cannot be modified or deleted/,
      );
    });

    it('blocks query-level delete operations (deleteOne, deleteMany, findOneAndDelete)', async () => {
      await expect(
        PartnerAvailabilityHistoryModel.deleteOne({ _id: historyRecord._id }),
      ).rejects.toThrow(
        /PARTNER_AVAILABILITY_HISTORY_IMMUTABLE: Partner availability history records cannot be modified or deleted/,
      );

      await expect(
        PartnerAvailabilityHistoryModel.findOneAndDelete({ _id: historyRecord._id }),
      ).rejects.toThrow(
        /PARTNER_AVAILABILITY_HISTORY_IMMUTABLE: Partner availability history records cannot be modified or deleted/,
      );
    });

    it('blocks bulkWrite mutation operations', async () => {
      expect(() =>
        PartnerAvailabilityHistoryModel.bulkWrite([
          {
            updateOne: {
              filter: { _id: historyRecord._id },
              update: { $set: { newState: false } },
            },
          },
        ]),
      ).toThrow(
        /PARTNER_AVAILABILITY_HISTORY_IMMUTABLE: Partner availability history records cannot be modified or deleted via bulkWrite/,
      );
    });
  });
});
