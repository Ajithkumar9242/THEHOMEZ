import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardOverviewPage } from './DashboardOverviewPage.js';
import { dashboardClient } from '../api/dashboard-client.js';
import * as AuthContext from '../../../providers/AuthProvider.js';
import {
  UserType,
  UserStatus,
  PermissionCode,
  type IAdminDashboardSummaryDto,
} from '@thehomez/shared-types';

describe('DashboardOverviewPage Integration & Component Verification', () => {
  const mockUser = {
    id: 'staff-user-123',
    phone: '+919988001122',
    email: 'admin@thehomez.in',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['SUPER_ADMIN'],
    permissions: Object.values(PermissionCode),
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  const mockSummary: IAdminDashboardSummaryDto = {
    timestamp: '2026-11-24T00:00:00.000Z',
    dateRange: '30d',
    startDate: '2026-10-25T00:00:00.000Z',
    endDate: '2026-11-24T00:00:00.000Z',
    orders: {
      totalOrders: {
        value: 0,
        label: 'Total Orders',
        isAvailable: true,
        status: 'pending_definition',
        definitionNote: 'Pending Milestone 5B.5 order placement approval.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'PENDING_DECISION',
        deliveryFeeTreatment: 'PENDING_DECISION',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'OrderModel',
        previousPeriodValue: null,
        changePercentage: null,
      },
      pendingActionOrders: {
        value: 0,
        label: 'Orders Awaiting Action',
        isAvailable: true,
        status: 'pending_definition',
        definitionNote: 'Orders requiring allocation.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'PENDING_DECISION',
        deliveryFeeTreatment: 'PENDING_DECISION',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'OrderModel',
        previousPeriodValue: null,
        changePercentage: null,
      },
      completedOrders: {
        value: 0,
        label: 'Completed Orders',
        isAvailable: true,
        status: 'pending_definition',
        definitionNote: 'Terminal fulfilled orders.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'PENDING_DECISION',
        deliveryFeeTreatment: 'PENDING_DECISION',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'OrderModel',
        previousPeriodValue: null,
        changePercentage: null,
      },
    },
    sales: {
      grossSalesPaise: {
        value: 0,
        label: 'Gross Sales (GOV)',
        isAvailable: true,
        status: 'pending_definition',
        definitionNote: 'Gross Order Value pending Phase 4 definition.',
        grossOrNet: 'GROSS',
        taxTreatment: 'PENDING_DECISION',
        deliveryFeeTreatment: 'PENDING_DECISION',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'FinanceLedger',
        previousPeriodValue: null,
        changePercentage: null,
      },
      netSalesPaise: {
        value: 0,
        label: 'Net Sales',
        isAvailable: true,
        status: 'pending_definition',
        definitionNote: 'Net sales excluding GST.',
        grossOrNet: 'NET',
        taxTreatment: 'GST_EXCLUSIVE',
        deliveryFeeTreatment: 'EXCLUDED',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'FinanceLedger',
        previousPeriodValue: null,
        changePercentage: null,
      },
    },
    payments: {
      successfulPayments: {
        value: 0,
        label: 'Successful Payments',
        isAvailable: true,
        status: 'deferred',
        definitionNote: 'Payment execution gateway deferred to Phase 4.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'PaymentTransaction',
        previousPeriodValue: null,
        changePercentage: null,
      },
      pendingPaymentExceptions: {
        value: 0,
        label: 'Payment Exceptions',
        isAvailable: true,
        status: 'deferred',
        definitionNote: 'Exceptions queue deferred to Phase 4.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'PaymentTransaction',
        previousPeriodValue: null,
        changePercentage: null,
      },
    },
    fulfilment: {
      activePartners: {
        value: 28,
        label: 'Active Partners',
        isAvailable: true,
        status: 'active',
        definitionNote: 'Active verified merchants and yards.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'PartnerModel',
        previousPeriodValue: 25,
        changePercentage: 12,
      },
      fulfilmentRate: {
        value: 0,
        label: 'Fulfilment Rate',
        isAvailable: true,
        status: 'pending_definition',
        definitionNote: 'Vendor delivery SLA rate.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'FulfilmentUnit',
        previousPeriodValue: null,
        changePercentage: null,
      },
    },
    settlements: {
      outstandingSettlementPaise: {
        value: 0,
        label: 'Outstanding Settlements',
        isAvailable: true,
        status: 'deferred',
        definitionNote: 'Payout release ledger deferred to Phase 4.',
        grossOrNet: 'NET',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'SettlementBatch',
        previousPeriodValue: null,
        changePercentage: null,
      },
      pendingApprovals: {
        value: 0,
        label: 'Pending Payout Approvals',
        isAvailable: true,
        status: 'deferred',
        definitionNote: 'Approvals deferred to Phase 4.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'SettlementBatch',
        previousPeriodValue: null,
        changePercentage: null,
      },
    },
    catalog: {
      totalProducts: {
        value: 142,
        label: 'Total Products',
        isAvailable: true,
        status: 'active',
        definitionNote: 'Catalog master products.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'ProductModel',
        previousPeriodValue: null,
        changePercentage: null,
      },
      publishedProducts: {
        value: 120,
        label: 'Published Products',
        isAvailable: true,
        status: 'active',
        definitionNote: 'Active products on storefront.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'ProductModel',
        previousPeriodValue: null,
        changePercentage: null,
      },
      activeServiceAreas: {
        value: 8,
        label: 'Active Service Areas',
        isAvailable: true,
        status: 'active',
        definitionNote: 'Operational delivery clusters.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'ServiceAreaModel',
        previousPeriodValue: null,
        changePercentage: null,
      },
    },
    customers: {
      totalCustomers: {
        value: 350,
        label: 'Registered Customers',
        isAvailable: true,
        status: 'active',
        definitionNote: 'Total registered customers.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'UserModel',
        previousPeriodValue: null,
        changePercentage: null,
      },
      pendingB2bVerifications: {
        value: 4,
        label: 'Pending B2B Verifications',
        isAvailable: true,
        status: 'active',
        definitionNote: 'Contractor accounts awaiting review.',
        grossOrNet: 'NOT_APPLICABLE',
        taxTreatment: 'NOT_APPLICABLE',
        deliveryFeeTreatment: 'NOT_APPLICABLE',
        timestampBasis: 'CREATED_AT',
        sourceOfTruth: 'UserModel',
        previousPeriodValue: null,
        changePercentage: null,
      },
    },
  };

  const mockPartnerOverview = {
    activePartnersCount: 28,
    pendingVerificationCount: 3,
    suspendedPartnersCount: 1,
    totalApplicationsCount: 5,
    applicationsUnderReviewCount: 2,
    statusBreakdown: [
      { status: 'ACTIVE', count: 28 },
      { status: 'PENDING_VERIFICATION', count: 3 },
      { status: 'SUSPENDED', count: 1 },
    ],
    deliveryModeBreakdown: [
      { mode: 'DIRECT_SHIP', count: 18 },
      { mode: 'PLATFORM_FLEET', count: 10 },
    ],
  };

  const mockExceptions = {
    totalCount: 1,
    criticalCount: 0,
    items: [
      {
        id: 'app-1',
        category: 'PARTNER_VERIFICATION' as const,
        severity: 'WARNING' as const,
        title: 'Partner Application: Apex Materials Ltd',
        description: 'Application is under review.',
        entityId: 'app-apex-123',
        entityType: 'partner_application' as const,
        link: '/partner-applications/app-apex-123',
        createdAt: '2026-11-20T10:00:00.000Z',
      },
    ],
  };

  const mockRecentActivity = {
    totalCount: 1,
    items: [
      {
        id: 'log-1',
        domain: 'PARTNER' as const,
        action: 'PARTNER_STATUS_CHANGED',
        actorEmail: 'admin@thehomez.in',
        actorType: 'STAFF',
        targetId: 'partner-1',
        summary: 'Partner status changed to ACTIVE',
        timestamp: '2026-11-24T05:00:00.000Z',
      },
    ],
  };

  beforeEach(() => {
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      user: mockUser as any,
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(dashboardClient, 'getSummary').mockResolvedValue(mockSummary);
    vi.spyOn(dashboardClient, 'getPartnerOverview').mockResolvedValue(mockPartnerOverview);
    vi.spyOn(dashboardClient, 'getOperationalExceptions').mockResolvedValue(mockExceptions);
    vi.spyOn(dashboardClient, 'getRecentActivity').mockResolvedValue(mockRecentActivity);

    // Mock window.matchMedia for Ant Design Grid/responsive hooks
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders dashboard header and role badge accurately', async () => {
    render(
      <MemoryRouter>
        <DashboardOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('Operational Dashboard')).toBeInTheDocument();
    expect(screen.getByText('SUPER_ADMIN')).toBeInTheDocument();
  });

  it('renders all summary KPI cards with live backend data and status tags', async () => {
    render(
      <MemoryRouter>
        <DashboardOverviewPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      // Live cards
      expect(screen.getAllByText('Active Partners').length).toBeGreaterThan(0);
      expect(screen.getAllByText('28').length).toBeGreaterThan(0);
      expect(screen.getByText('+12%')).toBeInTheDocument();

      expect(screen.getByText('Total Products')).toBeInTheDocument();
      expect(screen.getByText('142')).toBeInTheDocument();

      expect(screen.getByText('Registered Customers')).toBeInTheDocument();
      expect(screen.getByText('350')).toBeInTheDocument();

      expect(screen.getByText('Pending B2B Verifications')).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();

      // Pending definition cards
      expect(screen.getByText('Total Orders')).toBeInTheDocument();
      expect(screen.getByText('Gross Sales (GOV)')).toBeInTheDocument();
      expect(screen.getAllByText('TBD').length).toBeGreaterThan(0);

      // Deferred Phase 4 cards
      expect(screen.getByText('Successful Payments')).toBeInTheDocument();
      expect(screen.getByText('Outstanding Settlements')).toBeInTheDocument();
      expect(screen.getAllByText('Deferred').length).toBeGreaterThan(0);
    });
  });

  it('renders operational exceptions and enables inspection link navigation', async () => {
    render(
      <MemoryRouter>
        <DashboardOverviewPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Partner Application: Apex Materials Ltd')).toBeInTheDocument();
      expect(screen.getByText('Inspect')).toBeInTheDocument();
    });
  });

  it('handles independent widget errors gracefully without crashing the whole dashboard', async () => {
    vi.spyOn(dashboardClient, 'getPartnerOverview').mockRejectedValue(
      new Error('Partner service unreachable'),
    );

    render(
      <MemoryRouter>
        <DashboardOverviewPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      // Partner widget displays localized error
      expect(screen.getByText('Failed to load partner overview')).toBeInTheDocument();
      // Other widgets render successfully
      expect(screen.getByText('Active Partners')).toBeInTheDocument();
      expect(screen.getByText('Commerce & Order Pipeline Architecture')).toBeInTheDocument();
    });
  });

  it('triggers data reload when dateRange filter is changed', async () => {
    const summarySpy = vi.spyOn(dashboardClient, 'getSummary');

    render(
      <MemoryRouter>
        <DashboardOverviewPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('7 Days')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('7 Days'));

    await waitFor(() => {
      expect(summarySpy).toHaveBeenCalledWith({ dateRange: '7d' }, expect.any(AbortSignal));
    });
  });
});
