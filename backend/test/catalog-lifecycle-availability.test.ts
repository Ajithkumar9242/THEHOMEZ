import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Types } from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { ProductModel } from '../src/models/product.model.js';
import { ProductVariantModel } from '../src/models/product-variant.model.js';
import { SkuRegistryModel } from '../src/models/sku-registry.model.js';
import { CategoryModel } from '../src/models/category.model.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { PartnerProductModel } from '../src/models/partner-product.model.js';
import { PartnerAvailabilityHistoryModel } from '../src/models/partner-availability-history.model.js';
import { productService, ProductService } from '../src/services/catalog/product.service.js';
import {
  productVariantService,
  ProductVariantService,
} from '../src/services/catalog/product-variant.service.js';
import { PartnerAvailabilityService } from '../src/services/partner-availability/index.js';

describe('Milestone 4, Step 6.5A: Partner Availability Archive Lifecycle Integration', () => {
  const actorUserId = new Types.ObjectId();
  let testCategoryId: Types.ObjectId;
  let testServiceArea1: InstanceType<typeof ServiceAreaModel>;
  let testServiceArea2: InstanceType<typeof ServiceAreaModel>;
  let testPartner1: InstanceType<typeof PartnerModel>;
  let testPartner2: InstanceType<typeof PartnerModel>;

  beforeAll(async () => {
    await connectDatabase();
    await cleanTestData();

    const category = await CategoryModel.create({
      code: `AVAIL_CAT_${Date.now()}`,
      name: 'Availability Lifecycle Category',
      slug: `avail-lifecycle-cat-${Date.now()}`,
      isActive: true,
      displayOrder: 1,
    });
    testCategoryId = category._id;

    testServiceArea1 = await ServiceAreaModel.create({
      code: `SA-LIFECYCLE-1-${Date.now()}`,
      name: 'Bengaluru Core South',
      city: 'Bengaluru',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: ['569801', '569802'],
      isActive: true,
    });

    testServiceArea2 = await ServiceAreaModel.create({
      code: `SA-LIFECYCLE-2-${Date.now()}`,
      name: 'Bengaluru Core North',
      city: 'Bengaluru',
      state: 'Karnataka',
      countryCode: 'IN',
      pincodes: ['569803', '569804'],
      isActive: true,
    });

    testPartner1 = await PartnerModel.create({
      businessName: 'Lifecycle Test Partner 1',
      phone: '+919988110001',
      serviceAreaIds: [testServiceArea1._id, testServiceArea2._id],
      status: 'ACTIVE',
      deliveryMode: 'PARTNER_MANAGED',
    });

    testPartner2 = await PartnerModel.create({
      businessName: 'Lifecycle Test Partner 2',
      phone: '+919988110002',
      serviceAreaIds: [testServiceArea1._id, testServiceArea2._id],
      status: 'ACTIVE',
      deliveryMode: 'PLATFORM_MANAGED',
    });
  });

  afterAll(async () => {
    await cleanTestData();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await PartnerProductModel.collection.deleteMany({
      partnerId: { $in: [testPartner1._id, testPartner2._id] },
    });
    await PartnerAvailabilityHistoryModel.collection.deleteMany({
      partnerId: { $in: [testPartner1._id, testPartner2._id] },
    });
    await ProductVariantModel.collection.deleteMany({ sku: { $regex: /^TEST-AVAIL-/ } });
    await ProductModel.collection.deleteMany({ slug: { $regex: /^test-avail-/ } });
    await SkuRegistryModel.collection.deleteMany({ sku: { $regex: /^TEST-AVAIL-/ } });
  });

  async function cleanTestData() {
    if (testPartner1 && testPartner2) {
      await PartnerProductModel.collection.deleteMany({
        partnerId: { $in: [testPartner1._id, testPartner2._id] },
      });
      await PartnerAvailabilityHistoryModel.collection.deleteMany({
        partnerId: { $in: [testPartner1._id, testPartner2._id] },
      });
    }
    await ProductVariantModel.collection.deleteMany({ sku: { $regex: /^TEST-AVAIL-/ } });
    await ProductModel.collection.deleteMany({ slug: { $regex: /^test-avail-/ } });
    await SkuRegistryModel.collection.deleteMany({ sku: { $regex: /^TEST-AVAIL-/ } });
    await PartnerModel.collection.deleteMany({ phone: { $regex: /^\+998811/ } });
    await ServiceAreaModel.collection.deleteMany({
      $or: [
        { code: { $regex: /^SA-LIFECYCLE-/ } },
        { pincodes: { $in: ['569801', '569802', '569803', '569804'] } },
      ],
    });
    await CategoryModel.collection.deleteMany({ code: { $regex: /^AVAIL_CAT_/ } });
  }

  it('Product archival deactivates standalone product availability', async () => {
    const product = await ProductModel.create({
      title: 'Standalone Test Product',
      brand: 'TestBrand',
      slug: `test-avail-standalone-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: false,
      sku: `TEST-AVAIL-ST-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const partnerProduct = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: product._id,
      variantId: null,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 2,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const archived = await productService.archiveProduct(
      product._id.toString(),
      actorUserId.toString(),
    );
    expect(archived.status).toBe('ARCHIVED');

    const updatedPP = await PartnerProductModel.findById(partnerProduct._id);
    expect(updatedPP).not.toBeNull();
    expect(updatedPP!.isAvailable).toBe(false);
    expect(updatedPP!.version).toBe(2);
    expect(updatedPP!.updatedBy.toString()).toBe(actorUserId.toString());

    const histories = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: partnerProduct._id,
    });
    expect(histories).toHaveLength(1);
    expect(histories[0].previousState).toBe(true);
    expect(histories[0].newState).toBe(false);
    expect(histories[0].reason).toBe('Product archived: cascade availability deactivation');
    expect(histories[0].changedBy.toString()).toBe(actorUserId.toString());
  });

  it('Product archival deactivates all child variant availability', async () => {
    const parent = await ProductModel.create({
      title: 'Multi-Variant Parent Product',
      brand: 'TestBrand',
      slug: `test-avail-parent-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: true,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const variantA = await ProductVariantModel.create({
      productId: parent._id,
      title: 'Variant Red',
      sku: `TEST-AVAIL-VA-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      attributes: { Color: 'Red' },
      version: 0,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const variantB = await ProductVariantModel.create({
      productId: parent._id,
      title: 'Variant Blue',
      sku: `TEST-AVAIL-VB-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      attributes: { Color: 'Blue' },
      version: 0,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const ppA = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: parent._id,
      variantId: variantA._id,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 4,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const ppB = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: parent._id,
      variantId: variantB._id,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 6,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    await productService.archiveProduct(parent._id.toString(), actorUserId.toString());

    const updatedA = await PartnerProductModel.findById(ppA._id);
    const updatedB = await PartnerProductModel.findById(ppB._id);
    expect(updatedA!.isAvailable).toBe(false);
    expect(updatedA!.version).toBe(2);
    expect(updatedB!.isAvailable).toBe(false);
    expect(updatedB!.version).toBe(2);

    const historyA = await PartnerAvailabilityHistoryModel.findOne({ partnerProductId: ppA._id });
    const historyB = await PartnerAvailabilityHistoryModel.findOne({ partnerProductId: ppB._id });
    expect(historyA!.reason).toBe('Product archived: cascade availability deactivation');
    expect(historyB!.reason).toBe('Product archived: cascade availability deactivation');
  });

  it('Multiple partners and service areas are covered', async () => {
    const product = await ProductModel.create({
      title: 'Multi-Partner Product',
      brand: 'TestBrand',
      slug: `test-avail-multi-partner-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: false,
      sku: `TEST-AVAIL-MP-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const records = await PartnerProductModel.create([
      {
        partnerId: testPartner1._id,
        productId: product._id,
        variantId: null,
        serviceAreaId: testServiceArea1._id,
        isAvailable: true,
        minLeadTimeHours: 1,
        version: 1,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
      {
        partnerId: testPartner1._id,
        productId: product._id,
        variantId: null,
        serviceAreaId: testServiceArea2._id,
        isAvailable: true,
        minLeadTimeHours: 2,
        version: 1,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
      {
        partnerId: testPartner2._id,
        productId: product._id,
        variantId: null,
        serviceAreaId: testServiceArea1._id,
        isAvailable: true,
        minLeadTimeHours: 3,
        version: 1,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
      {
        partnerId: testPartner2._id,
        productId: product._id,
        variantId: null,
        serviceAreaId: testServiceArea2._id,
        isAvailable: true,
        minLeadTimeHours: 4,
        version: 1,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      },
    ]);

    expect(records).toHaveLength(4);

    await productService.archiveProduct(product._id.toString(), actorUserId.toString());

    const updatedRecords = await PartnerProductModel.find({ productId: product._id });
    expect(updatedRecords).toHaveLength(4);
    expect(updatedRecords.every((r) => r.isAvailable === false)).toBe(true);
    expect(updatedRecords.every((r) => r.version === 2)).toBe(true);

    const historyCount = await PartnerAvailabilityHistoryModel.countDocuments({
      productId: product._id,
    });
    expect(historyCount).toBe(4);
  });

  it('Already-unavailable records remain unchanged', async () => {
    const product = await ProductModel.create({
      title: 'Partial Availability Product',
      brand: 'TestBrand',
      slug: `test-avail-partial-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: false,
      sku: `TEST-AVAIL-PA-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const inactiveRecord = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: product._id,
      variantId: null,
      serviceAreaId: testServiceArea1._id,
      isAvailable: false,
      minLeadTimeHours: 1,
      version: 5,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const activeRecord = await PartnerProductModel.create({
      partnerId: testPartner2._id,
      productId: product._id,
      variantId: null,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 1,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    await productService.archiveProduct(product._id.toString(), actorUserId.toString());

    const refetchedInactive = await PartnerProductModel.findById(inactiveRecord._id);
    expect(refetchedInactive!.isAvailable).toBe(false);
    expect(refetchedInactive!.version).toBe(5);

    const refetchedActive = await PartnerProductModel.findById(activeRecord._id);
    expect(refetchedActive!.isAvailable).toBe(false);
    expect(refetchedActive!.version).toBe(2);

    const inactiveHistory = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: inactiveRecord._id,
    });
    expect(inactiveHistory).toHaveLength(0);

    const activeHistory = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: activeRecord._id,
    });
    expect(activeHistory).toHaveLength(1);
    expect(activeHistory[0].reason).toBe('Product archived: cascade availability deactivation');
  });

  it('Individual variant archival affects only that variant', async () => {
    const parent = await ProductModel.create({
      title: 'Variant Isolation Parent',
      brand: 'TestBrand',
      slug: `test-avail-var-iso-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: true,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const targetVariant = await ProductVariantModel.create({
      productId: parent._id,
      title: 'Variant Large',
      sku: `TEST-AVAIL-VTGT-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      attributes: { Size: 'Large' },
      version: 0,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const siblingVariant = await ProductVariantModel.create({
      productId: parent._id,
      title: 'Variant Small',
      sku: `TEST-AVAIL-VSIB-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      attributes: { Size: 'Small' },
      version: 0,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const targetPP = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: parent._id,
      variantId: targetVariant._id,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 2,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const siblingPP = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: parent._id,
      variantId: siblingVariant._id,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 2,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const archivedVariant = await productVariantService.archiveVariant(
      parent._id.toString(),
      targetVariant._id.toString(),
      actorUserId.toString(),
    );
    expect(archivedVariant.status).toBe('ARCHIVED');

    const updatedTargetPP = await PartnerProductModel.findById(targetPP._id);
    expect(updatedTargetPP!.isAvailable).toBe(false);
    expect(updatedTargetPP!.version).toBe(2);

    const updatedSiblingPP = await PartnerProductModel.findById(siblingPP._id);
    expect(updatedSiblingPP!.isAvailable).toBe(true);
    expect(updatedSiblingPP!.version).toBe(1);

    const targetHistories = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: targetPP._id,
    });
    expect(targetHistories).toHaveLength(1);
    expect(targetHistories[0].reason).toBe('Variant archived: cascade availability deactivation');
    expect(targetHistories[0].changedBy.toString()).toBe(actorUserId.toString());

    const siblingHistories = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: siblingPP._id,
    });
    expect(siblingHistories).toHaveLength(0);
  });

  it('Sibling variants remain available', async () => {
    const parent = await ProductModel.create({
      title: 'Sibling Check Parent',
      brand: 'TestBrand',
      slug: `test-avail-sibling-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: true,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const variant1 = await ProductVariantModel.create({
      productId: parent._id,
      title: 'Variant 10mm',
      sku: `TEST-AVAIL-S1-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      attributes: { Thickness: '10mm' },
      version: 0,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const variant2 = await ProductVariantModel.create({
      productId: parent._id,
      title: 'Variant 12mm',
      sku: `TEST-AVAIL-S2-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      attributes: { Thickness: '12mm' },
      version: 0,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const pp1 = await PartnerProductModel.create({
      partnerId: testPartner2._id,
      productId: parent._id,
      variantId: variant1._id,
      serviceAreaId: testServiceArea2._id,
      isAvailable: true,
      minLeadTimeHours: 3,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const pp2 = await PartnerProductModel.create({
      partnerId: testPartner2._id,
      productId: parent._id,
      variantId: variant2._id,
      serviceAreaId: testServiceArea2._id,
      isAvailable: true,
      minLeadTimeHours: 3,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    await productVariantService.archiveVariant(
      parent._id.toString(),
      variant1._id.toString(),
      actorUserId.toString(),
    );

    const refetchedPP1 = await PartnerProductModel.findById(pp1._id);
    expect(refetchedPP1!.isAvailable).toBe(false);
    expect(refetchedPP1!.version).toBe(2);

    const refetchedPP2 = await PartnerProductModel.findById(pp2._id);
    expect(refetchedPP2!.isAvailable).toBe(true);
    expect(refetchedPP2!.version).toBe(1);

    const refetchedVariant2 = await ProductVariantModel.findById(variant2._id);
    expect(refetchedVariant2!.status).toBe('ACTIVE');

    const histories2 = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: pp2._id,
    });
    expect(histories2).toHaveLength(0);
  });

  it('History entries have correct reason and actor', async () => {
    const parent = await ProductModel.create({
      title: 'Audit Reason Check Parent',
      brand: 'TestBrand',
      slug: `test-avail-audit-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: true,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const variant = await ProductVariantModel.create({
      productId: parent._id,
      title: 'Variant Premium',
      sku: `TEST-AVAIL-AUD-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      attributes: { Spec: 'Premium' },
      version: 0,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const ppVariant = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: parent._id,
      variantId: variant._id,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 5,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const specificActor = new Types.ObjectId();
    await productVariantService.archiveVariant(
      parent._id.toString(),
      variant._id.toString(),
      specificActor.toString(),
    );

    const historyVariant = await PartnerAvailabilityHistoryModel.findOne({
      partnerProductId: ppVariant._id,
    });
    expect(historyVariant).not.toBeNull();
    expect(historyVariant!.reason).toBe('Variant archived: cascade availability deactivation');
    expect(historyVariant!.changedBy.toString()).toBe(specificActor.toString());
    expect(historyVariant!.previousState).toBe(true);
    expect(historyVariant!.newState).toBe(false);
    expect(historyVariant!.variantId!.toString()).toBe(variant._id.toString());
    expect(historyVariant!.productId.toString()).toBe(parent._id.toString());

    // Test parent product archival reason
    const standalone = await ProductModel.create({
      title: 'Audit Reason Standalone',
      brand: 'TestBrand',
      slug: `test-avail-audit-std-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: false,
      sku: `TEST-AVAIL-ASTD-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const ppStandalone = await PartnerProductModel.create({
      partnerId: testPartner2._id,
      productId: standalone._id,
      variantId: null,
      serviceAreaId: testServiceArea2._id,
      isAvailable: true,
      minLeadTimeHours: 1,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const parentActor = new Types.ObjectId();
    await productService.archiveProduct(standalone._id.toString(), parentActor.toString());

    const historyParent = await PartnerAvailabilityHistoryModel.findOne({
      partnerProductId: ppStandalone._id,
    });
    expect(historyParent).not.toBeNull();
    expect(historyParent!.reason).toBe('Product archived: cascade availability deactivation');
    expect(historyParent!.changedBy.toString()).toBe(parentActor.toString());
    expect(historyParent!.previousState).toBe(true);
    expect(historyParent!.newState).toBe(false);
  });

  it('History creation failure rolls back all related mutations', async () => {
    const product = await ProductModel.create({
      title: 'Rollback Test Product',
      brand: 'TestBrand',
      slug: `test-avail-rollback-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: false,
      sku: `TEST-AVAIL-RB-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const pp = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: product._id,
      variantId: null,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 2,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const historyCreateSpy = vi
      .spyOn(PartnerAvailabilityHistoryModel, 'create')
      .mockImplementationOnce(async () => {
        throw new Error('SIMULATED_AVAILABILITY_HISTORY_FAILURE');
      });

    await expect(
      productService.archiveProduct(product._id.toString(), actorUserId.toString()),
    ).rejects.toThrow('SIMULATED_AVAILABILITY_HISTORY_FAILURE');

    historyCreateSpy.mockRestore();

    const refetchedProduct = await ProductModel.findById(product._id);
    expect(refetchedProduct!.status).toBe('ACTIVE');

    const refetchedPP = await PartnerProductModel.findById(pp._id);
    expect(refetchedPP!.isAvailable).toBe(true);
    expect(refetchedPP!.version).toBe(1);

    const historyCount = await PartnerAvailabilityHistoryModel.countDocuments({
      partnerProductId: pp._id,
    });
    expect(historyCount).toBe(0);

    // Also verify variant archival rollback
    const parentForRollback = await ProductModel.create({
      title: 'Variant Rollback Parent',
      brand: 'TestBrand',
      slug: `test-avail-rb-var-p-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: true,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const variantForRollback = await ProductVariantModel.create({
      productId: parentForRollback._id,
      title: 'Variant Rollback Item',
      sku: `TEST-AVAIL-VRB-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      attributes: { Type: 'Rollback' },
      version: 0,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const ppVariantForRollback = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: parentForRollback._id,
      variantId: variantForRollback._id,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 2,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const variantHistorySpy = vi
      .spyOn(PartnerAvailabilityHistoryModel, 'create')
      .mockImplementationOnce(async () => {
        throw new Error('SIMULATED_VARIANT_HISTORY_FAILURE');
      });

    await expect(
      productVariantService.archiveVariant(
        parentForRollback._id.toString(),
        variantForRollback._id.toString(),
        actorUserId.toString(),
      ),
    ).rejects.toThrow('SIMULATED_VARIANT_HISTORY_FAILURE');

    variantHistorySpy.mockRestore();

    const refetchedVariant = await ProductVariantModel.findById(variantForRollback._id);
    expect(refetchedVariant!.status).toBe('ACTIVE');

    const refetchedVariantPP = await PartnerProductModel.findById(ppVariantForRollback._id);
    expect(refetchedVariantPP!.isAvailable).toBe(true);
    expect(refetchedVariantPP!.version).toBe(1);

    const variantHistories = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: ppVariantForRollback._id,
    });
    expect(variantHistories).toHaveLength(0);
  });

  it('Repeated archival creates no duplicate history', async () => {
    const product = await ProductModel.create({
      title: 'Idempotency Test Product',
      brand: 'TestBrand',
      slug: `test-avail-idempotent-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: false,
      sku: `TEST-AVAIL-IDEM-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const pp = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: product._id,
      variantId: null,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 1,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const firstArchived = await productService.archiveProduct(
      product._id.toString(),
      actorUserId.toString(),
    );
    expect(firstArchived.status).toBe('ARCHIVED');

    const firstHistories = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: pp._id,
    });
    expect(firstHistories).toHaveLength(1);

    const secondArchived = await productService.archiveProduct(
      product._id.toString(),
      actorUserId.toString(),
    );
    expect(secondArchived.status).toBe('ARCHIVED');

    const secondHistories = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: pp._id,
    });
    expect(secondHistories).toHaveLength(1);

    const updatedPP = await PartnerProductModel.findById(pp._id);
    expect(updatedPP!.version).toBe(2);

    // Verify repeated variant archival idempotency as well
    const parentIdem = await ProductModel.create({
      title: 'Variant Idempotency Parent',
      brand: 'TestBrand',
      slug: `test-avail-idem-var-p-${Date.now()}`,
      categoryId: testCategoryId,
      subcategoryId: new Types.ObjectId(),
      hasVariants: true,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      createdBy: actorUserId,
      updatedBy: actorUserId,
      version: 0,
    });

    const variantIdem = await ProductVariantModel.create({
      productId: parentIdem._id,
      title: 'Variant Idempotency Item',
      sku: `TEST-AVAIL-VIDEM-${Date.now()}`,
      status: 'ACTIVE',
      publishedAt: new Date(),
      publishedBy: actorUserId,
      attributes: { Color: 'Silver' },
      version: 0,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const ppVarIdem = await PartnerProductModel.create({
      partnerId: testPartner1._id,
      productId: parentIdem._id,
      variantId: variantIdem._id,
      serviceAreaId: testServiceArea1._id,
      isAvailable: true,
      minLeadTimeHours: 1,
      version: 1,
      createdBy: actorUserId,
      updatedBy: actorUserId,
    });

    const firstVarArchived = await productVariantService.archiveVariant(
      parentIdem._id.toString(),
      variantIdem._id.toString(),
      actorUserId.toString(),
    );
    expect(firstVarArchived.status).toBe('ARCHIVED');

    const firstVarHistories = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: ppVarIdem._id,
    });
    expect(firstVarHistories).toHaveLength(1);

    const secondVarArchived = await productVariantService.archiveVariant(
      parentIdem._id.toString(),
      variantIdem._id.toString(),
      actorUserId.toString(),
    );
    expect(secondVarArchived.status).toBe('ARCHIVED');

    const secondVarHistories = await PartnerAvailabilityHistoryModel.find({
      partnerProductId: ppVarIdem._id,
    });
    expect(secondVarHistories).toHaveLength(1);
  });

  it('No circular dependency is introduced', async () => {
    expect(ProductService).toBeDefined();
    expect(ProductVariantService).toBeDefined();
    expect(PartnerAvailabilityService).toBeDefined();
    expect(productService).toBeInstanceOf(ProductService);
    expect(productVariantService).toBeInstanceOf(ProductVariantService);

    const customAvailabilityService = new PartnerAvailabilityService();
    const customProductService = new ProductService(customAvailabilityService);
    const customVariantService = new ProductVariantService(customAvailabilityService);

    expect(customProductService).toBeDefined();
    expect(customVariantService).toBeDefined();
  });
});
