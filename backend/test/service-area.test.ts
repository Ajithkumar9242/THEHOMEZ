import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import type { Application } from 'express';
import {
  UserType,
  UserStatus,
  PermissionCode,
  type IServiceArea,
  type IServiceAreaPartnerItem,
} from '@thehomez/shared-types';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../src/models/service-area.model.js';
import { PartnerModel, type IPartnerDocument } from '../src/models/partner.model.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { serviceAreaService } from '../src/services/service-area/service-area.service.js';
import { runServiceAreaSeed } from '../src/seeds/service-areas.seed.js';
import * as envConfig from '../src/config/env.js';

describe('Milestone 4 Step 1: Service Area Management & Coverage', () => {
  let isDbConnected = false;
  let app: Application;
  let tokenService: TokenService;

  // Test users & tokens
  let adminUser: IUserDocument;
  let adminToken: string;

  let unauthorizedUser: IUserDocument;
  let unauthorizedToken: string;

  let partnerAUser: IUserDocument;
  let partnerAToken: string;
  let partnerADoc: IPartnerDocument;

  let partnerBUser: IUserDocument;
  let partnerBToken: string;
  let partnerBDoc: IPartnerDocument;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = mongoose.connection.readyState === 1;
    } catch {
      isDbConnected = false;
    }

    tokenService = new TokenService();
    app = createApp();

    if (isDbConnected) {
      // Clean up previous test artifacts
      await ServiceAreaModel.deleteMany({ code: { $regex: /^(TEST-SA-|BLR-)/ } });
      await PartnerModel.deleteMany({ businessName: { $regex: /^Test Partner/ } });
      await UserModel.deleteMany({ phone: { $regex: /^\+9197777/ } });
      await RoleModel.deleteMany({ code: { $regex: /^SA_TEST_/ } });

      // 1. Create Admin Role & User
      await RoleModel.create({
        code: 'SA_TEST_ADMIN',
        name: 'Service Area Administrator Test',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [
          PermissionCode.SERVICE_AREA_READ,
          PermissionCode.SERVICE_AREA_WRITE,
          PermissionCode.PARTNER_READ,
          PermissionCode.PARTNER_VERIFY,
          PermissionCode.CATALOG_READ,
          PermissionCode.CATALOG_WRITE,
        ],
      });

      adminUser = await UserModel.create({
        phone: '+919777700001',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['SA_TEST_ADMIN'],
      });
      adminToken = tokenService.signAccessToken(adminUser);

      // 2. Create Unauthorized Staff User (lacks service area permissions)
      await RoleModel.create({
        code: 'SA_TEST_UNAUTH',
        name: 'Service Area Unauthorized Test',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.CUSTOMER_READ],
      });

      unauthorizedUser = await UserModel.create({
        phone: '+919777700002',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['SA_TEST_UNAUTH'],
      });
      unauthorizedToken = tokenService.signAccessToken(unauthorizedUser);

      // 3. Create Partner A
      partnerADoc = await PartnerModel.create({
        businessName: 'Test Partner Alpha Materials',
        legalName: 'Alpha Building Supplies LLP',
        phone: '+919777700010',
        status: 'ACTIVE',
      });

      partnerAUser = await UserModel.create({
        phone: '+919777700010',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerADoc._id,
        roles: [],
      });
      partnerAToken = tokenService.signAccessToken(partnerAUser);

      // 4. Create Partner B
      partnerBDoc = await PartnerModel.create({
        businessName: 'Test Partner Beta Hardware',
        legalName: 'Beta Trade Solutions Pvt Ltd',
        phone: '+919777700020',
        status: 'ACTIVE',
      });

      partnerBUser = await UserModel.create({
        phone: '+919777700020',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerBDoc._id,
        roles: [],
      });
      partnerBToken = tokenService.signAccessToken(partnerBUser);
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await ServiceAreaModel.deleteMany({ code: { $regex: /^(TEST-SA-|BLR-)/ } });
      await PartnerModel.deleteMany({ businessName: { $regex: /^Test Partner/ } });
      await UserModel.deleteMany({ phone: { $regex: /^\+9197777/ } });
      await RoleModel.deleteMany({ code: { $regex: /^SA_TEST_/ } });
      await disconnectDatabase();
    }
  });

  beforeEach(async () => {
    if (isDbConnected) {
      await ServiceAreaModel.deleteMany({ code: { $regex: /^(TEST-SA-|BLR-)/ } });

      // Ensure SA_TEST_ADMIN role exists in case another concurrent suite purged roles
      await RoleModel.updateOne(
        { code: 'SA_TEST_ADMIN' },
        {
          $setOnInsert: {
            code: 'SA_TEST_ADMIN',
            name: 'Service Area Administrator Test',
            userType: UserType.STAFF,
            isSystemManaged: false,
            permissions: [
              PermissionCode.SERVICE_AREA_READ,
              PermissionCode.SERVICE_AREA_WRITE,
              PermissionCode.PARTNER_READ,
              PermissionCode.PARTNER_VERIFY,
              PermissionCode.CATALOG_READ,
              PermissionCode.CATALOG_WRITE,
            ],
          },
        },
        { upsert: true },
      );
    }
  });

  // ============================================================================
  // SUITE 1: Model & Schema Validation Tests
  // ============================================================================
  describe('Suite 1: Data Model & Schema Validation', () => {
    it('creates a valid service area document', async () => {
      if (!isDbConnected) return;

      const area = new ServiceAreaModel({
        code: 'TEST-SA-CENTRAL',
        name: 'Test Central Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
        countryCode: 'IN',
        pincodes: ['560001', '560002'],
        deliveryRadiusKm: 15,
        isActive: true,
      });

      await expect(area.save()).resolves.toBeDefined();
      expect(area.code).toBe('TEST-SA-CENTRAL');
      expect(area.pincodes).toHaveLength(2);
      expect(area.isActive).toBe(true);
    });

    it('rejects invalid PIN code formats', async () => {
      if (!isDbConnected) return;

      const testCases = [
        ['56001'], // 5 digits
        ['5600001'], // 7 digits
        ['56000A'], // Alphanumeric
        ['056001'], // Starts with 0
        ['-56001'], // Negative
      ];

      for (const [badPin] of testCases) {
        const area = new ServiceAreaModel({
          code: 'TEST-SA-INVALID-PIN',
          name: 'Invalid Area',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: [badPin],
        });

        await expect(area.validate()).rejects.toThrow();
      }
    });

    it('rejects duplicate PIN codes within the same service area array', async () => {
      if (!isDbConnected) return;

      const area = new ServiceAreaModel({
        code: 'TEST-SA-DUP-PIN',
        name: 'Duplicate Pins',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560001', '560001'],
      });

      await expect(area.validate()).rejects.toThrow(/Duplicate PIN codes/);
    });

    it('enforces unique service area code index', async () => {
      if (!isDbConnected) return;

      await ServiceAreaModel.create({
        code: 'TEST-SA-UNIQUE',
        name: 'First Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560010'],
      });

      const duplicate = new ServiceAreaModel({
        code: 'TEST-SA-UNIQUE',
        name: 'Second Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560011'],
      });

      await expect(duplicate.save()).rejects.toThrow(/duplicate key error/);
    });

    it('partner model supports authoritative serviceAreaIds with multikey index', async () => {
      if (!isDbConnected) return;

      const partner = await PartnerModel.findById(partnerADoc._id);
      expect(partner).toBeDefined();
      expect(Array.isArray(partner?.serviceAreaIds)).toBe(true);
      expect(partner?.serviceAreaIds).toHaveLength(0);
    });
  });

  // ============================================================================
  // SUITE 2: Public Location Eligibility Lookup (GET /check)
  // ============================================================================
  describe('Suite 2: Public Location Eligibility Lookup', () => {
    beforeEach(async () => {
      if (!isDbConnected) return;

      await ServiceAreaModel.create({
        code: 'TEST-SA-EAST',
        name: 'Bengaluru East',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560037'],
        deliveryRadiusKm: 20,
        isActive: true,
      });

      await ServiceAreaModel.create({
        code: 'TEST-SA-INACTIVE',
        name: 'Bengaluru Inactive',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560099'],
        isActive: false,
      });
    });

    it('returns serviceable: true with public metadata for active covered PIN code', async () => {
      const res = await request(app).get('/api/v1/service-areas/check?pincode=560037');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.serviceable).toBe(true);
      expect(res.body.data.pincode).toBe('560037');
      expect(res.body.data.serviceArea).toMatchObject({
        code: 'TEST-SA-EAST',
        name: 'Bengaluru East',
        city: 'Bengaluru',
        state: 'Karnataka',
      });

      // Security check: Must NOT leak operational internals
      expect(res.body.data.serviceArea.deliveryRadiusKm).toBeUndefined();
      expect(res.body.data.serviceArea.partnerIds).toBeUndefined();
    });

    it('returns serviceable: false for unknown PIN code without error', async () => {
      const res = await request(app).get('/api/v1/service-areas/check?pincode=560050');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.serviceable).toBe(false);
      expect(res.body.data.pincode).toBe('560050');
      expect(res.body.data.serviceArea).toBeUndefined();
    });

    it('returns serviceable: false for PIN code covered by an INACTIVE service area', async () => {
      const res = await request(app).get('/api/v1/service-areas/check?pincode=560099');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.serviceable).toBe(false);
      expect(res.body.data.serviceArea).toBeUndefined();
    });

    it('normalizes whitespace around PIN code query parameter', async () => {
      const res = await request(app).get('/api/v1/service-areas/check?pincode=%20560037%20');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.serviceable).toBe(true);
      expect(res.body.data.pincode).toBe('560037');
    });

    it('rejects malformed PIN code with HTTP 400 validation error', async () => {
      const invalidQueries = ['56003', '5600377', 'ABCDEF', '056037', ''];

      for (const badPin of invalidQueries) {
        const res = await request(app).get(`/api/v1/service-areas/check?pincode=${badPin}`);

        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('INVALID_PINCODE');
      }
    });
  });

  // ============================================================================
  // SUITE 3: Administrative CRUD Endpoints (/api/v1/service-areas)
  // ============================================================================
  describe('Suite 3: Administrative Service Area Management', () => {
    it('rejects unauthenticated requests to administrative endpoints with HTTP 401', async () => {
      const res = await request(app).get('/api/v1/service-areas');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects authenticated users lacking required permissions with HTTP 403', async () => {
      const res = await request(app)
        .post('/api/v1/service-areas')
        .set('Authorization', `Bearer ${unauthorizedToken}`)
        .send({
          code: 'TEST-SA-DENIED',
          name: 'Denied Area',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: ['560001'],
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('allows authorized admin to create a new service area (HTTP 201)', async () => {
      const res = await request(app)
        .post('/api/v1/service-areas')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'test-sa-north', // lower case input to test uppercase transform
          name: 'Bengaluru North (Yelahanka)',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: ['560064'],
          deliveryRadiusKm: 25,
          isActive: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.code).toBe('TEST-SA-NORTH');
      expect(res.body.data.pincodes).toEqual(['560064']);
      expect(res.body.data.isActive).toBe(true);
    });

    it('rejects duplicate service area code with HTTP 409 Conflict', async () => {
      await ServiceAreaModel.create({
        code: 'TEST-SA-EXISTS',
        name: 'Existing Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560010'],
      });

      const res = await request(app)
        .post('/api/v1/service-areas')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'TEST-SA-EXISTS',
          name: 'Another Area',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: ['560011'],
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SERVICE_AREA_CODE_EXISTS');
    });

    it('rejects active PIN code coverage conflict with HTTP 409 Conflict', async () => {
      await ServiceAreaModel.create({
        code: 'TEST-SA-PRIMARY',
        name: 'Primary Active Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560020', '560021'],
        isActive: true,
      });

      // Attempt to create second active area covering overlapping PIN 560021
      const res = await request(app)
        .post('/api/v1/service-areas')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'TEST-SA-OVERLAP',
          name: 'Overlapping Area',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: ['560021', '560022'],
          isActive: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PIN_COVERAGE_CONFLICT');
      expect(res.body.error.message).toContain('560021');
    });

    it('lists service areas with filtering and pagination', async () => {
      await ServiceAreaModel.create([
        {
          code: 'TEST-SA-LIST-1',
          name: 'Bengaluru Area 1',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: ['560030'],
          isActive: true,
        },
        {
          code: 'TEST-SA-LIST-2',
          name: 'Mysuru Area 1',
          city: 'Mysuru',
          state: 'Karnataka',
          pincodes: ['570001'],
          isActive: true,
        },
      ]);

      const res = await request(app)
        .get('/api/v1/service-areas?city=Bengaluru')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items.every((a: IServiceArea) => a.city === 'Bengaluru')).toBe(true);
    });

    it('retrieves service area details by ID', async () => {
      const created = await ServiceAreaModel.create({
        code: 'TEST-SA-DETAIL',
        name: 'Detail Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560040'],
        deliveryRadiusKm: 12,
        isActive: true,
      });

      const res = await request(app)
        .get(`/api/v1/service-areas/${created._id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.code).toBe('TEST-SA-DETAIL');
      expect(res.body.data.deliveryRadiusKm).toBe(12);
    });

    it('updates service area details and deactivates/reactivates cleanly', async () => {
      const created = await ServiceAreaModel.create({
        code: 'TEST-SA-UPDATE',
        name: 'Initial Name',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560045'],
        isActive: true,
      });

      // Update name and deactivate
      const res = await request(app)
        .patch(`/api/v1/service-areas/${created._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Updated Name',
          isActive: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Updated Name');
      expect(res.body.data.isActive).toBe(false);

      // Verify public check now returns serviceable: false
      const checkRes = await request(app).get('/api/v1/service-areas/check?pincode=560045');
      expect(checkRes.body.data.serviceable).toBe(false);
    });

    it('rejects updating an inactive area to active if PIN conflicts with another active area', async () => {
      // Active Area
      await ServiceAreaModel.create({
        code: 'TEST-SA-ACT-1',
        name: 'Active Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560055'],
        isActive: true,
      });

      // Inactive Area sharing PIN 560055
      const inactive = await ServiceAreaModel.create({
        code: 'TEST-SA-INACT-2',
        name: 'Inactive Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560055'],
        isActive: false,
      });

      // Attempting to activate inactive area must fail with 409 PIN_COVERAGE_CONFLICT
      const res = await request(app)
        .patch(`/api/v1/service-areas/${inactive._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PIN_COVERAGE_CONFLICT');
    });
  });

  // ============================================================================
  // SUITE 4: Partner Assignment & Tenant Isolation
  // ============================================================================
  describe('Suite 4: Partner Service Area Assignment & Tenant Isolation', () => {
    let serviceArea1: IServiceAreaDocument;
    let serviceArea2: IServiceAreaDocument;
    let inactiveServiceArea: IServiceAreaDocument;

    beforeEach(async () => {
      if (!isDbConnected) return;

      serviceArea1 = await ServiceAreaModel.create({
        code: 'TEST-SA-PARTNER-1',
        name: 'Partner Service Hub 1',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560068'],
        isActive: true,
      });

      serviceArea2 = await ServiceAreaModel.create({
        code: 'TEST-SA-PARTNER-2',
        name: 'Partner Service Hub 2',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560086'],
        isActive: true,
      });

      inactiveServiceArea = await ServiceAreaModel.create({
        code: 'TEST-SA-PARTNER-INACTIVE',
        name: 'Partner Service Hub Inactive',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560090'],
        isActive: false,
      });
    });

    it('allows admin to assign active service areas to Partner A', async () => {
      const res = await request(app)
        .put(`/api/v1/partners/${partnerADoc._id}/service-areas`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          serviceAreaIds: [serviceArea1._id.toString(), serviceArea2._id.toString()],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.serviceAreaIds).toHaveLength(2);

      // Verify directly on Partner document
      const partner = await PartnerModel.findById(partnerADoc._id);
      expect(partner?.serviceAreaIds.map((id) => id.toString())).toEqual(
        expect.arrayContaining([serviceArea1._id.toString(), serviceArea2._id.toString()]),
      );
    });

    it('rejects assignment containing an INACTIVE service area with HTTP 400', async () => {
      const res = await request(app)
        .put(`/api/v1/partners/${partnerADoc._id}/service-areas`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          serviceAreaIds: [serviceArea1._id.toString(), inactiveServiceArea._id.toString()],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INACTIVE_SERVICE_AREA_ASSIGNMENT');
    });

    it('rejects assignment containing a nonexistent service area ID with HTTP 404', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .put(`/api/v1/partners/${partnerADoc._id}/service-areas`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          serviceAreaIds: [fakeId],
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SERVICE_AREA_NOT_FOUND');
    });

    it('allows admin to inspect partners assigned to a service area', async () => {
      // Assign serviceArea1 to Partner A and Partner B
      await PartnerModel.findByIdAndUpdate(partnerADoc._id, {
        serviceAreaIds: [serviceArea1._id],
      });
      await PartnerModel.findByIdAndUpdate(partnerBDoc._id, {
        serviceAreaIds: [serviceArea1._id],
      });

      const res = await request(app)
        .get(`/api/v1/service-areas/${serviceArea1._id}/partners`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((p: IServiceAreaPartnerItem) => p.businessName)).toEqual(
        expect.arrayContaining(['Test Partner Alpha Materials', 'Test Partner Beta Hardware']),
      );
    });

    it('allows Partner A to fetch their own assigned service areas', async () => {
      await PartnerModel.findByIdAndUpdate(partnerADoc._id, {
        serviceAreaIds: [serviceArea1._id],
      });

      const res = await request(app)
        .get(`/api/v1/partners/${partnerADoc._id}/service-areas`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].code).toBe('TEST-SA-PARTNER-1');
    });

    it('allows Partner B to fetch their own assigned service areas', async () => {
      await PartnerModel.findByIdAndUpdate(partnerBDoc._id, {
        serviceAreaIds: [serviceArea2._id],
      });

      const res = await request(app)
        .get(`/api/v1/partners/${partnerBDoc._id}/service-areas`)
        .set('Authorization', `Bearer ${partnerBToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].code).toBe('TEST-SA-PARTNER-2');
    });

    it('TENANT ISOLATION: Partner A CANNOT access Partner B service areas (HTTP 403 TENANT_MISMATCH)', async () => {
      // Partner A attempts to query Partner B's route parameter
      const res = await request(app)
        .get(`/api/v1/partners/${partnerBDoc._id}/service-areas`)
        .set('Authorization', `Bearer ${partnerAToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('TENANT_MISMATCH');
    });

    it('prevents non-admin partner from modifying service area assignments', async () => {
      const res = await request(app)
        .put(`/api/v1/partners/${partnerADoc._id}/service-areas`)
        .set('Authorization', `Bearer ${partnerAToken}`)
        .send({
          serviceAreaIds: [serviceArea1._id.toString()],
        });

      // Partner principal does not possess SERVICE_AREA_WRITE / PARTNER_VERIFY
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });

  // ============================================================================
  // SUITE 5: Seed Data & Bengaluru Fixtures
  // ============================================================================
  describe('Suite 5: Development & Test Seed Fixtures', () => {
    it('seeds the 5 confirmed Bengaluru PIN codes idempotently', async () => {
      if (!isDbConnected) return;

      const seeded1 = await serviceAreaService.seedBengaluruServiceAreas();
      expect(seeded1).toHaveLength(5);

      // Re-running seed must NOT create duplicates
      const seeded2 = await serviceAreaService.seedBengaluruServiceAreas();
      expect(seeded2).toHaveLength(5);

      const allBengaluru = await ServiceAreaModel.find({
        code: { $in: ['BLR-CENTRAL', 'BLR-EAST', 'BLR-SOUTH', 'BLR-NORTH', 'BLR-WEST'] },
      });
      expect(allBengaluru).toHaveLength(5);

      // Verify each of the 5 PIN codes is serviceable
      const testPins = ['560001', '560037', '560068', '560064', '560086'];
      for (const pin of testPins) {
        const check = await serviceAreaService.checkPincodeServiceability(pin);
        expect(check.serviceable).toBe(true);
        expect(check.pincode).toBe(pin);
        expect(check.serviceArea).toBeDefined();
      }
    });
  });

  // ============================================================================
  // SUITE 6: Case-Insensitive Code Uniqueness & Collation
  // ============================================================================
  describe('Suite 6: Case-Insensitive Code Uniqueness & Normalization', () => {
    it('rejects creating duplicate service area code differing only by casing (409 Conflict)', async () => {
      if (!isDbConnected) return;

      await ServiceAreaModel.create({
        code: 'TEST-SA-COLLATION',
        name: 'Uppercase Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560071'],
        isActive: true,
      });

      // Attempt to create with lower-case code via API
      const res = await request(app)
        .post('/api/v1/service-areas')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: 'test-sa-collation',
          name: 'Lowercase Collision Area',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: ['560072'],
          isActive: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SERVICE_AREA_CODE_EXISTS');
    });

    it('database collation index rejects direct database writes differing only by casing', async () => {
      if (!isDbConnected) return;

      await ServiceAreaModel.create({
        code: 'TEST-SA-DB-COLLATION',
        name: 'First Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560073'],
      });

      // Direct Mongoose model creation bypassing API
      const duplicateLower = new ServiceAreaModel({
        code: 'test-sa-db-collation',
        name: 'Second Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560074'],
      });

      // Must be rejected by database collation index (unique_code_ci)
      await expect(duplicateLower.save()).rejects.toThrow();
    });

    it('normalizes leading and trailing whitespace on service area code', async () => {
      if (!isDbConnected) return;

      const res = await request(app)
        .post('/api/v1/service-areas')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          code: '   TEST-SA-TRIM   ',
          name: 'Trimmed Area',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: ['560075'],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe('TEST-SA-TRIM');
    });
  });

  // ============================================================================
  // SUITE 7: Active PIN-Code Coverage Concurrency Regression
  // ============================================================================
  describe('Suite 7: Active PIN-Code Coverage Concurrency Regression', () => {
    it('concurrent creation of two active areas with overlapping PIN: exactly ONE succeeds (409 Conflict)', async () => {
      if (!isDbConnected) return;

      const competingPin = '560091';

      // Fire two competing requests simultaneously
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/service-areas')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            code: 'TEST-SA-RACE-1',
            name: 'Competing Area 1',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincodes: [competingPin],
            isActive: true,
          }),
        request(app)
          .post('/api/v1/service-areas')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            code: 'TEST-SA-RACE-2',
            name: 'Competing Area 2',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincodes: [competingPin],
            isActive: true,
          }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);

      const failureRes = res1.status === 409 ? res1 : res2;
      expect(failureRes.body.error.code).toBe('PIN_COVERAGE_CONFLICT');

      // Verify at the database level that exactly one active document covers this PIN
      const activeCoveringAreas = await ServiceAreaModel.find({
        pincodes: competingPin,
        isActive: true,
      });
      expect(activeCoveringAreas).toHaveLength(1);
    });

    it('concurrent activation of two areas with overlapping PIN: exactly ONE succeeds (409 Conflict)', async () => {
      if (!isDbConnected) return;

      const competingPin = '560092';

      // Create two inactive service areas sharing the PIN
      const [area1, area2] = await Promise.all([
        ServiceAreaModel.create({
          code: 'TEST-SA-INACT-RACE-1',
          name: 'Inactive Race 1',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: [competingPin],
          isActive: false,
        }),
        ServiceAreaModel.create({
          code: 'TEST-SA-INACT-RACE-2',
          name: 'Inactive Race 2',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: [competingPin],
          isActive: false,
        }),
      ]);

      // Fire simultaneous activation requests
      const [res1, res2] = await Promise.all([
        request(app)
          .patch(`/api/v1/service-areas/${area1._id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ isActive: true }),
        request(app)
          .patch(`/api/v1/service-areas/${area2._id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ isActive: true }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const failureRes = res1.status === 409 ? res1 : res2;
      expect(failureRes.body.error.code).toBe('PIN_COVERAGE_CONFLICT');

      // Database verification
      const activeCoveringAreas = await ServiceAreaModel.find({
        pincodes: competingPin,
        isActive: true,
      });
      expect(activeCoveringAreas).toHaveLength(1);
    });

    it('deactivation releases PIN code allowing subsequent activation of another area', async () => {
      if (!isDbConnected) return;

      const sharedPin = '560093';

      const activeArea = await ServiceAreaModel.create({
        code: 'TEST-SA-ACTIVE-REL',
        name: 'Active Area To Release',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: [sharedPin],
        isActive: true,
      });

      const inactiveArea = await ServiceAreaModel.create({
        code: 'TEST-SA-INACT-WAIT',
        name: 'Inactive Area Waiting',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: [sharedPin],
        isActive: false,
      });

      // 1. Deactivate activeArea
      const deactRes = await request(app)
        .patch(`/api/v1/service-areas/${activeArea._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });
      expect(deactRes.status).toBe(200);

      // 2. Now activate inactiveArea - must succeed since sharedPin is no longer actively covered
      const actRes = await request(app)
        .patch(`/api/v1/service-areas/${inactiveArea._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: true });
      expect(actRes.status).toBe(200);
      expect(actRes.body.data.isActive).toBe(true);

      const check = await serviceAreaService.checkPincodeServiceability(sharedPin);
      expect(check.serviceable).toBe(true);
      expect(check.serviceArea?.code).toBe('TEST-SA-INACT-WAIT');
    });
  });

  // ============================================================================
  // SUITE 8: Granular RBAC & Route Authorization Audit
  // ============================================================================
  describe('Suite 8: Granular RBAC & Route Authorization Audit', () => {
    let saReaderToken: string;
    let saWriterToken: string;
    let catalogReaderOnlyToken: string;
    let catalogWriterOnlyToken: string;

    beforeAll(async () => {
      if (!isDbConnected) return;

      // 1. Service Area Reader
      await RoleModel.create({
        code: 'SA_TEST_READER',
        name: 'Service Area Reader',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.SERVICE_AREA_READ],
      });
      const saReaderUser = await UserModel.create({
        phone: '+919777700031',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['SA_TEST_READER'],
      });
      saReaderToken = tokenService.signAccessToken(saReaderUser);

      // 2. Service Area Writer
      await RoleModel.create({
        code: 'SA_TEST_WRITER',
        name: 'Service Area Writer',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.SERVICE_AREA_WRITE],
      });
      const saWriterUser = await UserModel.create({
        phone: '+919777700032',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['SA_TEST_WRITER'],
      });
      saWriterToken = tokenService.signAccessToken(saWriterUser);

      // 3. Catalog-only Reader
      await RoleModel.create({
        code: 'SA_TEST_CAT_READ',
        name: 'Catalog Only Reader',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.CATALOG_READ],
      });
      const catReaderUser = await UserModel.create({
        phone: '+919777700033',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['SA_TEST_CAT_READ'],
      });
      catalogReaderOnlyToken = tokenService.signAccessToken(catReaderUser);

      // 4. Catalog-only Writer
      await RoleModel.create({
        code: 'SA_TEST_CAT_WRITE',
        name: 'Catalog Only Writer',
        userType: UserType.STAFF,
        isSystemManaged: false,
        permissions: [PermissionCode.CATALOG_WRITE],
      });
      const catWriterUser = await UserModel.create({
        phone: '+919777700034',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['SA_TEST_CAT_WRITE'],
      });
      catalogWriterOnlyToken = tokenService.signAccessToken(catWriterUser);
    });

    it('SERVICE_AREA_READ user CAN read service areas but CANNOT create', async () => {
      // Can read
      const readRes = await request(app)
        .get('/api/v1/service-areas')
        .set('Authorization', `Bearer ${saReaderToken}`);
      expect(readRes.status).toBe(200);

      // Cannot write
      const writeRes = await request(app)
        .post('/api/v1/service-areas')
        .set('Authorization', `Bearer ${saReaderToken}`)
        .send({
          code: 'TEST-SA-RBAC-NO',
          name: 'Denied',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: ['560076'],
        });
      expect(writeRes.status).toBe(403);
    });

    it('SERVICE_AREA_WRITE user CAN create service areas but CANNOT read list', async () => {
      // Can write
      const writeRes = await request(app)
        .post('/api/v1/service-areas')
        .set('Authorization', `Bearer ${saWriterToken}`)
        .send({
          code: 'TEST-SA-RBAC-OK',
          name: 'Writer Permitted',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: ['560077'],
        });
      expect(writeRes.status).toBe(201);

      // Cannot read list
      const readRes = await request(app)
        .get('/api/v1/service-areas')
        .set('Authorization', `Bearer ${saWriterToken}`);
      expect(readRes.status).toBe(403);
    });

    it('CATALOG_READ only user CANNOT read service areas (HTTP 403 - no catalog leak)', async () => {
      const res = await request(app)
        .get('/api/v1/service-areas')
        .set('Authorization', `Bearer ${catalogReaderOnlyToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('CATALOG_WRITE only user CANNOT create service areas (HTTP 403 - no catalog leak)', async () => {
      const res = await request(app)
        .post('/api/v1/service-areas')
        .set('Authorization', `Bearer ${catalogWriterOnlyToken}`)
        .send({
          code: 'TEST-SA-CAT-LEAK',
          name: 'Leaked Write Attempt',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincodes: ['560078'],
        });
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('unauthenticated user is rejected with HTTP 401', async () => {
      const res = await request(app).get('/api/v1/service-areas');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('unauthorized staff user without service area permissions is rejected with HTTP 403', async () => {
      const res = await request(app)
        .get('/api/v1/service-areas')
        .set('Authorization', `Bearer ${unauthorizedToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // ============================================================================
  // SUITE 9: Production Seed Safety Regression
  // ============================================================================
  describe('Suite 9: Production Seed Safety Regression', () => {
    it('unconditionally rejects running seed in production even if ALLOW_PROD_SEEDING=true is set', async () => {
      // Simulate production environment
      const originalConfig = envConfig.getConfig();
      const configSpy = vi.spyOn(envConfig, 'getConfig').mockReturnValue({
        ...originalConfig,
        isProduction: true,
      });

      process.env.ALLOW_PROD_SEEDING = 'true';

      try {
        await expect(runServiceAreaSeed()).rejects.toThrow(
          /Development fixture seeding is permanently blocked in production environments/,
        );
      } finally {
        configSpy.mockRestore();
        delete process.env.ALLOW_PROD_SEEDING;
      }
    });
  });
});
