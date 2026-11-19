import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase } from '../src/database/database.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { PartnerModel, type IPartnerDocument } from '../src/models/partner.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { RefreshTokenModel } from '../src/models/refresh-token.model.js';
import { PartnerAuditLogModel } from '../src/models/partner-audit-log.model.js';
import { PhoneOtpModel } from '../src/models/phone-otp.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { OtpService, hashOtp } from '../src/services/otp/otp.service.js';
import { getConfig } from '../src/config/env.js';
import { UserType, UserStatus, PermissionCode, DeliveryMode } from '@thehomez/shared-types';

describe('Stage C-8B.1: Admin Partner Management Security, Transaction & Regression Verification', () => {
  let app: Application;
  let tokenService: TokenService;
  let otpService: OtpService;
  let isDbConnected = false;

  // Staff Users & Tokens
  let superAdminUser: IUserDocument;
  let superAdminToken: string;

  let partnerReaderStaff: IUserDocument;
  let partnerReaderToken: string;

  let partnerVerifierStaff: IUserDocument;
  let partnerVerifierToken: string;

  let partnerSuspenderStaff: IUserDocument;
  let partnerSuspenderToken: string;

  let staffNoPartnerPerm: IUserDocument;
  let staffNoPartnerPermToken: string;

  // Customer & Partner Users
  let regularCustomer: IUserDocument;
  let regularCustomerToken: string;

  // Test Service Area
  let testServiceArea: InstanceType<typeof ServiceAreaModel>;

  // Partner Test Fixtures
  let activePartner: IPartnerDocument;
  let pendingPartner: IPartnerDocument;
  let inactivePartner: IPartnerDocument;
  let suspendedPartner: IPartnerDocument;

  // Linked Partner Users
  let activePartnerUser: IUserDocument;
  let activePartnerUserToken: string;
  let suspendedPartnerUser: IUserDocument;

  beforeAll(async () => {
    try {
      await connectDatabase(undefined, { serverSelectionTimeoutMS: 30000 });
      isDbConnected = true;
    } catch (err) {
      console.warn('MongoDB connection unavailable for test suite:', err);
      throw err;
    }

    tokenService = new TokenService();
    otpService = new OtpService();
    app = createApp();

    if (isDbConnected) {
      // Clean up previous test artifacts
      await Promise.all([
        UserModel.deleteMany({ phone: { $regex: /^\+919977/ } }),
        RoleModel.deleteMany({ code: { $regex: /^TEST_ADMIN_PARTNER_/ } }),
        ServiceAreaModel.deleteMany({ code: { $regex: /^TEST-PARTNER-SA/ } }),
        PartnerModel.deleteMany({ phone: { $regex: /^\+919977/ } }),
        RefreshTokenModel.deleteMany({ tokenHash: { $regex: /^dummy_active_part_refresh/ } }),
        PartnerAuditLogModel.collection.deleteMany({}),
        PhoneOtpModel.deleteMany({ phone: { $regex: /^\+919977/ } }),
      ]);

      // 1. Service Area
      testServiceArea = await ServiceAreaModel.create({
        code: 'TEST-PARTNER-SA-1',
        name: 'Bengaluru East Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560037', '560066'],
        isActive: true,
      });

      // 2. Roles
      await RoleModel.create([
        {
          code: 'TEST_ADMIN_PARTNER_SUPER',
          name: 'Super Admin Partner Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: Object.values(PermissionCode),
        },
        {
          code: 'TEST_ADMIN_PARTNER_READ_ONLY',
          name: 'Partner Read Only Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.PARTNER_READ],
        },
        {
          code: 'TEST_ADMIN_PARTNER_VERIFY_ONLY',
          name: 'Partner Verify Only Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.PARTNER_READ, PermissionCode.PARTNER_VERIFY],
        },
        {
          code: 'TEST_ADMIN_PARTNER_SUSPEND_ONLY',
          name: 'Partner Suspend Only Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.PARTNER_READ, PermissionCode.PARTNER_SUSPEND],
        },
        {
          code: 'TEST_ADMIN_PARTNER_NO_PERM',
          name: 'Staff No Partner Perm Role',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CATALOG_READ],
        },
        {
          code: 'TEST_ADMIN_PARTNER_OPERATIVE',
          name: 'Partner Operative Role',
          userType: UserType.PARTNER,
          isSystemManaged: false,
          permissions: [PermissionCode.PARTNER_AVAILABILITY_READ],
        },
      ]);

      // 3. Test Partners
      activePartner = await PartnerModel.create({
        businessName: 'Apex Building Solutions',
        legalName: 'Apex Infra Materials Ltd',
        phone: '+919977000001',
        email: 'ops@apexinfra.com',
        serviceAreaIds: [testServiceArea._id],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
        metadata: { source: 'TEST_HARNESS' },
      });

      pendingPartner = await PartnerModel.create({
        businessName: 'Karnataka Brick Works',
        legalName: 'KBW Suppliers LLP',
        phone: '+919977000002',
        email: 'contact@kbwbricks.com',
        serviceAreaIds: [testServiceArea._id],
        status: 'PENDING_VERIFICATION',
        deliveryMode: DeliveryMode.PLATFORM_MANAGED,
        metadata: { source: 'TEST_HARNESS' },
      });

      inactivePartner = await PartnerModel.create({
        businessName: 'Decan Aggregates Depot',
        legalName: 'Decan Aggregates Pvt Ltd',
        phone: '+919977000003',
        email: 'depot@decanagg.com',
        serviceAreaIds: [],
        status: 'INACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
        metadata: { source: 'TEST_HARNESS' },
      });

      suspendedPartner = await PartnerModel.create({
        businessName: 'Malabar Steel Fabricators',
        legalName: 'Malabar Steels Ltd',
        phone: '+919977000004',
        email: 'admin@malabarsteels.com',
        serviceAreaIds: [testServiceArea._id],
        status: 'SUSPENDED',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
        metadata: { source: 'TEST_HARNESS' },
      });

      // 4. Test Users
      const createdUsers = await UserModel.create([
        {
          phone: '+919977100001',
          email: 'superadmin-part@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_ADMIN_PARTNER_SUPER'],
        },
        {
          phone: '+919977100002',
          email: 'reader-part@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_ADMIN_PARTNER_READ_ONLY'],
        },
        {
          phone: '+919977100003',
          email: 'verifier-part@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_ADMIN_PARTNER_VERIFY_ONLY'],
        },
        {
          phone: '+919977100004',
          email: 'suspender-part@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_ADMIN_PARTNER_SUSPEND_ONLY'],
        },
        {
          phone: '+919977100005',
          email: 'noperm-part@thehomez.in',
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['TEST_ADMIN_PARTNER_NO_PERM'],
        },
        {
          phone: '+919977100006',
          email: 'regular-cust@thehomez.in',
          userType: UserType.CUSTOMER,
          status: UserStatus.ACTIVE,
          roles: [],
        },
        {
          phone: '+919977100007',
          email: 'partner-user-active@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: activePartner._id,
          roles: ['TEST_ADMIN_PARTNER_OPERATIVE'],
        },
        {
          phone: '+919977100008',
          email: 'partner-user-suspended@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: suspendedPartner._id,
          roles: ['TEST_ADMIN_PARTNER_OPERATIVE'],
        },
      ]);

      superAdminUser = createdUsers[0]!;
      partnerReaderStaff = createdUsers[1]!;
      partnerVerifierStaff = createdUsers[2]!;
      partnerSuspenderStaff = createdUsers[3]!;
      staffNoPartnerPerm = createdUsers[4]!;
      regularCustomer = createdUsers[5]!;
      activePartnerUser = createdUsers[6]!;
      suspendedPartnerUser = createdUsers[7]!;

      superAdminToken = tokenService.signAccessToken(superAdminUser);
      partnerReaderToken = tokenService.signAccessToken(partnerReaderStaff);
      partnerVerifierToken = tokenService.signAccessToken(partnerVerifierStaff);
      partnerSuspenderToken = tokenService.signAccessToken(partnerSuspenderStaff);
      staffNoPartnerPermToken = tokenService.signAccessToken(staffNoPartnerPerm);
      regularCustomerToken = tokenService.signAccessToken(regularCustomer);
      activePartnerUserToken = tokenService.signAccessToken(activePartnerUser);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (isDbConnected) {
      await Promise.all([
        UserModel.deleteMany({ phone: { $regex: /^\+919977/ } }),
        RoleModel.deleteMany({ code: { $regex: /^TEST_ADMIN_PARTNER_/ } }),
        ServiceAreaModel.deleteMany({ code: { $regex: /^TEST-PARTNER-SA/ } }),
        PartnerModel.deleteMany({ phone: { $regex: /^\+919977/ } }),
        RefreshTokenModel.deleteMany({ tokenHash: { $regex: /^dummy_active_part_refresh/ } }),
        PartnerAuditLogModel.collection.deleteMany({}),
        PhoneOtpModel.deleteMany({ phone: { $regex: /^\+919977/ } }),
      ]);
    }
  });

  describe('Section 1: Authentication, Route Protection & Probing Prevention', () => {
    it('rejects unauthenticated requests to GET /api/v1/admin/partners with 401', async () => {
      const res = await request(app).get('/api/v1/admin/partners');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects CUSTOMER caller to GET /api/v1/admin/partners with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners')
        .set('Authorization', `Bearer ${regularCustomerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects PARTNER caller to GET /api/v1/admin/partners with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners')
        .set('Authorization', `Bearer ${activePartnerUserToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects STAFF lacking PARTNER_READ with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners')
        .set('Authorization', `Bearer ${staffNoPartnerPermToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('prohibits partner existence probing: unprivileged caller targeting non-existent partnerId receives 403, NOT 404', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${nonExistentId}/status`)
        .set('Authorization', `Bearer ${staffNoPartnerPermToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Probing for partner existence using unprivileged token',
        });

      // Authorization guard must reject with 403 before partner lookup can occur
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff possessing only PARTNER_READ from status mutations with 403 FORBIDDEN', async () => {
      const res1 = await request(app)
        .patch(`/api/v1/admin/partners/${activePartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${partnerReaderToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Read-only staff attempting suspension',
        });
      expect(res1.status).toBe(403);
      expect(res1.body.error.code).toBe('FORBIDDEN');

      const res2 = await request(app)
        .patch(`/api/v1/admin/partners/${activePartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${partnerReaderToken}`)
        .send({
          status: 'INACTIVE',
          reason: 'Read-only staff attempting inactivation',
        });
      expect(res2.status).toBe(403);
      expect(res2.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Section 2: API 1 — GET /api/v1/admin/partners (Directory Listing)', () => {
    it('returns paginated partner directory for staff with PARTNER_READ', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners')
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(20);
      expect(res.body.data.pagination.total).toBeGreaterThanOrEqual(4);

      // Verify DTO fields
      const item = res.body.data.items.find(
        (p: { id: string }) => p.id === activePartner._id.toString(),
      );
      expect(item).toBeDefined();
      expect(item.businessName).toBe('Apex Building Solutions');
      expect(item.legalName).toBe('Apex Infra Materials Ltd');
      expect(item.status).toBe('ACTIVE');
      expect(item.serviceAreaCount).toBe(1);
      expect(item.deliveryMode).toBe('PARTNER_MANAGED');
    });

    it('filters partner directory by status', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners?status=PENDING_VERIFICATION')
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(
        res.body.data.items.every((p: { status: string }) => p.status === 'PENDING_VERIFICATION'),
      ).toBe(true);
      expect(
        res.body.data.items.some((p: { id: string }) => p.id === pendingPartner._id.toString()),
      ).toBe(true);
    });

    it('filters partner directory by search term across businessName', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners?search=Malabar')
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].id).toBe(suspendedPartner._id.toString());
    });

    it('filters partner directory by serviceAreaId', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners?serviceAreaId=${testServiceArea._id.toString()}`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(3);
    });

    it('safely escapes special regex characters in search query and prevents regex injection', async () => {
      // Regex special characters like +, (, ), [, ], *, . should not crash the search regex
      const res = await request(app)
        .get('/api/v1/admin/partners?search=%2B91%2899%2977%2A%5B')
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(0);
    });

    it('rejects limit exceeding maximum 100 with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners?limit=101')
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects page less than 1 with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners?page=0')
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Section 3: API 2 — GET /api/v1/admin/partners/:partnerId (Detail)', () => {
    it('returns 400 for malformed partnerId', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners/invalid-id')
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for non-existent partnerId', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/v1/admin/partners/${nonExistentId}`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PARTNER_NOT_FOUND');
    });

    it('returns partner detail DTO with populated service areas and linked user metrics', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/${activePartner._id.toString()}`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(activePartner._id.toString());
      expect(res.body.data.businessName).toBe('Apex Building Solutions');
      expect(res.body.data.serviceAreas.length).toBe(1);
      expect(res.body.data.serviceAreas[0].code).toBe('TEST-PARTNER-SA-1');
      expect(res.body.data.linkedUserCount).toBe(1);
    });

    it('sanitizes sensitive metadata fields (passwordHash, secret, token, otp) from detail view', async () => {
      const partnerWithSecrets = await PartnerModel.create({
        businessName: 'Secret Sanitization Partner',
        phone: '+919977000009',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
        metadata: {
          publicRegion: 'South-Zone',
          passwordHash: '$2b$10$UnsafePasswordHashSample',
          apiSecretKey: 'unsafe_secret_key_123',
          otpSecret: 'otp_pepper_9999',
          refreshToken: 'dummy_token_val',
        },
      });

      const res = await request(app)
        .get(`/api/v1/admin/partners/${partnerWithSecrets._id.toString()}`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.metadata.publicRegion).toBe('South-Zone');
      expect(res.body.data.metadata.passwordHash).toBeUndefined();
      expect(res.body.data.metadata.apiSecretKey).toBeUndefined();
      expect(res.body.data.metadata.otpSecret).toBeUndefined();
      expect(res.body.data.metadata.refreshToken).toBeUndefined();
    });
  });

  describe('Section 4: API 3 — Dynamic Target-Dependent Authorization', () => {
    it('rejects caller lacking PARTNER_SUSPEND when targeting SUSPENDED with 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${activePartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${partnerVerifierToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Regulatory compliance failure audit notice',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('allows caller with PARTNER_SUSPEND when targeting SUSPENDED', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Temporary Suspend Test Partner',
        phone: '+919977200001',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${partnerSuspenderToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Safety compliance audit failure verified',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SUSPENDED');
    });

    it('rejects caller lacking PARTNER_VERIFY when targeting INACTIVE with 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${activePartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${partnerSuspenderToken}`)
        .send({
          status: 'INACTIVE',
          reason: 'Routine seasonal closure requested by business owner',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('allows caller with PARTNER_VERIFY when targeting INACTIVE', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Temporary Inactive Test Partner',
        phone: '+919977200002',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${partnerVerifierToken}`)
        .send({
          status: 'INACTIVE',
          reason: 'Voluntary temporary maintenance shutdown',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('INACTIVE');
    });

    it('enforces authorization before verification gate (unprivileged caller targeting ACTIVE receives 403, not 400)', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${inactivePartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${staffNoPartnerPermToken}`)
        .send({
          status: 'ACTIVE',
          reason: 'Attempting unauthorized activation',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('Section 5: API 3 — Exact C-8A.8 Lifecycle Validation Order & 16-Transition Matrix', () => {
    // 1. Same-status no-ops (Step 1)
    it('Step 1: ACTIVE -> ACTIVE returns 400 INVALID_STATE_TRANSITION', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${activePartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'ACTIVE',
          reason: 'Redundant activation request validation',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(res.body.error.message).toMatch(/already active/i);
    });

    it('Step 1: INACTIVE -> INACTIVE returns 400 INVALID_STATE_TRANSITION', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${inactivePartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'INACTIVE',
          reason: 'Redundant deactivation request validation',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(res.body.error.message).toMatch(/already inactive/i);
    });

    it('Step 1: PENDING_VERIFICATION -> PENDING_VERIFICATION returns 400 INVALID_STATE_TRANSITION', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${pendingPartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'PENDING_VERIFICATION',
          reason: 'Redundant verification pending request validation',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(res.body.error.message).toMatch(/already pending_verification/i);
    });

    it('Step 1: SUSPENDED -> SUSPENDED returns 400 INVALID_STATE_TRANSITION', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${suspendedPartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Redundant suspension request validation',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(res.body.error.message).toMatch(/already suspended/i);
    });

    // 2. Genuine transitions to ACTIVE (Step 2)
    it('Step 2: PENDING_VERIFICATION -> ACTIVE returns 400 PARTNER_VERIFICATION_REQUIRED', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${pendingPartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'ACTIVE',
          reason: 'Premature activation without verification workflow',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PARTNER_VERIFICATION_REQUIRED');
    });

    it('Step 2: INACTIVE -> ACTIVE returns 400 PARTNER_VERIFICATION_REQUIRED', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${inactivePartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'ACTIVE',
          reason: 'Reactivation without verification workflow',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PARTNER_VERIFICATION_REQUIRED');
    });

    it('Step 2: SUSPENDED -> ACTIVE returns 400 PARTNER_VERIFICATION_REQUIRED', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${suspendedPartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'ACTIVE',
          reason: 'Unsuspension directly to active without verification workflow',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PARTNER_VERIFICATION_REQUIRED');
    });

    // 3. Backward transitions to PENDING_VERIFICATION (Step 3)
    it('Step 3: ACTIVE -> PENDING_VERIFICATION returns 400 INVALID_STATE_TRANSITION', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${activePartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'PENDING_VERIFICATION',
          reason: 'Illegal regression to unverified state',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('Step 3: INACTIVE -> PENDING_VERIFICATION returns 400 INVALID_STATE_TRANSITION', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${inactivePartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'PENDING_VERIFICATION',
          reason: 'Illegal regression to unverified state',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('Step 3: SUSPENDED -> PENDING_VERIFICATION returns 400 INVALID_STATE_TRANSITION', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${suspendedPartner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'PENDING_VERIFICATION',
          reason: 'Illegal regression to unverified state',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    // 4. Permitted transitions targeting INACTIVE or SUSPENDED (Steps 4 & 5)
    it('Permitted: PENDING_VERIFICATION -> INACTIVE succeeds', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Pending to Inactive Partner',
        phone: '+919977300001',
        serviceAreaIds: [],
        status: 'PENDING_VERIFICATION',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'INACTIVE',
          reason: 'Onboarding application placed on administrative hold',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('INACTIVE');
    });

    it('Permitted: PENDING_VERIFICATION -> SUSPENDED succeeds', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Pending to Suspended Partner',
        phone: '+919977300002',
        serviceAreaIds: [],
        status: 'PENDING_VERIFICATION',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Fraudulent documentation provided during onboarding',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SUSPENDED');
    });

    it('Permitted: ACTIVE -> INACTIVE succeeds', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Active to Inactive Partner',
        phone: '+919977300003',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'INACTIVE',
          reason: 'Depot temporarily closed for warehouse renovation',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('INACTIVE');
    });

    it('Permitted: ACTIVE -> SUSPENDED succeeds', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Active to Suspended Partner',
        phone: '+919977300004',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Serious breach of service delivery agreements',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SUSPENDED');
    });

    it('Permitted: INACTIVE -> SUSPENDED succeeds', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Inactive to Suspended Partner',
        phone: '+919977300005',
        serviceAreaIds: [],
        status: 'INACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Partner flagged for insolvency proceedings',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('SUSPENDED');
    });

    it('Permitted: SUSPENDED -> INACTIVE succeeds', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Suspended to Inactive Partner',
        phone: '+919977300006',
        serviceAreaIds: [],
        status: 'SUSPENDED',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'INACTIVE',
          reason: 'Penalty resolved; moved to inactive status awaiting re-audit',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('INACTIVE');
    });
  });

  describe('Section 6: Transaction Atomicity, Concurrency & Revocation Completeness', () => {
    it('rolls back partner status and leaves tokens unrevoked if audit log insertion fails', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Audit Fail Rollback Partner',
        phone: '+919977800001',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const pUser = await UserModel.create({
        phone: '+919977800002',
        email: 'audit-fail-user@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partner._id,
        roles: [],
      });

      const tokenDoc = await RefreshTokenModel.create({
        userId: pUser._id,
        userType: UserType.PARTNER,
        familyId: new Types.ObjectId().toString(),
        tokenHash: 'dummy_active_part_refresh_rollback_1',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isRevoked: false,
      });

      // Force failure during audit log creation inside transaction
      vi.spyOn(PartnerAuditLogModel, 'create').mockRejectedValueOnce(
        new Error('SIMULATED_AUDIT_INSERT_FAILURE'),
      );

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Testing transaction rollback on audit insertion failure',
        });

      expect(res.status).toBe(500);

      // Verify Partner status was NOT modified (rolled back to ACTIVE)
      const partnerAfter = await PartnerModel.findById(partner._id);
      expect(partnerAfter?.status).toBe('ACTIVE');

      // Verify RefreshToken was NOT revoked (rolled back to isRevoked: false)
      const tokenAfter = await RefreshTokenModel.findById(tokenDoc._id);
      expect(tokenAfter?.isRevoked).toBe(false);

      // Verify NO audit log document was committed
      const auditLogs = await PartnerAuditLogModel.find({ partnerId: partner._id });
      expect(auditLogs.length).toBe(0);
    });

    it('rolls back partner status and creates no audit log if token revocation fails', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Token Fail Rollback Partner',
        phone: '+919977800003',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const pUser = await UserModel.create({
        phone: '+919977800004',
        email: 'token-fail-user@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partner._id,
        roles: [],
      });

      const tokenDoc = await RefreshTokenModel.create({
        userId: pUser._id,
        userType: UserType.PARTNER,
        familyId: new Types.ObjectId().toString(),
        tokenHash: 'dummy_active_part_refresh_rollback_2',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isRevoked: false,
      });

      // Force failure during token revocation inside transaction
      vi.spyOn(RefreshTokenModel, 'updateMany').mockRejectedValueOnce(
        new Error('SIMULATED_TOKEN_REVOCATION_FAILURE'),
      );

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Testing transaction rollback on token revocation failure',
        });

      expect(res.status).toBe(500);

      // Verify Partner status was NOT modified (rolled back to ACTIVE)
      const partnerAfter = await PartnerModel.findById(partner._id);
      expect(partnerAfter?.status).toBe('ACTIVE');

      // Verify RefreshToken was NOT revoked (rolled back to isRevoked: false)
      const tokenAfter = await RefreshTokenModel.findById(tokenDoc._id);
      expect(tokenAfter?.isRevoked).toBe(false);

      // Verify NO audit log was committed
      const auditLogs = await PartnerAuditLogModel.find({ partnerId: partner._id });
      expect(auditLogs.length).toBe(0);
    });

    it('returns 409 CONCURRENT_MODIFICATION on concurrent status mutation conflict', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Concurrency Test Partner',
        phone: '+919977800005',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      // Spy on findOneAndUpdate to simulate condition mismatch (partner modified concurrently)
      vi.spyOn(PartnerModel, 'findOneAndUpdate').mockResolvedValueOnce(null);

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Testing concurrent modification detection response',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONCURRENT_MODIFICATION');
    });

    it('failed status mutation (validation or business rule) creates NO audit record', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Failed Mutation Audit Guard Partner',
        phone: '+919977800006',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      // Attempt invalid short reason
      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'short',
        });

      expect(res.status).toBe(400);

      const auditEntries = await PartnerAuditLogModel.find({ partnerId: partner._id });
      expect(auditEntries.length).toBe(0);
    });

    it('revokes active refresh tokens across multiple linked partner users (1:N multi-user tenant)', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Multi User Tenant Partner',
        phone: '+919977800007',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      // Create 2 linked partner users
      const pUser1 = await UserModel.create({
        phone: '+919977800008',
        email: 'multi-user-1@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partner._id,
        roles: [],
      });

      const pUser2 = await UserModel.create({
        phone: '+919977800009',
        email: 'multi-user-2@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partner._id,
        roles: [],
      });

      await RefreshTokenModel.create([
        {
          userId: pUser1._id,
          userType: UserType.PARTNER,
          familyId: new Types.ObjectId().toString(),
          tokenHash: 'dummy_active_part_refresh_multi_1',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        },
        {
          userId: pUser2._id,
          userType: UserType.PARTNER,
          familyId: new Types.ObjectId().toString(),
          tokenHash: 'dummy_active_part_refresh_multi_2',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        },
      ]);

      const res = await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Emergency suspension for multi-user partner organization',
        });

      expect(res.status).toBe(200);

      const tokens1 = await RefreshTokenModel.find({ userId: pUser1._id });
      expect(tokens1[0].isRevoked).toBe(true);
      expect(tokens1[0].revokedReason).toBe('SECURITY_RESET');

      const tokens2 = await RefreshTokenModel.find({ userId: pUser2._id });
      expect(tokens2[0].isRevoked).toBe(true);
      expect(tokens2[0].revokedReason).toBe('SECURITY_RESET');
    });

    it('leaves unrelated partner users tokens untouched during status mutation', async () => {
      const partnerA = await PartnerModel.create({
        businessName: 'Partner A Target',
        phone: '+919977800010',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const partnerB = await PartnerModel.create({
        businessName: 'Partner B Unrelated',
        phone: '+919977800011',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const userA = await UserModel.create({
        phone: '+919977800012',
        email: 'user-a@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerA._id,
        roles: [],
      });

      const userB = await UserModel.create({
        phone: '+919977800013',
        email: 'user-b@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partnerB._id,
        roles: [],
      });

      await RefreshTokenModel.create([
        {
          userId: userA._id,
          userType: UserType.PARTNER,
          familyId: new Types.ObjectId().toString(),
          tokenHash: 'dummy_active_part_refresh_unrelated_a',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        },
        {
          userId: userB._id,
          userType: UserType.PARTNER,
          familyId: new Types.ObjectId().toString(),
          tokenHash: 'dummy_active_part_refresh_unrelated_b',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        },
      ]);

      await request(app)
        .patch(`/api/v1/admin/partners/${partnerA._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Suspending partner A only without touching partner B',
        });

      // User A token is revoked
      const tokenA = await RefreshTokenModel.findOne({ userId: userA._id });
      expect(tokenA?.isRevoked).toBe(true);

      // User B token is untouched
      const tokenB = await RefreshTokenModel.findOne({ userId: userB._id });
      expect(tokenB?.isRevoked).toBe(false);
    });

    it('does NOT modify individual linked UserModel.status values during partner mutation', async () => {
      const partner = await PartnerModel.create({
        businessName: 'User Status Preservation Partner',
        phone: '+919977800014',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const pUser = await UserModel.create({
        phone: '+919977800015',
        email: 'user-preservation@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partner._id,
        roles: [],
      });

      await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Verifying individual user status is preserved during org suspension',
        });

      // User document status remains ACTIVE (only org status changed & tokens revoked)
      const userAfter = await UserModel.findById(pUser._id);
      expect(userAfter?.status).toBe(UserStatus.ACTIVE);
    });

    it('reactivation does NOT restore previously revoked refresh tokens', async () => {
      const partner = await PartnerModel.create({
        businessName: 'No Token Restoration Partner',
        phone: '+919977800016',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      const pUser = await UserModel.create({
        phone: '+919977800017',
        email: 'no-restore-user@thehomez.in',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: partner._id,
        roles: [],
      });

      const tokenDoc = await RefreshTokenModel.create({
        userId: pUser._id,
        userType: UserType.PARTNER,
        familyId: new Types.ObjectId().toString(),
        tokenHash: 'dummy_active_part_refresh_no_restore',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isRevoked: false,
      });

      // 1. Suspend partner (revokes token)
      await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Initial suspension revoking tokens',
        });

      // 2. Move partner from SUSPENDED to INACTIVE
      await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'INACTIVE',
          reason: 'Reactivation to inactive standby status',
        });

      // Verify token remains revoked
      const tokenAfter = await RefreshTokenModel.findById(tokenDoc._id);
      expect(tokenAfter?.isRevoked).toBe(true);
      expect(tokenAfter?.revokedReason).toBe('SECURITY_RESET');
    });

    it('revokes active refresh tokens across all 6 permitted status transitions', async () => {
      // Test matrix tuples: [fromStatus, toStatus, reason]
      const transitions: Array<
        ['ACTIVE' | 'INACTIVE' | 'PENDING_VERIFICATION' | 'SUSPENDED', 'INACTIVE' | 'SUSPENDED']
      > = [
        ['ACTIVE', 'INACTIVE'],
        ['ACTIVE', 'SUSPENDED'],
        ['PENDING_VERIFICATION', 'INACTIVE'],
        ['PENDING_VERIFICATION', 'SUSPENDED'],
        ['INACTIVE', 'SUSPENDED'],
        ['SUSPENDED', 'INACTIVE'],
      ];

      for (let i = 0; i < transitions.length; i++) {
        const [fromStatus, toStatus] = transitions[i]!;
        const phoneSuffix = String(20 + i).padStart(2, '0');

        const p = await PartnerModel.create({
          businessName: `Transition Test Partner ${fromStatus}->${toStatus}`,
          phone: `+9199778000${phoneSuffix}`,
          serviceAreaIds: [],
          status: fromStatus,
          deliveryMode: DeliveryMode.PARTNER_MANAGED,
        });

        const u = await UserModel.create({
          phone: `+9199778001${phoneSuffix}`,
          email: `trans-user-${i}@thehomez.in`,
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: p._id,
          roles: [],
        });

        const t = await RefreshTokenModel.create({
          userId: u._id,
          userType: UserType.PARTNER,
          familyId: new Types.ObjectId().toString(),
          tokenHash: `dummy_active_part_refresh_trans_${i}`,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        });

        const res = await request(app)
          .patch(`/api/v1/admin/partners/${p._id.toString()}/status`)
          .set('Authorization', `Bearer ${superAdminToken}`)
          .send({
            status: toStatus,
            reason: `Testing token revocation for transition ${fromStatus} to ${toStatus}`,
          });

        expect(res.status).toBe(200);

        const tokenAfter = await RefreshTokenModel.findById(t._id);
        expect(tokenAfter?.isRevoked).toBe(true);
        expect(tokenAfter?.revokedReason).toBe('SECURITY_RESET');
      }
    });
  });

  describe('Section 7: API 4 — GET /api/v1/admin/partners/:partnerId/audit-logs (Audit History)', () => {
    it('returns chronological audit history for staff with PARTNER_READ', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Audit History Query Partner',
        phone: '+919977500001',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      // Perform two status transitions
      await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'SUSPENDED',
          reason: 'Initial temporary suspension for verification check',
        });

      await request(app)
        .patch(`/api/v1/admin/partners/${partner._id.toString()}/status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          status: 'INACTIVE',
          reason: 'Lifted suspension and placed on inactive standby',
        });

      const res = await request(app)
        .get(`/api/v1/admin/partners/${partner._id.toString()}/audit-logs`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBe(2);
      expect(res.body.data.pagination.total).toBe(2);
      // Newest first
      expect(res.body.data.items[0].newState).toEqual({ status: 'INACTIVE' });
      expect(res.body.data.items[1].newState).toEqual({ status: 'SUSPENDED' });
    });

    it('returns 404 for non-existent partnerId audit history', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const res = await request(app)
        .get(`/api/v1/admin/partners/${nonExistentId}/audit-logs`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PARTNER_NOT_FOUND');
    });

    it('audit history endpoint strictly filters by PARTNER_STATUS_CHANGED action', async () => {
      const partner = await PartnerModel.create({
        businessName: 'Audit Action Filter Partner',
        phone: '+919977500002',
        serviceAreaIds: [],
        status: 'ACTIVE',
        deliveryMode: DeliveryMode.PARTNER_MANAGED,
      });

      // Insert two audit logs: one PARTNER_STATUS_CHANGED, one with other action
      await PartnerAuditLogModel.create([
        {
          partnerId: partner._id,
          staffUserId: superAdminUser._id,
          action: 'PARTNER_STATUS_CHANGED',
          previousState: { status: 'ACTIVE' },
          newState: { status: 'SUSPENDED' },
          reason: 'Status changed audit log entry',
        },
        {
          partnerId: partner._id,
          staffUserId: superAdminUser._id,
          action: 'PARTNER_SERVICE_AREAS_ASSIGNED',
          previousState: {},
          newState: {},
          reason: 'Service area assigned audit log entry',
        },
      ]);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${partner._id.toString()}/audit-logs`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].action).toBe('PARTNER_STATUS_CHANGED');
    });
  });

  describe('Section 8: PartnerAuditLogModel Immutability Guarantees', () => {
    it('blocks updating an existing audit document via save()', async () => {
      const logDoc = await PartnerAuditLogModel.create({
        partnerId: activePartner._id,
        staffUserId: superAdminUser._id,
        action: 'PARTNER_STATUS_CHANGED',
        previousState: { status: 'ACTIVE' },
        newState: { status: 'SUSPENDED' },
        reason: 'Immutability test baseline record creation',
      });

      logDoc.reason = 'Tampered reason attempt';
      await expect(logDoc.save()).rejects.toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);
    });

    it('blocks modifying audit documents via updateOne', async () => {
      await expect(
        PartnerAuditLogModel.updateOne(
          { partnerId: activePartner._id },
          { $set: { reason: 'Tampered' } },
        ),
      ).rejects.toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);
    });

    it('blocks modifying audit documents via updateMany', async () => {
      await expect(
        PartnerAuditLogModel.updateMany(
          { partnerId: activePartner._id },
          { $set: { reason: 'Tampered' } },
        ),
      ).rejects.toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);
    });

    it('blocks modifying audit documents via findOneAndUpdate', async () => {
      await expect(
        PartnerAuditLogModel.findOneAndUpdate(
          { partnerId: activePartner._id },
          { $set: { reason: 'Tampered' } },
        ),
      ).rejects.toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);
    });

    it('blocks modifying audit documents via replaceOne', async () => {
      await expect(
        PartnerAuditLogModel.replaceOne(
          { partnerId: activePartner._id },
          { reason: 'Tampered replacement' },
        ),
      ).rejects.toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);
    });

    it('blocks deleting audit documents via deleteOne', async () => {
      await expect(
        PartnerAuditLogModel.deleteOne({ partnerId: activePartner._id }),
      ).rejects.toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);
    });

    it('blocks deleting audit documents via deleteMany', async () => {
      await expect(
        PartnerAuditLogModel.deleteMany({ partnerId: activePartner._id }),
      ).rejects.toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);
    });

    it('blocks deleting audit documents via findOneAndDelete', async () => {
      await expect(
        PartnerAuditLogModel.findOneAndDelete({ partnerId: activePartner._id }),
      ).rejects.toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);
    });

    it('blocks replacing audit documents via findOneAndReplace', async () => {
      await expect(
        PartnerAuditLogModel.findOneAndReplace(
          { partnerId: activePartner._id },
          { reason: 'Tampered' },
        ),
      ).rejects.toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);
    });

    it('blocks modifying or deleting audit documents via bulkWrite', () => {
      expect(() =>
        PartnerAuditLogModel.bulkWrite([
          {
            updateOne: {
              filter: { partnerId: activePartner._id },
              update: { $set: { reason: 'Tampered' } },
            },
          },
        ]),
      ).toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);

      expect(() =>
        PartnerAuditLogModel.bulkWrite([
          {
            deleteOne: {
              filter: { partnerId: activePartner._id },
            },
          },
        ]),
      ).toThrow(/PARTNER_AUDIT_LOG_IMMUTABLE/);
    });

    it('blocks modifying audit documents via bulkSave', async () => {
      const existingDoc = await PartnerAuditLogModel.findOne();
      if (existingDoc) {
        existingDoc.reason = 'Tampered reason attempt';
        expect(() => PartnerAuditLogModel.bulkSave([existingDoc])).toThrow(
          /PARTNER_AUDIT_LOG_IMMUTABLE/,
        );
      }
    });

    it('confirms legitimate creation of new audit records still succeeds', async () => {
      const audit = await PartnerAuditLogModel.create({
        partnerId: activePartner._id,
        staffUserId: superAdminUser._id,
        action: 'PARTNER_STATUS_CHANGED',
        previousState: { status: 'ACTIVE' },
        newState: { status: 'SUSPENDED' },
        reason: 'Legitimate creation verification test',
      });

      expect(audit._id).toBeDefined();
      expect(audit.reason).toBe('Legitimate creation verification test');
    });
  });

  describe('Section 9: Parent Partner Tenant Enforcement (3 Touchpoints & Non-Regression)', () => {
    // Subsection 9.1: Touchpoint 1 — authenticate middleware
    describe('Touchpoint 1 — authenticate Middleware', () => {
      it('allows PARTNER caller whose parent partner is ACTIVE', async () => {
        const res = await request(app)
          .get('/api/v1/partner/availability')
          .set('Authorization', `Bearer ${activePartnerUserToken}`);

        // Passes authentication and proceeds into partner availability endpoint
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });

      it('blocks PARTNER caller whose parent partner is SUSPENDED with 403 PARTNER_NOT_ACTIVE', async () => {
        const suspendedToken = tokenService.signAccessToken(suspendedPartnerUser);
        const res = await request(app)
          .get('/api/v1/partner/availability')
          .set('Authorization', `Bearer ${suspendedToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('PARTNER_NOT_ACTIVE');
      });

      it('blocks PARTNER caller whose parent partner is INACTIVE with 403 PARTNER_NOT_ACTIVE', async () => {
        const inactivePartnerUser = await UserModel.create({
          phone: '+919977600002',
          email: 'inactive-partner-user@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: inactivePartner._id,
          roles: [],
        });

        const token = tokenService.signAccessToken(inactivePartnerUser);
        const res = await request(app)
          .get('/api/v1/partner/availability')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('PARTNER_NOT_ACTIVE');
      });

      it('blocks PARTNER caller whose parent partner is PENDING_VERIFICATION with 403 PARTNER_NOT_ACTIVE', async () => {
        const pendingPartnerUser = await UserModel.create({
          phone: '+919977600003',
          email: 'pending-partner-user@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: pendingPartner._id,
          roles: [],
        });

        const token = tokenService.signAccessToken(pendingPartnerUser);
        const res = await request(app)
          .get('/api/v1/partner/availability')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('PARTNER_NOT_ACTIVE');
      });

      it('blocks PARTNER caller with non-existent parent partner document with 403 PARTNER_NOT_FOUND', async () => {
        const ghostPartnerUser = await UserModel.create({
          phone: '+919977600004',
          email: 'ghost-partner-user@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: new Types.ObjectId(),
          roles: [],
        });

        const token = tokenService.signAccessToken(ghostPartnerUser);
        const res = await request(app)
          .get('/api/v1/partner/availability')
          .set('Authorization', `Bearer ${token}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('PARTNER_NOT_FOUND');
      });

      it('blocks PARTNER caller with missing partnerId with 403 PARTNER_CONTEXT_REQUIRED', async () => {
        const orphanedPartnerUser = await UserModel.create({
          phone: '+919977600005',
          email: 'orphaned-partner@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          // partnerId intentionally omitted
          roles: [],
        });

        const orphanedToken = tokenService.signAccessToken(orphanedPartnerUser);
        const res = await request(app)
          .get('/api/v1/partner/availability')
          .set('Authorization', `Bearer ${orphanedToken}`);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('PARTNER_CONTEXT_REQUIRED');
      });
    });

    // Subsection 9.2: Touchpoint 2 — TokenService.rotateRefreshToken
    describe('Touchpoint 2 — TokenService.rotateRefreshToken', () => {
      it('allows token rotation when parent partner is ACTIVE', async () => {
        const familyId = new Types.ObjectId().toString();
        const rawRefreshToken = `${familyId}.dummytokensecret1234567890abcdef1`;
        const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

        await RefreshTokenModel.create({
          userId: activePartnerUser._id,
          userType: UserType.PARTNER,
          familyId,
          tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        });

        const tokens = await tokenService.rotateRefreshToken(rawRefreshToken, {
          userAgent: 'vitest-agent',
          ipAddress: '127.0.0.1',
        });

        expect(tokens.accessToken).toBeDefined();
        expect(tokens.refreshToken).toBeDefined();
      });

      it('rejects rotation and revokes family with 403 PARTNER_NOT_ACTIVE when parent partner is SUSPENDED', async () => {
        const familyId = new Types.ObjectId().toString();
        const rawRefreshToken = `${familyId}.dummytokensecret1234567890abcdef2`;
        const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

        await RefreshTokenModel.create({
          userId: suspendedPartnerUser._id,
          userType: UserType.PARTNER,
          familyId,
          tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        });

        await expect(
          tokenService.rotateRefreshToken(rawRefreshToken, {
            userAgent: 'vitest-agent',
            ipAddress: '127.0.0.1',
          }),
        ).rejects.toMatchObject({
          code: 'PARTNER_NOT_ACTIVE',
          statusCode: 403,
        });

        const revokedRecord = await RefreshTokenModel.findOne({ familyId });
        expect(revokedRecord?.isRevoked).toBe(true);
        expect(revokedRecord?.revokedReason).toBe('SECURITY_RESET');
      });

      it('rejects rotation and revokes family when parent partner is INACTIVE', async () => {
        const inUser = await UserModel.create({
          phone: '+919977600010',
          email: 'in-user-rotate@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: inactivePartner._id,
          roles: [],
        });

        const familyId = new Types.ObjectId().toString();
        const rawRefreshToken = `${familyId}.dummytokensecret1234567890abcdef3`;
        const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

        await RefreshTokenModel.create({
          userId: inUser._id,
          userType: UserType.PARTNER,
          familyId,
          tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isRevoked: false,
        });

        await expect(
          tokenService.rotateRefreshToken(rawRefreshToken, {
            userAgent: 'vitest-agent',
            ipAddress: '127.0.0.1',
          }),
        ).rejects.toMatchObject({
          code: 'PARTNER_NOT_ACTIVE',
          statusCode: 403,
        });

        const revokedRecord = await RefreshTokenModel.findOne({ familyId });
        expect(revokedRecord?.isRevoked).toBe(true);
        expect(revokedRecord?.revokedReason).toBe('SECURITY_RESET');
      });

      it('refresh token reuse detection correctly revokes entire token family', async () => {
        const familyId = new Types.ObjectId().toString();
        const rawRefreshToken = `${familyId}.dummytokensecret1234567890abcdef4`;
        const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

        // Create already-revoked refresh token
        await RefreshTokenModel.create({
          userId: activePartnerUser._id,
          userType: UserType.PARTNER,
          familyId,
          tokenHash,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          isRevoked: true,
          revokedReason: 'ROTATED',
        });

        // Attempting to rotate an already revoked token is reuse
        await expect(
          tokenService.rotateRefreshToken(rawRefreshToken, {
            userAgent: 'vitest-agent',
            ipAddress: '127.0.0.1',
          }),
        ).rejects.toMatchObject({
          code: 'TOKEN_REUSE_DETECTED',
          statusCode: 401,
        });
      });
    });

    // Subsection 9.3: Touchpoint 3 — OtpService.verifyOtp
    describe('Touchpoint 3 — OtpService.verifyOtp', () => {
      it('allows OTP verification when parent partner is ACTIVE', async () => {
        const config = getConfig();
        const phone = '+919977700010';
        const plainOtp = '123456';
        const pepper = config.auth.otp.pepperSecret;
        const hashedOtp = hashOtp(plainOtp, pepper);

        await UserModel.create({
          phone,
          email: 'otp-active-partner-user@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: activePartner._id,
          roles: [],
        });

        await PhoneOtpModel.create({
          phone,
          userType: UserType.PARTNER,
          hashedOtp,
          attempts: 0,
          maxAttempts: 3,
          expiresAt: new Date(Date.now() + 300000),
          cooldownUntil: new Date(Date.now() + 60000),
          isConsumed: false,
        });

        const result = await otpService.verifyOtp(phone, plainOtp, UserType.PARTNER);
        expect(result.user).toBeDefined();
        expect(result.user.phone).toBe(phone);
      });

      it('rejects OTP verification with 403 PARTNER_NOT_ACTIVE when parent partner is SUSPENDED', async () => {
        const config = getConfig();
        const phone = '+919977700011';
        const plainOtp = '123456';
        const pepper = config.auth.otp.pepperSecret;
        const hashedOtp = hashOtp(plainOtp, pepper);

        await UserModel.create({
          phone,
          email: 'otp-suspended-partner-user@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: suspendedPartner._id,
          roles: [],
        });

        await PhoneOtpModel.create({
          phone,
          userType: UserType.PARTNER,
          hashedOtp,
          attempts: 0,
          maxAttempts: 3,
          expiresAt: new Date(Date.now() + 300000),
          cooldownUntil: new Date(Date.now() + 60000),
          isConsumed: false,
        });

        await expect(otpService.verifyOtp(phone, plainOtp, UserType.PARTNER)).rejects.toMatchObject(
          {
            code: 'PARTNER_NOT_ACTIVE',
            statusCode: 403,
          },
        );
      });

      it('rejects OTP verification with 403 PARTNER_NOT_ACTIVE when parent partner is INACTIVE', async () => {
        const config = getConfig();
        const phone = '+919977700012';
        const plainOtp = '123456';
        const pepper = config.auth.otp.pepperSecret;
        const hashedOtp = hashOtp(plainOtp, pepper);

        await UserModel.create({
          phone,
          email: 'otp-inactive-partner-user@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: inactivePartner._id,
          roles: [],
        });

        await PhoneOtpModel.create({
          phone,
          userType: UserType.PARTNER,
          hashedOtp,
          attempts: 0,
          maxAttempts: 3,
          expiresAt: new Date(Date.now() + 300000),
          cooldownUntil: new Date(Date.now() + 60000),
          isConsumed: false,
        });

        await expect(otpService.verifyOtp(phone, plainOtp, UserType.PARTNER)).rejects.toMatchObject(
          {
            code: 'PARTNER_NOT_ACTIVE',
            statusCode: 403,
          },
        );
      });

      it('rejects OTP verification with 403 PARTNER_NOT_FOUND when parent partner document is missing', async () => {
        const config = getConfig();
        const phone = '+919977700013';
        const plainOtp = '123456';
        const pepper = config.auth.otp.pepperSecret;
        const hashedOtp = hashOtp(plainOtp, pepper);

        await UserModel.create({
          phone,
          email: 'otp-missing-partner-user@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          partnerId: new Types.ObjectId(),
          roles: [],
        });

        await PhoneOtpModel.create({
          phone,
          userType: UserType.PARTNER,
          hashedOtp,
          attempts: 0,
          maxAttempts: 3,
          expiresAt: new Date(Date.now() + 300000),
          cooldownUntil: new Date(Date.now() + 60000),
          isConsumed: false,
        });

        await expect(otpService.verifyOtp(phone, plainOtp, UserType.PARTNER)).rejects.toMatchObject(
          {
            code: 'PARTNER_NOT_FOUND',
            statusCode: 403,
          },
        );
      });

      it('rejects OTP verification with 403 PARTNER_CONTEXT_REQUIRED when partnerId is missing', async () => {
        const config = getConfig();
        const phone = '+919977700014';
        const plainOtp = '123456';
        const pepper = config.auth.otp.pepperSecret;
        const hashedOtp = hashOtp(plainOtp, pepper);

        await UserModel.create({
          phone,
          email: 'otp-noid-partner-user@thehomez.in',
          userType: UserType.PARTNER,
          status: UserStatus.ACTIVE,
          // partnerId intentionally omitted
          roles: [],
        });

        await PhoneOtpModel.create({
          phone,
          userType: UserType.PARTNER,
          hashedOtp,
          attempts: 0,
          maxAttempts: 3,
          expiresAt: new Date(Date.now() + 300000),
          cooldownUntil: new Date(Date.now() + 60000),
          isConsumed: false,
        });

        await expect(otpService.verifyOtp(phone, plainOtp, UserType.PARTNER)).rejects.toMatchObject(
          {
            code: 'PARTNER_CONTEXT_REQUIRED',
            statusCode: 403,
          },
        );
      });
    });

    // Subsection 9.4: Non-Regression Guarantees for Other Identities
    describe('Authentication Non-Regression Guarantees', () => {
      it('Customer OTP authentication & auto-provisioning continues to work normally', async () => {
        const config = getConfig();
        const phone = '+919977700020';
        const plainOtp = '123456';
        const pepper = config.auth.otp.pepperSecret;
        const hashedOtp = hashOtp(plainOtp, pepper);

        // PhoneOtp created for brand new customer
        await PhoneOtpModel.create({
          phone,
          userType: UserType.CUSTOMER,
          hashedOtp,
          attempts: 0,
          maxAttempts: 3,
          expiresAt: new Date(Date.now() + 300000),
          cooldownUntil: new Date(Date.now() + 60000),
          isConsumed: false,
        });

        const result = await otpService.verifyOtp(phone, plainOtp, UserType.CUSTOMER);
        expect(result.user).toBeDefined();
        expect(result.user.phone).toBe(phone);
        expect(result.user.userType).toBe(UserType.CUSTOMER);
        expect(result.user.status).toBe(UserStatus.ACTIVE);
      });

      it('Partner users belonging to an active partner remain unaffected by suspension of other partners', async () => {
        const suspendedToken = tokenService.signAccessToken(suspendedPartnerUser);
        const activeToken = tokenService.signAccessToken(activePartnerUser);

        // Suspended partner caller fails
        const res1 = await request(app)
          .get('/api/v1/partner/availability')
          .set('Authorization', `Bearer ${suspendedToken}`);
        expect(res1.status).toBe(403);
        expect(res1.body.error.code).toBe('PARTNER_NOT_ACTIVE');

        // Active partner caller succeeds
        const res2 = await request(app)
          .get('/api/v1/partner/availability')
          .set('Authorization', `Bearer ${activeToken}`);
        expect(res2.status).not.toBe(401);
        expect(res2.status).not.toBe(403);
      });
    });
  });
});
