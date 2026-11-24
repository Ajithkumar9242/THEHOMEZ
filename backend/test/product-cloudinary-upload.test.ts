import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import { createApp } from '../src/app.js';
import { UserModel } from '../src/models/user.model.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { ProductVariantModel } from '../src/models/product-variant.model.js';
import { TokenService } from '../src/services/token/token.service.js';
import { RbacService } from '../src/services/rbac/rbac.service.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';
import { cloudinaryService } from '../src/services/cloudinary/cloudinary.service.js';

describe('Cloudinary Product Image Upload & Deletion Safety Integration Tests', () => {
  let app: Application;
  let tokenService: TokenService;

  let catalogStaffToken: string;
  let readOnlyStaffToken: string;
  let customerToken: string;
  let partnerToken: string;

  // Valid image magic bytes fixtures
  const validJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60,
    0x00, 0x60, 0x00, 0x00,
  ]);
  const fakeSpoofedJpeg = Buffer.from('NOT A REAL JPEG FILE CONTENT BUT HAS .JPG EXTENSION');

  beforeAll(() => {
    tokenService = new TokenService();
    app = createApp();

    const catalogStaffUser = {
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      phone: '+919811000021',
      email: 'img-staff-write@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['CATALOG_MANAGER'],
      permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
    };

    const readOnlyStaffUser = {
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      phone: '+919811000022',
      email: 'img-staff-read@thehomez.in',
      userType: UserType.STAFF,
      status: UserStatus.ACTIVE,
      roles: ['CATALOG_VIEWER'],
      permissions: [PermissionCode.CATALOG_READ],
    };

    const customerUser = {
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      phone: '+919811000023',
      email: 'img-customer@example.com',
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: [],
      permissions: [],
    };

    const partnerUser = {
      _id: new Types.ObjectId(),
      id: new Types.ObjectId().toString(),
      phone: '+919811000024',
      email: 'img-partner@example.com',
      userType: UserType.PARTNER,
      status: UserStatus.ACTIVE,
      partnerId: new Types.ObjectId(),
      roles: [],
      permissions: [],
    };

    // Mock session verification for staff tokens (C-12.3)
    vi.spyOn(TokenService.prototype, 'validateAdminSession').mockImplementation(
      async (sessionId: string) => {
        let matchedUserId = catalogStaffUser._id;
        if (sessionId === 'session-img-read') matchedUserId = readOnlyStaffUser._id;
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

    // Mock UserModel and PartnerModel queries in authenticate middleware
    vi.spyOn(UserModel, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === catalogStaffUser._id.toString()) return Promise.resolve(catalogStaffUser) as any;
      if (idStr === readOnlyStaffUser._id.toString()) return Promise.resolve(readOnlyStaffUser) as any;
      if (idStr === customerUser._id.toString()) return Promise.resolve(customerUser) as any;
      if (idStr === partnerUser._id.toString()) return Promise.resolve(partnerUser) as any;
      return Promise.resolve(null) as any;
    });

    vi.spyOn(PartnerModel, 'findById').mockResolvedValue({
      _id: partnerUser.partnerId,
      status: 'ACTIVE',
    } as any);

    vi.spyOn(RbacService.prototype, 'getEffectivePermissions').mockImplementation(async (roles: string[]) => {
      if (roles.includes('CATALOG_MANAGER')) return [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE];
      if (roles.includes('CATALOG_VIEWER')) return [PermissionCode.CATALOG_READ];
      return [];
    });

    // Sign tokens
    catalogStaffToken = tokenService.signAccessToken(catalogStaffUser as any, 'session-img-write');
    readOnlyStaffToken = tokenService.signAccessToken(readOnlyStaffUser as any, 'session-img-read');
    customerToken = tokenService.signAccessToken(customerUser as any);
    partnerToken = tokenService.signAccessToken(partnerUser as any);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. PERMISSION AND AUTHENTICATION GUARDS
  // =========================================================================
  describe('1. Authentication & Permission Denial', () => {
    it('POST /api/v1/admin/uploads/product-image: unauthenticated request is rejected with 401', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/product-image')
        .attach('file', validJpegBuffer, 'sample.jpg');

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('POST /api/v1/admin/uploads/product-image: Customer identity is rejected with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${customerToken}`)
        .attach('file', validJpegBuffer, 'sample.jpg');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/staff principals/i);
    });

    it('POST /api/v1/admin/uploads/product-image: Partner identity is rejected with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${partnerToken}`)
        .attach('file', validJpegBuffer, 'sample.jpg');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/staff principals/i);
    });

    it('POST /api/v1/admin/uploads/product-image: Staff lacking CATALOG_WRITE is rejected with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${readOnlyStaffToken}`)
        .attach('file', validJpegBuffer, 'sample.jpg');

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toMatch(/insufficient permissions/i);
    });
  });

  // =========================================================================
  // 2. FILE TYPE AND CONTENT VALIDATION
  // =========================================================================
  describe('2. File Type and Content Validation', () => {
    it('rejects request with no file attached with 400', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${catalogStaffToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NO_FILE_PROVIDED');
    });

    it('rejects unsupported MIME type (e.g. application/pdf) with 400', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 sample content');
      const res = await request(app)
        .post('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${catalogStaffToken}`)
        .attach('file', pdfBuffer, { filename: 'document.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_MIME_TYPE');
      expect(res.body.error.message).toMatch(/supported formats are JPG, JPEG, PNG, and WebP/i);
    });

    it('rejects spoofed image file where extension is .jpg but magic bytes are invalid text with 400', async () => {
      const res = await request(app)
        .post('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${catalogStaffToken}`)
        .attach('file', fakeSpoofedJpeg, { filename: 'malicious.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_IMAGE_CONTENT');
      expect(res.body.error.message).toMatch(/header signature does not match/i);
    });

    it('rejects file exceeding 5MB size limit with 400', async () => {
      // Create a 5.1 MB buffer
      const oversizedBuffer = Buffer.alloc(5.1 * 1024 * 1024);
      validJpegBuffer.copy(oversizedBuffer, 0, 0, 20);

      const res = await request(app)
        .post('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${catalogStaffToken}`)
        .attach('file', oversizedBuffer, { filename: 'huge.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('FILE_TOO_LARGE');
      expect(res.body.error.message).toMatch(/exceeds/i);
    });
  });

  // =========================================================================
  // 3. MOCKED CLOUDINARY UPLOAD EXECUTION
  // =========================================================================
  describe('3. Cloudinary Upload Execution (Mocked)', () => {
    it('returns 503 if Cloudinary credentials are not configured', async () => {
      const isConfiguredSpy = vi.spyOn(cloudinaryService, 'isConfigured').mockReturnValue(false);

      const res = await request(app)
        .post('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${catalogStaffToken}`)
        .attach('file', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('CLOUDINARY_NOT_CONFIGURED');
      expect(res.body.error.message).toMatch(/CLOUDINARY_CLOUD_NAME/i);

      isConfiguredSpy.mockRestore();
    });

    it('successfully uploads valid image to Cloudinary and returns HTTPS delivery URL and publicId (Mocked)', async () => {
      const isConfiguredSpy = vi.spyOn(cloudinaryService, 'isConfigured').mockReturnValue(true);

      const mockUploadResult = {
        secureUrl: 'https://res.cloudinary.com/thehomez/image/upload/v12345/thehomez/products/prod_123.jpg',
        publicId: 'thehomez/products/prod_123',
        format: 'jpg',
        width: 800,
        height: 600,
        bytes: 12345,
      };

      const uploadSpy = vi.spyOn(cloudinaryService, 'uploadProductImage').mockResolvedValue(mockUploadResult);

      const res = await request(app)
        .post('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${catalogStaffToken}`)
        .attach('file', validJpegBuffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.url).toBe(mockUploadResult.secureUrl);
      expect(res.body.data.publicId).toBe(mockUploadResult.publicId);
      expect(res.body.data.format).toBe('jpg');
      expect(res.body.data.width).toBe(800);
      expect(res.body.data.height).toBe(600);

      isConfiguredSpy.mockRestore();
      uploadSpy.mockRestore();
    });
  });

  // =========================================================================
  // 4. DELETION SAFETY AND REFERENCE STATE CHECK
  // =========================================================================
  describe('4. Deletion Safety Verification', () => {
    it('refuses deletion if publicId is currently referenced in an active product (409 Conflict)', async () => {
      const referencedPublicId = 'thehomez/products/prod_referenced_123';

      vi.spyOn(cloudinaryService, 'isConfigured').mockReturnValue(true);
      (cloudinaryService as any).configureSdk = vi.fn().mockReturnValue(true);

      // Mock ProductModel.findOne returning an existing product document
      vi.spyOn(ProductModel, 'findOne').mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          title: 'Referenced Product',
        }),
      } as any);
      vi.spyOn(ProductVariantModel, 'findOne').mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as any);

      const res = await request(app)
        .delete('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${catalogStaffToken}`)
        .send({ publicId: referencedPublicId });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('IMAGE_STILL_REFERENCED');
      expect(res.body.error.message).toMatch(/currently referenced by product/i);
    });

    it('refuses deletion of arbitrary publicIds outside designated products folder (403 Forbidden)', async () => {
      vi.spyOn(cloudinaryService, 'isConfigured').mockReturnValue(true);

      const res = await request(app)
        .delete('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${catalogStaffToken}`)
        .send({ publicId: 'critical_system_folder/avatar_123' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('UNAUTHORIZED_ASSET_DELETION');
    });

    it('allows deletion of unreferenced image asset (Mocked Cloudinary Destroy)', async () => {
      const unreferencedPublicId = 'thehomez/products/prod_unreferenced_999';

      vi.spyOn(cloudinaryService, 'isConfigured').mockReturnValue(true);
      (cloudinaryService as any).configureSdk = vi.fn().mockReturnValue(true);

      // Mock ProductModel & VariantModel returning null (unreferenced)
      vi.spyOn(ProductModel, 'findOne').mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as any);
      vi.spyOn(ProductVariantModel, 'findOne').mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      } as any);

      vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

      const res = await request(app)
        .delete('/api/v1/admin/uploads/product-image')
        .set('Authorization', `Bearer ${catalogStaffToken}`)
        .send({ publicId: unreferencedPublicId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toMatch(/deleted successfully/i);
    });
  });
});
