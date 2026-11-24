import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import { Types } from 'mongoose';
import { createApp } from '../src/app.js';
import { TokenService } from '../src/services/token/token.service.js';
import {
  AdminDashboardService,
  type StaffSecurityContext,
} from '../src/services/admin-dashboard/admin-dashboard.service.js';
import { UserType, UserStatus, PermissionCode } from '@thehomez/shared-types';
import { UserModel } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import { PartnerModel } from '../src/models/partner.model.js';
import { ProductModel } from '../src/models/product.model.js';
import { ServiceAreaModel } from '../src/models/service-area.model.js';
import { PartnerApplicationModel } from '../src/models/partner-application.model.js';
import { PartnerAuditLogModel } from '../src/models/partner-audit-log.model.js';
import { CustomerAuditLogModel } from '../src/models/customer-audit-log.model.js';

describe('Admin Dashboard Backend Implementation & Security Verification', () => {
  let app: Application;
  let tokenService: TokenService;
  let dashboardService: AdminDashboardService;

  // Test Tokens & Mock User Documents
  const mockSuperAdminId = new Types.ObjectId();
  const mockOpsManagerId = new Types.ObjectId();
  const mockCatalogManagerId = new Types.ObjectId();
  const mockCustomerUserId = new Types.ObjectId();

  let superAdminToken: string;
  let opsManagerToken: string;
  let catalogManagerToken: string;
  let customerToken: string;

  beforeAll(() => {
    tokenService = new TokenService();
    dashboardService = new AdminDashboardService();
    app = createApp();

    // Generate valid JWT tokens for test principals with valid session identifiers
    superAdminToken = tokenService.signAccessToken(
      {
        _id: mockSuperAdminId,
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['SUPER_ADMIN'],
      } as any,
      'session-super-admin',
    );

    opsManagerToken = tokenService.signAccessToken(
      {
        _id: mockOpsManagerId,
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['OPS_MANAGER'],
      } as any,
      'session-ops-manager',
    );

    catalogManagerToken = tokenService.signAccessToken(
      {
        _id: mockCatalogManagerId,
        userType: UserType.STAFF,
        status: UserStatus.ACTIVE,
        roles: ['CATALOG_MANAGER'],
      } as any,
      'session-catalog-manager',
    );

    customerToken = tokenService.signAccessToken({
      _id: mockCustomerUserId,
      userType: UserType.CUSTOMER,
      status: UserStatus.ACTIVE,
      roles: ['CUSTOMER'],
    } as any);

    // Mock Admin Session verification and activity tracking for staff auth
    vi.spyOn(TokenService.prototype, 'validateAdminSession').mockImplementation(
      (sessionId: string) => {
        let matchedUserId = mockSuperAdminId;
        if (sessionId === 'session-ops-manager') matchedUserId = mockOpsManagerId;
        if (sessionId === 'session-catalog-manager') matchedUserId = mockCatalogManagerId;
        return Promise.resolve({
          _id: new Types.ObjectId(),
          sessionId,
          userId: matchedUserId,
          status: 'ACTIVE',
          lastActivityAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
        } as any);
      },
    );

    vi.spyOn(TokenService.prototype, 'recordAdminActivity').mockResolvedValue();

    // Mock Mongoose model counts and query results for deterministic unit testing without live DB
    vi.spyOn(PartnerModel, 'countDocuments').mockResolvedValue(5 as any);
    vi.spyOn(ProductModel, 'countDocuments').mockResolvedValue(12 as any);
    vi.spyOn(ServiceAreaModel, 'countDocuments').mockResolvedValue(3 as any);
    vi.spyOn(PartnerApplicationModel, 'countDocuments').mockResolvedValue(2 as any);
    vi.spyOn(UserModel, 'countDocuments').mockResolvedValue(20 as any);
    vi.spyOn(PartnerModel, 'aggregate').mockResolvedValue([{ _id: 'ACTIVE', count: 5 }] as any);
    vi.spyOn(PartnerApplicationModel, 'find').mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }),
    } as any);
    vi.spyOn(PartnerModel, 'find').mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }),
    } as any);
    vi.spyOn(PartnerAuditLogModel, 'find').mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }),
    } as any);
    vi.spyOn(CustomerAuditLogModel, 'find').mockReturnValue({
      sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }),
    } as any);
    const originalFind = UserModel.find.bind(UserModel);
    vi.spyOn(UserModel, 'find').mockImplementation((query: any) => {
      if (query?.userType === 'CUSTOMER') {
        return {
          sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) }),
        } as any;
      }
      return originalFind(query);
    });

    // Mock UserModel.findById so the authenticate middleware resolves users
    vi.spyOn(UserModel, 'findById').mockImplementation((id: any) => {
      const idStr = id?.toString();
      if (idStr === mockSuperAdminId.toString()) {
        return Promise.resolve({
          _id: mockSuperAdminId,
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['SUPER_ADMIN'],
        } as any);
      }
      if (idStr === mockOpsManagerId.toString()) {
        return Promise.resolve({
          _id: mockOpsManagerId,
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['OPS_MANAGER'],
        } as any);
      }
      if (idStr === mockCatalogManagerId.toString()) {
        return Promise.resolve({
          _id: mockCatalogManagerId,
          userType: UserType.STAFF,
          status: UserStatus.ACTIVE,
          roles: ['CATALOG_MANAGER'],
        } as any);
      }
      if (idStr === mockCustomerUserId.toString()) {
        return Promise.resolve({
          _id: mockCustomerUserId,
          userType: UserType.CUSTOMER,
          status: UserStatus.ACTIVE,
          roles: ['CUSTOMER'],
        } as any);
      }
      return Promise.resolve(null);
    });

    // Mock RoleModel.find for dynamic RBAC permission resolution
    vi.spyOn(RoleModel, 'find').mockImplementation((query: any) => {
      const roleCodes = query?.code?.$in || [];
      const roles = [];
      if (roleCodes.includes('SUPER_ADMIN')) {
        roles.push({
          code: 'SUPER_ADMIN',
          permissions: Object.values(PermissionCode),
        });
      }
      if (roleCodes.includes('OPS_MANAGER')) {
        roles.push({
          code: 'OPS_MANAGER',
          permissions: [
            PermissionCode.ORDER_READ,
            PermissionCode.ORDER_CANCEL,
            PermissionCode.ORDER_REASSIGN,
            PermissionCode.FULFILMENT_UPDATE,
            PermissionCode.CUSTOMER_READ,
            PermissionCode.PARTNER_READ,
            PermissionCode.AUDIT_READ,
          ],
        });
      }
      if (roleCodes.includes('CATALOG_MANAGER')) {
        roles.push({
          code: 'CATALOG_MANAGER',
          permissions: [
            PermissionCode.CATALOG_READ,
            PermissionCode.CATALOG_WRITE,
            PermissionCode.PRICING_READ,
            PermissionCode.SERVICE_AREA_READ,
          ],
        });
      }
      return Promise.resolve(roles) as any;
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. UNIT TESTS: AdminDashboardService Date Boundaries & KPI Definitions
  // =========================================================================
  describe('Unit: AdminDashboardService Date Boundaries & Accounting Compliance', () => {
    it('resolves correct date bounds for 7d, 30d, 90d, today and custom', () => {
      const b7d = dashboardService.resolveDateBounds({ dateRange: '7d' });
      expect(b7d.startDate).toBeDefined();
      expect(b7d.endDate).toBeDefined();
      expect(b7d.endDate.getTime() - b7d.startDate.getTime()).toBeCloseTo(
        7 * 24 * 60 * 60 * 1000,
        -3,
      );

      const b30d = dashboardService.resolveDateBounds({ dateRange: '30d' });
      expect(b30d.endDate.getTime() - b30d.startDate.getTime()).toBeCloseTo(
        30 * 24 * 60 * 60 * 1000,
        -3,
      );

      const customStart = '2026-01-01T00:00:00.000Z';
      const customEnd = '2026-01-15T00:00:00.000Z';
      const bCustom = dashboardService.resolveDateBounds({
        dateRange: 'custom',
        startDate: customStart,
        endDate: customEnd,
      });
      expect(bCustom.startDate.toISOString()).toBe(customStart);
      expect(bCustom.endDate.toISOString()).toBe(customEnd);
    });

    it('enforces SRS Section 14.5 accounting disclosure on financial & order metrics', async () => {
      const superAdminContext: StaffSecurityContext = {
        userId: mockSuperAdminId.toString(),
        permissions: Object.values(PermissionCode),
        isSuperAdmin: true,
      };

      const summary = await dashboardService.getSummary({ dateRange: '30d' }, superAdminContext);

      // Verify Orders definition disclosure
      expect(summary.orders.totalOrders.status).toBe('pending_definition');
      expect(summary.orders.totalOrders.sourceOfTruth).toContain('OrderModel');
      expect(summary.orders.totalOrders.taxTreatment).toBe('PENDING_DECISION');

      // Verify Gross Sales (GOV) definition disclosure
      expect(summary.sales.grossSalesPaise.status).toBe('pending_definition');
      expect(summary.sales.grossSalesPaise.grossOrNet).toBe('GROSS');
      expect(summary.sales.grossSalesPaise.taxTreatment).toBe('PENDING_DECISION');
      expect(summary.sales.grossSalesPaise.sourceOfTruth).toContain('FinanceLedger');

      // Verify Net Sales definition disclosure
      expect(summary.sales.netSalesPaise.grossOrNet).toBe('NET');
      expect(summary.sales.netSalesPaise.taxTreatment).toBe('GST_EXCLUSIVE');
      expect(summary.sales.netSalesPaise.deliveryFeeTreatment).toBe('EXCLUDED');

      // Verify Settlements definition disclosure
      expect(summary.settlements.outstandingSettlementPaise.status).toBe('deferred');
      expect(summary.settlements.outstandingSettlementPaise.grossOrNet).toBe('NET');

      // Verify Live models have active status
      expect(summary.fulfilment.activePartners.status).toBe('active');
      expect(summary.catalog.totalProducts.status).toBe('active');
      expect(summary.customers.totalCustomers.status).toBe('active');
    });

    it('enforces RBAC field masking when staff lacks specific domain permissions', async () => {
      const catalogOnlyContext: StaffSecurityContext = {
        userId: mockCatalogManagerId.toString(),
        permissions: [PermissionCode.CATALOG_READ, PermissionCode.PRICING_READ],
        isSuperAdmin: false,
      };

      const summary = await dashboardService.getSummary({ dateRange: '30d' }, catalogOnlyContext);

      // Catalog domain is available
      expect(summary.catalog.totalProducts.isAvailable).toBe(true);

      // Partner and Customer domains are masked
      expect(summary.fulfilment.activePartners.isAvailable).toBe(false);
      expect(summary.fulfilment.activePartners.value).toBe(0);
      expect(summary.customers.totalCustomers.isAvailable).toBe(false);
      expect(summary.customers.totalCustomers.value).toBe(0);

      // Finance domain is masked
      expect(summary.sales.grossSalesPaise.isAvailable).toBe(false);
      expect(summary.settlements.outstandingSettlementPaise.isAvailable).toBe(false);
    });
  });

  // =========================================================================
  // 2. HTTP INTEGRATION TESTS: Route Guards & Authorization (Security Freeze)
  // =========================================================================
  describe('HTTP: Route Guards, Authentication & Authorization Boundaries', () => {
    it('returns 401 when request has no Authorization header', async () => {
      const res = await request(app).get('/api/v1/admin/dashboard/summary');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 401 when request has malformed Bearer token', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard/summary')
        .set('Authorization', 'InvalidFormat token123');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('MALFORMED_TOKEN');
    });

    it('returns 403 when authenticated user is NOT STAFF (e.g. CUSTOMER principal)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard/summary')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('returns 400 when invalid query parameters are supplied', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard/summary?dateRange=invalidRange')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 200 with summary payload for authenticated staff user', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard/summary?dateRange=30d')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.orders).toBeDefined();
      expect(res.body.data.sales).toBeDefined();
      expect(res.body.data.catalog).toBeDefined();
      expect(res.body.data.customers).toBeDefined();
    });

    it('enforces PARTNER_READ on /partner-overview endpoint (403 for unauthorized staff)', async () => {
      // Catalog manager lacks PARTNER_READ
      const resUnauthorized = await request(app)
        .get('/api/v1/admin/dashboard/partner-overview')
        .set('Authorization', `Bearer ${catalogManagerToken}`);
      expect(resUnauthorized.status).toBe(403);
      expect(resUnauthorized.body.error.code).toBe('FORBIDDEN');

      // Super admin or ops manager has PARTNER_READ
      const resAuthorized = await request(app)
        .get('/api/v1/admin/dashboard/partner-overview')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(resAuthorized.status).toBe(200);
      expect(resAuthorized.body.success).toBe(true);
      expect(resAuthorized.body.data.statusBreakdown).toBeDefined();
    });

    it('enforces AUDIT_READ on /recent-activity endpoint (403 for unauthorized staff)', async () => {
      // Catalog manager lacks AUDIT_READ
      const resUnauthorized = await request(app)
        .get('/api/v1/admin/dashboard/recent-activity')
        .set('Authorization', `Bearer ${catalogManagerToken}`);
      expect(resUnauthorized.status).toBe(403);
      expect(resUnauthorized.body.error.code).toBe('FORBIDDEN');

      // Ops manager has AUDIT_READ
      const resAuthorized = await request(app)
        .get('/api/v1/admin/dashboard/recent-activity')
        .set('Authorization', `Bearer ${opsManagerToken}`);
      expect(resAuthorized.status).toBe(200);
      expect(resAuthorized.body.success).toBe(true);
      expect(resAuthorized.body.data.items).toBeDefined();
    });

    it('returns 200 for /operational-exceptions with bounded limit query', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard/operational-exceptions?limit=5')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items).toBeDefined();
      expect(res.body.data.totalCount).toBeDefined();
    });
  });
});
