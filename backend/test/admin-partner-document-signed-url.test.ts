import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { TokenService } from '../src/services/token/token.service.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { PartnerAuditLogModel } from '../src/models/partner-audit-log.model.js';
import {
  UserType,
  UserStatus,
  PermissionCode,
  PartnerDocumentType,
  DocumentReviewStatus,
  DocumentScanStatus,
  ManualSecurityReviewStatus,
} from '@thehomez/shared-types';
import { RbacService } from '../src/services/rbac/rbac.service.js';
import { UserModel } from '../src/models/user.model.js';
import { cloudinaryPrivateStorageAdapter } from '../src/services/storage/cloudinary-private-storage.service.js';

describe('Phase 1A P1A-09: Expiring Signed Download URL (GET /api/v1/admin/partners/:partnerId/documents/:docId/signed-url)', () => {
  let app: Application;
  let tokenService: TokenService;

  const mockStaffUserId = new Types.ObjectId();
  const mockStaffNoPermId = new Types.ObjectId();
  const mockCustomerId = new Types.ObjectId();
  const mockPartnerId = new Types.ObjectId();
  const otherPartnerId = new Types.ObjectId();
  const mockDocId = new Types.ObjectId();

  let partnerReaderToken: string;
  let staffNoPartnerReadToken: string;
  let customerToken: string;

  beforeAll(() => {
    tokenService = new TokenService();
    app = createApp();

    const partnerReaderStaff = {
      _id: mockStaffUserId,
      id: mockStaffUserId.toString(),
      phone: '+919811000041',
      email: 'staff-partner-read@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['OPERATIONS_MANAGER'],
      permissions: [PermissionCode.PARTNER_READ],
    };

    const staffNoPartnerRead = {
      _id: mockStaffNoPermId,
      id: mockStaffNoPermId.toString(),
      phone: '+919811000042',
      email: 'staff-catalog-only@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['CATALOG_OPERATOR'],
      permissions: [PermissionCode.CATALOG_READ],
    };

    const customerUser = {
      _id: mockCustomerId,
      id: mockCustomerId.toString(),
      phone: '+919811000043',
      email: 'customer@thehomez.in',
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: ['CUSTOMER'],
      permissions: [],
    };

    function setupAuthSpies() {
      vi.spyOn(TokenService.prototype, 'validateAdminSession').mockImplementation(
        async (sessionId: string) => {
          let matchedUserId = mockStaffUserId;
          if (sessionId === 'session-no-read') matchedUserId = mockStaffNoPermId;
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
        if (idStr === mockStaffUserId.toString()) return Promise.resolve(partnerReaderStaff) as any;
        if (idStr === mockStaffNoPermId.toString()) return Promise.resolve(staffNoPartnerRead) as any;
        if (idStr === mockCustomerId.toString()) return Promise.resolve(customerUser) as any;
        return Promise.resolve(null) as any;
      });

      vi.spyOn(RbacService.prototype, 'getEffectivePermissions').mockImplementation(async (roles: string[]) => {
        if (roles.includes('OPERATIONS_MANAGER')) return [PermissionCode.PARTNER_READ];
        if (roles.includes('CATALOG_OPERATOR')) return [PermissionCode.CATALOG_READ];
        return [];
      });
    }

    (globalThis as any).__setupAuthSpiesP1A09 = setupAuthSpies;
    setupAuthSpies();

    partnerReaderToken = tokenService.signAccessToken(partnerReaderStaff as any, 'session-partner-read');
    staffNoPartnerReadToken = tokenService.signAccessToken(staffNoPartnerRead as any, 'session-no-read');
    customerToken = tokenService.signAccessToken(customerUser as any);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).__setupAuthSpiesP1A09();

    // Default spy for storage adapter generateExpiringSignedUrl
    vi.spyOn(cloudinaryPrivateStorageAdapter, 'generateExpiringSignedUrl').mockResolvedValue({
      downloadUrl: 'https://res.cloudinary.com/thehomez/image/authenticated/s--signed--/test.pdf',
      expiresAt: new Date(Date.now() + 900000),
    });

    // Default spy for audit log creation
    vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);
  });

  // Helper to build a mock document
  function buildMockDoc(overrides: Record<string, any> = {}) {
    return {
      _id: mockDocId,
      documentType: PartnerDocumentType.GST_CERTIFICATE,
      storageKey: 'thehomez-private/partners/p1/gst_cert.pdf',
      originalFilename: 'gst_certificate.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1048576,
      sha256Hash: 'a'.repeat(64),
      uploadedAt: new Date('2026-01-15T10:00:00Z'),
      uploadedBy: mockStaffUserId,
      status: DocumentReviewStatus.VERIFIED,
      scanStatus: DocumentScanStatus.CLEAN,
      scanGeneration: 1,
      manualSecurityReview: {
        status: ManualSecurityReviewStatus.NOT_REVIEWED,
      },
      isDeleted: false,
      ...overrides,
    };
  }

  // =========================================================================
  // 1. Authentication & Authorization Guards
  // =========================================================================
  describe('Authentication & Authorization Guards', () => {
    it('rejects unauthenticated requests with HTTP 401', async () => {
      const res = await request(app).get(
        `/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`,
      );

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects non-staff principals (e.g. CUSTOMER) with HTTP 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff principals lacking PARTNER_READ with HTTP 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${staffNoPartnerReadToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('grants access to staff with PARTNER_READ for clean documents', async () => {
      const mockDoc = buildMockDoc();
      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [mockDoc],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Input Validation (Path & Query)
  // =========================================================================
  describe('Input Validation', () => {
    it('rejects malformed partnerId with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/bad-hex-id/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects malformed docId with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/bad-doc-id/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects unexpected query parameters with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url?extra=param`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // =========================================================================
  // 3. Partner & Document Resolution (Cross-Tenant Isolation)
  // =========================================================================
  describe('Partner & Document Resolution', () => {
    it('returns HTTP 404 PARTNER_NOT_FOUND when partner does not exist', async () => {
      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PARTNER_NOT_FOUND');
    });

    it('returns HTTP 404 DOCUMENT_NOT_FOUND when docId is not in partner documents', async () => {
      const differentDocId = new Types.ObjectId();
      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [buildMockDoc({ _id: differentDocId })],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    });

    it('strictly isolates documents across partners (cross-tenant safety)', async () => {
      // Document belongs to otherPartnerId, request is made for mockPartnerId
      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [], // mockPartner has no documents
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    });
  });

  // =========================================================================
  // 4. Unified KYC Eligibility Policy Enforcement
  // =========================================================================
  describe('Unified KYC Eligibility Policy Enforcement', () => {
    it('rejects soft-deleted document with HTTP 404 DOCUMENT_NOT_FOUND', async () => {
      const deletedDoc = buildMockDoc({
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: mockStaffUserId,
      });

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [deletedDoc],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_FOUND');
    });

    it('rejects INFECTED document with HTTP 403 DOCUMENT_QUARANTINED', async () => {
      const infectedDoc = buildMockDoc({
        scanStatus: DocumentScanStatus.INFECTED,
        scanDetails: { threatName: 'Win32.EICAR-Test-Signature' },
      });

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [infectedDoc],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_QUARANTINED');
    });

    it('rejects PENDING_SCAN document with HTTP 423 DOCUMENT_SCAN_PENDING', async () => {
      const pendingDoc = buildMockDoc({
        scanStatus: DocumentScanStatus.PENDING_SCAN,
      });

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [pendingDoc],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(423);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_SCAN_PENDING');
    });

    it('rejects SCAN_FAILED document without manual override with HTTP 502 DOCUMENT_SCAN_FAILED', async () => {
      const failedDoc = buildMockDoc({
        scanStatus: DocumentScanStatus.SCAN_FAILED,
        manualSecurityReview: { status: ManualSecurityReviewStatus.NOT_REVIEWED },
      });

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [failedDoc],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_SCAN_FAILED');
    });

    it('rejects SCAN_UNAVAILABLE document without manual override with HTTP 503 SCANNER_UNAVAILABLE', async () => {
      const unavailDoc = buildMockDoc({
        scanStatus: DocumentScanStatus.SCAN_UNAVAILABLE,
        manualSecurityReview: { status: ManualSecurityReviewStatus.NOT_REVIEWED },
      });

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [unavailDoc],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('SCANNER_UNAVAILABLE');
    });

    it('rejects expired document with HTTP 410 DOCUMENT_EXPIRED', async () => {
      const expiredDoc = buildMockDoc({
        expiresAt: new Date(Date.now() - 86400000), // 1 day in past
      });

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [expiredDoc],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(410);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DOCUMENT_EXPIRED');
    });

    it('permits SCAN_FAILED document when manual security override is APPROVED', async () => {
      const overriddenDoc = buildMockDoc({
        scanStatus: DocumentScanStatus.SCAN_FAILED,
        manualSecurityReview: {
          status: ManualSecurityReviewStatus.APPROVED,
          reviewedBy: mockStaffUserId,
          reviewedAt: new Date(),
          reason: 'Verified clean via isolated sandbox inspection',
        },
      });

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [overriddenDoc],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
    });

    it('permits SCAN_UNAVAILABLE document when manual security override is APPROVED', async () => {
      const overriddenDoc = buildMockDoc({
        scanStatus: DocumentScanStatus.SCAN_UNAVAILABLE,
        manualSecurityReview: {
          status: ManualSecurityReviewStatus.APPROVED,
          reviewedBy: mockStaffUserId,
          reviewedAt: new Date(),
          reason: 'Scanner unreachable in test environment; manual inspection passed',
        },
      });

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [overriddenDoc],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.downloadUrl).toBeDefined();
    });
  });

  // =========================================================================
  // 5. Signed URL TTL & Security Response Guarantees
  // =========================================================================
  describe('Signed URL Generation & Response Contract', () => {
    it('returns downloadUrl, expiresAt, and ttlSeconds (900s) and strictly hides storageKey', async () => {
      const cleanDoc = buildMockDoc();
      const mockExpiresAt = new Date(Date.now() + 900000);
      const mockDownloadUrl = 'https://res.cloudinary.com/thehomez/image/authenticated/s--abc123--/test.pdf';

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [cleanDoc],
        }),
      } as any);

      const storageSpy = vi.spyOn(cloudinaryPrivateStorageAdapter, 'generateExpiringSignedUrl').mockResolvedValue({
        downloadUrl: mockDownloadUrl,
        expiresAt: mockExpiresAt,
      });

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        downloadUrl: mockDownloadUrl,
        expiresAt: mockExpiresAt.toISOString(),
        ttlSeconds: 900,
      });

      // Verify adapter was invoked with storageKey and 900s TTL
      expect(storageSpy).toHaveBeenCalledWith(cleanDoc.storageKey, 900);

      // Verify strict isolation: internal storage keys or secrets are NEVER in response
      expect(res.body.data).not.toHaveProperty('storageKey');
      expect(res.body.data).not.toHaveProperty('cloudSecret');
      expect(res.body.data).not.toHaveProperty('apiKey');
    });
  });

  // =========================================================================
  // 6. Mandatory Audit Logging & Failure Handling
  // =========================================================================
  describe('Mandatory Audit Logging & Failure Compensation', () => {
    it('records immutable PARTNER_DOCUMENT_ACCESSED audit event on successful download', async () => {
      const cleanDoc = buildMockDoc();
      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [cleanDoc],
        }),
      } as any);

      const auditSpy = vi.spyOn(PartnerAuditLogModel, 'create').mockResolvedValue({} as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(auditSpy).toHaveBeenCalledTimes(1);
      const auditPayload = auditSpy.mock.calls[0][0] as any;
      expect(auditPayload.partnerId.toString()).toBe(mockPartnerId.toHexString());
      expect(auditPayload.staffUserId.toString()).toBe(mockStaffUserId.toHexString());
      expect(auditPayload.action).toBe('PARTNER_DOCUMENT_ACCESSED');
      expect(auditPayload.newState.documentId.toString()).toBe(mockDocId.toHexString());
      expect(auditPayload.newState.ttlSeconds).toBe(900);
    });

    it('suppresses signed URL release if audit logging fails (HTTP 500 AUDIT_LOG_FAILED)', async () => {
      const cleanDoc = buildMockDoc();
      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [cleanDoc],
        }),
      } as any);

      // Simulate audit logging persistence failure
      vi.spyOn(PartnerAuditLogModel, 'create').mockRejectedValue(new Error('MongoDB replica set election error'));

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents/${mockDocId.toHexString()}/signed-url`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('AUDIT_LOG_FAILED');
      // Critical guarantee: the generated download URL must NOT be returned
      expect(res.body.data).toBeUndefined();
    });
  });
});
