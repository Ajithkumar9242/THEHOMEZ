import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { UserModel } from '../src/models/user.model.js';
import { PartnerAuditLogModel } from '../src/models/partner-audit-log.model.js';
import {
  StorageCleanupJobModel,
  StorageCleanupStatus,
  StorageCleanupTriggerReason,
} from '../src/models/storage-cleanup-job.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { RbacService } from '../src/services/rbac/rbac.service.js';
import {
  UserType,
  UserStatus,
  PermissionCode,
} from '@thehomez/shared-types';

describe('Phase 1A Task P1A-12: Admin Cleanup Job Retry API', () => {
  let app: Application;
  let tokenService: TokenService;

  let settingsWriteToken: string;
  let rbacManageToken: string;
  let partnerWriteOnlyToken: string;
  let customerToken: string;

  const mockStaffSettingsId = new Types.ObjectId();
  const mockStaffRbacId = new Types.ObjectId();
  const mockStaffPartnerWriteId = new Types.ObjectId();
  const mockCustomerId = new Types.ObjectId();
  const mockPartnerId = new Types.ObjectId();
  const testJobId = new Types.ObjectId();

  const settingsWriteUser = {
    _id: mockStaffSettingsId,
    id: mockStaffSettingsId.toString(),
    phone: '+919811000041',
    email: 'settings-admin@thehomez.in',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['SETTINGS_ADMIN'],
    permissions: [PermissionCode.SETTINGS_WRITE],
  };

  const rbacManageUser = {
    _id: mockStaffRbacId,
    id: mockStaffRbacId.toString(),
    phone: '+919811000042',
    email: 'rbac-admin@thehomez.in',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['RBAC_ADMIN'],
    permissions: [PermissionCode.RBAC_MANAGE],
  };

  const partnerWriteUser = {
    _id: mockStaffPartnerWriteId,
    id: mockStaffPartnerWriteId.toString(),
    phone: '+919811000043',
    email: 'partner-write@thehomez.in',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['PARTNER_OPERATOR'],
    permissions: [PermissionCode.PARTNER_WRITE],
  };

  const customerUser = {
    _id: mockCustomerId,
    id: mockCustomerId.toString(),
    phone: '+919811000044',
    email: 'customer@example.com',
    userType: UserType.CUSTOMER,
    status: UserStatus.ACTIVE,
    roles: ['CUSTOMER'],
    permissions: [],
  };

  beforeAll(() => {
    tokenService = new TokenService();
    app = createApp();

    // Spies for admin session validation
    vi.spyOn(TokenService.prototype, 'validateAdminSession').mockImplementation(
      async (sessionId: string) => {
        let matchedUserId = settingsWriteUser._id;
        if (sessionId === 'session-rbac') matchedUserId = rbacManageUser._id;
        if (sessionId === 'session-partner-write') matchedUserId = partnerWriteUser._id;
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
      if (idStr === settingsWriteUser._id.toString()) return Promise.resolve(settingsWriteUser) as any;
      if (idStr === rbacManageUser._id.toString()) return Promise.resolve(rbacManageUser) as any;
      if (idStr === partnerWriteUser._id.toString()) return Promise.resolve(partnerWriteUser) as any;
      if (idStr === customerUser._id.toString()) return Promise.resolve(customerUser) as any;
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

    settingsWriteToken = tokenService.signAccessToken(settingsWriteUser as any, 'session-settings');
    rbacManageToken = tokenService.signAccessToken(rbacManageUser as any, 'session-rbac');
    partnerWriteOnlyToken = tokenService.signAccessToken(partnerWriteUser as any, 'session-partner-write');
    customerToken = tokenService.signAccessToken(customerUser as any);
  });

  const makeTestJob = (overrides: Record<string, unknown> = {}) => ({
    _id: testJobId,
    storageKey: 'thehomez-private/partners/p-123/docs/d-456/reg.pdf',
    partnerId: mockPartnerId,
    documentId: new Types.ObjectId(),
    triggerReason: StorageCleanupTriggerReason.DOCUMENT_DELETED,
    status: StorageCleanupStatus.FAILED,
    attempts: 5,
    maxAttempts: 5,
    lastError: 'Cloudinary API connection timeout after 3 attempts',
    nextRetryAt: new Date(Date.now() - 60000),
    leaseExpiresAt: undefined,
    workerId: undefined,
    createdAt: new Date('2026-11-20T10:00:00.000Z'),
    updatedAt: new Date('2026-11-20T10:15:00.000Z'),
    ...overrides,
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(TokenService.prototype, 'validateAdminSession').mockImplementation(
      async (sessionId: string) => {
        let matchedUserId = settingsWriteUser._id;
        if (sessionId === 'session-rbac') matchedUserId = rbacManageUser._id;
        if (sessionId === 'session-partner-write') matchedUserId = partnerWriteUser._id;
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
      if (idStr === settingsWriteUser._id.toString()) return Promise.resolve(settingsWriteUser) as any;
      if (idStr === rbacManageUser._id.toString()) return Promise.resolve(rbacManageUser) as any;
      if (idStr === partnerWriteUser._id.toString()) return Promise.resolve(partnerWriteUser) as any;
      if (idStr === customerUser._id.toString()) return Promise.resolve(customerUser) as any;
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
  });

  // 1. Authorization Gates
  describe('Authorization Gates', () => {
    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      const res = await request(app).post(
        `/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`,
      );

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects customer token with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff token lacking both SETTINGS_WRITE and RBAC_MANAGE with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${partnerWriteOnlyToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('permits authorized staff with SETTINGS_WRITE', async () => {
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(makeTestJob() as any);
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue(
        makeTestJob({ status: StorageCleanupStatus.PENDING, attempts: 0 }) as any,
      );
      vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('permits authorized staff with RBAC_MANAGE', async () => {
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(makeTestJob() as any);
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue(
        makeTestJob({ status: StorageCleanupStatus.PENDING, attempts: 0 }) as any,
      );
      vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${rbacManageToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // 2. Input Validation Gates
  describe('Input Validation Gates', () => {
    it('rejects invalid jobId parameter format with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/admin/storage/cleanup-jobs/invalid-hex-id-123/retry')
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('24-character hexadecimal ObjectId');
    });

    it('rejects unexpected query parameters with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry?unexpected=1`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unexpected request-body fields with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`)
        .send({ unexpectedField: 'malicious' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // 3. State Machine & Worker Safety Gates
  describe('State Machine & Worker Safety Gates', () => {
    it('returns 404 CLEANUP_JOB_NOT_FOUND when job does not exist in database', async () => {
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('CLEANUP_JOB_NOT_FOUND');
    });

    it('rejects retrying a COMPLETED job with 400 CLEANUP_JOB_ALREADY_RESOLVED', async () => {
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(
        makeTestJob({ status: StorageCleanupStatus.COMPLETED }) as any,
      );

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CLEANUP_JOB_ALREADY_RESOLVED');
      expect(res.body.error.message).toContain('already resolved');
    });

    it('rejects retrying a RESOLVED job with 400 CLEANUP_JOB_ALREADY_RESOLVED', async () => {
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(
        makeTestJob({ status: StorageCleanupStatus.RESOLVED }) as any,
      );

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CLEANUP_JOB_ALREADY_RESOLVED');
    });

    it('rejects retrying when worker lease is currently ACTIVE with 409 CLEANUP_JOB_LEASE_ACTIVE', async () => {
      const activeLeaseExpiry = new Date(Date.now() + 180000); // 3 minutes in future
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(
        makeTestJob({
          status: StorageCleanupStatus.IN_PROGRESS,
          workerId: 'worker-node-1',
          leaseExpiresAt: activeLeaseExpiry,
        }) as any,
      );

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLEANUP_JOB_LEASE_ACTIVE');
      expect(res.body.error.message).toContain('active worker lease');
    });

    it('allows retry takeover when IN_PROGRESS job has an EXPIRED worker lease', async () => {
      const expiredLease = new Date(Date.now() - 30000); // Expired 30 seconds ago
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(
        makeTestJob({
          status: StorageCleanupStatus.IN_PROGRESS,
          workerId: 'dead-worker-node',
          leaseExpiresAt: expiredLease,
        }) as any,
      );
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue(
        makeTestJob({
          status: StorageCleanupStatus.PENDING,
          attempts: 0,
          workerId: undefined,
          leaseExpiresAt: undefined,
        }) as any,
      );
      vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.job.status).toBe(StorageCleanupStatus.PENDING);
      expect(res.body.data.job.attempts).toBe(0);
    });
  });

  // 4. Success Execution & Audit Logging
  describe('Success Execution & Security Invariants', () => {
    it('successfully resets attempts to 0, sets status to PENDING, sets nextRetryAt to now, emits audit log, and strictly excludes storageKey', async () => {
      const initialJob = makeTestJob({
        status: StorageCleanupStatus.DEAD_LETTER,
        attempts: 10,
        workerId: 'worker-dead',
        leaseExpiresAt: new Date(Date.now() - 60000),
      });
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(initialJob as any);

      const now = new Date();
      const updatedJob = makeTestJob({
        status: StorageCleanupStatus.PENDING,
        attempts: 0,
        nextRetryAt: now,
        workerId: undefined,
        leaseExpiresAt: undefined,
      });

      const findOneAndUpdateSpy = vi
        .spyOn(StorageCleanupJobModel, 'findOneAndUpdate')
        .mockResolvedValue(updatedJob as any);
      const auditSpy = vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.job).toBeDefined();

      const jobDto = res.body.data.job;
      expect(jobDto.id).toBe(testJobId.toHexString());
      expect(jobDto.status).toBe(StorageCleanupStatus.PENDING);
      expect(jobDto.attempts).toBe(0);
      expect(jobDto.workerId).toBeNull();
      expect(jobDto.leaseExpiresAt).toBeNull();

      // STRICT SECURITY INVARIANT: storageKey, private paths, and URLs must NOT be exposed in response
      expect(jobDto.storageKey).toBeUndefined();
      expect((jobDto as any).privateUrl).toBeUndefined();
      expect((jobDto as any).downloadUrl).toBeUndefined();

      // Verify atomic update was invoked with exact reset and lease unsetting
      expect(findOneAndUpdateSpy).toHaveBeenCalledWith(
        {
          _id: testJobId,
          status: { $nin: [StorageCleanupStatus.COMPLETED, StorageCleanupStatus.RESOLVED] },
          $or: [
            { status: { $ne: StorageCleanupStatus.IN_PROGRESS } },
            { leaseExpiresAt: { $lte: expect.any(Date) } },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { $exists: false } },
          ],
        },
        {
          $set: {
            status: StorageCleanupStatus.PENDING,
            attempts: 0,
            nextRetryAt: expect.any(Date),
          },
          $unset: {
            workerId: 1,
            leaseExpiresAt: 1,
          },
        },
        { new: true },
      );

      // Verify STORAGE_CLEANUP_JOB_RETRY_TRIGGERED audit event was emitted
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: mockPartnerId,
          staffUserId: mockStaffSettingsId,
          action: 'STORAGE_CLEANUP_JOB_RETRY_TRIGGERED',
          previousState: expect.objectContaining({
            jobId: testJobId.toHexString(),
            status: StorageCleanupStatus.DEAD_LETTER,
            attempts: 10,
          }),
          newState: expect.objectContaining({
            jobId: testJobId.toHexString(),
            status: StorageCleanupStatus.PENDING,
            attempts: 0,
          }),
        }),
      );
    });

    it('permits retry on an orphan cleanup job without partnerId and persists audit record', async () => {
      const orphanJob = makeTestJob({
        partnerId: undefined,
        status: StorageCleanupStatus.FAILED,
        attempts: 3,
      });
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(orphanJob as any);
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue(
        makeTestJob({ partnerId: undefined, status: StorageCleanupStatus.PENDING, attempts: 0 }) as any,
      );
      const auditSpy = vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.job.partnerId).toBeNull();

      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: undefined,
          action: 'STORAGE_CLEANUP_JOB_RETRY_TRIGGERED',
        }),
      );
    });

    it('sanitizes lastError in response by redacting signed URLs, credentials, storage keys, and filesystem paths', async () => {
      const sensitiveError =
        'Upload failed: https://api.cloudinary.com/v1_1/demo/image/upload?sig=secretToken123&api_key=key999 with key thehomez-private/partners/p-123/docs/d-456/reg.pdf at /var/app/storage/wal/temp.file';
      const jobWithSensitiveError = makeTestJob({
        status: StorageCleanupStatus.FAILED,
        lastError: sensitiveError,
      });
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(jobWithSensitiveError as any);
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue(
        makeTestJob({
          status: StorageCleanupStatus.PENDING,
          attempts: 0,
          lastError: sensitiveError,
        }) as any,
      );
      vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const returnedError = res.body.data.job.lastError;

      // Assert sensitive substrings are redacted
      expect(returnedError).not.toContain('https://api.cloudinary.com');
      expect(returnedError).not.toContain('secretToken123');
      expect(returnedError).not.toContain('key999');
      expect(returnedError).not.toContain('thehomez-private/partners/p-123/docs/d-456/reg.pdf');
      expect(returnedError).not.toContain('/var/app/storage/wal/temp.file');

      expect(returnedError).toContain('[REDACTED_URL]');
      expect(returnedError).toContain('[REDACTED_STORAGE_KEY]');
    });
  });

  // 5. Audit Failure Rollback & Concurrency Handling
  describe('Audit Failure Rollback & Concurrency Handling', () => {
    it('rolls back cleanup job state in MongoDB if audit log creation fails with 500 AUDIT_LOG_FAILED', async () => {
      const initialJob = makeTestJob({
        status: StorageCleanupStatus.FAILED,
        attempts: 5,
        lastError: 'Permanent failure',
      });
      vi.spyOn(StorageCleanupJobModel, 'findById').mockResolvedValue(initialJob as any);
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue(
        makeTestJob({ status: StorageCleanupStatus.PENDING, attempts: 0 }) as any,
      );

      const updateOneSpy = vi
        .spyOn(StorageCleanupJobModel, 'updateOne')
        .mockResolvedValue({ acknowledged: true, matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null } as any);

      vi.spyOn(PartnerAuditLogModel, 'create').mockRejectedValue(new Error('Audit log MongoDB insertion failure'));

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('AUDIT_LOG_FAILED');

      // Verify rollback restored prior status FAILED and attempts 5
      expect(updateOneSpy).toHaveBeenCalledWith(
        {
          _id: testJobId,
          status: StorageCleanupStatus.PENDING,
          nextRetryAt: expect.any(Date),
        },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: StorageCleanupStatus.FAILED,
            attempts: 5,
          }),
        }),
      );
    });

    it('returns 409 CLEANUP_JOB_CONFLICT when atomic update matches no document due to concurrent modification', async () => {
      vi.spyOn(StorageCleanupJobModel, 'findById')
        .mockResolvedValueOnce(makeTestJob({ status: StorageCleanupStatus.FAILED }) as any)
        .mockResolvedValueOnce(makeTestJob({ status: StorageCleanupStatus.FAILED }) as any);

      // Concurrent race condition: findOneAndUpdate matches 0 documents
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/v1/admin/storage/cleanup-jobs/${testJobId.toHexString()}/retry`)
        .set('Authorization', `Bearer ${settingsWriteToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CLEANUP_JOB_CONFLICT');
    });
  });
});
