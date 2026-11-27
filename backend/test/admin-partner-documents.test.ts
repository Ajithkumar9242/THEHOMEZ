import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { TokenService } from '../src/services/token/token.service.js';
import { PartnerModel } from '../src/models/partner.model.js';
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

describe('Phase 1A P1A-08: Admin Partner KYC Documents Metadata Inspection (GET /api/v1/admin/partners/:partnerId/documents)', () => {
  let app: Application;
  let tokenService: TokenService;

  const mockStaffUserId = new Types.ObjectId();
  const mockStaffNoPermId = new Types.ObjectId();
  const mockCustomerId = new Types.ObjectId();
  const mockPartnerId = new Types.ObjectId();

  let partnerReaderToken: string;
  let staffNoPartnerReadToken: string;
  let customerToken: string;

  beforeAll(() => {
    tokenService = new TokenService();
    app = createApp();

    const partnerReaderStaff = {
      _id: mockStaffUserId,
      id: mockStaffUserId.toString(),
      phone: '+919811000031',
      email: 'staff-partner-read@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['OPERATIONS_MANAGER'],
      permissions: [PermissionCode.PARTNER_READ],
    };

    const staffNoPartnerRead = {
      _id: mockStaffNoPermId,
      id: mockStaffNoPermId.toString(),
      phone: '+919811000032',
      email: 'staff-catalog-only@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['CATALOG_OPERATOR'],
      permissions: [PermissionCode.CATALOG_READ],
    };

    const customerUser = {
      _id: mockCustomerId,
      id: mockCustomerId.toString(),
      phone: '+919811000033',
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

    (globalThis as any).__setupAuthSpies = setupAuthSpies;

    setupAuthSpies();

    partnerReaderToken = tokenService.signAccessToken(partnerReaderStaff as any, 'session-partner-read');
    staffNoPartnerReadToken = tokenService.signAccessToken(staffNoPartnerRead as any, 'session-no-read');
    customerToken = tokenService.signAccessToken(customerUser as any);
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    (globalThis as any).__setupAuthSpies();
  });

  // =========================================================================
  // 1. Authentication & RBAC Guarding
  // =========================================================================
  describe('Authentication & Authorization Guards', () => {
    it('rejects unauthenticated requests with HTTP 401', async () => {
      const res = await request(app).get(
        `/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents`,
      );

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects non-staff principals (e.g. Customer) with HTTP 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents`)
        .set('Authorization', `Bearer ${customerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('rejects staff principals lacking PARTNER_READ with HTTP 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents`)
        .set('Authorization', `Bearer ${staffNoPartnerReadToken}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('grants access to staff principals possessing PARTNER_READ', async () => {
      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 2. Input Validation & Partner Lookup
  // =========================================================================
  describe('Input Validation & Partner Lookup', () => {
    it('rejects invalid partnerId format with HTTP 400', async () => {
      const res = await request(app)
        .get('/api/v1/admin/partners/invalid-hex-id-123/documents')
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns HTTP 404 PARTNER_NOT_FOUND when partner does not exist in DB', async () => {
      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as any);

      const nonExistentId = new Types.ObjectId().toHexString();
      const res = await request(app)
        .get(`/api/v1/admin/partners/${nonExistentId}/documents`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('PARTNER_NOT_FOUND');
    });

    it('returns HTTP 500 when database lookup throws an unexpected error', async () => {
      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockRejectedValue(new Error('Database connection reset')),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
    });
  });

  // =========================================================================
  // 3. Document List Response & Security Guarantees
  // =========================================================================
  describe('Document List Response & Safe Metadata Guarantees', () => {
    it('returns an empty list with total 0 when partner has no documents', async () => {
      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: mockPartnerId,
          documents: [],
        }),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual({
        partnerId: mockPartnerId.toHexString(),
        items: [],
        total: 0,
      });
    });

    it('returns populated documents with complete metadata and newest first sorting', async () => {
      const doc1Id = new Types.ObjectId();
      const doc2Id = new Types.ObjectId();
      const olderDate = new Date('2026-01-10T10:00:00Z');
      const newerDate = new Date('2026-02-15T14:30:00Z');

      const mockPartner = {
        _id: mockPartnerId,
        documents: [
          {
            _id: doc1Id,
            documentType: PartnerDocumentType.PAN_CARD,
            storageKey: 'thehomez-private/partners/p1/pan_card_internal_1.jpg',
            originalFilename: 'pan_card.jpg',
            mimeType: 'image/jpeg',
            fileSizeBytes: 204850,
            sha256Hash: 'a'.repeat(64),
            uploadedAt: olderDate,
            uploadedBy: mockStaffUserId,
            status: DocumentReviewStatus.VERIFIED,
            reviewedAt: new Date('2026-01-11T10:00:00Z'),
            reviewedBy: mockStaffUserId,
            scanStatus: DocumentScanStatus.CLEAN,
            scanGeneration: 1,
            manualSecurityReview: {
              status: ManualSecurityReviewStatus.NOT_REVIEWED,
            },
            isDeleted: false,
          },
          {
            _id: doc2Id,
            documentType: PartnerDocumentType.GST_CERTIFICATE,
            storageKey: 'thehomez-private/partners/p1/gst_cert_internal_2.pdf',
            originalFilename: 'gst_certificate.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 1048576,
            sha256Hash: 'b'.repeat(64),
            uploadedAt: newerDate,
            uploadedBy: mockStaffUserId,
            status: DocumentReviewStatus.PENDING_REVIEW,
            scanStatus: DocumentScanStatus.PENDING_SCAN,
            scanGeneration: 1,
            manualSecurityReview: {
              status: ManualSecurityReviewStatus.NOT_REVIEWED,
            },
            notes: 'Awaiting primary compliance review',
            isDeleted: false,
          },
        ],
      };

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockPartner),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.total).toBe(2);
      expect(res.body.data.items).toHaveLength(2);

      // Verify newest first sorting (doc2 uploaded later than doc1)
      expect(res.body.data.items[0].id).toBe(doc2Id.toHexString());
      expect(res.body.data.items[0].documentType).toBe(PartnerDocumentType.GST_CERTIFICATE);
      expect(res.body.data.items[0].originalFilename).toBe('gst_certificate.pdf');
      expect(res.body.data.items[0].mimeType).toBe('application/pdf');
      expect(res.body.data.items[0].fileSizeBytes).toBe(1048576);
      expect(res.body.data.items[0].sha256Hash).toBe('b'.repeat(64));
      expect(res.body.data.items[0].status).toBe(DocumentReviewStatus.PENDING_REVIEW);
      expect(res.body.data.items[0].scanStatus).toBe(DocumentScanStatus.PENDING_SCAN);
      expect(res.body.data.items[0].notes).toBe('Awaiting primary compliance review');

      expect(res.body.data.items[1].id).toBe(doc1Id.toHexString());
      expect(res.body.data.items[1].documentType).toBe(PartnerDocumentType.PAN_CARD);
      expect(res.body.data.items[1].status).toBe(DocumentReviewStatus.VERIFIED);
      expect(res.body.data.items[1].scanStatus).toBe(DocumentScanStatus.CLEAN);

      // Critical Security Guarantees:
      // storageKey and internal paths must NEVER be exposed in metadata listing
      for (const item of res.body.data.items) {
        expect(item).not.toHaveProperty('storageKey');
        expect(item).not.toHaveProperty('fileBuffer');
        expect(item).not.toHaveProperty('cloudSecret');
        expect(item).not.toHaveProperty('downloadUrl');
      }
    });
  });

  // =========================================================================
  // 4. Soft-Deleted Document Visibility Rules
  // =========================================================================
  describe('Soft-Deleted Document Visibility Rules', () => {
    it('filters out soft-deleted documents by default', async () => {
      const activeDocId = new Types.ObjectId();
      const deletedDocId = new Types.ObjectId();

      const mockPartner = {
        _id: mockPartnerId,
        documents: [
          {
            _id: activeDocId,
            documentType: PartnerDocumentType.GST_CERTIFICATE,
            storageKey: 'thehomez-private/partners/p1/active.pdf',
            originalFilename: 'active.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 50000,
            sha256Hash: 'c'.repeat(64),
            uploadedAt: new Date(),
            uploadedBy: mockStaffUserId,
            status: DocumentReviewStatus.VERIFIED,
            scanStatus: DocumentScanStatus.CLEAN,
            scanGeneration: 1,
            manualSecurityReview: { status: ManualSecurityReviewStatus.NOT_REVIEWED },
            isDeleted: false,
          },
          {
            _id: deletedDocId,
            documentType: PartnerDocumentType.TRADE_LICENSE,
            storageKey: 'thehomez-private/partners/p1/deleted.pdf',
            originalFilename: 'deleted.pdf',
            mimeType: 'application/pdf',
            fileSizeBytes: 60000,
            sha256Hash: 'd'.repeat(64),
            uploadedAt: new Date(),
            uploadedBy: mockStaffUserId,
            status: DocumentReviewStatus.REJECTED,
            scanStatus: DocumentScanStatus.CLEAN,
            scanGeneration: 1,
            manualSecurityReview: { status: ManualSecurityReviewStatus.NOT_REVIEWED },
            isDeleted: true,
            deletedAt: new Date(),
            deletedBy: mockStaffUserId,
          },
        ],
      };

      vi.spyOn(PartnerModel, 'findById').mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockPartner),
      } as any);

      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].id).toBe(activeDocId.toHexString());
      expect(res.body.data.items[0].isDeleted).toBe(false);
    });

    it('rejects unexpected query parameters with HTTP 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/partners/${mockPartnerId.toHexString()}/documents?includeDeleted=true`)
        .set('Authorization', `Bearer ${partnerReaderToken}`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
