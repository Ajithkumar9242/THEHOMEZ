import { z } from 'zod';
import type { MoneyPaise } from '../common/money.js';

/**
 * Permitted date range filter keys for Admin Dashboard metrics.
 */
export const DASHBOARD_DATE_RANGES = ['today', '7d', '30d', '90d', 'custom'] as const;
export type DashboardDateRange = (typeof DASHBOARD_DATE_RANGES)[number];

export const dashboardDateRangeSchema = z.enum(DASHBOARD_DATE_RANGES);

/**
 * Standard KPI metric contract satisfying SRS Section 14.5 and FR-REP-005.
 * Every KPI explicitly documents its accounting definition, tax/freight treatment,
 * source of truth, and whether the domain is live or pending stakeholder definition.
 */
export interface IKpiMetric<T = number> {
  value: T;
  label: string;
  isAvailable: boolean;
  status: 'active' | 'pending_definition' | 'deferred';
  definitionNote: string;
  grossOrNet: 'GROSS' | 'NET' | 'NOT_APPLICABLE';
  taxTreatment: 'GST_EXCLUSIVE' | 'GST_INCLUSIVE' | 'NOT_APPLICABLE' | 'PENDING_DECISION';
  deliveryFeeTreatment: 'INCLUDED' | 'EXCLUDED' | 'NOT_APPLICABLE' | 'PENDING_DECISION';
  timestampBasis: 'CREATED_AT' | 'UPDATED_AT' | 'COMPLETED_AT';
  sourceOfTruth: string;
  previousPeriodValue: T | null;
  changePercentage: number | null;
}

/**
 * Top-level dashboard summary payload containing role-authorized domain cards.
 */
export interface IAdminDashboardSummaryDto {
  timestamp: string;
  dateRange: DashboardDateRange;
  startDate: string;
  endDate: string;
  orders: {
    totalOrders: IKpiMetric<number>;
    pendingActionOrders: IKpiMetric<number>;
    completedOrders: IKpiMetric<number>;
  };
  sales: {
    grossSalesPaise: IKpiMetric<MoneyPaise>;
    netSalesPaise: IKpiMetric<MoneyPaise>;
  };
  payments: {
    successfulPayments: IKpiMetric<number>;
    pendingPaymentExceptions: IKpiMetric<number>;
  };
  fulfilment: {
    activePartners: IKpiMetric<number>;
    fulfilmentRate: IKpiMetric<number>;
  };
  settlements: {
    outstandingSettlementPaise: IKpiMetric<MoneyPaise>;
    pendingApprovals: IKpiMetric<number>;
  };
  catalog: {
    totalProducts: IKpiMetric<number>;
    publishedProducts: IKpiMetric<number>;
    activeServiceAreas: IKpiMetric<number>;
  };
  customers: {
    totalCustomers: IKpiMetric<number>;
    pendingB2bVerifications: IKpiMetric<number>;
  };
}

/**
 * Operational exception item for actionable operator intervention.
 */
export interface IOperationalExceptionItem {
  id: string;
  category:
    | 'PARTNER_VERIFICATION'
    | 'B2B_VERIFICATION'
    | 'ACCOUNT_SUSPENSION'
    | 'FULFILMENT_DELAY'
    | 'PAYMENT_EXCEPTION';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  description: string;
  entityId: string;
  entityType: 'partner' | 'partner_application' | 'customer' | 'order' | 'payment';
  link: string;
  createdAt: string;
}

export interface IOperationalExceptionsDto {
  totalCount: number;
  criticalCount: number;
  items: IOperationalExceptionItem[];
}

/**
 * Partner domain operational overview metrics.
 */
export interface IPartnerOverviewDto {
  activePartnersCount: number;
  pendingVerificationCount: number;
  suspendedPartnersCount: number;
  totalApplicationsCount: number;
  applicationsUnderReviewCount: number;
  statusBreakdown: Array<{ status: string; count: number }>;
  deliveryModeBreakdown: Array<{ mode: string; count: number }>;
}

/**
 * Real operational audit log item for recent activity feed.
 */
export interface IRecentActivityItem {
  id: string;
  domain: 'PARTNER' | 'CUSTOMER' | 'SYSTEM';
  action: string;
  actorEmail?: string;
  actorType: string;
  targetId?: string;
  summary: string;
  timestamp: string;
}

export interface IRecentActivityDto {
  totalCount: number;
  items: IRecentActivityItem[];
}
