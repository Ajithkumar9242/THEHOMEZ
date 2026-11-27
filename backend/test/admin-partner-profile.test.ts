import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { UserModel } from '../src/models/user.model.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { RefreshTokenModel } from '../src/models/refresh-token.model.js';
import { PartnerAuditLogModel } from '../src/models/partner-audit-log.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { RbacService } from '../src/services/rbac/rbac.service.js';
import * as TransactionModule from '../src/database/transaction.js';
import { UserType, UserStatus, PermissionCode, DeliveryMode } from '@thehomez/shared-types';

function mockPartnerQuery(doc: any) {
  if (!doc) {
    return {
      lean: vi.fn().mockResolvedValue(null),
      then: (resolve: any, reject: any) => Promise.resolve(null).then(resolve, reject),
      catch: (reject: any) => Promise.resolve(null).catch(reject),
    };
  }
  return {
    ...doc,
    lean: vi.fn().mockResolvedValue(doc),
    then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(doc).catch(reject),
  };
}

describe('P1A-13: Partner Profile Edit API (PUT /api/v1/admin/partners/:partnerId)', () => {
  let app: Application;
  let tokenService: TokenService;

  let staffWriterToken: string;
  let staffReadOnlyToken: string;
  let customerToken: string;
  let partnerUserToken: string;

  const mockStaffWriterId = new Types.ObjectId();
  const mockStaffReadOnlyId = new Types.ObjectId();
  const mockCustomerId = new Types.ObjectId();
  const mockPartnerOperatorId = new Types.ObjectId();

  const mockPartnerId = new Types.ObjectId();
  const mockOtherOperatorId = new Types.ObjectId();

  const staffWriterUser = {
    _id: mockStaffWriterId,
    id: mockStaffWriterId.toString(),
    phone: '+919811000051',
    email: 'staff-writer@thehomez.in',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['PARTNER_ADMIN'],
    permissions: [PermissionCode.PARTNER_READ, PermissionCode.PARTNER_WRITE],
  };

  const staffReadOnlyUser = {
    _id: mockStaffReadOnlyId,
    id: mockStaffReadOnlyId.toString(),
    phone: '+919811000052',
    email: 'staff-ro@thehomez.in',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['PARTNER_VIEWER'],
    permissions: [PermissionCode.PARTNER_READ],
  };

  const customerUser = {
    _id: mockCustomerId,
    id: mockCustomerId.toString(),
    phone: '+919811000053',
    email: 'cust@example.com',
    userType: UserType.CUSTOMER,
    status: UserStatus.ACTIVE,
    roles: ['CUSTOMER'],
    permissions: [],
  };

  const partnerOperatorUser = {
    _id: mockPartnerOperatorId,
    id: mockPartnerOperatorId.toString(),
    partnerId: mockPartnerId,
    phone: '+919811000054',
    email: 'operator@timberworks.com',
    userType: UserType.PARTNER,
    status: UserStatus.ACTIVE,
    roles: ['PARTNER_OPERATOR'],
    permissions: [PermissionCode.PARTNER_AVAILABILITY_READ],
  };

  const basePartnerDoc = {
    _id: mockPartnerId,
    businessName: 'Original Timber Works',
    legalName: 'Original Timber Works Pvt Ltd',
    phone: '+919876500001',
    email: 'dispatch@originaltimber.com',
    serviceAreaIds: [new Types.ObjectId()],
    status: 'ACTIVE',
    deliveryMode: DeliveryMode.PARTNER_MANAGED,
    documents: [],
    serviceAreas: [],
    linkedUserCount: 1,
    metadata: {},
    coverageVersion: 1,
    createdAt: new Date('2026-11-01T10:00:00.000Z'),
    updatedAt: new Date('2026-11-01T10:00:00.000Z'),
  };

  beforeAll(() => {
    tokenService = new TokenService();
    app = createApp();

    staffWriterToken = tokenService.signAccessToken(staffWriterUser as any, 'session-writer');
    staffReadOnlyToken = tokenService.signAccessToken(staffReadOnlyUser as any, 'session-ro');
    customerToken = tokenService.signAccessToken(customerUser as any);
    partnerUserToken = tokenService.signAccessToken(partnerOperatorUser as any);
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    // Spies for admin session handling
    vi.spyOn(TokenService.prototype, 'validateAdminSession').mockImplementation(
      async (sessionId: string) => {
        let matchedUserId = staffWriterUser._id;
        if (sessionId === 'session-ro') matchedUserId = staffReadOnlyUser._id;
        return {
          _id: sessionId,
          sessionId,
          userId: matchedUserId,
          status: 'ACTIVE',
          lastActivityAt: new Date(),
          absoluteExpiresAt: new Date(Date.now() + 86400000),
          isAbsoluteExpired: () => false,
          isIdleExpired: () => false,
          isActive: () => true,
        } as any;
      },
    );
    vi.spyOn(TokenService.prototype, 'recordAdminActivity').mockResolvedValue();

    vi.spyOn(UserModel, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === staffWriterUser._id.toString()) return Promise.resolve(staffWriterUser) as any;
      if (idStr === staffReadOnlyUser._id.toString()) return Promise.resolve(staffReadOnlyUser) as any;
      if (idStr === customerUser._id.toString()) return Promise.resolve(customerUser) as any;
      if (idStr === partnerOperatorUser._id.toString()) return Promise.resolve(partnerOperatorUser) as any;
      return Promise.resolve(null) as any;
    });

    vi.spyOn(RbacService.prototype, 'resolveUserPrincipal').mockImplementation(
      async (user: any) => ({
        id: user._id.toString(),
        userId: user._id.toString(),
        userType: user.userType,
        roles: user.roles,
        permissions: user.permissions,
        email: user.email,
        phone: user.phone,
        status: user.status,
      }),
    );

    // Default withTransaction implementation executing callback with a mock session
    vi.spyOn(TransactionModule, 'withTransaction').mockImplementation(
      async (work: (session: any) => Promise<any>) => {
        const mockSession = {
          startTransaction: vi.fn(),
          commitTransaction: vi.fn(),
          abortTransaction: vi.fn(),
          inTransaction: () => true,
        };
        return work(mockSession);
      },
    );

    vi.spyOn(PartnerModel, 'findById').mockImplementation(((id: any) =>
      mockPartnerQuery(basePartnerDoc),
    ) as any);

    vi.spyOn(UserModel, 'countDocuments').mockResolvedValue(1);

    vi.spyOn(ServiceAreaModel, 'find').mockReturnValue({
      lean: vi.fn().mockResolvedValue([]),
    } as any);
  });

  describe('1. Authentication & Authorization Guards', () => {
    it('rejects unauthenticated requests with HTTP 401', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .send({
          businessName: 'New Name',
          reason: 'Valid audit reason for testing update',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects customer tokens with HTTP 403 FORBIDDEN', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          businessName: 'New Name',
          reason: 'Valid audit reason for testing update',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects partner user tokens with HTTP 403 FORBIDDEN', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${partnerUserToken}`)
        .send({
          businessName: 'New Name',
          reason: 'Valid audit reason for testing update',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff tokens missing PARTNER_WRITE with HTTP 403 FORBIDDEN', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffReadOnlyToken}`)
        .send({
          businessName: 'New Name',
          reason: 'Valid audit reason for testing update',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('2. Request Validation & Constraints', () => {
    it('rejects invalid partner ID format with HTTP 400', async () => {
      const res = await request(app)
        .put('/api/v1/admin/partners/not-a-valid-object-id')
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          businessName: 'New Name',
          reason: 'Valid audit reason for testing update',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unexpected query parameters with HTTP 400', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}?unexpectedParam=123`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          businessName: 'New Name',
          reason: 'Valid audit reason for testing update',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 404 PARTNER_NOT_FOUND if partner does not exist', async () => {
      vi.spyOn(PartnerModel, 'findById').mockReturnValueOnce(mockPartnerQuery(null) as any);

      const nonExistentId = new Types.ObjectId().toString();
      const res = await request(app)
        .put(`/api/v1/admin/partners/${nonExistentId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          businessName: 'New Name',
          reason: 'Valid audit reason for testing update',
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PARTNER_NOT_FOUND');
    });

    it('rejects payload with no profile fields with HTTP 400', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          reason: 'Valid audit reason with no profile fields',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects payload missing reason with HTTP 400', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          businessName: 'Valid New Business Name',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects payload with reason shorter than 10 characters with HTTP 400', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          businessName: 'Valid New Business Name',
          reason: 'Too short',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid phone string with HTTP 400', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          phone: '12345',
          reason: 'Valid audit reason for testing phone validation',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid email string with HTTP 400', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          email: 'not-an-email',
          reason: 'Valid audit reason for testing email validation',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid deliveryMode with HTTP 400', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          deliveryMode: 'INVALID_MODE',
          reason: 'Valid audit reason for testing delivery mode',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects syncPrimaryOperatorPhone: true when phone is omitted with HTTP 400', async () => {
      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          businessName: 'Updated Name Without Phone',
          syncPrimaryOperatorPhone: true,
          reason: 'Valid audit reason for testing missing phone',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('3. Standard Profile Update (Without Operator Phone Sync)', () => {
    it('modifies partner dispatch contacts and preserves operator credentials', async () => {
      const partnerDoc = { ...basePartnerDoc };
      const updatedDoc = {
        ...basePartnerDoc,
        businessName: 'Renamed Timber Works',
        legalName: 'Renamed Timber Works LLC',
        phone: '+919876543210',
        email: 'newdispatch@renamedtimber.com',
        deliveryMode: DeliveryMode.PLATFORM_MANAGED,
      };

      vi.spyOn(PartnerModel, 'findById')
        .mockReturnValueOnce(mockPartnerQuery(partnerDoc) as any) // initial check
        .mockReturnValueOnce(mockPartnerQuery(updatedDoc) as any); // getPartnerById return
      const findByIdAndUpdateSpy = vi
        .spyOn(PartnerModel, 'findByIdAndUpdate')
        .mockResolvedValueOnce(updatedDoc as any);

      const userUpdateOneSpy = vi.spyOn(UserModel, 'updateOne');
      const tokenUpdateManySpy = vi.spyOn(RefreshTokenModel, 'updateMany');
      const auditCreateSpy = vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValueOnce([] as any);

      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          businessName: 'Renamed Timber Works',
          legalName: 'Renamed Timber Works LLC',
          phone: '+919876543210',
          email: 'newdispatch@renamedtimber.com',
          deliveryMode: DeliveryMode.PLATFORM_MANAGED,
          syncPrimaryOperatorPhone: false,
          reason: 'Administrative update of commercial contact details',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.businessName).toBe('Renamed Timber Works');
      expect(res.body.data.legalName).toBe('Renamed Timber Works LLC');
      expect(res.body.data.phone).toBe('+919876543210');
      expect(res.body.data.email).toBe('newdispatch@renamedtimber.com');
      expect(res.body.data.deliveryMode).toBe('PLATFORM_MANAGED');

      // Verify PartnerModel.findByIdAndUpdate was called with correct updates and session
      expect(findByIdAndUpdateSpy).toHaveBeenCalledWith(
        mockPartnerId,
        {
          $set: {
            businessName: 'Renamed Timber Works',
            legalName: 'Renamed Timber Works LLC',
            phone: '+919876543210',
            email: 'newdispatch@renamedtimber.com',
            deliveryMode: 'PLATFORM_MANAGED',
          },
        },
        expect.objectContaining({ session: expect.anything(), new: true, runValidators: true }),
      );

      // Verify UserModel operator credentials were NOT touched (Identity Separation)
      expect(userUpdateOneSpy).not.toHaveBeenCalled();

      // Verify RefreshTokens were NOT revoked
      expect(tokenUpdateManySpy).not.toHaveBeenCalled();

      // Verify PARTNER_PROFILE_UPDATED audit log was emitted
      expect(auditCreateSpy).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            partnerId: mockPartnerId,
            action: 'PARTNER_PROFILE_UPDATED',
            reason: 'Administrative update of commercial contact details',
            previousState: expect.objectContaining({
              businessName: 'Original Timber Works',
              phone: '+919876500001',
            }),
            newState: expect.objectContaining({
              businessName: 'Renamed Timber Works',
              phone: '+919876543210',
            }),
          }),
        ],
        expect.objectContaining({ session: expect.anything() }),
      );
    });
  });

  describe('4. Primary Operator Phone Sync (syncPrimaryOperatorPhone: true)', () => {
    it('rejects with HTTP 400 NO_ACTIVE_OPERATOR when partner has no active operator', async () => {
      vi.spyOn(PartnerModel, 'findById').mockReturnValueOnce(mockPartnerQuery(basePartnerDoc) as any);
      vi.spyOn(UserModel, 'countDocuments').mockResolvedValueOnce(0);
      vi.spyOn(UserModel, 'findOne').mockReturnValueOnce({
        sort: vi.fn().mockResolvedValueOnce(null),
      } as any);

      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          phone: '+919876500099',
          syncPrimaryOperatorPhone: true,
          reason: 'Attempting operator sync on partner without operator',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_ACTIVE_OPERATOR');
      expect(res.body.error.message).toContain('No active operator account exists');
    });

    it('rejects with HTTP 400 MULTIPLE_OPERATORS_EXIST when partner has multiple operators', async () => {
      vi.spyOn(PartnerModel, 'findById').mockReturnValueOnce(mockPartnerQuery(basePartnerDoc) as any);
      vi.spyOn(UserModel, 'countDocuments').mockResolvedValueOnce(2);

      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          phone: '+919876500099',
          syncPrimaryOperatorPhone: true,
          reason: 'Attempting operator sync on partner with multiple operators',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MULTIPLE_OPERATORS_EXIST');
      expect(res.body.error.message).toContain('Multiple operator accounts exist');
    });

    it('rejects with HTTP 409 PHONE_ALREADY_REGISTERED when phone is already taken by another partner operator', async () => {
      vi.spyOn(PartnerModel, 'findById').mockReturnValueOnce(mockPartnerQuery(basePartnerDoc) as any);
      vi.spyOn(UserModel, 'countDocuments').mockResolvedValueOnce(1);
      vi.spyOn(UserModel, 'findOne').mockReturnValueOnce({
        sort: vi.fn().mockResolvedValueOnce(partnerOperatorUser),
      } as any);
      vi.spyOn(UserModel, 'exists').mockResolvedValueOnce({ _id: mockOtherOperatorId } as any);

      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          phone: '+919876599999',
          syncPrimaryOperatorPhone: true,
          reason: 'Attempting to sync a conflicting phone number',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
    });

    it('successfully syncs operator phone, updates partner, revokes sessions, and records audit', async () => {
      const newPhone = '+919876577777';
      const updatedPartnerDoc = {
        ...basePartnerDoc,
        phone: newPhone,
      };

      vi.spyOn(PartnerModel, 'findById')
        .mockReturnValueOnce(mockPartnerQuery(basePartnerDoc) as any) // initial check
        .mockReturnValueOnce(mockPartnerQuery(updatedPartnerDoc) as any); // getPartnerById return

      vi.spyOn(UserModel, 'countDocuments').mockResolvedValueOnce(1);
      vi.spyOn(UserModel, 'findOne').mockReturnValueOnce({
        sort: vi.fn().mockResolvedValueOnce(partnerOperatorUser),
      } as any);

      // Pre-check exists returns null, and session exists returns null
      vi.spyOn(UserModel, 'exists')
        .mockResolvedValueOnce(null)
        .mockReturnValueOnce({
          session: vi.fn().mockResolvedValueOnce(null),
        } as any);

      const findByIdAndUpdateSpy = vi
        .spyOn(PartnerModel, 'findByIdAndUpdate')
        .mockResolvedValueOnce(updatedPartnerDoc as any);

      const userUpdateOneSpy = vi
        .spyOn(UserModel, 'updateOne')
        .mockResolvedValueOnce({ acknowledged: true, modifiedCount: 1 } as any);

      const tokenUpdateManySpy = vi
        .spyOn(RefreshTokenModel, 'updateMany')
        .mockResolvedValueOnce({ acknowledged: true, modifiedCount: 1 } as any);

      const auditCreateSpy = vi
        .spyOn(PartnerAuditLogModel, 'create')
        .mockResolvedValueOnce([] as any) // operator cred audit
        .mockResolvedValueOnce([] as any); // partner profile audit

      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          phone: newPhone,
          syncPrimaryOperatorPhone: true,
          reason: 'Authorized partner operator phone sync after staff verification',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.phone).toBe(newPhone);

      // Verify PartnerModel was updated with session
      expect(findByIdAndUpdateSpy).toHaveBeenCalledWith(
        mockPartnerId,
        { $set: { phone: newPhone } },
        expect.objectContaining({ session: expect.anything(), new: true, runValidators: true }),
      );

      // Verify UserModel was updated with session
      expect(userUpdateOneSpy).toHaveBeenCalledWith(
        { _id: mockPartnerOperatorId },
        { $set: { phone: newPhone } },
        expect.objectContaining({ session: expect.anything(), runValidators: true }),
      );

      // Verify RefreshTokens were revoked with SECURITY_RESET and session
      expect(tokenUpdateManySpy).toHaveBeenCalledWith(
        { userId: mockPartnerOperatorId, isRevoked: false },
        {
          $set: expect.objectContaining({
            isRevoked: true,
            revokedReason: 'SECURITY_RESET',
          }),
        },
        expect.objectContaining({ session: expect.anything() }),
      );

      // Verify PARTNER_OPERATOR_CREDENTIALS_UPDATED and PARTNER_PROFILE_UPDATED audit logs
      expect(auditCreateSpy).toHaveBeenCalledTimes(2);
      expect(auditCreateSpy).toHaveBeenNthCalledWith(
        1,
        [
          expect.objectContaining({
            partnerId: mockPartnerId,
            action: 'PARTNER_OPERATOR_CREDENTIALS_UPDATED',
            reason: 'Authorized partner operator phone sync after staff verification',
            previousState: {
              phone: partnerOperatorUser.phone,
              operatorUserId: mockPartnerOperatorId.toString(),
            },
            newState: {
              phone: newPhone,
              operatorUserId: mockPartnerOperatorId.toString(),
            },
          }),
        ],
        expect.objectContaining({ session: expect.anything() }),
      );

      expect(auditCreateSpy).toHaveBeenNthCalledWith(
        2,
        [
          expect.objectContaining({
            partnerId: mockPartnerId,
            action: 'PARTNER_PROFILE_UPDATED',
            reason: 'Authorized partner operator phone sync after staff verification',
            previousState: { phone: basePartnerDoc.phone },
            newState: { phone: newPhone },
          }),
        ],
        expect.objectContaining({ session: expect.anything() }),
      );
    });

    it('traps MongoDB E11000 duplicate key error and converts it cleanly to HTTP 409', async () => {
      vi.spyOn(PartnerModel, 'findById').mockReturnValueOnce(mockPartnerQuery(basePartnerDoc) as any);
      vi.spyOn(UserModel, 'countDocuments').mockResolvedValueOnce(1);
      vi.spyOn(UserModel, 'findOne').mockReturnValueOnce({
        sort: vi.fn().mockResolvedValueOnce(partnerOperatorUser),
      } as any);
      vi.spyOn(UserModel, 'exists').mockResolvedValueOnce(null);

      // Simulate withTransaction throwing E11000
      const duplicateKeyError = new Error('E11000 duplicate key error');
      (duplicateKeyError as any).code = 11000;
      (duplicateKeyError as any).name = 'MongoServerError';

      vi.spyOn(TransactionModule, 'withTransaction').mockRejectedValueOnce(duplicateKeyError);

      const res = await request(app)
        .put(`/api/v1/admin/partners/${mockPartnerId}`)
        .set('Authorization', `Bearer ${staffWriterToken}`)
        .send({
          phone: '+919876588888',
          syncPrimaryOperatorPhone: true,
          reason: 'Testing atomic E11000 duplicate key trap',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
    });
  });
});
