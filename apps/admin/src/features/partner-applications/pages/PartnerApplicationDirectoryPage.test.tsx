import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  DeliveryMode,
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IPartnerApplicationSummaryDto,
  type IPartnerApplicationListResponseDto,
  type IServiceArea,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { partnerApplicationClient } from '../api/partner-application-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { PartnerApplicationDirectoryPage } from './PartnerApplicationDirectoryPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/partner-application-client.js', () => ({
  partnerApplicationClient: {
    listApplications: vi.fn(),
    getApplicationById: vi.fn(),
    createApplication: vi.fn(),
    submitApplicationForReview: vi.fn(),
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

const staffWithReadAndOnboard: IAuthUser = {
  id: 'staff-onboarder',
  phone: '+919999999999',
  email: 'staff@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['SUPER_ADMIN'],
  permissions: [PermissionCode.PARTNER_READ, PermissionCode.PARTNER_ONBOARD],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staffWithReadOnly: IAuthUser = {
  id: 'staff-reader-only',
  phone: '+918888888888',
  email: 'reader@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['SUPPORT'],
  permissions: [PermissionCode.PARTNER_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staffWithoutPartnerRead: IAuthUser = {
  id: 'staff-catalog-only',
  phone: '+917777777777',
  email: 'catalog@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['CATALOG_OPERATOR'],
  permissions: [PermissionCode.CATALOG_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mockSummaryItem1: IPartnerApplicationSummaryDto = {
  id: 'app-001',
  businessName: 'BuildPro Supplies',
  phone: '+919876543210',
  email: 'contact@buildpro.com',
  status: 'SUBMITTED',
  deliveryMode: DeliveryMode.PARTNER_MANAGED,
  serviceAreaCount: 2,
  assignedStaffUserId: null,
  createdAt: '2026-11-19T08:00:00.000Z',
  updatedAt: '2026-11-19T08:00:00.000Z',
};

const mockSummaryItem2: IPartnerApplicationSummaryDto = {
  id: 'app-002',
  businessName: 'Metro Timber Depot',
  phone: '+919876543211',
  email: 'timber@metro.com',
  status: 'APPROVED',
  deliveryMode: DeliveryMode.PLATFORM_MANAGED,
  serviceAreaCount: 1,
  assignedStaffUserId: null,
  createdAt: '2026-11-18T10:00:00.000Z',
  updatedAt: '2026-11-19T09:00:00.000Z',
};

const mockListResponse: IPartnerApplicationListResponseDto = {
  items: [mockSummaryItem1, mockSummaryItem2],
  pagination: {
    total: 2,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
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
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('PartnerApplicationDirectoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: staffWithReadAndOnboard,
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    vi.mocked(partnerApplicationClient.listApplications).mockResolvedValue(mockListResponse);
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

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={['/partner-applications']}>
        <Routes>
          <Route path="/partner-applications" element={<PartnerApplicationDirectoryPage />} />
          <Route
            path="/partner-applications/:applicationId"
            element={<div data-testid="detail-page">Partner Application Detail Page</div>}
          />
          <Route
            path="/partners/:partnerId"
            element={<div data-testid="partner-page">Operational Partner Page</div>}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  describe('Security and Route Permission Guards', () => {
    it('renders access denied alert when staff lacks PARTNER_READ', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: staffWithoutPartnerRead,
        status: 'signed-in',
        signIn: vi.fn(),
        signOut: vi.fn(),
      });

      renderPage();

      expect(screen.getByRole('alert')).toHaveTextContent('PARTNER_READ permission required');
      expect(partnerApplicationClient.listApplications).not.toHaveBeenCalled();
    });

    it('permits authorized staff with PARTNER_READ to fetch applications directory', async () => {
      renderPage();

      await waitFor(() => {
        expect(partnerApplicationClient.listApplications).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByText('BuildPro Supplies')).toBeInTheDocument();
      expect(screen.getByText('Metro Timber Depot')).toBeInTheDocument();
    });
  });

  describe('Directory Heading and Statistics', () => {
    it('renders page eyebrow, title, description, and total badge count', async () => {
      renderPage();

      expect(screen.getByText('PARTNER ONBOARDING')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { level: 2, name: 'Partner Applications' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Manage candidate partner intake, track compliance review pipelines/i),
      ).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText(/of 2 applications/i)).toBeInTheDocument();
      });
    });
  });

  describe('Table Columns and DTO Rendering', () => {
    it('renders all required columns with formatted data', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('BuildPro Supplies')).toBeInTheDocument();
      });

      // Contact
      expect(screen.getByText('+919876543210')).toBeInTheDocument();
      expect(screen.getByText('contact@buildpro.com')).toBeInTheDocument();
      // Status
      expect(screen.getByText('Submitted')).toBeInTheDocument();
      expect(screen.getByText('Approved')).toBeInTheDocument();
      // Delivery mode
      expect(screen.getByText('Partner Managed')).toBeInTheDocument();
      expect(screen.getByText('Platform Managed')).toBeInTheDocument();
      // Service Areas
      expect(screen.getByText('2 Areas')).toBeInTheDocument();
      expect(screen.getByText('1 Area')).toBeInTheDocument();
    });

    it('navigates to detail page when clicking an application view button', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('BuildPro Supplies')).toBeInTheDocument();
      });

      const viewButton = screen.getByRole('button', {
        name: /view details for buildpro supplies/i,
      });
      fireEvent.click(viewButton);

      expect(screen.getByTestId('detail-page')).toBeInTheDocument();
    });
  });

  describe('Filtering and Search', () => {
    it('triggers search API query on search input submission', async () => {
      renderPage();

      await waitFor(() => {
        expect(partnerApplicationClient.listApplications).toHaveBeenCalledWith(
          expect.objectContaining({ page: 1, limit: 20 }),
          expect.any(Object),
        );
      });

      const searchInput = screen.getByPlaceholderText(/search by business name, phone, email/i);
      fireEvent.change(searchInput, { target: { value: 'BuildPro' } });
      fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(partnerApplicationClient.listApplications).toHaveBeenCalledWith(
          expect.objectContaining({ search: 'BuildPro', page: 1 }),
          expect.any(Object),
        );
      });
    });

    it('triggers reset filters restoring initial state', async () => {
      renderPage();

      await waitFor(() => {
        expect(partnerApplicationClient.listApplications).toHaveBeenCalled();
      });

      const searchInput = screen.getByPlaceholderText(/search by business name, phone, email/i);
      fireEvent.change(searchInput, { target: { value: 'BuildPro' } });
      fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
      });

      const clearButton = screen.getByRole('button', { name: /clear filters/i });
      fireEvent.click(clearButton);

      await waitFor(() => {
        expect(partnerApplicationClient.listApplications).toHaveBeenCalledWith(
          expect.objectContaining({ page: 1, limit: 20 }),
          expect.any(Object),
        );
      });
    });
  });

  describe('Intake Drawer (New Application)', () => {
    it('shows New Application button when user has PARTNER_ONBOARD permission', () => {
      renderPage();

      expect(screen.getByRole('button', { name: /new application/i })).toBeInTheDocument();
    });

    it('hides New Application button when user lacks PARTNER_ONBOARD permission', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: staffWithReadOnly,
        status: 'signed-in',
        signIn: vi.fn(),
        signOut: vi.fn(),
      });

      renderPage();

      expect(screen.queryByRole('button', { name: /new application/i })).not.toBeInTheDocument();
    });

    it('opens intake drawer when clicking New Application button', async () => {
      renderPage();

      const newButton = screen.getByRole('button', { name: /new application/i });
      fireEvent.click(newButton);

      await waitFor(() => {
        expect(screen.getByText(/new partner application/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/trade \/ business name/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error and Empty States', () => {
    it('displays error message when listing API fails and allows retry', async () => {
      vi.mocked(partnerApplicationClient.listApplications)
        .mockRejectedValueOnce(new ApiError('Database unavailable', 500, 'INTERNAL_SERVER_ERROR'))
        .mockResolvedValueOnce(mockListResponse);

      renderPage();

      await waitFor(() => {
        expect(screen.getByText(/database unavailable/i)).toBeInTheDocument();
      });

      const retryButton = screen.getByRole('button', { name: /try again/i });
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(screen.getByText('BuildPro Supplies')).toBeInTheDocument();
      });
    });
  });
});
