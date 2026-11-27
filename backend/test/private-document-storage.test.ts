import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { UserModel } from '../src/models/user.model.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { PartnerAuditLogModel } from '../src/models/partner-audit-log.model.js';
import { StorageCleanupJobModel, StorageCleanupTriggerReason } from '../src/models/storage-cleanup-job.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { RbacService } from '../src/services/rbac/rbac.service.js';
import {
  UserType,
  UserStatus,
  PermissionCode,
  PartnerDocumentType,
  DocumentReviewStatus,
  DocumentScanStatus,
  ManualSecurityReviewStatus,
} from '@thehomez/shared-types';
import {
  MockMalwareScannerAdapter,
  EICAR_STANDARD_TEST_STRING,
} from '../src/services/security/malware-scanner.service.js';
import { validateDocumentSignature } from '../src/services/storage/file-signature.validator.js';
import { cloudinaryPrivateStorageAdapter } from '../src/services/storage/cloudinary-private-storage.service.js';
import { storageCleanupService } from '../src/services/storage/storage-cleanup.service.js';

describe('Phase 1A: Private KYC Storage Slice Integration Tests', () => {
  let app: Application;
  let tokenService: TokenService;

  let partnerStaffToken: string;
  let readOnlyStaffToken: string;
  let customerToken: string;
  let superAdminToken: string;
  let verifyOnlyToken: string;
  let rbacOnlyToken: string;

  const mockPartnerId = new Types.ObjectId();
  const mockStaffUserId = new Types.ObjectId();
  const mockSuperAdminId = new Types.ObjectId();

  // Test fixtures for valid magic byte signatures
  const validPdfBuffer = Buffer.concat([
    Buffer.from('%PDF-1.4\n%âãÏÓ\n'),
    Buffer.from('Mock valid PDF stream content for testing purposes'),
  ]);

  const validJpegBuffer = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
    Buffer.from('Mock JPEG content'),
  ]);

  const validPngBuffer = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
    Buffer.from('IHDR Mock PNG content'),
  ]);

  const validWebpBuffer = Buffer.concat([
    Buffer.from([0x52, 0x49, 0x46, 0x46]), // 'RIFF'
    Buffer.from([0x24, 0x00, 0x00, 0x00]), // size
    Buffer.from([0x57, 0x45, 0x42, 0x50]), // 'WEBP'
    Buffer.from('VP8X Mock WebP content'),
  ]);

  const spoofedExecutableBuffer = Buffer.concat([
    Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), // MZ DOS/PE
    Buffer.from('Executable code disguised as pdf'),
  ]);

  const spoofedSvgBuffer = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const spoofedHtmlBuffer = Buffer.from('<html><head><title>Phishing</title></head><body>Login</body></html>');

  beforeAll(() => {
    tokenService = new TokenService();
    app = createApp();

    const partnerStaffUser = {
      _id: mockStaffUserId,
      id: mockStaffUserId.toString(),
      phone: '+919811000031',
      email: 'staff-partner-write@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['PARTNER_MANAGER'],
      permissions: [PermissionCode.PARTNER_READ, PermissionCode.PARTNER_WRITE],
    };

    const readOnlyStaffUser = {
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      phone: '+919811000032',
      email: 'staff-partner-read@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['PARTNER_VIEWER'],
      permissions: [PermissionCode.PARTNER_READ],
    };

    const superAdminUser = {
      _id: mockSuperAdminId,
      id: mockSuperAdminId.toString(),
      phone: '+919811000035',
      email: 'super-admin@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['SUPER_ADMIN'],
      permissions: [
        PermissionCode.PARTNER_READ,
        PermissionCode.PARTNER_WRITE,
        PermissionCode.PARTNER_VERIFY,
        PermissionCode.RBAC_MANAGE,
      ],
    };

    const verifyOnlyUser = {
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      phone: '+919811000036',
      email: 'verify-only@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['PARTNER_VERIFIER'],
      permissions: [PermissionCode.PARTNER_READ, PermissionCode.PARTNER_VERIFY],
    };

    const rbacOnlyUser = {
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      phone: '+919811000037',
      email: 'rbac-only@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['RBAC_ADMIN'],
      permissions: [PermissionCode.RBAC_MANAGE],
    };

    const customerUser = {
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      phone: '+919811000033',
      email: 'customer-user@example.com',
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: [],
      permissions: [],
    };

    function setupAuthSpies() {
      vi.spyOn(TokenService.prototype, 'validateAdminSession').mockImplementation(
        async (sessionId: string) => {
          let matchedUserId = partnerStaffUser._id;
          if (sessionId === 'session-read-only') matchedUserId = readOnlyStaffUser._id;
          if (sessionId === 'session-super-admin') matchedUserId = superAdminUser._id;
          if (sessionId === 'session-verify-only') matchedUserId = verifyOnlyUser._id;
          if (sessionId === 'session-rbac-only') matchedUserId = rbacOnlyUser._id;
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
        if (idStr === partnerStaffUser._id.toString()) return Promise.resolve(partnerStaffUser) as any;
        if (idStr === readOnlyStaffUser._id.toString()) return Promise.resolve(readOnlyStaffUser) as any;
        if (idStr === superAdminUser._id.toString()) return Promise.resolve(superAdminUser) as any;
        if (idStr === verifyOnlyUser._id.toString()) return Promise.resolve(verifyOnlyUser) as any;
        if (idStr === rbacOnlyUser._id.toString()) return Promise.resolve(rbacOnlyUser) as any;
        if (idStr === customerUser._id.toString()) return Promise.resolve(customerUser) as any;
        return Promise.resolve(null) as any;
      });

      vi.spyOn(RbacService.prototype, 'getEffectivePermissions').mockImplementation(async (roles: string[]) => {
        if (roles.includes('SUPER_ADMIN'))
          return [
            PermissionCode.PARTNER_READ,
            PermissionCode.PARTNER_WRITE,
            PermissionCode.PARTNER_VERIFY,
            PermissionCode.RBAC_MANAGE,
          ];
        if (roles.includes('PARTNER_VERIFIER'))
          return [PermissionCode.PARTNER_READ, PermissionCode.PARTNER_VERIFY];
        if (roles.includes('RBAC_ADMIN')) return [PermissionCode.RBAC_MANAGE];
        if (roles.includes('PARTNER_MANAGER'))
          return [PermissionCode.PARTNER_READ, PermissionCode.PARTNER_WRITE];
        if (roles.includes('PARTNER_VIEWER')) return [PermissionCode.PARTNER_READ];
        return [];
      });
    }

    setupAuthSpies();

    partnerStaffToken = tokenService.signAccessToken(partnerStaffUser as any, 'session-partner-write');
    readOnlyStaffToken = tokenService.signAccessToken(readOnlyStaffUser as any, 'session-read-only');
    superAdminToken = tokenService.signAccessToken(superAdminUser as any, 'session-super-admin');
    verifyOnlyToken = tokenService.signAccessToken(verifyOnlyUser as any, 'session-verify-only');
    rbacOnlyToken = tokenService.signAccessToken(rbacOnlyUser as any, 'session-rbac-only');
    customerToken = tokenService.signAccessToken(customerUser as any);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. P1A-05: Malware Scanner Service Unit Tests
  // =========================================================================
  describe('P1A-05: Malware Scanner Adapter Tests', () => {
    it('detects EICAR standard antivirus test signature and returns INFECTED status', async () => {
      const scanner = new MockMalwareScannerAdapter();
      const infectedBuffer = Buffer.from(`Header text before signature: ${EICAR_STANDARD_TEST_STRING} trailing text`);

      const submission = await scanner.submitScanJob(infectedBuffer, {
        storageKey: 'thehomez-private/partners/test/doc1',
        mimeType: 'application/pdf',
        sha256Hash: 'dummyhash',
      });

      expect(submission.initialStatus).toBe(DocumentScanStatus.INFECTED);
      expect(submission.details?.threatName).toBe('EICAR-Standard-AV-Test');

      const check = await scanner.checkScanStatus(submission.jobId);
      expect(check.status).toBe(DocumentScanStatus.INFECTED);
      expect(check.details?.threatName).toBe('EICAR-Standard-AV-Test');
    });

    it('returns CLEAN status for clean payload buffer', async () => {
      const scanner = new MockMalwareScannerAdapter();
      const cleanBuffer = Buffer.from('Standard non-malicious business invoice document');

      const submission = await scanner.submitScanJob(cleanBuffer, {
        storageKey: 'thehomez-private/partners/test/doc2',
        mimeType: 'application/pdf',
        sha256Hash: 'dummyhash',
      });

      expect(submission.initialStatus).toBe(DocumentScanStatus.CLEAN);
      const check = await scanner.checkScanStatus(submission.jobId);
      expect(check.status).toBe(DocumentScanStatus.CLEAN);
    });

    it('returns SCAN_UNAVAILABLE when querying an unknown scan job ID', async () => {
      const scanner = new MockMalwareScannerAdapter();
      const check = await scanner.checkScanStatus('non-existent-uuid');
      expect(check.status).toBe(DocumentScanStatus.SCAN_UNAVAILABLE);
    });

    it('throws SECURITY_VIOLATION if instantiated in NODE_ENV === "production"', () => {
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        expect(() => new MockMalwareScannerAdapter()).toThrow(/SECURITY_VIOLATION/);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });

  // =========================================================================
  // 2. Binary Magic-Byte Signature Validation Tests
  // =========================================================================
  describe('Binary Magic-Byte Inspection Tests', () => {
    it('validates PDF magic bytes correctly (%PDF)', () => {
      const result = validateDocumentSignature(validPdfBuffer);
      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe('application/pdf');
      expect(result.extension).toBe('pdf');
    });

    it('validates JPEG magic bytes correctly (0xFF 0xD8 0xFF)', () => {
      const result = validateDocumentSignature(validJpegBuffer);
      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe('image/jpeg');
      expect(result.extension).toBe('jpg');
    });

    it('validates PNG magic bytes correctly (0x89 0x50 0x4E 0x47...)', () => {
      const result = validateDocumentSignature(validPngBuffer);
      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe('image/png');
      expect(result.extension).toBe('png');
    });

    it('validates WebP magic bytes correctly (RIFF...WEBP)', () => {
      const result = validateDocumentSignature(validWebpBuffer);
      expect(result.valid).toBe(true);
      expect(result.mimeType).toBe('image/webp');
      expect(result.extension).toBe('webp');
    });

    it('rejects spoofed executable payload disguised as PDF', () => {
      const result = validateDocumentSignature(spoofedExecutableBuffer);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unsupported file signature');
    });

    it('rejects SVG and HTML payloads', () => {
      const svgResult = validateDocumentSignature(spoofedSvgBuffer);
      expect(svgResult.valid).toBe(false);

      const htmlResult = validateDocumentSignature(spoofedHtmlBuffer);
      expect(htmlResult.valid).toBe(false);
    });

    it('rejects truncated buffers under 12 bytes', () => {
      const shortBuffer = Buffer.from([0x25, 0x50]);
      const result = validateDocumentSignature(shortBuffer);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too small');
    });
  });

  // =========================================================================
  // 3. P1A-07: Multipart KYC Document Upload Endpoint Integration Tests
  // =========================================================================
  describe('P1A-07: POST /api/v1/admin/uploads/document', () => {
    beforeEach(() => {
      // Default mocks for upload route without wiping out auth spies
      vi.spyOn(PartnerModel, 'findById').mockImplementation(async (id: any) => {
        if (id?.toString() === mockPartnerId.toHexString()) {
          return {
            _id: mockPartnerId,
            businessName: 'Apex Electronics Private Limited',
            status: 'ACTIVE',
            documents: [],
          } as any;
        }
        return null;
      });

      vi.spyOn(PartnerModel, 'updateOne').mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      } as any);

      vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue({} as any);

      vi.spyOn(cloudinaryPrivateStorageAdapter, 'uploadPrivateDocument').mockResolvedValue({
        storageKey: `thehomez-private/partners/${mockPartnerId.toHexString()}/gst_certificate_1234.pdf`,
        bytes: validPdfBuffer.length,
        mimeType: 'application/pdf',
      });

      vi.spyOn(cloudinaryPrivateStorageAdapter, 'updateObjectTags').mockResolvedValue(true);
      vi.spyOn(cloudinaryPrivateStorageAdapter, 'deletePrivateDocument').mockResolvedValue(true);
    });

    it('rejects unauthenticated requests with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects customer token with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${customerToken}`)
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff lacking PARTNER_WRITE permission with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${readOnlyStaffToken}`)
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects request with no file attached with 400 NO_FILE_PROVIDED', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_FILE_PROVIDED');
    });

    it('rejects request with missing or invalid partnerId with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', 'invalid-object-id')
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 PARTNER_NOT_FOUND if target partner does not exist in MongoDB', async () => {
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(null);

      const nonExistentId = new Types.ObjectId().toHexString();
      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', nonExistentId)
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PARTNER_NOT_FOUND');
    });

    it('rejects request with invalid documentType with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', 'INVALID_DOC_TYPE');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects spoofed file with 400 INVALID_FILE_SIGNATURE when header does not match allowed magic bytes', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', spoofedSvgBuffer, 'gst_cert.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_FILE_SIGNATURE');
    });

    it('rejects files exceeding 10 MB ceiling with 400 FILE_TOO_LARGE', async () => {
      // 10 MB + 1 KB buffer
      const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 1024);
      // Give it valid PDF signature at the beginning
      oversizedBuffer[0] = 0x25;
      oversizedBuffer[1] = 0x50;
      oversizedBuffer[2] = 0x44;
      oversizedBuffer[3] = 0x46;

      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', oversizedBuffer, 'oversized.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    });

    it('successfully uploads valid PDF document, persists subdocument, and emits audit event', async () => {
      const auditSpy = vi.spyOn(PartnerAuditLogModel, 'create');
      const updateSpy = vi.spyOn(PartnerModel, 'updateOne');
      const uploadStorageSpy = vi.spyOn(cloudinaryPrivateStorageAdapter, 'uploadPrivateDocument');

      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', validPdfBuffer, 'gst_certificate.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE)
        .field('notes', 'Official GST certificate copy');

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.document).toBeDefined();

      const doc = res.body.data.document;
      expect(doc.documentType).toBe(PartnerDocumentType.GST_CERTIFICATE);
      expect(doc.mimeType).toBe('application/pdf');
      expect(doc.status).toBe(DocumentReviewStatus.PENDING_REVIEW);
      expect(doc.scanStatus).toBe(DocumentScanStatus.PENDING_SCAN);
      expect(doc.scanGeneration).toBe(1);
      expect(doc.manualSecurityReview.status).toBe('NOT_REVIEWED');
      expect(doc.isDeleted).toBe(false);

      // Verify Cloudinary private upload was called
      expect(uploadStorageSpy).toHaveBeenCalledWith(
        expect.any(Buffer),
        expect.objectContaining({
          partnerId: mockPartnerId.toHexString(),
          documentType: PartnerDocumentType.GST_CERTIFICATE,
          originalFilename: 'gst_certificate.pdf',
          mimeType: 'application/pdf',
        }),
      );

      // Verify MongoDB update was called
      expect(updateSpy).toHaveBeenCalledWith(
        { _id: mockPartnerId.toHexString() },
        expect.objectContaining({
          $push: expect.objectContaining({
            documents: expect.objectContaining({
              documentType: PartnerDocumentType.GST_CERTIFICATE,
              status: DocumentReviewStatus.PENDING_REVIEW,
              scanStatus: DocumentScanStatus.PENDING_SCAN,
            }),
          }),
        }),
      );

      // Verify PartnerAuditLogModel.create was called
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PARTNER_DOCUMENT_UPLOADED',
          partnerId: mockPartnerId,
        }),
      );
    });

    it('triggers compensating storage deletion when MongoDB update fails', async () => {
      const deleteStorageSpy = vi.spyOn(cloudinaryPrivateStorageAdapter, 'deletePrivateDocument');
      vi.spyOn(PartnerModel, 'updateOne').mockRejectedValue(new Error('Mongo connection timeout'));

      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(deleteStorageSpy).toHaveBeenCalled();
    });

    it('queues cleanup job in StorageCleanupJobModel when both MongoDB update and storage delete fail', async () => {
      vi.spyOn(PartnerModel, 'updateOne').mockRejectedValue(new Error('Mongo connection timeout'));
      vi.spyOn(cloudinaryPrivateStorageAdapter, 'deletePrivateDocument').mockRejectedValue(
        new Error('Cloudinary API unreachable'),
      );
      const compensationSpy = vi.spyOn(storageCleanupService, 'recordCompensationFailure');

      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(500);
      expect(compensationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
        }),
      );
    });

    it('handles partner disappearing between initial lookup and update (matchedCount === 0) via compensation path', async () => {
      const deleteStorageSpy = vi.spyOn(cloudinaryPrivateStorageAdapter, 'deletePrivateDocument');
      vi.spyOn(PartnerModel, 'updateOne').mockResolvedValue({
        acknowledged: true,
        matchedCount: 0,
        modifiedCount: 0,
        upsertedCount: 0,
        upsertedId: null,
      } as any);

      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(deleteStorageSpy).toHaveBeenCalled();
    });

    it('rolls back document and storage if mandatory audit log creation fails (preventing unaudited success)', async () => {
      const deleteStorageSpy = vi.spyOn(cloudinaryPrivateStorageAdapter, 'deletePrivateDocument');
      const updateSpy = vi.spyOn(PartnerModel, 'updateOne');
      vi.spyOn(PartnerAuditLogModel, 'create').mockRejectedValue(new Error('Audit log persistence failure'));

      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('AUDIT_LOG_FAILED');
      expect(deleteStorageSpy).toHaveBeenCalled();
      // Verifies $pull was executed to remove the un-audited document subdocument
      expect(updateSpy).toHaveBeenCalledWith(
        { _id: mockPartnerId.toHexString() },
        expect.objectContaining({
          $pull: expect.objectContaining({
            documents: expect.objectContaining({ _id: expect.any(Types.ObjectId) }),
          }),
        }),
      );
    });

    it('records durable compensation failure if MongoDB document rollback fails during audit error', async () => {
      const deleteStorageSpy = vi.spyOn(cloudinaryPrivateStorageAdapter, 'deletePrivateDocument');
      const compensationSpy = vi.spyOn(storageCleanupService, 'recordCompensationFailure');
      vi.spyOn(PartnerAuditLogModel, 'create').mockRejectedValue(new Error('Audit log persistence failure'));

      // First call for initial $push succeeds; second call for rollback $pull returns modifiedCount: 0
      vi.spyOn(PartnerModel, 'updateOne')
        .mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        } as any)
        .mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 0, // Rollback failed to remove subdocument
          upsertedCount: 0,
          upsertedId: null,
        } as any);

      const res = await request(app)
        .post('/api/v1/admin/uploads/document')
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .attach('file', validPdfBuffer, 'gst.pdf')
        .field('partnerId', mockPartnerId.toHexString())
        .field('documentType', PartnerDocumentType.GST_CERTIFICATE);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('AUDIT_LOG_FAILED');
      expect(deleteStorageSpy).toHaveBeenCalled();
      // Verifies durable compensation record was created due to un-pulled subdocument
      expect(compensationSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
          error: expect.stringContaining('Audit log rollback failed'),
        }),
      );
    });
  });

  // =========================================================================
  // 4. Dual-Layer Cleanup Durability Unit Tests
  // =========================================================================
  describe('Durable Dual-Layer Cleanup Compensation Mechanism', () => {
    it('persists cleanup job into MongoDB StorageCleanupJobModel when available', async () => {
      const upsertSpy = vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue({} as any);

      await storageCleanupService.recordCompensationFailure({
        storageKey: 'thehomez-private/partners/p1/docs/test_doc.pdf',
        partnerId: new Types.ObjectId(),
        triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
        error: 'Simulated failure',
      });

      expect(upsertSpy).toHaveBeenCalledWith(
        { storageKey: 'thehomez-private/partners/p1/docs/test_doc.pdf' },
        expect.any(Object),
        expect.objectContaining({ upsert: true }),
      );
    });

    it('falls back to local WAL file when MongoDB queue persistence fails', async () => {
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockRejectedValue(
        new Error('MongoDB cluster unreachable'),
      );

      const walFile = storageCleanupService.getWalFilePath();
      // Ensure clean state
      if (fs.existsSync(walFile)) {
        fs.unlinkSync(walFile);
      }

      await storageCleanupService.recordCompensationFailure({
        storageKey: 'thehomez-private/partners/wal_test/doc_999.pdf',
        partnerId: new Types.ObjectId(),
        triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
        error: 'Storage deletion timeout',
      });

      expect(fs.existsSync(walFile)).toBe(true);
      const content = fs.readFileSync(walFile, 'utf8');
      expect(content).toContain('thehomez-private/partners/wal_test/doc_999.pdf');
      expect(content).toContain(StorageCleanupTriggerReason.UPLOAD_FAILED);

      // Clean up test file
      try {
        fs.unlinkSync(walFile);
      } catch {}
    });

    it('synchronously appends to WAL with advisory locking and cleans up lockfile', async () => {
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockRejectedValue(
        new Error('MongoDB cluster down'),
      );

      const walFile = storageCleanupService.getWalFilePath();
      const lockFile = storageCleanupService.getLockFilePath();

      await storageCleanupService.recordCompensationFailure({
        storageKey: 'thehomez-private/partners/wal_test/doc_locked.pdf',
        partnerId: new Types.ObjectId(),
        triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
        error: 'Storage failure',
      });

      // Verify lockfile was released
      expect(fs.existsSync(lockFile)).toBe(false);
      // Verify walFile contains entry
      expect(fs.existsSync(walFile)).toBe(true);
      const content = fs.readFileSync(walFile, 'utf8');
      expect(content).toContain('doc_locked.pdf');

      try {
        fs.unlinkSync(walFile);
      } catch {}
    });

    it('stale lock recovery does not remove lock belonging to an active process, but recovers from dead process', async () => {
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockRejectedValue(
        new Error('MongoDB down'),
      );

      const lockFile = storageCleanupService.getLockFilePath();
      const walFile = storageCleanupService.getWalFilePath();
      const walDir = path.dirname(lockFile);
      if (!fs.existsSync(walDir)) {
        fs.mkdirSync(walDir, { recursive: true });
      }

      // Case 1: Dead process PID (e.g. 99999999) older than 10 seconds -> recovered and unlinked
      fs.writeFileSync(
        lockFile,
        JSON.stringify({ pid: 99999999, createdAt: Date.now() - 15000 }),
      );
      // Set mtime to 15 seconds ago
      const pastTime = new Date(Date.now() - 15000);
      fs.utimesSync(lockFile, pastTime, pastTime);

      await storageCleanupService.recordCompensationFailure({
        storageKey: 'thehomez-private/partners/wal_test/doc_dead_pid.pdf',
        partnerId: new Types.ObjectId(),
        triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
      });

      // The dead lock was cleared and the WAL write succeeded
      expect(fs.existsSync(walFile)).toBe(true);
      const content = fs.readFileSync(walFile, 'utf8');
      expect(content).toContain('doc_dead_pid.pdf');

      // Case 2: Active process PID (current process.pid) older than 10 seconds
      // Must NOT be removed; acquireLock will fail with timeout
      fs.writeFileSync(
        lockFile,
        JSON.stringify({ pid: process.pid, createdAt: Date.now() - 15000 }),
      );
      fs.utimesSync(lockFile, pastTime, pastTime);

      // Call recordCompensationFailure with active lock - layer 2 will fail acquiring lock and trigger layer 3 fatal
      await storageCleanupService.recordCompensationFailure({
        storageKey: 'thehomez-private/partners/wal_test/doc_active_pid.pdf',
        partnerId: new Types.ObjectId(),
        triggerReason: StorageCleanupTriggerReason.UPLOAD_FAILED,
      });

      // The active process lockfile was NOT deleted by stale recovery
      expect(fs.existsSync(lockFile)).toBe(true);

      // Clean up test files
      try {
        fs.unlinkSync(lockFile);
        fs.unlinkSync(walFile);
      } catch {}
    });
  });

  // =========================================================================
  // 5. Phase 1A Task P1A-10: KYC Document Soft Deletion & Cleanup Trigger Tests
  // =========================================================================
  describe('Phase 1A Task P1A-10: Soft Deletion & Cleanup Trigger', () => {
    const testDocId = new Types.ObjectId();
    const testStorageKey = `thehomez-private/partners/${mockPartnerId.toHexString()}/docs/${testDocId.toHexString()}.pdf`;

    const makeTestPartner = (docOverrides: Record<string, unknown> = {}) => ({
      _id: mockPartnerId,
      businessName: 'Ace Cement Corp',
      legalName: 'Ace Cement Pvt Ltd',
      phone: '+919812345678',
      email: 'contact@acecement.in',
      documents: [
        {
          _id: testDocId,
          documentType: PartnerDocumentType.GST_CERTIFICATE,
          storageKey: testStorageKey,
          originalFilename: 'gst_certificate.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 2048,
          sha256Hash: 'b'.repeat(64),
          uploadedAt: new Date(Date.now() - 3600000),
          uploadedBy: mockStaffUserId,
          status: DocumentReviewStatus.VERIFIED,
          scanStatus: DocumentScanStatus.CLEAN,
          scanGeneration: 1,
          manualSecurityReview: { status: ManualSecurityReviewStatus.NOT_REVIEWED },
          isDeleted: false,
          ...docOverrides,
        },
      ],
    });

    beforeEach(() => {
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(makeTestPartner() as any);
      vi.spyOn(PartnerModel, 'updateOne').mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      } as any);
      vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue({} as any);
    });

    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      const res = await request(app).delete(
        `/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}`,
      );

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects customer token with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff lacking PARTNER_WRITE with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}`)
        .set('Authorization', `Bearer ${readOnlyStaffToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects invalid hex ObjectId parameter with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .delete(`/api/v1/admin/partners/invalid-hex-id/documents/${testDocId.toHexString()}`)
        .set('Authorization', `Bearer ${partnerStaffToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 PARTNER_NOT_FOUND when partner does not exist', async () => {
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(null);

      const nonExistentPartnerId = new Types.ObjectId().toHexString();
      const res = await request(app)
        .delete(`/api/v1/admin/partners/${nonExistentPartnerId}/documents/${testDocId.toHexString()}`)
        .set('Authorization', `Bearer ${partnerStaffToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PARTNER_NOT_FOUND');
    });

    it('returns 404 DOCUMENT_NOT_FOUND when document does not exist on partner', async () => {
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(makeTestPartner() as any);

      const missingDocId = new Types.ObjectId().toHexString();
      const res = await request(app)
        .delete(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${missingDocId}`)
        .set('Authorization', `Bearer ${partnerStaffToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    });

    it('successfully soft-deletes document, creates audit log, and schedules storage cleanup job in queue', async () => {
      const partnerData = makeTestPartner();
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(partnerData as any);
      const updateSpy = vi.spyOn(PartnerModel, 'updateOne').mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      } as any);
      const auditSpy = vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);
      const cleanupSpy = vi.spyOn(storageCleanupService, 'recordCompensationFailure');

      const res = await request(app)
        .delete(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}`)
        .set('Authorization', `Bearer ${partnerStaffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBe('Document deleted successfully');
      expect(res.body.data.documentId).toBe(testDocId.toHexString());
      // Security invariant: private storage identifier and download URLs MUST NOT be exposed
      expect(res.body.data.storageKey).toBeUndefined();
      expect(res.body.data.downloadUrl).toBeUndefined();

      // Invariant: MongoDB update sets isDeleted: true without physically deleting document record
      expect(updateSpy).toHaveBeenCalledWith(
        {
          _id: mockPartnerId,
          'documents._id': testDocId,
          'documents.isDeleted': { $ne: true },
        },
        expect.objectContaining({
          $set: expect.objectContaining({
            'documents.$.isDeleted': true,
            'documents.$.deletedAt': expect.any(Date),
            'documents.$.deletedBy': mockStaffUserId,
          }),
        }),
      );

      // Invariant: Audit event PARTNER_DOCUMENT_DELETED emitted with immutable state history
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: mockPartnerId,
          staffUserId: mockStaffUserId,
          action: 'PARTNER_DOCUMENT_DELETED',
          previousState: expect.objectContaining({
            documentId: testDocId.toHexString(),
            isDeleted: false,
          }),
          newState: expect.objectContaining({
            documentId: testDocId.toHexString(),
            isDeleted: true,
          }),
          reason: expect.stringContaining('soft-deleted by staff user'),
        }),
      );

      // Invariant: Cleanup job scheduled in queue with DOCUMENT_DELETED trigger reason
      expect(cleanupSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          storageKey: testStorageKey,
          partnerId: mockPartnerId,
          documentId: testDocId,
          triggerReason: StorageCleanupTriggerReason.DOCUMENT_DELETED,
        }),
      );
      cleanupSpy.mockRestore();
    });

    it('rejects repeated deletion requests with 400 DOCUMENT_ALREADY_DELETED and avoids duplicate cleanup jobs', async () => {
      const alreadyDeletedPartner = makeTestPartner({
        isDeleted: true,
        deletedAt: new Date(Date.now() - 60000),
        deletedBy: mockStaffUserId,
      });
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(alreadyDeletedPartner as any);
      const updateSpy = vi.spyOn(PartnerModel, 'updateOne');
      const auditSpy = vi.spyOn(PartnerAuditLogModel, 'create');
      const cleanupSpy = vi.spyOn(storageCleanupService, 'recordCompensationFailure');

      const res = await request(app)
        .delete(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}`)
        .set('Authorization', `Bearer ${partnerStaffToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DOCUMENT_ALREADY_DELETED');
      expect(res.body.error.message).toContain('already been deleted');

      // Invariant: No mutation, audit log, or duplicate cleanup queue entry on repeated delete
      expect(updateSpy).not.toHaveBeenCalled();
      expect(auditSpy).not.toHaveBeenCalled();
      expect(cleanupSpy).not.toHaveBeenCalled();
      cleanupSpy.mockRestore();
    });

    it('rolls back soft-deletion in MongoDB if audit log creation fails and suppresses cleanup scheduling', async () => {
      const partnerData = makeTestPartner();
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(partnerData as any);
      const updateSpy = vi.spyOn(PartnerModel, 'updateOne')
        .mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        } as any)
        .mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        } as any);

      vi.spyOn(PartnerAuditLogModel, 'create').mockRejectedValue(new Error('Audit log MongoDB connection failed'));
      const cleanupSpy = vi.spyOn(storageCleanupService, 'recordCompensationFailure');

      const res = await request(app)
        .delete(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}`)
        .set('Authorization', `Bearer ${partnerStaffToken}`);

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('AUDIT_LOG_FAILED');

      // Verify soft-delete rollback was executed: isDeleted restored to false
      expect(updateSpy).toHaveBeenNthCalledWith(
        2,
        {
          _id: mockPartnerId,
          'documents._id': testDocId,
        },
        expect.objectContaining({
          $set: { 'documents.$.isDeleted': false },
          $unset: { 'documents.$.deletedAt': 1, 'documents.$.deletedBy': 1 },
        }),
      );

      // Verify storage cleanup scheduling was suppressed
      expect(cleanupSpy).not.toHaveBeenCalled();
      cleanupSpy.mockRestore();
    });

    it('falls back gracefully to WAL when MongoDB queue persistence fails during cleanup job recording', async () => {
      const partnerData = makeTestPartner();
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(partnerData as any);
      vi.spyOn(PartnerModel, 'updateOne').mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      } as any);
      vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);

      // Simulate MongoDB layer 1 failure in StorageCleanupJobModel
      vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockRejectedValue(
        new Error('StorageCleanupJobModel MongoDB connection timeout'),
      );

      const walFile = storageCleanupService.getWalFilePath();
      const walDir = path.dirname(walFile);
      if (!fs.existsSync(walDir)) fs.mkdirSync(walDir, { recursive: true });
      if (fs.existsSync(walFile)) fs.unlinkSync(walFile);

      const res = await request(app)
        .delete(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}`)
        .set('Authorization', `Bearer ${partnerStaffToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Layer 2 WAL check: file exists and contains the deleted document directive
      expect(fs.existsSync(walFile)).toBe(true);
      const walContent = fs.readFileSync(walFile, 'utf8');
      expect(walContent).toContain(testStorageKey);
      expect(walContent).toContain('DOCUMENT_DELETED');

      // Clean up WAL test file
      try {
        fs.unlinkSync(walFile);
      } catch {}
    });

    it('fails safely with 500 when database update fails during initial soft-delete operation', async () => {
      const partnerData = makeTestPartner();
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(partnerData as any);
      vi.spyOn(PartnerModel, 'updateOne').mockRejectedValue(new Error('Fatal database connection reset'));
      const auditSpy = vi.spyOn(PartnerAuditLogModel, 'create');
      const cleanupSpy = vi.spyOn(storageCleanupService, 'recordCompensationFailure');

      const res = await request(app)
        .delete(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}`)
        .set('Authorization', `Bearer ${partnerStaffToken}`);

      expect(res.status).toBe(500);
      expect(auditSpy).not.toHaveBeenCalled();
      expect(cleanupSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 6. Phase 1A Task P1A-11: Manual Security Override API Tests
  // =========================================================================
  describe('Phase 1A Task P1A-11: Manual Security Override API', () => {
    const testDocId = new Types.ObjectId();
    const testStorageKey = `thehomez-private/partners/${mockPartnerId.toHexString()}/docs/${testDocId.toHexString()}.pdf`;
    const validJustificationReason = 'Verified genuine bank document via independent branch confirmation';

    const makeTestPartnerWithScanStatus = (
      scanStatus: DocumentScanStatus,
      reviewOverrides: Record<string, unknown> = {},
      docOverrides: Record<string, unknown> = {},
    ) => ({
      _id: mockPartnerId,
      businessName: 'Ace Cement Corp',
      legalName: 'Ace Cement Pvt Ltd',
      phone: '+919812345678',
      email: 'contact@acecement.in',
      documents: [
        {
          _id: testDocId,
          documentType: PartnerDocumentType.GST_CERTIFICATE,
          storageKey: testStorageKey,
          originalFilename: 'gst_certificate.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: 2048,
          sha256Hash: 'c'.repeat(64),
          uploadedAt: new Date(Date.now() - 3600000),
          uploadedBy: mockStaffUserId,
          status: DocumentReviewStatus.PENDING_REVIEW,
          scanStatus,
          scanGeneration: 1,
          manualSecurityReview: {
            status: ManualSecurityReviewStatus.NOT_REVIEWED,
            ...reviewOverrides,
          },
          isDeleted: false,
          ...docOverrides,
        },
      ],
    });

    beforeEach(() => {
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(
        makeTestPartnerWithScanStatus(DocumentScanStatus.SCAN_UNAVAILABLE) as any,
      );
      vi.spyOn(PartnerModel, 'updateOne').mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      } as any);
      vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);
    });

    // 1. Authorization Gates
    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects customer token with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff having only PARTNER_VERIFY (lacking RBAC_MANAGE) with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${verifyOnlyToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff having only RBAC_MANAGE (lacking PARTNER_VERIFY) with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${rbacOnlyToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff having only PARTNER_WRITE (lacking both) with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${partnerStaffToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    // 2. Input Validation Gates
    it('rejects justification reason shorter than 20 characters with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: 'Too short reason' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('at least 20 characters');
    });

    it('rejects missing justification reason field with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unexpected query parameters with 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override?force=true`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    // 3. Scan Status Eligibility Gates & Security Invariants
    it('ABSOLUTELY BLOCKS manual override on an INFECTED document with 403 DOCUMENT_QUARANTINED', async () => {
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(
        makeTestPartnerWithScanStatus(DocumentScanStatus.INFECTED) as any,
      );

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('DOCUMENT_QUARANTINED');
      expect(res.body.error.message).toContain('Infected documents cannot be manually overridden');
    });

    it('rejects manual override when malware scan is still PENDING_SCAN with 400 DOCUMENT_SCAN_PENDING', async () => {
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(
        makeTestPartnerWithScanStatus(DocumentScanStatus.PENDING_SCAN) as any,
      );

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('DOCUMENT_SCAN_PENDING');
      expect(res.body.error.message).toContain('malware scan is pending');
    });

    it('rejects manual override when document scanStatus is already CLEAN with 400 SCAN_OVERRIDE_NOT_PERMITTED', async () => {
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(
        makeTestPartnerWithScanStatus(DocumentScanStatus.CLEAN) as any,
      );

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SCAN_OVERRIDE_NOT_PERMITTED');
    });

    it('rejects manual override when review is already APPROVED with 400 SECURITY_OVERRIDE_ALREADY_GRANTED', async () => {
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(
        makeTestPartnerWithScanStatus(
          DocumentScanStatus.SCAN_UNAVAILABLE,
          {
            status: ManualSecurityReviewStatus.APPROVED,
            reviewedBy: mockSuperAdminId,
            reviewedAt: new Date(),
            reason: 'Previous valid justification reason here',
          },
        ) as any,
      );

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SECURITY_OVERRIDE_ALREADY_GRANTED');
    });

    it('returns 404 DOCUMENT_NOT_FOUND when document is soft-deleted', async () => {
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(
        makeTestPartnerWithScanStatus(DocumentScanStatus.SCAN_UNAVAILABLE, {}, { isDeleted: true }) as any,
      );

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    });

    // 4. Success Execution & Audit Logging
    it('successfully grants manual security override for SCAN_UNAVAILABLE document, sets review metadata without altering scanStatus, and emits audit event', async () => {
      const partnerData = makeTestPartnerWithScanStatus(DocumentScanStatus.SCAN_UNAVAILABLE);
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(partnerData as any);
      const updateSpy = vi.spyOn(PartnerModel, 'updateOne').mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      } as any);
      const auditSpy = vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.document).toBeDefined();

      const doc = res.body.data.document;
      // Invariant: scanStatus remains strictly SCAN_UNAVAILABLE (not CLEAN)
      expect(doc.scanStatus).toBe(DocumentScanStatus.SCAN_UNAVAILABLE);
      // Invariant: manualSecurityReview is APPROVED with reason and staff ID
      expect(doc.manualSecurityReview.status).toBe(ManualSecurityReviewStatus.APPROVED);
      expect(doc.manualSecurityReview.reviewedBy).toBe(mockSuperAdminId.toHexString());
      expect(doc.manualSecurityReview.reason).toBe(validJustificationReason);
      expect(doc.manualSecurityReview.reviewedAt).toBeDefined();
      // Security Invariant: no storageKey or private URLs returned
      expect(doc.storageKey).toBeUndefined();
      expect(doc.downloadUrl).toBeUndefined();

      // Invariant: update query atomically restricts to eligible scan status
      expect(updateSpy).toHaveBeenCalledWith(
        {
          _id: mockPartnerId,
          'documents._id': testDocId,
          'documents.isDeleted': { $ne: true },
          'documents.scanStatus': {
            $in: [DocumentScanStatus.SCAN_UNAVAILABLE, DocumentScanStatus.SCAN_FAILED],
          },
          'documents.manualSecurityReview.status': { $ne: ManualSecurityReviewStatus.APPROVED },
        },
        expect.objectContaining({
          $set: expect.objectContaining({
            'documents.$.manualSecurityReview.status': ManualSecurityReviewStatus.APPROVED,
            'documents.$.manualSecurityReview.reviewedBy': mockSuperAdminId,
            'documents.$.manualSecurityReview.reviewedAt': expect.any(Date),
            'documents.$.manualSecurityReview.reason': validJustificationReason,
          }),
        }),
      );

      // Invariant: Audit event PARTNER_DOCUMENT_MANUAL_SECURITY_OVERRIDE_GRANTED emitted
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          partnerId: mockPartnerId,
          staffUserId: mockSuperAdminId,
          action: 'PARTNER_DOCUMENT_MANUAL_SECURITY_OVERRIDE_GRANTED',
          reason: validJustificationReason,
          previousState: expect.objectContaining({
            documentId: testDocId.toHexString(),
            scanStatus: DocumentScanStatus.SCAN_UNAVAILABLE,
            manualSecurityReview: expect.objectContaining({
              status: ManualSecurityReviewStatus.NOT_REVIEWED,
            }),
          }),
          newState: expect.objectContaining({
            documentId: testDocId.toHexString(),
            scanStatus: DocumentScanStatus.SCAN_UNAVAILABLE,
            manualSecurityReview: expect.objectContaining({
              status: ManualSecurityReviewStatus.APPROVED,
              reviewedBy: mockSuperAdminId.toHexString(),
              reason: validJustificationReason,
            }),
          }),
        }),
      );
    });

    it('successfully grants manual security override for SCAN_FAILED document', async () => {
      const partnerData = makeTestPartnerWithScanStatus(DocumentScanStatus.SCAN_FAILED);
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(partnerData as any);
      vi.spyOn(PartnerModel, 'updateOne').mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
        upsertedCount: 0,
        upsertedId: null,
      } as any);
      vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.document.scanStatus).toBe(DocumentScanStatus.SCAN_FAILED);
      expect(res.body.data.document.manualSecurityReview.status).toBe(ManualSecurityReviewStatus.APPROVED);
    });

    // 5. Audit Rollback & Concurrency Failure Handling
    it('rolls back manual security override in MongoDB restoring original NOT_REVIEWED state and unsetting metadata if audit log creation fails', async () => {
      const partnerData = makeTestPartnerWithScanStatus(DocumentScanStatus.SCAN_UNAVAILABLE);
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(partnerData as any);
      const updateSpy = vi.spyOn(PartnerModel, 'updateOne')
        .mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        } as any)
        .mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        } as any);

      vi.spyOn(PartnerAuditLogModel, 'create').mockRejectedValue(new Error('Audit log MongoDB insertion failure'));

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('AUDIT_LOG_FAILED');

      // Assert rollback was called with exact condition and unsetting absent metadata
      expect(updateSpy).toHaveBeenNthCalledWith(
        2,
        {
          _id: mockPartnerId,
          'documents._id': testDocId,
          'documents.manualSecurityReview.status': ManualSecurityReviewStatus.APPROVED,
          'documents.manualSecurityReview.reviewedAt': expect.any(Date),
        },
        {
          $set: {
            'documents.$.manualSecurityReview.status': ManualSecurityReviewStatus.NOT_REVIEWED,
          },
          $unset: {
            'documents.$.manualSecurityReview.reviewedBy': 1,
            'documents.$.manualSecurityReview.reviewedAt': 1,
            'documents.$.manualSecurityReview.reason': 1,
          },
        },
      );
    });

    it('rolls back manual security override restoring a previously existing review state and metadata without unsetting', async () => {
      const previousReviewedAt = new Date('2026-11-20T10:00:00.000Z');
      const partnerData = makeTestPartnerWithScanStatus(
        DocumentScanStatus.SCAN_UNAVAILABLE,
        {
          status: ManualSecurityReviewStatus.REJECTED,
          reviewedBy: mockSuperAdminId,
          reviewedAt: previousReviewedAt,
          reason: 'Initial document scan inconclusive but rejected on manual inspection',
        },
      );
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(partnerData as any);
      const updateSpy = vi.spyOn(PartnerModel, 'updateOne')
        .mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        } as any)
        .mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        } as any);

      vi.spyOn(PartnerAuditLogModel, 'create').mockRejectedValue(new Error('Audit log MongoDB insertion failure'));

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('AUDIT_LOG_FAILED');

      // Assert rollback restores previous REJECTED review status and previous reviewer metadata without $unset
      expect(updateSpy).toHaveBeenNthCalledWith(
        2,
        {
          _id: mockPartnerId,
          'documents._id': testDocId,
          'documents.manualSecurityReview.status': ManualSecurityReviewStatus.APPROVED,
          'documents.manualSecurityReview.reviewedAt': expect.any(Date),
        },
        {
          $set: {
            'documents.$.manualSecurityReview.status': ManualSecurityReviewStatus.REJECTED,
            'documents.$.manualSecurityReview.reviewedBy': mockSuperAdminId,
            'documents.$.manualSecurityReview.reviewedAt': previousReviewedAt,
            'documents.$.manualSecurityReview.reason':
              'Initial document scan inconclusive but rejected on manual inspection',
          },
        },
      );
    });

    it('rollback does not overwrite a newer concurrent update and logs structured error when modifiedCount === 0', async () => {
      const partnerData = makeTestPartnerWithScanStatus(DocumentScanStatus.SCAN_UNAVAILABLE);
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(partnerData as any);
      const updateSpy = vi.spyOn(PartnerModel, 'updateOne')
        .mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedCount: 0,
          upsertedId: null,
        } as any)
        .mockResolvedValueOnce({
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0, // Concurrent modification occurred, no document matched the filter
          upsertedCount: 0,
          upsertedId: null,
        } as any);

      vi.spyOn(PartnerAuditLogModel, 'create').mockRejectedValue(new Error('Audit log MongoDB insertion failure'));

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('AUDIT_LOG_FAILED');

      // Verify rollback filter was conditional on exact APPROVED state and reviewedAt timestamp
      expect(updateSpy).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          _id: mockPartnerId,
          'documents._id': testDocId,
          'documents.manualSecurityReview.status': ManualSecurityReviewStatus.APPROVED,
          'documents.manualSecurityReview.reviewedAt': expect.any(Date),
        }),
        expect.any(Object),
      );
    });

    it('returns 409 SECURITY_OVERRIDE_CONFLICT when concurrent modification causes modifiedCount === 0', async () => {
      const partnerData = makeTestPartnerWithScanStatus(DocumentScanStatus.SCAN_UNAVAILABLE);
      vi.spyOn(PartnerModel, 'findById').mockResolvedValue(partnerData as any);
      vi.spyOn(PartnerModel, 'updateOne').mockResolvedValue({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 0, // Concurrent update already modified document
        upsertedCount: 0,
        upsertedId: null,
      } as any);

      const res = await request(app)
        .post(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${testDocId.toHexString()}/scan-override`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ reason: validJustificationReason });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SECURITY_OVERRIDE_CONFLICT');
    });
  });
});
