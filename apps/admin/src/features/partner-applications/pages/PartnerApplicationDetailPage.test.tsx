import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  DeliveryMode,
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IPartnerApplicationDto,
  type IServiceArea,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { partnerApplicationClient } from '../api/partner-application-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { PartnerApplicationDetailPage } from './PartnerApplicationDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/partner-application-client.js', () => ({
  partnerApplicationClient: {
    listApplications: vi.fn(),
    getApplicationById: vi.fn(),
    createApplication: vi.fn(),
    reviewApplication: vi.fn(),
    rejectApplication: vi.fn(),
    withdrawApplication: vi.fn(),
    approveApplication: vi.fn(),
  },
}));
vi.mock('../../service-areas/api/service-area-client.js', () => ({
  serviceAreaClient: {
    list: vi.fn(),
  },
}));

const staffWithAllPermissions: IAuthUser = {
  id: 'staff-admin',
  phone: '+919999999999',
  email: 'admin@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['SUPER_ADMIN'],
  permissions: [
    PermissionCode.PARTNER_READ,
    PermissionCode.PARTNER_ONBOARD,
    PermissionCode.PARTNER_VERIFY,
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staffWithReadOnly: IAuthUser = {
  id: 'staff-reader',
  phone: '+918888888888',
  email: 'reader@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['SUPPORT'],
  permissions: [PermissionCode.PARTNER_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staffWithoutPartnerRead: IAuthUser = {
  id: 'staff-no-access',
  phone: '+917777777777',
  email: 'noaccess@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['OPERATOR'],
  permissions: [PermissionCode.CATALOG_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mockServiceAreas: IServiceArea[] = [
  {
    id: 'sa-blr-1',
    code: 'SA-BLR-1',
    name: 'Bengaluru East',
    city: 'Bengaluru',
    state: 'Karnataka',
    countryCode: 'IND',
    pincodes: ['560037'],
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'sa-mum-1',
    code: 'SA-MUM-1',
    name: 'Mumbai South',
    city: 'Mumbai',
    state: 'Maharashtra',
    countryCode: 'IND',
    pincodes: ['400001'],
    isActive: false, // inactive service area
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const mockSubmittedDetail: IPartnerApplicationDto = {
  id: 'app-100',
  businessName: 'Coastal Builders Mart',
  legalName: 'Coastal Builders Mart LLP',
  phone: '+919876543200',
  email: 'info@coastalbuilders.in',
  status: 'SUBMITTED',
  deliveryMode: DeliveryMode.PARTNER_MANAGED,
  serviceAreaIds: ['sa-blr-1'],
  initialUser: {
    contactName: 'Ramesh Shenoy',
    email: 'ramesh@coastalbuilders.in',
    phone: '+919876543201',
  },
  metadata: {
    source: 'web_portal',
    gstin: 'GSTIN29AAAAA0000A1Z5',
    tradeLicense: 'LLP-12345',
  },
  refusalReasonCode: null,
  rejectionReason: null,
  previousApplicationId: null,
  assignedStaffUserId: null,
  partnerId: null,
  auditHistory: [
    {
      action: 'APPLICATION_CREATED',
      previousStatus: undefined,
      newStatus: 'SUBMITTED',
      performedBy: 'user-1',
      reason: 'Self-serve application intake',
      timestamp: '2026-11-19T06:00:00.000Z',
    },
  ],
  createdAt: '2026-11-19T06:00:00.000Z',
  updatedAt: '2026-11-19T06:00:00.000Z',
};

const mockUnderReviewDetail: IPartnerApplicationDto = {
  ...mockSubmittedDetail,
  id: 'app-101',
  status: 'UNDER_REVIEW',
  auditHistory: [
    ...mockSubmittedDetail.auditHistory,
    {
      action: 'APPLICATION_STATUS_CHANGED',
      previousStatus: 'SUBMITTED',
      newStatus: 'UNDER_REVIEW',
      performedBy: 'staff-admin',
      reason: 'Commenced compliance verification',
      timestamp: '2026-11-19T07:00:00.000Z',
    },
  ],
};

const mockApprovedDetail: IPartnerApplicationDto = {
  ...mockUnderReviewDetail,
  id: 'app-102',
  status: 'APPROVED',
  partnerId: 'partner-888',
  auditHistory: [
    ...mockUnderReviewDetail.auditHistory,
    {
      action: 'APPLICATION_STATUS_CHANGED',
      previousStatus: 'UNDER_REVIEW',
      newStatus: 'APPROVED',
      performedBy: 'staff-admin',
      reason: 'All compliance checks satisfied and business authenticated',
      timestamp: '2026-11-19T08:00:00.000Z',
    },
  ],
};

describe('PartnerApplicationDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: staffWithAllPermissions,
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    vi.mocked(partnerApplicationClient.getApplicationById).mockResolvedValue(mockSubmittedDetail);
    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: mockServiceAreas,
      total: 2,
      page: 1,
      limit: 100,
      totalPages: 1,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderPage(applicationId = 'app-100') {
    return render(
      <MemoryRouter initialEntries={[`/partner-applications/${applicationId}`]}>
        <Routes>
          <Route
            path="/partner-applications/:applicationId"
            element={<PartnerApplicationDetailPage />}
          />
          <Route
            path="/partner-applications"
            element={<div data-testid="directory-page">Directory Page</div>}
          />
          <Route
            path="/partners/:partnerId"
            element={<div data-testid="partner-page">Operational Partner Page</div>}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  describe('Security and Permission Guards', () => {
    it('renders access denied alert when staff lacks PARTNER_READ', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: staffWithoutPartnerRead,
        status: 'signed-in',
        signIn: vi.fn(),
        signOut: vi.fn(),
      });

      renderPage();

      expect(screen.getByRole('alert')).toHaveTextContent('PARTNER_READ permission required');
      expect(partnerApplicationClient.getApplicationById).not.toHaveBeenCalled();
    });

    it('hides transition action buttons when staff has PARTNER_READ but lacks PARTNER_ONBOARD', async () => {
      vi.mocked(useAuth).mockReturnValue({
        user: staffWithReadOnly,
        status: 'signed-in',
        signIn: vi.fn(),
        signOut: vi.fn(),
      });

      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 3, name: 'Coastal Builders Mart' }),
        ).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /start review/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reject application/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /approve partner/i })).not.toBeInTheDocument();
    });
  });

  describe('Data Rendering and Tab Navigation', () => {
    it('renders application header, business details, primary contact and service areas', async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 3, name: 'Coastal Builders Mart' }),
        ).toBeInTheDocument();
      });

      expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0);
      expect(screen.getByText('Coastal Builders Mart LLP')).toBeInTheDocument();
      expect(screen.getByText('+919876543200')).toBeInTheDocument();
      expect(screen.getByText('info@coastalbuilders.in')).toBeInTheDocument();
      expect(screen.getByText('Ramesh Shenoy')).toBeInTheDocument();
      expect(screen.getByText('ramesh@coastalbuilders.in')).toBeInTheDocument();
      expect(screen.getByText('GSTIN29AAAAA0000A1Z5')).toBeInTheDocument();
      expect(screen.getByText('SA-BLR-1')).toBeInTheDocument();
    });

    it('renders audit history table correctly', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('APPLICATION_CREATED')).toBeInTheDocument();
        expect(screen.getByText(/self-serve application intake/i)).toBeInTheDocument();
      });
    });
  });

  describe('Lifecycle Action Flows', () => {
    it('allows transitioning from SUBMITTED to UNDER_REVIEW via Start Review modal', async () => {
      vi.mocked(partnerApplicationClient.reviewApplication).mockResolvedValue(mockUnderReviewDetail);

      renderPage('app-100');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /start review/i })).toBeInTheDocument();
      });

      const startReviewBtn = screen.getByRole('button', { name: /start review/i });
      fireEvent.click(startReviewBtn);

      await waitFor(() => {
        expect(screen.getByText(/move application to review/i)).toBeInTheDocument();
      });

      const confirmBtn = screen.getByRole('button', { name: /confirm review/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(partnerApplicationClient.reviewApplication).toHaveBeenCalledWith('app-100');
      });
    }, 40000);

    it('allows rejecting an application with refusal code and detailed reason', async () => {
      vi.mocked(partnerApplicationClient.rejectApplication).mockResolvedValue({
        ...mockSubmittedDetail,
        status: 'REJECTED',
        refusalReasonCode: 'INCOMPLETE_DOCUMENTATION',
        rejectionReason: 'Missing trade license documents and tax compliance certificate',
      });

      renderPage('app-100');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /reject application/i })).toBeInTheDocument();
      });

      const rejectBtn = screen.getByRole('button', { name: /reject application/i });
      fireEvent.click(rejectBtn);

      await waitFor(() => {
        expect(screen.getByText('Reject Partner Application')).toBeInTheDocument();
      });

      // Type operator refusal code
      const codeInput = screen.getByLabelText(/refusal reason code/i);
      fireEvent.change(codeInput, {
        target: { value: 'INCOMPLETE_DOCUMENTATION' },
      });

      // Type reason narrative
      const reasonInput = screen.getByLabelText(/rejection reason narrative/i);
      fireEvent.change(reasonInput, {
        target: { value: 'Missing trade license documents and tax compliance certificate' },
      });

      const confirmRejectBtn = screen.getByRole('button', { name: /confirm rejection/i });
      fireEvent.click(confirmRejectBtn);

      await waitFor(() => {
        expect(partnerApplicationClient.rejectApplication).toHaveBeenCalledWith(
          'app-100',
          expect.objectContaining({
            refusalReasonCode: 'INCOMPLETE_DOCUMENTATION',
            reason: 'Missing trade license documents and tax compliance certificate',
          }),
        );
      });
    }, 40000);

    it('enforces all 3 affirmative checklist items before approving an application', async () => {
      vi.mocked(partnerApplicationClient.getApplicationById).mockResolvedValue(mockUnderReviewDetail);
      vi.mocked(partnerApplicationClient.approveApplication).mockResolvedValue({
        application: mockApprovedDetail,
        partner: {
          id: 'partner-888',
          businessName: 'Coastal Builders Mart',
          legalName: 'Coastal Builders Mart LLP',
          phone: '+919876543200',
          email: 'info@coastalbuilders.in',
          status: 'ACTIVE',
          deliveryMode: 'PARTNER_MANAGED',
          serviceAreas: [],
          linkedUserCount: 1,
          metadata: {},
          createdAt: '2026-11-19T08:00:00.000Z',
          updatedAt: '2026-11-19T08:00:00.000Z',
        },
      });

      renderPage('app-101');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve & activate partner/i })).toBeInTheDocument();
      });

      const approveBtn = screen.getByRole('button', { name: /approve & activate partner/i });
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByText(/transactional approval gate/i)).toBeInTheDocument();
      });

      // Fill reason
      const reasonInput = screen.getByLabelText(/approval.*reason narrative/i);
      fireEvent.change(reasonInput, {
        target: { value: 'Legal KYC and service area confirmation passed' },
      });

      // Check all 3 checklist boxes
      const identityCheckbox = screen.getByLabelText(/identity verified/i);
      const serviceAreaCheckbox = screen.getByLabelText(/service area confirmed/i);
      const complianceCheckbox = screen.getByLabelText(/compliance confirmed/i);

      fireEvent.click(identityCheckbox);
      fireEvent.click(serviceAreaCheckbox);
      fireEvent.click(complianceCheckbox);

      const modalApproveBtns = screen.getAllByRole('button', { name: /approve & activate partner/i });
      fireEvent.click(modalApproveBtns[1]!);

      await waitFor(() => {
        expect(partnerApplicationClient.approveApplication).toHaveBeenCalledWith(
          'app-101',
          expect.objectContaining({
            reason: 'Legal KYC and service area confirmation passed',
            checklist: {
              identityVerified: true,
              serviceAreaConfirmed: true,
              complianceConfirmed: true,
            },
          }),
        );
      });
    }, 40000);

    it('displays operational partner link when application is already approved', async () => {
      vi.mocked(partnerApplicationClient.getApplicationById).mockResolvedValue(mockApprovedDetail);

      renderPage('app-102');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /view operational partner/i })).toBeInTheDocument();
      });

      const partnerBtn = screen.getByRole('button', { name: /view operational partner/i });
      fireEvent.click(partnerBtn);

      expect(screen.getByTestId('partner-page')).toBeInTheDocument();
    }, 40000);
  });

  describe('Approval Transaction Safety & Ambiguous Outcome Handling', () => {
    it('displays ambiguous outcome warning, disables resubmission, and prevents auto-retry on NETWORK_ERROR', async () => {
      vi.mocked(partnerApplicationClient.getApplicationById).mockResolvedValue(mockUnderReviewDetail);
      vi.mocked(partnerApplicationClient.approveApplication).mockRejectedValue(
        new ApiError('Unable to reach the API. Check that the backend is running.', 0, 'NETWORK_ERROR'),
      );

      renderPage('app-101');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve & activate partner/i })).toBeInTheDocument();
      });

      const approveBtn = screen.getByRole('button', { name: /approve & activate partner/i });
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByText(/transactional approval gate/i)).toBeInTheDocument();
      });

      const reasonInput = screen.getByLabelText(/approval.*reason narrative/i);
      fireEvent.change(reasonInput, {
        target: { value: 'Affirmative compliance verified for vendor' },
      });

      fireEvent.click(screen.getByLabelText(/identity verified/i));
      fireEvent.click(screen.getByLabelText(/service area confirmed/i));
      fireEvent.click(screen.getByLabelText(/compliance confirmed/i));

      const modalApproveBtns = screen.getAllByRole('button', { name: /approve & activate partner/i });
      const submitBtn = modalApproveBtns[1]!;
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText('Ambiguous Transaction Result')).toBeInTheDocument();
      });

      // Verify explicit caution instructing operator not to immediately resubmit
      expect(
        screen.getByText(/the transaction commit result is ambiguous\. do not resubmit immediately/i),
      ).toBeInTheDocument();

      // Verify the approval submit button is disabled to prevent duplicate resubmission
      expect(submitBtn).toBeDisabled();

      // Verify no automatic repeated approval attempt
      expect(partnerApplicationClient.approveApplication).toHaveBeenCalledTimes(1);
    }, 40000);

    it('prevents duplicate submission while an approval request is in flight', async () => {
      vi.mocked(partnerApplicationClient.getApplicationById).mockResolvedValue(mockUnderReviewDetail);

      let resolveApproval: (val: any) => void;
      const pendingApprovalPromise = new Promise((resolve) => {
        resolveApproval = resolve;
      });
      vi.mocked(partnerApplicationClient.approveApplication).mockReturnValue(pendingApprovalPromise as any);

      renderPage('app-101');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve & activate partner/i })).toBeInTheDocument();
      });

      const approveBtn = screen.getByRole('button', { name: /approve & activate partner/i });
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByText(/transactional approval gate/i)).toBeInTheDocument();
      });

      const reasonInput = screen.getByLabelText(/approval.*reason narrative/i);
      fireEvent.change(reasonInput, {
        target: { value: 'Affirmative compliance verified for vendor' },
      });

      fireEvent.click(screen.getByLabelText(/identity verified/i));
      fireEvent.click(screen.getByLabelText(/service area confirmed/i));
      fireEvent.click(screen.getByLabelText(/compliance confirmed/i));

      const modalApproveBtns = screen.getAllByRole('button', { name: /approve & activate partner/i });
      const submitBtn = modalApproveBtns[1]!;

      // First submit click
      fireEvent.click(submitBtn);

      // Verify request initiated
      await waitFor(() => {
        expect(partnerApplicationClient.approveApplication).toHaveBeenCalledTimes(1);
      });

      // Verify button is disabled while in-flight
      expect(submitBtn).toBeDisabled();

      // Attempt second click while still in-flight
      fireEvent.click(submitBtn);

      // Verify duplicate submission was prevented
      expect(partnerApplicationClient.approveApplication).toHaveBeenCalledTimes(1);

      // Resolve pending promise cleanly
      resolveApproval!({
        application: mockApprovedDetail,
        partner: {
          id: 'partner-888',
          businessName: 'Coastal Builders Mart',
          legalName: 'Coastal Builders Mart LLP',
          phone: '+919876543200',
          email: 'info@coastalbuilders.in',
          status: 'ACTIVE',
          deliveryMode: 'PARTNER_MANAGED',
          serviceAreas: [],
          linkedUserCount: 1,
          metadata: {},
          createdAt: '2026-11-19T08:00:00.000Z',
          updatedAt: '2026-11-19T08:00:00.000Z',
        },
      });

      await waitFor(() => {
        expect(screen.getByText('Partner Application Approved Successfully')).toBeInTheDocument();
      });
    }, 40000);

    it('distinguishes ordinary domain errors from ambiguous outcome and preserves specific error handling', async () => {
      vi.mocked(partnerApplicationClient.getApplicationById).mockResolvedValue(mockUnderReviewDetail);
      vi.mocked(partnerApplicationClient.approveApplication).mockRejectedValue(
        new ApiError(
          'One or more assigned service areas are currently inactive or missing.',
          400,
          'NO_ACTIVE_SERVICE_AREA',
        ),
      );

      renderPage('app-101');

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /approve & activate partner/i })).toBeInTheDocument();
      });

      const approveBtn = screen.getByRole('button', { name: /approve & activate partner/i });
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByText(/transactional approval gate/i)).toBeInTheDocument();
      });

      const reasonInput = screen.getByLabelText(/approval.*reason narrative/i);
      fireEvent.change(reasonInput, {
        target: { value: 'Affirmative compliance verified for vendor' },
      });

      fireEvent.click(screen.getByLabelText(/identity verified/i));
      fireEvent.click(screen.getByLabelText(/service area confirmed/i));
      fireEvent.click(screen.getByLabelText(/compliance confirmed/i));

      const modalApproveBtns = screen.getAllByRole('button', { name: /approve & activate partner/i });
      fireEvent.click(modalApproveBtns[1]!);

      await waitFor(() => {
        expect(screen.getByText('Approval Failed')).toBeInTheDocument();
      });

      // Verify specific error text is displayed
      expect(
        screen.getByText(/one or more assigned service areas are currently inactive or missing/i),
      ).toBeInTheDocument();

      // Verify ambiguous outcome banner is NOT displayed
      expect(screen.queryByText('Ambiguous Transaction Result')).not.toBeInTheDocument();
      expect(screen.queryByText(/the transaction commit result is ambiguous/i)).not.toBeInTheDocument();
    }, 40000);
  });
});
