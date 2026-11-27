import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UserModel, type IUserDocument } from '../src/models/user.model.js';
import { PartnerModel, type IPartnerDocument } from '../src/models/partner.model.js';
import { PartnerApplicationModel } from '../src/models/partner-application.model.js';
import { ServiceAreaModel, type IServiceAreaDocument } from '../src/models/service-area.model.js';
import { PartnerAuditLogModel } from '../src/models/partner-audit-log.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { serviceAreaService } from '../src/services/service-area/service-area.service.js';
import { partnerApplicationService } from '../src/services/partner-application/partner-application.service.js';
import { withTransaction } from '../src/database/transaction.js';
import { registerTestFixture } from '../src/database/test-guard.js';
import { UserType, UserStatus, PermissionCode, DeliveryMode } from '@thehomez/shared-types';

describe('Stage C-11.2B: Partner Application Lifecycle, Transactional Approval & Dual-Level Concurrency', () => {
  let app: Application;
  let tokenService: TokenService;
  let isDbConnected = false;

  // Staff Users & Tokens
  let superAdminUser: IUserDocument;
  let superAdminToken: string;

  let onboarderStaff: IUserDocument;
  let onboarderToken: string;

  let verifierStaff: IUserDocument;
  let verifierToken: string;

  let readerStaff: IUserDocument;
  let readerToken: string;

  let staffNoPerm: IUserDocument;
  let _staffNoPermToken: string;

  let regularCustomer: IUserDocument;
  let regularCustomerToken: string;

  let existingPartnerUser: IUserDocument;
  let _existingPartnerToken: string;
  let existingPartnerDoc: IPartnerDocument;

  // Test Service Areas
  let saAlpha: IServiceAreaDocument;
  let saBeta: IServiceAreaDocument;
  let _saGamma: IServiceAreaDocument;

  // Tracked In-Memory Document IDs for Current-Run Positive Ownership
  const createdAppIds: Types.ObjectId[] = [];
  const createdPartnerIds: Types.ObjectId[] = [];
  const createdUserIds: Types.ObjectId[] = [];
  const createdServiceAreaIds: Types.ObjectId[] = [];
  const createdRoleIds: Types.ObjectId[] = [];

  beforeAll(async () => {
    try {
      await connectDatabase(undefined, { serverSelectionTimeoutMS: 30000 });
      isDbConnected = true;
    } catch (err) {
      console.warn('MongoDB connection unavailable for partner application test suite:', err);
      throw err;
    }

    tokenService = new TokenService();
    app = createApp();

    if (isDbConnected) {
      // 0. Clean any leftover fixtures from previous aborted test runs by explicit _id constraint
      const oldSAs = await ServiceAreaModel.find(
        { code: { $in: [/^TEST-APP-SA-/i, /^TEST-SCENARIO-/i] } },
        { _id: 1 },
      ).lean();
      if (oldSAs.length > 0) {
        for (const sa of oldSAs) registerTestFixture('ServiceArea', sa._id);
        await ServiceAreaModel.deleteMany({ _id: { $in: oldSAs.map((d: any) => d._id) } });
      }

      const oldRoles = await RoleModel.find({ code: /^TEST_APP_/i }, { _id: 1 }).lean();
      if (oldRoles.length > 0) {
        for (const r of oldRoles) registerTestFixture('Role', r._id);
        await RoleModel.deleteMany({ _id: { $in: oldRoles.map((d: any) => d._id) } });
      }

      const oldUsers = await UserModel.find({ phone: /^\+919666/ }, { _id: 1 }).lean();
      if (oldUsers.length > 0) {
        for (const u of oldUsers) registerTestFixture('User', u._id);
        await UserModel.deleteMany({ _id: { $in: oldUsers.map((d: any) => d._id) } });
      }

      const oldPartners = await PartnerModel.find({ phone: /^\+919666/ }, { _id: 1 }).lean();
      if (oldPartners.length > 0) {
        for (const p of oldPartners) registerTestFixture('Partner', p._id);
        await PartnerModel.deleteMany({ _id: { $in: oldPartners.map((d: any) => d._id) } });
      }

      const oldApps = await PartnerApplicationModel.find({ phone: /^\+919666/ }, { _id: 1 }).lean();
      if (oldApps.length > 0) {
        for (const a of oldApps) registerTestFixture('PartnerApplication', a._id);
        await PartnerApplicationModel.deleteMany({ _id: { $in: oldApps.map((d: any) => d._id) } });
      }

      // Attach post-save hooks to track all created documents in this suite
      ServiceAreaModel.schema.post('save', function (doc: any) {
        if (doc && doc._id) createdServiceAreaIds.push(doc._id);
      });
      PartnerApplicationModel.schema.post('save', function (doc: any) {
        if (doc && doc._id) createdAppIds.push(doc._id);
      });
      PartnerModel.schema.post('save', function (doc: any) {
        if (doc && doc._id) createdPartnerIds.push(doc._id);
      });
      UserModel.schema.post('save', function (doc: any) {
        if (doc && doc._id) createdUserIds.push(doc._id);
      });

      // 1. Create Test Service Areas
      saAlpha = await ServiceAreaModel.create({
        code: 'TEST-APP-SA-ALPHA',
        name: 'Bengaluru Alpha Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560091'],
        isActive: true,
      });

      saBeta = await ServiceAreaModel.create({
        code: 'TEST-APP-SA-BETA',
        name: 'Bengaluru Beta Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560092'],
        isActive: true,
      });

      _saGamma = await ServiceAreaModel.create({
        code: 'TEST-APP-SA-GAMMA',
        name: 'Bengaluru Gamma Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560093'],
        isActive: true,
      });

      // 2. Create Test Roles
      const seededRoles = await RoleModel.create([
        {
          code: 'TEST_APP_SUPER',
          name: 'Super Admin Application Test',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: Object.values(PermissionCode),
        },
        {
          code: 'TEST_APP_ONBOARD_ONLY',
          name: 'Partner Onboarder Only',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.PARTNER_READ, PermissionCode.PARTNER_ONBOARD],
        },
        {
          code: 'TEST_APP_VERIFY_ONLY',
          name: 'Partner Verifier Only',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.PARTNER_READ, PermissionCode.PARTNER_VERIFY],
        },
        {
          code: 'TEST_APP_READ_ONLY',
          name: 'Partner Reader Only',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.PARTNER_READ],
        },
        {
          code: 'TEST_APP_NO_PERM',
          name: 'Staff No Perm',
          userType: UserType.STAFF,
          isSystemManaged: false,
          permissions: [PermissionCode.CATALOG_READ],
        },
        {
          code: 'TEST_APP_PARTNER_ROLE',
          name: 'Partner Operative Role',
          userType: UserType.PARTNER,
          isSystemManaged: false,
          permissions: [PermissionCode.PARTNER_AVAILABILITY_READ],
        },
      ]);
      createdRoleIds.push(...seededRoles.map((r: any) => r._id));

      // 3. Create Staff Users & Tokens
      superAdminUser = await UserModel.create({
        phone: '+919666000001',
        email: 'superadmin.apptest@thehomez.local',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['TEST_APP_SUPER'],
      });
      superAdminToken = tokenService.signAccessToken(superAdminUser, 'session-superadmin');

      onboarderStaff = await UserModel.create({
        phone: '+919666000002',
        email: 'onboarder.apptest@thehomez.local',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['TEST_APP_ONBOARD_ONLY'],
      });
      onboarderToken = tokenService.signAccessToken(onboarderStaff, 'session-onboarder');

      verifierStaff = await UserModel.create({
        phone: '+919666000003',
        email: 'verifier.apptest@thehomez.local',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['TEST_APP_VERIFY_ONLY'],
      });
      verifierToken = tokenService.signAccessToken(verifierStaff, 'session-verifier');

      readerStaff = await UserModel.create({
        phone: '+919666000004',
        email: 'reader.apptest@thehomez.local',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['TEST_APP_READ_ONLY'],
      });
      readerToken = tokenService.signAccessToken(readerStaff, 'session-reader');

      staffNoPerm = await UserModel.create({
        phone: '+919666000005',
        email: 'noperm.apptest@thehomez.local',
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['TEST_APP_NO_PERM'],
      });
      _staffNoPermToken = tokenService.signAccessToken(staffNoPerm, 'session-noperm');

      // 4. Create Customer User & Token
      regularCustomer = await UserModel.create({
        phone: '+919666000006',
        email: 'customer.apptest@thehomez.local',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });
      regularCustomerToken = tokenService.signAccessToken(regularCustomer);

      // 5. Create Pre-existing Active Partner & User
      existingPartnerDoc = await PartnerModel.create({
        businessName: 'Pre-existing Operational Vendor',
        phone: '+919666000007',
        email: 'existing.vendor@thehomez.local',
        serviceAreaIds: [saAlpha._id],
        status: 'ACTIVE',
        coverageVersion: 0,
      });

      existingPartnerUser = await UserModel.create({
        phone: '+919666000007',
        email: 'existing.partneruser@thehomez.local',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        partnerId: existingPartnerDoc._id,
        roles: ['TEST_APP_PARTNER_ROLE'],
      });
      _existingPartnerToken = tokenService.signAccessToken(existingPartnerUser);
    }
  });

  beforeEach(() => {
    vi.spyOn(TokenService.prototype, 'validateAdminSession').mockImplementation(
      async (sessionId: string) => {
        let matchedUserId = superAdminUser._id;
        if (sessionId === 'session-onboarder') matchedUserId = onboarderStaff._id;
        if (sessionId === 'session-verifier') matchedUserId = verifierStaff._id;
        if (sessionId === 'session-reader') matchedUserId = readerStaff._id;
        if (sessionId === 'session-noperm') matchedUserId = staffNoPerm._id;
        return {
          _id: sessionId,
          userId: matchedUserId,
          isRevoked: false,
          absoluteExpiresAt: new Date(Date.now() + 86400000),
          lastActivityAt: new Date(),
        } as any;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // GROUP A: APPLICATION CREATION & REAPPLICATION
  // =========================================================================
  describe('Group A: Application Creation & Reapplication', () => {
    it('creates a valid partner application with default SUBMITTED status', async () => {
      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          businessName: 'Apex Building Solutions',
          legalName: 'Apex Building Solutions Pvt Ltd',
          phone: '+919666110001',
          email: 'contact@apexbuilding.local',
          deliveryMode: DeliveryMode.PARTNER_MANAGED,
          serviceAreaIds: [saAlpha._id.toString()],
          metadata: { pan: 'ABCDE1234F', gstin: '29ABCDE1234F1Z5' },
          initialUser: {
            contactName: 'Ramesh Patel',
            phone: '+919666110002',
            email: 'ramesh@apexbuilding.local',
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUBMITTED');
      expect(res.body.data.businessName).toBe('Apex Building Solutions');
      expect(res.body.data.initialUser.contactName).toBe('Ramesh Patel');
      expect(res.body.data.auditHistory.length).toBe(1);
      expect(res.body.data.auditHistory[0].action).toBe('APPLICATION_SUBMITTED');

      // Assert zero operational Partner or User created at intake
      const partnerExists = await PartnerModel.exists({ phone: '+919666110001' });
      const userExists = await UserModel.exists({
        phone: '+919666110002',
        userType: UserType.PARTNER,
      });
      expect(partnerExists).toBeNull();
      expect(userExists).toBeNull();
    });

    it('rejects creation if required business name or contact phone is missing', async () => {
      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          phone: '+919666110003',
          initialUser: {
            contactName: 'Missing Name',
            phone: '+919666110004',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects invalid E.164 business phone number', async () => {
      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          businessName: 'Invalid Phone LLP',
          phone: '9876543210', // Missing +
          initialUser: {
            contactName: 'Invalid Phone Contact',
            phone: '+919666110005',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects unknown request fields (strict schema enforcement)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          businessName: 'Hacker Vendor',
          phone: '+919666110006',
          status: 'APPROVED', // Client attempting to forge status
          partnerId: new Types.ObjectId().toString(), // Client forging operational ID
          initialUser: {
            contactName: 'Attacker',
            phone: '+919666110007',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('rejects service area array exceeding technical maximum of 20', async () => {
      const excessAreas = Array.from({ length: 21 }, () => new Types.ObjectId().toString());
      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          businessName: 'Excess Areas Vendor',
          phone: '+919666110008',
          serviceAreaIds: excessAreas,
          initialUser: {
            contactName: 'Area Overloader',
            phone: '+919666110009',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('creates clean reapplication referencing a REJECTED application', async () => {
      // 1. Create initial application A1 and reject it
      const app1 = await PartnerApplicationModel.create({
        businessName: 'First Attempt Vendor',
        phone: '+919666110010',
        initialUser: { contactName: 'Vijay Kumar', phone: '+919666110011' },
        status: 'REJECTED',
        refusalReasonCode: 'INCOMPLETE_DOCUMENTS',
        rejectionReason: 'Missing GST registration certificate',
      });

      // 2. Submit reapplication A2 linking previousApplicationId
      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          businessName: 'Second Attempt Vendor',
          phone: '+919666110010', // Reusing same business phone
          previousApplicationId: app1._id.toString(),
          initialUser: {
            contactName: 'Vijay Kumar',
            phone: '+919666110011', // Reusing same contact phone
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('SUBMITTED');
      expect(res.body.data.previousApplicationId).toBe(app1._id.toString());
      expect(res.body.data.id).not.toBe(app1._id.toString());
    });

    it('rejects reapplication referencing non-existent previousApplicationId with 404', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          businessName: 'Phantom Reapplicant',
          phone: '+919666110012',
          previousApplicationId: nonExistentId,
          initialUser: { contactName: 'Ghost', phone: '+919666110013' },
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PREVIOUS_APPLICATION_NOT_FOUND');
    });

    it('rejects reapplication referencing an application that is NOT REJECTED', async () => {
      const inReviewApp = await PartnerApplicationModel.create({
        businessName: 'Active Review Vendor',
        phone: '+919666110014',
        initialUser: { contactName: 'Current Applicant', phone: '+919666110015' },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          businessName: 'Premature Reapplicant',
          phone: '+919666110014',
          previousApplicationId: inReviewApp._id.toString(),
          initialUser: { contactName: 'Impatience', phone: '+919666110015' },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REAPPLICATION_TARGET');
    });

    it('rejects self-referencing or circular previousApplicationId', async () => {
      // In intake, ID is generated by server, but client cannot pass previousApplicationId equal to a prospective document
      const fakeId = new Types.ObjectId().toString();
      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          businessName: 'Circular Reapplicant',
          phone: '+919666110016',
          previousApplicationId: fakeId,
          initialUser: { contactName: 'Ouroboros', phone: '+919666110017' },
        });

      expect(res.status).toBe(404);
    });

    it('prevents intake collision if phone already belongs to an operational partner (409)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          businessName: 'Duplicate Phone Partner',
          phone: existingPartnerDoc.phone, // Already an active partner
          initialUser: { contactName: 'Colliding Contact', phone: '+919666110018' },
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PARTNER_PHONE_EXISTS');
    });
  });

  // =========================================================================
  // GROUP B: LIFECYCLE & AUDIT HISTORY
  // =========================================================================
  describe('Group B: Lifecycle Transitions & Embedded Audit History', () => {
    it('moves SUBMITTED application into review with staff assignment and audit log', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Review Lifecycle Vendor',
        phone: '+919666220001',
        initialUser: { contactName: 'Review Applicant', phone: '+919666220002' },
        status: 'SUBMITTED',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/review`)
        .set('Authorization', `Bearer ${verifierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('UNDER_REVIEW');
      expect(res.body.data.assignedStaffUserId).toBe(verifierStaff._id.toString());
      expect(res.body.data.auditHistory.length).toBe(1);
      expect(res.body.data.auditHistory[0].action).toBe('APPLICATION_UNDER_REVIEW');
      expect(res.body.data.auditHistory[0].performedBy).toBe(verifierStaff._id.toString());
    });

    it('rejects moving an application already in UNDER_REVIEW (400)', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Already In Review Vendor',
        phone: '+919666220003',
        initialUser: { contactName: 'Applicant B', phone: '+919666220004' },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/review`)
        .set('Authorization', `Bearer ${verifierToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('rejects an application under review with structured refusal code and audit reason', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Rejection Candidate Vendor',
        phone: '+919666220005',
        initialUser: { contactName: 'Rejectee', phone: '+919666220006' },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/reject`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          refusalReasonCode: 'UNVERIFIED_OPERATING_YARD',
          reason: 'Physical site inspection revealed no active warehousing facilities at location.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('REJECTED');
      expect(res.body.data.refusalReasonCode).toBe('UNVERIFIED_OPERATING_YARD');
      expect(res.body.data.rejectionReason).toContain('Physical site inspection');
      expect(res.body.data.auditHistory.length).toBe(1);
      expect(res.body.data.auditHistory[0].action).toBe('APPLICATION_REJECTED');

      // Verify zero operational records exist
      const partnerExists = await PartnerModel.exists({ phone: appDoc.phone });
      expect(partnerExists).toBeNull();
    });

    it('rejects rejection payload missing refusal code or reason shorter than 10 chars', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Short Reason Vendor',
        phone: '+919666220007',
        initialUser: { contactName: 'Rejectee Short', phone: '+919666220008' },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/reject`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          refusalReasonCode: 'CODE',
          reason: 'Too short', // Only 9 characters
        });

      expect(res.status).toBe(400);
    });

    it('withdraws an in-review application with mandatory reason', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Withdrawal Candidate Vendor',
        phone: '+919666220009',
        initialUser: { contactName: 'Withdrawer', phone: '+919666220010' },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/withdraw`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Applicant requested withdrawal due to change in corporate business model.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('WITHDRAWN');
      expect(res.body.data.auditHistory[0].action).toBe('APPLICATION_WITHDRAWN');
    });

    it('rejects withdrawing an application that has already been approved (400)', async () => {
      const approvedApp = await PartnerApplicationModel.create({
        businessName: 'Approved Not Withdrawable',
        phone: '+919666220011',
        initialUser: { contactName: 'Approved Guy', phone: '+919666220012' },
        status: 'APPROVED',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${approvedApp._id}/withdraw`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Cannot withdraw once approved in production directory.',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('retrieves paginated application directory and detail by ID', async () => {
      const resList = await request(app)
        .get('/api/v1/admin/partner-applications?limit=5')
        .set('Authorization', `Bearer ${readerToken}`);

      expect(resList.status).toBe(200);
      expect(resList.body.data.items).toBeDefined();
      expect(resList.body.data.pagination).toBeDefined();
    });
  });

  // =========================================================================
  // GROUP C: TRANSACTIONAL APPROVAL GATE
  // =========================================================================
  describe('Group C: Transactional Approval Gate (Exclusive Creation Path)', () => {
    it('approves application and atomically provisions Partner, User, and PartnerAuditLog', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'SteelWorks Karnataka LLP',
        legalName: 'SteelWorks Karnataka Private Limited',
        phone: '+919666330001',
        email: 'steelworks@thehomez.local',
        deliveryMode: DeliveryMode.PLATFORM_MANAGED,
        serviceAreaIds: [saAlpha._id, saBeta._id],
        metadata: { pan: 'STELW1234K', gstin: '29STELW1234K1Z2' },
        initialUser: {
          contactName: 'Anil Deshmukh',
          phone: '+919666330002',
          email: 'anil@steelworks.local',
        },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason:
            'All compliance checks passed: yard verified, trade registry valid, voice contact confirmed.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // 1. Assert PartnerApplication state
      expect(res.body.data.application.status).toBe('APPROVED');
      expect(res.body.data.application.partnerId).toBeDefined();

      // 2. Assert created operational Partner
      const partner = await PartnerModel.findById(res.body.data.application.partnerId);
      expect(partner).not.toBeNull();
      expect(partner?.status).toBe('ACTIVE');
      expect(partner?.businessName).toBe('SteelWorks Karnataka LLP');
      expect(partner?.coverageVersion).toBe(0);
      expect(partner?.deliveryMode).toBe(DeliveryMode.PLATFORM_MANAGED);

      // 3. Assert created operational UserModel
      const user = await UserModel.findOne({ phone: '+919666330002', userType: UserType.PARTNER });
      expect(user).not.toBeNull();
      expect(user?.status).toBe(UserStatus.ACTIVE);
      expect(user?.roles).toEqual(['PARTNER_OPERATOR']);
      expect(user?.partnerId?.toString()).toBe(partner?._id.toString());
      expect(user?.metadata?.contactName).toBe('Anil Deshmukh');

      // 4. Assert initial operational PartnerAuditLogModel
      const auditLog = await PartnerAuditLogModel.findOne({ partnerId: partner?._id });
      expect(auditLog).not.toBeNull();
      expect(auditLog?.action).toBe('PARTNER_STATUS_CHANGED');
      expect(auditLog?.previousState).toEqual({ status: null });
      expect(auditLog?.newState).toEqual({ status: 'ACTIVE' });
      expect(auditLog?.staffUserId.toString()).toBe(verifierStaff._id.toString());
    });

    it('rejects approval if any administrative attestation is false or omitted (400)', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Unverified Compliance Co',
        phone: '+919666330003',
        serviceAreaIds: [saAlpha._id],
        initialUser: { contactName: 'Unverified Operator', phone: '+919666330004' },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Attempting approval without compliance attestation.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: false, // Fails attestation!
          },
        });

      expect(res.status).toBe(400);

      // Assert zero records created
      const partnerExists = await PartnerModel.exists({ phone: appDoc.phone });
      expect(partnerExists).toBeNull();
    });

    it('rejects approval if application has zero assigned service areas (400 NO_ACTIVE_SERVICE_AREA)', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Zero Areas Vendor',
        phone: '+919666330005',
        serviceAreaIds: [], // Empty areas
        initialUser: { contactName: 'Zero Areas', phone: '+919666330006' },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Attempting approval without any service area assigned.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_ACTIVE_SERVICE_AREA');
    });

    it('rejects approval if assigned service area is currently inactive', async () => {
      const inactiveArea = await ServiceAreaModel.create({
        code: 'TEST-APP-SA-INACTIVE-INIT',
        name: 'Inactive Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560098'],
        isActive: false,
      });

      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Inactive Area Assignee',
        phone: '+919666330007',
        serviceAreaIds: [inactiveArea._id],
        initialUser: { contactName: 'Inactive Contact', phone: '+919666330008' },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Attempting approval against inactive service area.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_ACTIVE_SERVICE_AREA');
    });

    it('rejects repeated approval on an already approved application (400)', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Already Approved Vendor',
        phone: '+919666330009',
        serviceAreaIds: [saAlpha._id],
        initialUser: { contactName: 'Repeater', phone: '+919666330010' },
        status: 'APPROVED',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Attempting duplicate second approval.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  // =========================================================================
  // GROUP D: ROLLBACK & FAILURE INJECTION BOUNDARIES
  // =========================================================================
  describe('Group D: Transaction Rollback & Failure Injection', () => {
    it('rolls back entire transaction if UserModel phone collides with existing partner user (409)', async () => {
      // Create existing partner user with specific phone
      await UserModel.create({
        phone: '+919666440001',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        roles: ['TEST_APP_PARTNER_ROLE'],
      });

      // Application with colliding contact phone
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Colliding Phone Vendor',
        phone: '+919666440002',
        serviceAreaIds: [saAlpha._id],
        initialUser: {
          contactName: 'Collision Artist',
          phone: '+919666440001', // Collides with existing PARTNER user!
        },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'This approval must cleanly abort without partial writes.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PHONE_ALREADY_REGISTERED');

      // Assert complete rollback:
      // 1. Application remains UNDER_REVIEW
      const freshApp = await PartnerApplicationModel.findById(appDoc._id);
      expect(freshApp?.status).toBe('UNDER_REVIEW');
      expect(freshApp?.partnerId).toBeUndefined();

      // 2. Operational Partner was NOT created
      const partnerExists = await PartnerModel.exists({ phone: '+919666440002' });
      expect(partnerExists).toBeNull();

      // 3. Operational audit record was NOT created
      const auditCount = await PartnerAuditLogModel.countDocuments({
        reason: { $regex: /Colliding Phone Vendor/ },
      });
      expect(auditCount).toBe(0);
    });

    it('rolls back entire transaction if UserModel email collides with existing global user (409)', async () => {
      // Existing user with specific email
      await UserModel.create({
        phone: '+919666440003',
        email: 'collision.target@thehomez.local',
        userType: UserType.CUSTOMER,
        status: UserStatus.ACTIVE,
        roles: [],
      });

      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Colliding Email Vendor',
        phone: '+919666440004',
        serviceAreaIds: [saAlpha._id],
        initialUser: {
          contactName: 'Email Clasher',
          phone: '+919666440005',
          email: 'collision.target@thehomez.local', // Global sparse unique conflict!
        },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Approval must abort cleanly on email duplicate.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');

      // Assert complete rollback
      const freshApp = await PartnerApplicationModel.findById(appDoc._id);
      expect(freshApp?.status).toBe('UNDER_REVIEW');
      const partnerExists = await PartnerModel.exists({ phone: '+919666440004' });
      expect(partnerExists).toBeNull();
    });

    it('rolls back completely if operational audit log insertion fails', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Audit Failure Vendor',
        phone: '+919666440006',
        serviceAreaIds: [saAlpha._id],
        initialUser: { contactName: 'Audit Fail', phone: '+919666440007' },
        status: 'UNDER_REVIEW',
      });

      // Inject failure on PartnerAuditLogModel.create
      vi.spyOn(PartnerAuditLogModel, 'create').mockImplementationOnce(async () => {
        throw new Error('Simulated disk/compliance ledger failure during audit write');
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Audit log failure simulation.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      expect(res.status).toBe(500);

      // Verify rollback: no partner and no user exist
      const partnerExists = await PartnerModel.exists({ phone: '+919666440006' });
      const userExists = await UserModel.exists({ phone: '+919666440007' });
      const freshApp = await PartnerApplicationModel.findById(appDoc._id);

      expect(partnerExists).toBeNull();
      expect(userExists).toBeNull();
      expect(freshApp?.status).toBe('UNDER_REVIEW');
    });
  });

  // =========================================================================
  // GROUP E: SECURITY, RBAC & ANTI-PROBING
  // =========================================================================
  describe('Group E: Security, RBAC & Anti-Probing Validation', () => {
    it('rejects unauthenticated requests with HTTP 401 UNAUTHORIZED', async () => {
      const res = await request(app).get('/api/v1/admin/partner-applications');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects customer caller with HTTP 403 FORBIDDEN (staffOnlyGuard)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${regularCustomerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff user without PARTNER_ONBOARD on application creation (403)', async () => {
      const res = await request(app)
        .post('/api/v1/admin/partner-applications')
        .set('Authorization', `Bearer ${readerToken}`) // Only has PARTNER_READ
        .send({
          businessName: 'Unauthorized Create',
          phone: '+919666550001',
          initialUser: { contactName: 'Unauth', phone: '+919666550002' },
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff user without PARTNER_VERIFY on application review/reject/approve (403)', async () => {
      const fakeId = new Types.ObjectId().toString();

      // Onboarder lacks PARTNER_VERIFY
      const resReview = await request(app)
        .post(`/api/v1/admin/partner-applications/${fakeId}/review`)
        .set('Authorization', `Bearer ${onboarderToken}`);
      expect(resReview.status).toBe(403);

      const resReject = await request(app)
        .post(`/api/v1/admin/partner-applications/${fakeId}/reject`)
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({ refusalReasonCode: 'TEST', reason: 'Attempted reject without verify permission.' });
      expect(resReject.status).toBe(403);

      const resApprove = await request(app)
        .post(`/api/v1/admin/partner-applications/${fakeId}/approve`)
        .set('Authorization', `Bearer ${onboarderToken}`)
        .send({
          reason: 'Attempted approve without verify permission.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });
      expect(resApprove.status).toBe(403);
    });

    it('ANTI-PROBING: unauthorized staff caller receives 403 on non-existent application ID (no 404 leak)', async () => {
      const nonExistentId = new Types.ObjectId().toString();

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${nonExistentId}/approve`)
        .set('Authorization', `Bearer ${onboarderToken}`) // Lacks PARTNER_VERIFY
        .send({
          reason: 'Probing for existence.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      // Must receive 403 FORBIDDEN, NOT 404 APPLICATION_NOT_FOUND
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  // =========================================================================
  // GROUP F & G: THE 18 REQUIRED CONCURRENCY SCENARIOS & INVARIANTS
  // =========================================================================
  describe('Group F & G: The 18 Required Concurrency, Serialization & Coverage Invariant Scenarios', () => {
    // SCENARIO 1: Approval Concurrent with Deactivation of its Sole Active Service Area
    it('Scenario 1: Approval concurrent with deactivation of its sole active service area enforces serialization', async () => {
      // Setup isolated service area S1
      const s1 = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-1-SA',
        name: 'Scenario 1 Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560041'],
        isActive: true,
      });

      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Scenario 1 Vendor',
        phone: '+919666660001',
        serviceAreaIds: [s1._id],
        initialUser: { contactName: 'Operator S1', phone: '+919666660002' },
        status: 'UNDER_REVIEW',
      });

      // Deactivate area S1 directly
      await serviceAreaService.updateServiceArea(s1._id.toString(), { isActive: false });

      // Attempt approval against now-inactive area
      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Testing approval against concurrently deactivated sole service area.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_ACTIVE_SERVICE_AREA');

      // Database Invariant: Zero operational partner created without active coverage
      const partnerExists = await PartnerModel.exists({ phone: appDoc.phone });
      expect(partnerExists).toBeNull();
    });

    // SCENARIO 2: Deactivation Concurrent with Approval (Inverse Scheduling Window)
    it('Scenario 2: Deactivation concurrent with approval prevents deactivation if partner becomes active', async () => {
      const s2 = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-2-SA',
        name: 'Scenario 2 Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560042'],
        isActive: true,
      });

      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Scenario 2 Vendor',
        phone: '+919666660003',
        serviceAreaIds: [s2._id],
        initialUser: { contactName: 'Operator S2', phone: '+919666660004' },
        status: 'UNDER_REVIEW',
      });

      // Approve application first
      const approveRes = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Approval commits, creating active partner on S2.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      expect(approveRes.status).toBe(200);

      // Now attempt deactivating S2; must fail because new active partner depends on it!
      await expect(
        serviceAreaService.updateServiceArea(s2._id.toString(), { isActive: false }),
      ).rejects.toThrow('Active partner');

      const areaCheck = await ServiceAreaModel.findById(s2._id);
      expect(areaCheck?.isActive).toBe(true);
    });

    // SCENARIO 3: Two Simultaneous Service-Area Deactivations for a Partner with Multiple Areas
    it('Scenario 3: Two simultaneous deactivations for partner with multiple areas serialize on Partner coverageVersion', async () => {
      const sa1 = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-3-SA1',
        name: 'Scenario 3 Area 1',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560043'],
        isActive: true,
      });

      const sa2 = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-3-SA2',
        name: 'Scenario 3 Area 2',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560044'],
        isActive: true,
      });

      const partner = await PartnerModel.create({
        businessName: 'Multi-Area Partner S3',
        phone: '+919666660005',
        serviceAreaIds: [sa1._id, sa2._id],
        status: 'ACTIVE',
        coverageVersion: 0,
      });

      // Deactivate SA1 -> succeeds because SA2 remains active
      await serviceAreaService.updateServiceArea(sa1._id.toString(), { isActive: false });

      const partnerAfter1 = await PartnerModel.findById(partner._id);
      expect(partnerAfter1?.coverageVersion).toBe(1);

      // Concurrently attempt deactivating SA2 -> must fail because partner now has 0 other active areas!
      await expect(
        serviceAreaService.updateServiceArea(sa2._id.toString(), { isActive: false }),
      ).rejects.toThrow('zero other active assigned service areas');

      // Database Invariant: SA2 remains active, partner is never active with 0 active areas!
      const sa2Check = await ServiceAreaModel.findById(sa2._id);
      expect(sa2Check?.isActive).toBe(true);
    });

    // SCENARIO 4: Service-Area Deactivation when Another Active Assigned Area Remains
    it('Scenario 4: Service-area deactivation succeeds when another active assigned area remains', async () => {
      const saA = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-4-SAA',
        name: 'Scenario 4 Area A',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560045'],
        isActive: true,
      });

      const saB = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-4-SAB',
        name: 'Scenario 4 Area B',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560046'],
        isActive: true,
      });

      const partner = await PartnerModel.create({
        businessName: 'Dual Coverage Partner',
        phone: '+919666660006',
        serviceAreaIds: [saA._id, saB._id],
        status: 'ACTIVE',
        coverageVersion: 0,
      });

      const res = await serviceAreaService.updateServiceArea(saA._id.toString(), {
        isActive: false,
      });
      expect(res.isActive).toBe(false);

      const refreshedPartner = await PartnerModel.findById(partner._id);
      expect(refreshedPartner?.coverageVersion).toBe(1);
    });

    // SCENARIO 5: Service-Area Deactivation when All Other Assigned Areas are Already Inactive
    it('Scenario 5: Deactivation rejected when all other assigned areas are already inactive', async () => {
      const saActive = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-5-ACT',
        name: 'Scenario 5 Active',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560047'],
        isActive: true,
      });

      const saInactive = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-5-INACT',
        name: 'Scenario 5 Inactive',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560048'],
        isActive: false,
      });

      await PartnerModel.create({
        businessName: 'Stranded Partner Candidate',
        phone: '+919666660007',
        serviceAreaIds: [saActive._id, saInactive._id],
        status: 'ACTIVE',
      });

      await expect(
        serviceAreaService.updateServiceArea(saActive._id.toString(), { isActive: false }),
      ).rejects.toThrow('ACTIVE_PARTNER_DEPENDENCY');

      const check = await ServiceAreaModel.findById(saActive._id);
      expect(check?.isActive).toBe(true);
    });

    // SCENARIO 6: Multiple Active Partners Depending on the Same Service Area
    it('Scenario 6: Multiple active partners depending on the same area: blocked citing partner lacking backup', async () => {
      const saShared = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-6-SHARED',
        name: 'Scenario 6 Shared Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560049'],
        isActive: true,
      });

      const saBackup = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-6-BACKUP',
        name: 'Scenario 6 Backup Area',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560051'],
        isActive: true,
      });

      // P1 has backup
      await PartnerModel.create({
        businessName: 'Partner With Backup',
        phone: '+919666660008',
        serviceAreaIds: [saShared._id, saBackup._id],
        status: 'ACTIVE',
      });

      // P2 has ONLY the shared area
      await PartnerModel.create({
        businessName: 'Partner Sole Shared Area',
        phone: '+919666660009',
        serviceAreaIds: [saShared._id],
        status: 'ACTIVE',
      });

      await expect(
        serviceAreaService.updateServiceArea(saShared._id.toString(), { isActive: false }),
      ).rejects.toThrow('Partner Sole Shared Area');

      const saCheck = await ServiceAreaModel.findById(saShared._id);
      expect(saCheck?.isActive).toBe(true);
    });

    // SCENARIO 7: Transaction Retry and Failure Semantics Under Write Conflicts
    it('Scenario 7: Transient write conflict triggers withTransaction retry re-evaluating fresh state', async () => {
      let attemptCount = 0;

      const result = await withTransaction(async (_session) => {
        attemptCount++;
        if (attemptCount === 1) {
          // Simulate transient error on first attempt
          const transientErr = new Error('WriteConflict on document') as Error & { code: number };
          transientErr.code = 112; // TransientTransactionError code
          throw transientErr;
        }
        return { success: true, attempts: attemptCount };
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(attemptCount).toBe(2);
    });

    // SCENARIO 8: Concurrent Approval Attempts on the Same Application
    it('Scenario 8: Concurrent approval requests on the same application: exactly ONE succeeds', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Concurrent Approval Vendor',
        phone: '+919666660010',
        serviceAreaIds: [saAlpha._id],
        initialUser: { contactName: 'Race Candidate', phone: '+919666660011' },
        status: 'UNDER_REVIEW',
      });

      const approvePayload = {
        reason: 'Concurrent approval attempt validation.',
        checklist: {
          identityVerified: true,
          serviceAreaConfirmed: true,
          complianceConfirmed: true,
        },
      };

      // Fire two parallel approval calls
      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
          .set('Authorization', `Bearer ${verifierToken}`)
          .send(approvePayload),
        request(app)
          .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
          .set('Authorization', `Bearer ${verifierToken}`)
          .send(approvePayload),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses[0]).toBe(200);
      expect([400, 409]).toContain(statuses[1]); // One succeeds with 200, second receives 400 (already approved) or 409 (concurrent modification)

      // Invariant: Exactly ONE operational Partner and User created
      const partners = await PartnerModel.find({ phone: '+919666660010' });
      const users = await UserModel.find({ phone: '+919666660011', userType: UserType.PARTNER });
      expect(partners.length).toBe(1);
      expect(users.length).toBe(1);
    });

    // SCENARIO 9: Phone / Email Collision and Complete Transaction Rollback
    it('Scenario 9: Identity collision on User creation triggers complete transaction rollback', async () => {
      // Existing partner user with phone
      await UserModel.create({
        phone: '+919666660012',
        userType: UserType.PARTNER,
        status: UserStatus.ACTIVE,
        roles: ['TEST_APP_PARTNER_ROLE'],
      });

      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Rollback Candidate Vendor',
        phone: '+919666660013',
        serviceAreaIds: [saAlpha._id],
        initialUser: { contactName: 'Colliding User', phone: '+919666660012' },
        status: 'UNDER_REVIEW',
      });

      const res = await request(app)
        .post(`/api/v1/admin/partner-applications/${appDoc._id}/approve`)
        .set('Authorization', `Bearer ${verifierToken}`)
        .send({
          reason: 'Testing complete rollback on user collision.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PHONE_ALREADY_REGISTERED');

      // Assert complete rollback
      const partner = await PartnerModel.findOne({ phone: '+919666660013' });
      expect(partner).toBeNull();
    });

    // SCENARIO 10: Clean Reapplication After Rejection
    it('Scenario 10: Clean reapplication succeeds without unique index collisions from past rejection', async () => {
      // 1. Rejected application
      const a1 = await PartnerApplicationModel.create({
        businessName: 'Reapplication Vendor Target',
        phone: '+919666660014',
        serviceAreaIds: [saAlpha._id],
        initialUser: { contactName: 'Reapplicant', phone: '+919666660015' },
        status: 'REJECTED',
        refusalReasonCode: 'TRADE_LICENSE_EXPIRED',
        rejectionReason: 'Expired trade license provided.',
      });

      // 2. Submit new application referencing A1
      const a2 = await partnerApplicationService.createApplication(
        {
          businessName: 'Reapplication Vendor Target',
          phone: '+919666660014',
          previousApplicationId: a1._id.toString(),
          serviceAreaIds: [saAlpha._id.toString()],
          initialUser: { contactName: 'Reapplicant', phone: '+919666660015' },
        },
        { id: verifierStaff._id.toString() },
      );

      // 3. Move A2 to review
      await partnerApplicationService.reviewApplication(a2.id, {
        id: verifierStaff._id.toString(),
      });

      // 4. Approve A2
      const approveResult = await partnerApplicationService.approveApplication(
        a2.id,
        {
          reason: 'Reapplication approved with valid updated trade license.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        },
        { id: verifierStaff._id.toString() },
      );

      expect(approveResult.application.status).toBe('APPROVED');
      expect(approveResult.partner.status).toBe('ACTIVE');
      expect(approveResult.partner.phone).toBe('+919666660014');
    });

    // SCENARIO 11: Application Audit History & Operational Audit Immutability
    it('Scenario 11: Application audit history tracks transitions and operational audit is immutable', async () => {
      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Audit Lifecycle Vendor',
        phone: '+919666660016',
        serviceAreaIds: [saAlpha._id],
        initialUser: { contactName: 'Audit Trackee', phone: '+919666660017' },
        status: 'SUBMITTED',
      });

      // Move to review
      await partnerApplicationService.reviewApplication(appDoc._id.toString(), {
        id: verifierStaff._id.toString(),
      });

      // Approve
      const res = await partnerApplicationService.approveApplication(
        appDoc._id.toString(),
        {
          reason: 'Approved for audit history verification.',
          checklist: {
            identityVerified: true,
            serviceAreaConfirmed: true,
            complianceConfirmed: true,
          },
        },
        { id: verifierStaff._id.toString() },
      );

      expect(res.application.auditHistory.length).toBe(2); // UNDER_REVIEW, APPROVED

      // Operational audit log is created
      const auditLog = await PartnerAuditLogModel.findOne({ partnerId: res.partner.id });
      expect(auditLog).not.toBeNull();

      // Attempting to modify audit record throws immutability error
      await expect(
        PartnerAuditLogModel.updateOne(
          { _id: auditLog?._id },
          { $set: { reason: 'Tampered reason' } },
        ),
      ).rejects.toThrow('PARTNER_AUDIT_LOG_IMMUTABLE');
    });

    // SCENARIO 12: Two Different Service Areas Concurrently Deactivated for the Same Partner
    it('Scenario 12: Two different service areas deactivated for same partner: second fails coverage invariant', async () => {
      const saX = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-12-SAX',
        name: 'Area X',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560052'],
        isActive: true,
      });

      const saY = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-12-SAY',
        name: 'Area Y',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560053'],
        isActive: true,
      });

      const _partner = await PartnerModel.create({
        businessName: 'Partner XY',
        phone: '+919666660018',
        serviceAreaIds: [saX._id, saY._id],
        status: 'ACTIVE',
        coverageVersion: 0,
      });

      // First deactivation succeeds
      await serviceAreaService.updateServiceArea(saX._id.toString(), { isActive: false });

      // Second deactivation fails
      await expect(
        serviceAreaService.updateServiceArea(saY._id.toString(), { isActive: false }),
      ).rejects.toThrow('ACTIVE_PARTNER_DEPENDENCY');

      // Invariant: partner XY retains 1 active area (saY)
      const saYCheck = await ServiceAreaModel.findById(saY._id);
      expect(saYCheck?.isActive).toBe(true);
    });

    // SCENARIO 13: Two Different Service Areas Concurrently Deactivated for Two Different Partners
    it('Scenario 13: Disjoint partners and areas deactivate concurrently without write conflict', async () => {
      const sa13A = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-13-A',
        name: 'Area 13A',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560054'],
        isActive: true,
      });

      const sa13B = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-13-B',
        name: 'Area 13B',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560055'],
        isActive: true,
      });

      const saBackupA = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-13-BAK-A',
        name: 'Backup A',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560056'],
        isActive: true,
      });

      const saBackupB = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-13-BAK-B',
        name: 'Backup B',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560057'],
        isActive: true,
      });

      // P1 on 13A + Backup A
      await PartnerModel.create({
        businessName: 'Partner 13A',
        phone: '+919666660019',
        serviceAreaIds: [sa13A._id, saBackupA._id],
        status: 'ACTIVE',
      });

      // P2 on 13B + Backup B
      await PartnerModel.create({
        businessName: 'Partner 13B',
        phone: '+919666660020',
        serviceAreaIds: [sa13B._id, saBackupB._id],
        status: 'ACTIVE',
      });

      // Both deactivations execute and commit successfully
      const [resA, resB] = await Promise.all([
        serviceAreaService.updateServiceArea(sa13A._id.toString(), { isActive: false }),
        serviceAreaService.updateServiceArea(sa13B._id.toString(), { isActive: false }),
      ]);

      expect(resA.isActive).toBe(false);
      expect(resB.isActive).toBe(false);
    });

    // SCENARIO 14: Multiple Active Partners Sharing One Service Area (Deterministic Lock Ordering)
    it('Scenario 14: Multiple active partners sharing one area acquire locks in sorted order', async () => {
      const sa14 = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-14-MAIN',
        name: 'Area 14 Main',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560058'],
        isActive: true,
      });

      const sa14Backup = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-14-BAK',
        name: 'Area 14 Backup',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560059'],
        isActive: true,
      });

      // Create 3 partners all having backup
      const p1 = await PartnerModel.create({
        businessName: 'Partner 14-1',
        phone: '+919666660021',
        serviceAreaIds: [sa14._id, sa14Backup._id],
        status: 'ACTIVE',
      });
      const p2 = await PartnerModel.create({
        businessName: 'Partner 14-2',
        phone: '+919666660022',
        serviceAreaIds: [sa14._id, sa14Backup._id],
        status: 'ACTIVE',
      });
      const p3 = await PartnerModel.create({
        businessName: 'Partner 14-3',
        phone: '+919666660023',
        serviceAreaIds: [sa14._id, sa14Backup._id],
        status: 'ACTIVE',
      });

      // Deactivation acquires locks in ascending order [p1, p2, p3] and increments coverageVersion
      const res = await serviceAreaService.updateServiceArea(sa14._id.toString(), {
        isActive: false,
      });
      expect(res.isActive).toBe(false);

      const refreshed1 = await PartnerModel.findById(p1._id);
      const refreshed2 = await PartnerModel.findById(p2._id);
      const refreshed3 = await PartnerModel.findById(p3._id);

      expect(refreshed1?.coverageVersion).toBe(1);
      expect(refreshed2?.coverageVersion).toBe(1);
      expect(refreshed3?.coverageVersion).toBe(1);
    });

    // SCENARIO 15: Guard Update that Matches Zero Documents
    it('Scenario 15: Guard update matching zero documents immediately aborts transaction', async () => {
      const fakeAreaId = new Types.ObjectId();

      const appDoc = await PartnerApplicationModel.create({
        businessName: 'Zero Match Vendor',
        phone: '+919666660024',
        serviceAreaIds: [fakeAreaId],
        initialUser: { contactName: 'Zero Match', phone: '+919666660025' },
        status: 'UNDER_REVIEW',
      });

      await expect(
        partnerApplicationService.approveApplication(
          appDoc._id.toString(),
          {
            reason: 'Testing zero match guard abort.',
            checklist: {
              identityVerified: true,
              serviceAreaConfirmed: true,
              complianceConfirmed: true,
            },
          },
          { id: verifierStaff._id.toString() },
        ),
      ).rejects.toThrow('inactive or does not exist');
    });

    // SCENARIO 16: Transaction Retry Re-evaluates Dependency Rule on Fresh Snapshot
    it('Scenario 16: Retry callback re-evaluates dependency rule against fresh committed state', async () => {
      const saShared = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-16-SA',
        name: 'Area 16',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560060'],
        isActive: true,
      });

      const _partner = await PartnerModel.create({
        businessName: 'Retry Dependency Partner',
        phone: '+919666660026',
        serviceAreaIds: [saShared._id],
        status: 'ACTIVE',
      });

      // Attempting deactivation evaluates dependency on fresh state and throws
      await expect(
        serviceAreaService.updateServiceArea(saShared._id.toString(), { isActive: false }),
      ).rejects.toThrow('ACTIVE_PARTNER_DEPENDENCY');
    });

    // SCENARIO 17: Partner Service-Area Assignment Change Concurrent with Service-Area Deactivation
    it('Scenario 17: Partner service-area reassignment serializes with deactivation on coverageVersion', async () => {
      const sa17A = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-17-A',
        name: 'Area 17A',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560061'],
        isActive: true,
      });

      const sa17B = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-17-B',
        name: 'Area 17B',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560062'],
        isActive: true,
      });

      const partner = await PartnerModel.create({
        businessName: 'Reassignment Race Partner',
        phone: '+919666660027',
        serviceAreaIds: [sa17A._id, sa17B._id],
        status: 'ACTIVE',
        coverageVersion: 0,
      });

      // Reassign partner to only SA17A (removing 17B)
      await serviceAreaService.assignPartnerServiceAreas(partner._id.toString(), [
        sa17A._id.toString(),
      ]);

      const updatedPartner = await PartnerModel.findById(partner._id);
      expect(updatedPartner?.coverageVersion).toBe(1);

      // Now deactivating SA17A must be blocked because partner only has SA17A!
      await expect(
        serviceAreaService.updateServiceArea(sa17A._id.toString(), { isActive: false }),
      ).rejects.toThrow('ACTIVE_PARTNER_DEPENDENCY');
    });

    // SCENARIO 18: Partner Status Change Concurrent with Service-Area Deactivation
    it('Scenario 18: Partner status change to INACTIVE releases deactivation dependency', async () => {
      const sa18 = await ServiceAreaModel.create({
        code: 'TEST-SCENARIO-18',
        name: 'Area 18',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincodes: ['560063'],
        isActive: true,
      });

      const partner = await PartnerModel.create({
        businessName: 'Status Transition Partner',
        phone: '+919666660028',
        serviceAreaIds: [sa18._id],
        status: 'ACTIVE',
      });

      // While ACTIVE, deactivation is blocked
      await expect(
        serviceAreaService.updateServiceArea(sa18._id.toString(), { isActive: false }),
      ).rejects.toThrow('ACTIVE_PARTNER_DEPENDENCY');

      // Change partner status to INACTIVE
      await PartnerModel.updateOne({ _id: partner._id }, { $set: { status: 'INACTIVE' } });

      // Now deactivation succeeds because no ACTIVE partners depend on it!
      const deactResult = await serviceAreaService.updateServiceArea(sa18._id.toString(), {
        isActive: false,
      });
      expect(deactResult.isActive).toBe(false);
    });
  });

  afterAll(async () => {
    if (isDbConnected) {
      if (createdPartnerIds.length > 0) {
        const partnerIds = [...createdPartnerIds];
        createdPartnerIds.length = 0;
        await PartnerModel.deleteMany({ _id: { $in: partnerIds } });
      }

      if (createdAppIds.length > 0) {
        const appIds = [...createdAppIds];
        createdAppIds.length = 0;
        await PartnerApplicationModel.deleteMany({ _id: { $in: appIds } });
      }

      if (createdUserIds.length > 0) {
        const userIds = [...createdUserIds];
        createdUserIds.length = 0;
        await UserModel.deleteMany({ _id: { $in: userIds } });
      }

      if (createdServiceAreaIds.length > 0) {
        const saIds = [...createdServiceAreaIds];
        createdServiceAreaIds.length = 0;
        await ServiceAreaModel.deleteMany({ _id: { $in: saIds } });
      }

      if (createdRoleIds.length > 0) {
        const roleIds = [...createdRoleIds];
        createdRoleIds.length = 0;
        await RoleModel.deleteMany({ _id: { $in: roleIds } });
      }

      await disconnectDatabase();
    }
  });
});
