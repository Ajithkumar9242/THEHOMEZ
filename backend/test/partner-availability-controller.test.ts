import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  PartnerAvailabilityController,
  partnerAvailabilityController,
} from '../src/controllers/partner-availability.controller.js';
import type { PartnerAvailabilityService } from '../src/services/partner-availability/partner-availability.service.js';
import {
  UserType,
  PermissionCode,
  type IUserPrincipal,
  type IPartnerProductDto,
  type IBatchPartnerAvailabilityResponseDto,
  type IPartnerAvailabilityHistoryDto,
  type IPartnerAvailabilityListResponseDto,
  type IPublicProductAvailabilityDto,
} from '@thehomez/shared-types';

describe('Milestone 4 Step 6: Subtask 6.4A — Partner Availability HTTP Controllers', () => {
  let mockService: Partial<Record<keyof PartnerAvailabilityService, ReturnType<typeof vi.fn>>>;
  let controller: PartnerAvailabilityController;

  const mockPrincipal: IUserPrincipal = {
    id: '672a00000000000000000099',
    userType: UserType.PARTNER,
    roles: ['PARTNER_OPERATOR'],
    permissions: [
      PermissionCode.PARTNER_AVAILABILITY_READ,
      PermissionCode.PARTNER_AVAILABILITY_WRITE,
    ],
    partnerId: '672a00000000000000000001',
  };

  const mockAdminPrincipal: IUserPrincipal = {
    id: '672a00000000000000000088',
    userType: UserType.STAFF,
    roles: ['SUPER_ADMIN'],
    permissions: [
      PermissionCode.PARTNER_AVAILABILITY_READ,
      PermissionCode.PARTNER_AVAILABILITY_WRITE,
    ],
  };

  const samplePartnerProductDto: IPartnerProductDto = {
    id: '672b1234abcd5678ef901234',
    partnerId: '672a00000000000000000001',
    productId: '672b00000000000000000010',
    variantId: null,
    serviceAreaId: '672a11110000000000000001',
    isAvailable: true,
    partnerCustomSku: 'WH-CEM-01',
    minLeadTimeHours: 4,
    version: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const createMockReq = (overrides: Partial<Request> = {}): Request => {
    return {
      body: {},
      params: {},
      query: {},
      user: mockPrincipal,
      ...overrides,
    } as unknown as Request;
  };

  const createMockRes = () => {
    const res: Partial<Response> = {};
    res.statusCode = 200;
    res.status = vi.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    });
    res.json = vi.fn().mockReturnValue(res);
    return res as Response & { statusCode: number; json: ReturnType<typeof vi.fn> };
  };

  const createMockNext = () => vi.fn() as unknown as NextFunction;

  beforeEach(() => {
    mockService = {
      setAvailability: vi.fn(),
      toggleAvailability: vi.fn(),
      batchUpdateAvailability: vi.fn(),
      listAvailability: vi.fn(),
      getAvailabilityById: vi.fn(),
      getAvailabilityHistory: vi.fn(),
      resolveStorefrontAvailability: vi.fn(),
      deactivateAvailabilityForProduct: vi.fn(),
      deactivateAvailabilityForVariant: vi.fn(),
    };

    controller = new PartnerAvailabilityController(
      mockService as unknown as PartnerAvailabilityService,
    );
  });

  describe('Instantiation & Exports', () => {
    it('should export a default singleton instance of PartnerAvailabilityController', () => {
      expect(partnerAvailabilityController).toBeInstanceOf(PartnerAvailabilityController);
    });

    it('should properly bind controller methods for express router detachment', async () => {
      const { setAvailability } = controller;
      mockService.setAvailability!.mockResolvedValue(samplePartnerProductDto);

      const req = createMockReq({ body: { productId: 'p1', serviceAreaId: 'sa1' } });
      const res = createMockRes();
      const next = createMockNext();

      await setAvailability(req, res, next);
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('PUT /api/v1/partner/availability (setAvailability)', () => {
    it('should return 201 Created when linking initial availability (version === 0)', async () => {
      const newRecordDto: IPartnerProductDto = { ...samplePartnerProductDto, version: 0 };
      mockService.setAvailability!.mockResolvedValue(newRecordDto);

      const req = createMockReq({
        body: {
          productId: '672b00000000000000000010',
          serviceAreaId: '672a11110000000000000001',
          isAvailable: true,
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.setAvailability(req, res, next);

      expect(mockService.setAvailability).toHaveBeenCalledWith(mockPrincipal, req.body);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: newRecordDto,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 200 OK when updating existing availability (version > 0)', async () => {
      const updatedDto: IPartnerProductDto = { ...samplePartnerProductDto, version: 1 };
      mockService.setAvailability!.mockResolvedValue(updatedDto);

      const req = createMockReq({
        body: {
          productId: '672b00000000000000000010',
          serviceAreaId: '672a11110000000000000001',
          isAvailable: true,
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.setAvailability(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: updatedDto,
      });
    });

    it('should forward service errors to next()', async () => {
      const testError = new Error('Service failure');
      mockService.setAvailability!.mockRejectedValue(testError);

      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      await controller.setAvailability(req, res, next);

      expect(next).toHaveBeenCalledWith(testError);
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /api/v1/partner/availability/:id (toggleAvailability)', () => {
    it('should toggle availability and return 200 OK with updated record', async () => {
      const toggledDto: IPartnerProductDto = {
        ...samplePartnerProductDto,
        isAvailable: false,
        version: 1,
      };
      mockService.toggleAvailability!.mockResolvedValue(toggledDto);

      const req = createMockReq({
        params: { id: '672b1234abcd5678ef901234' },
        body: { isAvailable: false, reason: 'Out of stock', version: 0 },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.toggleAvailability(req, res, next);

      expect(mockService.toggleAvailability).toHaveBeenCalledWith(
        mockPrincipal,
        '672b1234abcd5678ef901234',
        req.body,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: toggledDto,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward concurrency or validation errors to next()', async () => {
      const conflictError = new Error('CONCURRENT_MODIFICATION_CONFLICT');
      mockService.toggleAvailability!.mockRejectedValue(conflictError);

      const req = createMockReq({ params: { id: '672b1234abcd5678ef901234' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.toggleAvailability(req, res, next);

      expect(next).toHaveBeenCalledWith(conflictError);
    });
  });

  describe('POST /api/v1/partner/availability/batch (batchUpdateAvailability)', () => {
    it('should perform batch updates and return 200 OK with updated count and IDs', async () => {
      const batchResult: IBatchPartnerAvailabilityResponseDto = {
        updatedCount: 2,
        updatedIds: ['id1', 'id2'],
      };
      mockService.batchUpdateAvailability!.mockResolvedValue(batchResult);

      const req = createMockReq({
        body: {
          items: [
            { id: 'id1', isAvailable: true },
            { id: 'id2', isAvailable: false },
          ],
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.batchUpdateAvailability(req, res, next);

      expect(mockService.batchUpdateAvailability).toHaveBeenCalledWith(mockPrincipal, req.body);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: batchResult,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('should forward batch errors to next()', async () => {
      const error = new Error('INVALID_BATCH_SIZE');
      mockService.batchUpdateAvailability!.mockRejectedValue(error);

      const req = createMockReq({ body: { items: [] } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.batchUpdateAvailability(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('GET /api/v1/partner/availability (listPartnerAvailability)', () => {
    it('should correctly parse query filters and return paginated envelope', async () => {
      const listResponse: IPartnerAvailabilityListResponseDto = {
        items: [samplePartnerProductDto],
        total: 25,
        page: 2,
        limit: 10,
        totalPages: 3,
      };
      mockService.listAvailability!.mockResolvedValue(listResponse);

      const req = createMockReq({
        query: {
          page: '2',
          limit: '10',
          productId: '672b00000000000000000010',
          serviceAreaId: '672a11110000000000000001',
          categoryId: '672c22220000000000000001',
          isAvailable: 'true',
          search: 'cement',
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.listPartnerAvailability(req, res, next);

      expect(mockService.listAvailability).toHaveBeenCalledWith(mockPrincipal, {
        page: 2,
        limit: 10,
        productId: '672b00000000000000000010',
        serviceAreaId: '672a11110000000000000001',
        categoryId: '672c22220000000000000001',
        isAvailable: true,
        search: 'cement',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [samplePartnerProductDto],
        pagination: {
          page: 2,
          limit: 10,
          totalItems: 25,
          totalPages: 3,
          hasNextPage: true,
          hasPrevPage: true,
        },
      });
    });

    it('should handle boolean and string variations of isAvailable filter', async () => {
      mockService.listAvailability!.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      // Test false string
      const req1 = createMockReq({ query: { isAvailable: 'false' } });
      const res1 = createMockRes();
      await controller.listPartnerAvailability(req1, res1, createMockNext());
      expect(mockService.listAvailability).toHaveBeenCalledWith(
        mockPrincipal,
        expect.objectContaining({ isAvailable: false }),
      );

      // Test raw boolean true
      const req2 = createMockReq({ query: { isAvailable: true as unknown as string } });
      const res2 = createMockRes();
      await controller.listPartnerAvailability(req2, res2, createMockNext());
      expect(mockService.listAvailability).toHaveBeenCalledWith(
        mockPrincipal,
        expect.objectContaining({ isAvailable: true }),
      );

      // Test undefined when omitted
      const req3 = createMockReq({ query: {} });
      const res3 = createMockRes();
      await controller.listPartnerAvailability(req3, res3, createMockNext());
      expect(mockService.listAvailability).toHaveBeenCalledWith(
        mockPrincipal,
        expect.objectContaining({ isAvailable: undefined }),
      );
    });

    it('should forward list errors to next()', async () => {
      const error = new Error('FORBIDDEN');
      mockService.listAvailability!.mockRejectedValue(error);

      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      await controller.listPartnerAvailability(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('GET /api/v1/partner/availability/:id (getPartnerAvailabilityById)', () => {
    it('should retrieve single availability record by ID with 200 OK', async () => {
      mockService.getAvailabilityById!.mockResolvedValue(samplePartnerProductDto);

      const req = createMockReq({ params: { id: '672b1234abcd5678ef901234' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.getPartnerAvailabilityById(req, res, next);

      expect(mockService.getAvailabilityById).toHaveBeenCalledWith(
        mockPrincipal,
        '672b1234abcd5678ef901234',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: samplePartnerProductDto,
      });
    });

    it('should forward not found or tenant mismatch errors to next()', async () => {
      const notFoundErr = new Error('PARTNER_PRODUCT_NOT_FOUND');
      mockService.getAvailabilityById!.mockRejectedValue(notFoundErr);

      const req = createMockReq({ params: { id: 'nonexistent' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.getPartnerAvailabilityById(req, res, next);

      expect(next).toHaveBeenCalledWith(notFoundErr);
    });
  });

  describe('GET /api/v1/partner/availability/:id/history (getPartnerAvailabilityHistory)', () => {
    const historyItem1: IPartnerAvailabilityHistoryDto = {
      id: 'h1',
      partnerProductId: 'p1',
      partnerId: 'partner1',
      productId: 'prod1',
      variantId: null,
      serviceAreaId: 'sa1',
      previousState: null,
      newState: true,
      reason: 'Initial setup',
      changedBy: 'user1',
      createdAt: '2026-11-06T10:00:00.000Z',
    };
    const historyItem2: IPartnerAvailabilityHistoryDto = {
      id: 'h2',
      partnerProductId: 'p1',
      partnerId: 'partner1',
      productId: 'prod1',
      variantId: null,
      serviceAreaId: 'sa1',
      previousState: true,
      newState: false,
      reason: 'Out of stock',
      changedBy: 'user1',
      createdAt: '2026-11-06T11:00:00.000Z',
    };

    it('should return unpaginated history array when no pagination query params are supplied', async () => {
      mockService.getAvailabilityHistory!.mockResolvedValue([historyItem2, historyItem1]);

      const req = createMockReq({ params: { id: 'p1' }, query: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.getPartnerAvailabilityHistory(req, res, next);

      expect(mockService.getAvailabilityHistory).toHaveBeenCalledWith(mockPrincipal, 'p1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [historyItem2, historyItem1],
      });
    });

    it('should paginate history items when page and limit query params are provided', async () => {
      mockService.getAvailabilityHistory!.mockResolvedValue([historyItem2, historyItem1]);

      const req = createMockReq({ params: { id: 'p1' }, query: { page: '1', limit: '1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.getPartnerAvailabilityHistory(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [historyItem2],
        pagination: {
          page: 1,
          limit: 1,
          totalItems: 2,
          totalPages: 2,
          hasNextPage: true,
          hasPrevPage: false,
        },
      });
    });

    it('should forward history errors to next()', async () => {
      const err = new Error('Database read failure');
      mockService.getAvailabilityHistory!.mockRejectedValue(err);

      const req = createMockReq({ params: { id: 'p1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.getPartnerAvailabilityHistory(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('GET /api/v1/admin/partners/:partnerId/availability (adminListPartnerAvailability)', () => {
    it('should allow staff to query specific partner availability with pagination envelope', async () => {
      const targetPartnerId = '672a00000000000000000055';
      const listResponse: IPartnerAvailabilityListResponseDto = {
        items: [samplePartnerProductDto],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      mockService.listAvailability!.mockResolvedValue(listResponse);

      const req = createMockReq({
        user: mockAdminPrincipal,
        params: { partnerId: targetPartnerId },
        query: { page: '1', limit: '20' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.adminListPartnerAvailability(req, res, next);

      expect(mockService.listAvailability).toHaveBeenCalledWith(
        mockAdminPrincipal,
        expect.objectContaining({ page: 1, limit: 20 }),
        targetPartnerId,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: [samplePartnerProductDto],
        pagination: {
          page: 1,
          limit: 20,
          totalItems: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });
    });

    it('should forward admin list errors to next()', async () => {
      const err = new Error('Staff unauthorized');
      mockService.listAvailability!.mockRejectedValue(err);

      const req = createMockReq({
        user: mockAdminPrincipal,
        params: { partnerId: 'target' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.adminListPartnerAvailability(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('PATCH /api/v1/admin/partners/:partnerId/availability/:id (adminTogglePartnerAvailability)', () => {
    it('should allow staff emergency toggle for a specific partner', async () => {
      const targetPartnerId = '672a00000000000000000055';
      const recordId = '672b1234abcd5678ef901234';
      const updatedDto: IPartnerProductDto = { ...samplePartnerProductDto, isAvailable: false };
      mockService.toggleAvailability!.mockResolvedValue(updatedDto);

      const req = createMockReq({
        user: mockAdminPrincipal,
        params: { partnerId: targetPartnerId, id: recordId },
        body: { isAvailable: false, reason: 'Administrative health & safety suspension' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.adminTogglePartnerAvailability(req, res, next);

      expect(mockService.toggleAvailability).toHaveBeenCalledWith(
        mockAdminPrincipal,
        recordId,
        req.body,
        targetPartnerId,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: updatedDto,
      });
    });

    it('should forward admin toggle errors to next()', async () => {
      const err = new Error('Admin toggle failed');
      mockService.toggleAvailability!.mockRejectedValue(err);

      const req = createMockReq({
        user: mockAdminPrincipal,
        params: { partnerId: 'target', id: 'rec' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.adminTogglePartnerAvailability(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('GET /api/v1/products/public/availability (getPublicAvailability)', () => {
    it('should resolve unlocalized browsing when no pincode is provided (Decision #48)', async () => {
      const unlocalizedDto: IPublicProductAvailabilityDto = {
        productId: '672b00000000000000000010',
        variantId: null,
        serviceAreaId: null,
        isAvailable: null,
        availabilityUnknown: true,
        minLeadTimeHours: null,
        availablePartnerCount: null,
        message: 'Enter delivery PIN code to check local availability',
      };
      mockService.resolveStorefrontAvailability!.mockResolvedValue(unlocalizedDto);

      const req = createMockReq({
        query: { productId: '672b00000000000000000010' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.getPublicAvailability(req, res, next);

      expect(mockService.resolveStorefrontAvailability).toHaveBeenCalledWith(
        '672b00000000000000000010',
        null,
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: unlocalizedDto,
      });
    });

    it('should resolve localized browsing when pincode is provided', async () => {
      const localizedDto: IPublicProductAvailabilityDto = {
        productId: '672b00000000000000000010',
        variantId: '672b00000000000000000020',
        serviceAreaId: '672a11110000000000000001',
        isAvailable: true,
        availabilityUnknown: false,
        minLeadTimeHours: 6,
        availablePartnerCount: 3,
      };
      mockService.resolveStorefrontAvailability!.mockResolvedValue(localizedDto);

      const req = createMockReq({
        query: {
          productId: '672b00000000000000000010',
          variantId: '672b00000000000000000020',
          pincode: '560068',
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.getPublicAvailability(req, res, next);

      expect(mockService.resolveStorefrontAvailability).toHaveBeenCalledWith(
        '672b00000000000000000010',
        '672b00000000000000000020',
        '560068',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: localizedDto,
      });
    });

    it('should support deliveryPincode alias and route params', async () => {
      const localizedDto: IPublicProductAvailabilityDto = {
        productId: '672b00000000000000000010',
        variantId: '672b00000000000000000020',
        serviceAreaId: '672a11110000000000000001',
        isAvailable: false,
        availabilityUnknown: false,
        minLeadTimeHours: null,
        availablePartnerCount: 0,
      };
      mockService.resolveStorefrontAvailability!.mockResolvedValue(localizedDto);

      const req = createMockReq({
        params: {
          productId: '672b00000000000000000010',
          variantId: '672b00000000000000000020',
        },
        query: { deliveryPincode: '560099' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.getPublicAvailability(req, res, next);

      expect(mockService.resolveStorefrontAvailability).toHaveBeenCalledWith(
        '672b00000000000000000010',
        '672b00000000000000000020',
        '560099',
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should forward storefront resolution errors to next()', async () => {
      const err = new Error('Invalid product format');
      mockService.resolveStorefrontAvailability!.mockRejectedValue(err);

      const req = createMockReq({ query: { productId: 'invalid' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.getPublicAvailability(req, res, next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });
});
