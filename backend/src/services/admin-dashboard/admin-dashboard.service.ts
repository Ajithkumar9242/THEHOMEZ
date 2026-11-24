import {
  PermissionCode,
  type IAdminDashboardSummaryDto,
  type IOperationalExceptionsDto,
  type IOperationalExceptionItem,
  type IPartnerOverviewDto,
  type IRecentActivityDto,
  type IRecentActivityItem,
  type IKpiMetric,
} from '@thehomez/shared-types';
import { PartnerModel } from '../../models/partner.model.js';
import { PartnerApplicationModel } from '../../models/partner-application.model.js';
import { UserModel } from '../../models/user.model.js';
import { ProductModel } from '../../models/product.model.js';
import { ServiceAreaModel } from '../../models/service-area.model.js';
import { PartnerAuditLogModel } from '../../models/partner-audit-log.model.js';
import { CustomerAuditLogModel } from '../../models/customer-audit-log.model.js';
import type { AdminDashboardQueryInput } from '../../routes/admin-dashboard.schemas.js';

export interface StaffSecurityContext {
  userId: string;
  permissions: PermissionCode[];
  isSuperAdmin: boolean;
}

export class AdminDashboardService {
  /**
   * Resolves the exact ISO start and end bounds for the given date range.
   */
  public resolveDateBounds(query: AdminDashboardQueryInput): {
    startDate: Date;
    endDate: Date;
    prevStartDate: Date;
    prevEndDate: Date;
  } {
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;

    if (query.dateRange === 'today') {
      startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    } else if (query.dateRange === '7d') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (query.dateRange === '90d') {
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    } else if (query.dateRange === 'custom' && query.startDate && query.endDate) {
      startDate = new Date(query.startDate);
      endDate = new Date(query.endDate);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        endDate = now;
      }
    } else {
      // Default to 30d
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const duration = endDate.getTime() - startDate.getTime();
    const prevEndDate = new Date(startDate.getTime());
    const prevStartDate = new Date(startDate.getTime() - duration);

    return { startDate, endDate, prevStartDate, prevEndDate };
  }

  /**
   * Helper to construct a strictly defined IKpiMetric conforming to SRS Section 14.5.
   */
  private buildMetric<T>(
    value: T,
    label: string,
    opts: {
      isAvailable?: boolean;
      status?: 'active' | 'pending_definition' | 'deferred';
      definitionNote?: string;
      grossOrNet?: 'GROSS' | 'NET' | 'NOT_APPLICABLE';
      taxTreatment?: 'GST_EXCLUSIVE' | 'GST_INCLUSIVE' | 'NOT_APPLICABLE' | 'PENDING_DECISION';
      deliveryFeeTreatment?: 'INCLUDED' | 'EXCLUDED' | 'NOT_APPLICABLE' | 'PENDING_DECISION';
      timestampBasis?: 'CREATED_AT' | 'UPDATED_AT' | 'COMPLETED_AT';
      sourceOfTruth?: string;
      previousPeriodValue?: T | null;
      changePercentage?: number | null;
    } = {},
  ): IKpiMetric<T> {
    return {
      value,
      label,
      isAvailable: opts.isAvailable ?? true,
      status: opts.status ?? 'active',
      definitionNote: opts.definitionNote ?? 'Direct count from verified database records.',
      grossOrNet: opts.grossOrNet ?? 'NOT_APPLICABLE',
      taxTreatment: opts.taxTreatment ?? 'NOT_APPLICABLE',
      deliveryFeeTreatment: opts.deliveryFeeTreatment ?? 'NOT_APPLICABLE',
      timestampBasis: opts.timestampBasis ?? 'CREATED_AT',
      sourceOfTruth: opts.sourceOfTruth ?? 'MongoDB',
      previousPeriodValue: opts.previousPeriodValue ?? null,
      changePercentage: opts.changePercentage ?? null,
    };
  }

  /**
   * Calculates valid percentage change between two numeric periods, or null if invalid.
   */
  private calculateTrend(current: number, previous: number | null): number | null {
    if (previous === null || previous <= 0) return null;
    return Math.round(((current - previous) / previous) * 100);
  }

  /**
   * Fetches top-level summary metrics with fine-grained RBAC authorization.
   */
  public async getSummary(
    query: AdminDashboardQueryInput,
    staff: StaffSecurityContext,
  ): Promise<IAdminDashboardSummaryDto> {
    const { startDate, endDate, prevStartDate, prevEndDate } = this.resolveDateBounds(query);

    // Parallel aggregation pipelines for permitted domains
    const canReadPartner =
      staff.isSuperAdmin || staff.permissions.includes(PermissionCode.PARTNER_READ);
    const canReadCatalog =
      staff.isSuperAdmin || staff.permissions.includes(PermissionCode.CATALOG_READ);
    const canReadCustomer =
      staff.isSuperAdmin || staff.permissions.includes(PermissionCode.CUSTOMER_READ);
    const canReadOrder =
      staff.isSuperAdmin || staff.permissions.includes(PermissionCode.ORDER_READ);
    const canReadFinance =
      staff.isSuperAdmin || staff.permissions.includes(PermissionCode.FINANCE_READ);

    const [
      activePartnersCount,
      prevActivePartnersCount,
      totalProductsCount,
      publishedProductsCount,
      activeServiceAreasCount,
      totalCustomersCount,
      pendingB2bCount,
    ] = await Promise.all([
      canReadPartner
        ? PartnerModel.countDocuments({ status: 'ACTIVE' }).catch(() => 0)
        : Promise.resolve(0),
      canReadPartner
        ? PartnerModel.countDocuments({
            status: 'ACTIVE',
            createdAt: { $gte: prevStartDate, $lte: prevEndDate },
          }).catch(() => 0)
        : Promise.resolve(0),
      canReadCatalog ? ProductModel.countDocuments({}).catch(() => 0) : Promise.resolve(0),
      canReadCatalog
        ? ProductModel.countDocuments({ status: 'PUBLISHED' }).catch(() => 0)
        : Promise.resolve(0),
      canReadCatalog ||
      staff.permissions.includes(PermissionCode.SERVICE_AREA_READ) ||
      staff.isSuperAdmin
        ? ServiceAreaModel.countDocuments({ isActive: true }).catch(() => 0)
        : Promise.resolve(0),
      canReadCustomer
        ? UserModel.countDocuments({ userType: 'CUSTOMER' }).catch(() => 0)
        : Promise.resolve(0),
      canReadCustomer
        ? UserModel.countDocuments({
            userType: 'CUSTOMER',
            $or: [
              { 'metadata.b2bStatus': 'PENDING_VERIFICATION' },
              { status: 'PENDING_VERIFICATION' },
            ],
          }).catch(() => 0)
        : Promise.resolve(0),
    ]);

    // Construct role-authorized response with explicit accounting disclosure
    const summary: IAdminDashboardSummaryDto = {
      timestamp: new Date().toISOString(),
      dateRange: query.dateRange,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      orders: {
        totalOrders: this.buildMetric(0, 'Total Orders', {
          isAvailable: canReadOrder,
          status: 'pending_definition',
          definitionNote:
            'Parent Order placement model deferred pending Milestone 5B.5 ratification (Decisions #4, #6, #7).',
          grossOrNet: 'NOT_APPLICABLE',
          taxTreatment: 'PENDING_DECISION',
          deliveryFeeTreatment: 'PENDING_DECISION',
          timestampBasis: 'CREATED_AT',
          sourceOfTruth: 'OrderModel (Milestone 5B.5)',
        }),
        pendingActionOrders: this.buildMetric(0, 'Orders Awaiting Action', {
          isAvailable: canReadOrder,
          status: 'pending_definition',
          definitionNote:
            'Order state machine active action required count pending allocation workflow approval.',
          sourceOfTruth: 'OrderModel (Milestone 5B.5)',
        }),
        completedOrders: this.buildMetric(0, 'Completed Orders', {
          isAvailable: canReadOrder,
          status: 'pending_definition',
          definitionNote: 'Terminal FULFILLED state orders per SRS Section 8.1.',
          sourceOfTruth: 'OrderModel (Milestone 5B.5)',
        }),
      },
      sales: {
        grossSalesPaise: this.buildMetric(0, 'Gross Sales (GOV)', {
          isAvailable: canReadFinance,
          status: 'pending_definition',
          definitionNote:
            'Gross Order Value (GOV) accounting definition pending stakeholder approval per Decision #32 (Phase 4). Tax and freight inclusion TBD.',
          grossOrNet: 'GROSS',
          taxTreatment: 'PENDING_DECISION',
          deliveryFeeTreatment: 'PENDING_DECISION',
          sourceOfTruth: 'FinanceLedger (Phase 4)',
        }),
        netSalesPaise: this.buildMetric(0, 'Net Sales', {
          isAvailable: canReadFinance,
          status: 'pending_definition',
          definitionNote:
            'Net material sales excluding GST, delivery charges, discounts and returns. Pending Phase 4 definition.',
          grossOrNet: 'NET',
          taxTreatment: 'GST_EXCLUSIVE',
          deliveryFeeTreatment: 'EXCLUDED',
          sourceOfTruth: 'FinanceLedger (Phase 4)',
        }),
      },
      payments: {
        successfulPayments: this.buildMetric(0, 'Successful Payments', {
          isAvailable: canReadFinance,
          status: 'deferred',
          definitionNote:
            'Direct payment transaction execution deferred to Phase 4 (Decisions #11–#13).',
          sourceOfTruth: 'PaymentTransaction (Phase 4)',
        }),
        pendingPaymentExceptions: this.buildMetric(0, 'Payment Exceptions', {
          isAvailable: canReadFinance,
          status: 'deferred',
          definitionNote: 'Payment reconciliation and failure queues deferred to Phase 4.',
          sourceOfTruth: 'PaymentTransaction (Phase 4)',
        }),
      },
      fulfilment: {
        activePartners: this.buildMetric(activePartnersCount, 'Active Partners', {
          isAvailable: canReadPartner,
          status: 'active',
          definitionNote: 'Total active verified merchants and yards servicing platform orders.',
          sourceOfTruth: 'PartnerModel',
          previousPeriodValue: prevActivePartnersCount,
          changePercentage: this.calculateTrend(activePartnersCount, prevActivePartnersCount),
        }),
        fulfilmentRate: this.buildMetric(0, 'Fulfilment Rate', {
          isAvailable: canReadPartner,
          status: 'pending_definition',
          definitionNote:
            'Sub-order delivery completion SLA percentage pending vendor allocation release.',
          sourceOfTruth: 'FulfilmentUnit (Milestone 5B.5)',
        }),
      },
      settlements: {
        outstandingSettlementPaise: this.buildMetric(0, 'Outstanding Settlements', {
          isAvailable: canReadFinance,
          status: 'deferred',
          definitionNote:
            'Partner payout release and escrow ledger deferred to Phase 4 (Decisions #10, #14).',
          grossOrNet: 'NET',
          sourceOfTruth: 'SettlementBatch (Phase 4)',
        }),
        pendingApprovals: this.buildMetric(0, 'Pending Payout Approvals', {
          isAvailable: canReadFinance,
          status: 'deferred',
          definitionNote: 'Payout approval workflows deferred to Phase 4.',
          sourceOfTruth: 'SettlementBatch (Phase 4)',
        }),
      },
      catalog: {
        totalProducts: this.buildMetric(totalProductsCount, 'Total Products', {
          isAvailable: canReadCatalog,
          status: 'active',
          definitionNote: 'Total catalog master products registered on platform.',
          sourceOfTruth: 'ProductModel',
        }),
        publishedProducts: this.buildMetric(publishedProductsCount, 'Published Products', {
          isAvailable: canReadCatalog,
          status: 'active',
          definitionNote: 'Catalog products active and discoverable on customer storefront.',
          sourceOfTruth: 'ProductModel',
        }),
        activeServiceAreas: this.buildMetric(activeServiceAreasCount, 'Active Service Areas', {
          isAvailable:
            canReadCatalog ||
            staff.permissions.includes(PermissionCode.SERVICE_AREA_READ) ||
            staff.isSuperAdmin,
          status: 'active',
          definitionNote: 'Configured geographic delivery zones currently operational.',
          sourceOfTruth: 'ServiceAreaModel',
        }),
      },
      customers: {
        totalCustomers: this.buildMetric(totalCustomersCount, 'Registered Customers', {
          isAvailable: canReadCustomer,
          status: 'active',
          definitionNote: 'Total registered B2C retail and B2B commercial contractor accounts.',
          sourceOfTruth: 'UserModel',
        }),
        pendingB2bVerifications: this.buildMetric(pendingB2bCount, 'Pending B2B Verifications', {
          isAvailable: canReadCustomer,
          status: 'active',
          definitionNote:
            'Contractor wholesale accounts awaiting tax document/business verification.',
          sourceOfTruth: 'UserModel',
        }),
      },
    };

    return summary;
  }

  /**
   * Fetches partner operational overview metrics (Requires PARTNER_READ).
   */
  public async getPartnerOverview(): Promise<IPartnerOverviewDto> {
    const [
      activeCount,
      pendingCount,
      suspendedCount,
      totalApps,
      reviewApps,
      statusAgg,
      deliveryAgg,
    ] = await Promise.all([
      PartnerModel.countDocuments({ status: 'ACTIVE' }).catch(() => 0),
      PartnerModel.countDocuments({ status: 'PENDING_VERIFICATION' }).catch(() => 0),
      PartnerModel.countDocuments({ status: 'SUSPENDED' }).catch(() => 0),
      PartnerApplicationModel.countDocuments({}).catch(() => 0),
      PartnerApplicationModel.countDocuments({ status: 'UNDER_REVIEW' }).catch(() => 0),
      PartnerModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]).catch(() => []),
      PartnerModel.aggregate([{ $group: { _id: '$deliveryMode', count: { $sum: 1 } } }]).catch(
        () => [],
      ),
    ]);

    const statusBreakdown = statusAgg.map((item: any) => ({
      status: item._id || 'UNKNOWN',
      count: item.count || 0,
    }));

    const deliveryModeBreakdown = deliveryAgg.map((item: any) => ({
      mode: item._id || 'UNKNOWN',
      count: item.count || 0,
    }));

    return {
      activePartnersCount: activeCount,
      pendingVerificationCount: pendingCount,
      suspendedPartnersCount: suspendedCount,
      totalApplicationsCount: totalApps,
      applicationsUnderReviewCount: reviewApps,
      statusBreakdown,
      deliveryModeBreakdown,
    };
  }

  /**
   * Fetches actionable operational exceptions from real database records.
   */
  public async getOperationalExceptions(
    limit = 10,
    staff: StaffSecurityContext,
  ): Promise<IOperationalExceptionsDto> {
    const items: IOperationalExceptionItem[] = [];

    const canReadPartner =
      staff.isSuperAdmin || staff.permissions.includes(PermissionCode.PARTNER_READ);
    const canReadCustomer =
      staff.isSuperAdmin || staff.permissions.includes(PermissionCode.CUSTOMER_READ);

    // Parallel fetch of exception candidates across permitted domains
    const [pendingApplications, suspendedPartners, pendingCustomers] = await Promise.all([
      canReadPartner
        ? PartnerApplicationModel.find({
            status: { $in: ['SUBMITTED', 'UNDER_REVIEW'] },
          })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean()
            .catch(() => [])
        : Promise.resolve([]),
      canReadPartner
        ? PartnerModel.find({ status: 'SUSPENDED' })
            .sort({ updatedAt: -1 })
            .limit(limit)
            .lean()
            .catch(() => [])
        : Promise.resolve([]),
      canReadCustomer
        ? UserModel.find({
            userType: 'CUSTOMER',
            $or: [
              { 'metadata.b2bStatus': 'PENDING_VERIFICATION' },
              { status: 'PENDING_VERIFICATION' },
            ],
          })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean()
            .catch(() => [])
        : Promise.resolve([]),
    ]);

    for (const app of pendingApplications) {
      items.push({
        id: `app-${app._id.toString()}`,
        category: 'PARTNER_VERIFICATION',
        severity: app.status === 'UNDER_REVIEW' ? 'WARNING' : 'INFO',
        title: `Partner Application: ${app.businessName}`,
        description: `Application is ${app.status.toLowerCase().replace('_', ' ')}. Awaiting review and document verification.`,
        entityId: app._id.toString(),
        entityType: 'partner_application',
        link: `/partner-applications/${app._id.toString()}`,
        createdAt:
          app.createdAt instanceof Date
            ? app.createdAt.toISOString()
            : new Date(app.createdAt).toISOString(),
      });
    }

    for (const partner of suspendedPartners) {
      items.push({
        id: `partner-susp-${partner._id.toString()}`,
        category: 'ACCOUNT_SUSPENSION',
        severity: 'CRITICAL',
        title: `Suspended Partner: ${partner.businessName}`,
        description: 'Merchant account is suspended from taking active customer orders.',
        entityId: partner._id.toString(),
        entityType: 'partner',
        link: `/partners/${partner._id.toString()}`,
        createdAt:
          partner.updatedAt instanceof Date
            ? partner.updatedAt.toISOString()
            : new Date(partner.updatedAt).toISOString(),
      });
    }

    for (const cust of pendingCustomers) {
      items.push({
        id: `cust-b2b-${cust._id.toString()}`,
        category: 'B2B_VERIFICATION',
        severity: 'INFO',
        title: `B2B Contractor Verification: ${cust.email || cust.phone}`,
        description:
          'Customer requested B2B commercial contractor status. Awaiting document verification.',
        entityId: cust._id.toString(),
        entityType: 'customer',
        link: `/customers/${cust._id.toString()}`,
        createdAt:
          cust.createdAt instanceof Date
            ? cust.createdAt.toISOString()
            : new Date(cust.createdAt).toISOString(),
      });
    }

    // Sort combined items by createdAt descending
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const boundedItems = items.slice(0, limit);
    const criticalCount = boundedItems.filter((i) => i.severity === 'CRITICAL').length;

    return {
      totalCount: boundedItems.length,
      criticalCount,
      items: boundedItems,
    };
  }

  /**
   * Fetches real operational activity from Customer and Partner audit logs (Requires AUDIT_READ).
   */
  public async getRecentActivity(limit = 10): Promise<IRecentActivityDto> {
    const [partnerLogs, customerLogs] = await Promise.all([
      PartnerAuditLogModel.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .catch(() => []),
      CustomerAuditLogModel.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .catch(() => []),
    ]);

    const activityItems: IRecentActivityItem[] = [];

    for (const log of partnerLogs) {
      activityItems.push({
        id: `partner-log-${log._id.toString()}`,
        domain: 'PARTNER',
        action: log.action,
        actorEmail: log.metadata?.staffEmail,
        actorType: 'STAFF',
        targetId: log.partnerId?.toString(),
        summary: `Partner operational audit: ${log.action.replace(/_/g, ' ').toLowerCase()} — reason: ${log.reason || 'N/A'}`,
        timestamp:
          log.createdAt instanceof Date
            ? log.createdAt.toISOString()
            : new Date(log.createdAt).toISOString(),
      });
    }

    for (const log of customerLogs) {
      activityItems.push({
        id: `customer-log-${log._id.toString()}`,
        domain: 'CUSTOMER',
        action: log.action,
        actorType: 'STAFF',
        targetId: log.targetCustomerId?.toString(),
        summary: `Customer operational audit: ${log.action.replace(/_/g, ' ').toLowerCase()} — reason: ${log.reason || 'N/A'}`,
        timestamp:
          log.createdAt instanceof Date
            ? log.createdAt.toISOString()
            : new Date(log.createdAt).toISOString(),
      });
    }

    // Sort by timestamp descending
    activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const bounded = activityItems.slice(0, limit);

    return {
      totalCount: bounded.length,
      items: bounded,
    };
  }
}

export const adminDashboardService = new AdminDashboardService();
