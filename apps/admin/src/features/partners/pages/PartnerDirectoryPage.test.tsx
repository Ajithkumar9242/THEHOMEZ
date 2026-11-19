import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IAdminPartnerListResponseDto,
  type IPartnerAdminSummaryDto,
  type IServiceArea,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { partnerClient } from '../api/partner-client.js';
import { serviceAreaClient } from '../../service-areas/api/service-area-client.js';
import { PartnerDirectoryPage } from './PartnerDirectoryPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/partner-client.js', () => ({
  partnerClient: {
    listPartners: vi.fn(),
    getPartnerById: vi.fn(),
    updatePartnerStatus: vi.fn(),
    getPartnerAuditLogs: vi.fn(),
  },
}));
vi.mock('../../service-areas/api/service-area-client.js', () => ({
  serviceAreaClient: {
    list: vi.fn(),
  },
}));

const staffWithPartnerRead: IAuthUser = {
  id: 'staff-partner-reader',
  phone: '+919999999999',
  email: 'staff@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['SUPER_ADMIN'],
  permissions: [PermissionCode.PARTNER_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staffWithoutPartnerRead: IAuthUser = {
  id: 'staff-catalog-only',
  phone: '+918888888888',
  email: 'catalog-staff@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['CATALOG_OPERATOR'],
  permissions: [PermissionCode.CATALOG_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mockPartnerItem1: IPartnerAdminSummaryDto = {
  id: '507f1f77bcf86cd799439011',
  businessName: 'Apex Building Solutions',
  legalName: 'Apex Infra Materials Ltd',
  phone: '+919977000001',
  email: 'ops@apexinfra.com',
  status: 'ACTIVE',
  deliveryMode: 'PARTNER_MANAGED',
  serviceAreaCount: 2,
  createdAt: '2026-11-19T00:00:00.000Z',
  updatedAt: '2026-11-19T00:00:00.000Z',
};

const mockPartnerItem2: IPartnerAdminSummaryDto = {
  id: '507f1f77bcf86cd799439012',
  businessName: 'Karnataka Brick Works',
  legalName: null,
  phone: '+919977000002',
  email: null,
  status: 'PENDING_VERIFICATION',
  deliveryMode: 'PLATFORM_MANAGED',
  serviceAreaCount: 1,
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z',
};

const mockSuccessResponse: IAdminPartnerListResponseDto = {
  items: [mockPartnerItem1, mockPartnerItem2],
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
    id: 'sa-1',
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
];

describe('PartnerDirectoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: staffWithPartnerRead,
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    vi.mocked(partnerClient.listPartners).mockResolvedValue(mockSuccessResponse);
    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: mockServiceAreas,
      total: 1,
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
      <MemoryRouter initialEntries={['/partners']}>
        <Routes>
          <Route path="/partners" element={<PartnerDirectoryPage />} />
          <Route
            path="/partners/:partnerId"
            element={<div data-testid="detail-page">Partner Detail Page</div>}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  describe('Security and Route Permission Guards', () => {
    it('renders error alert and halts API calls when staff lacks PARTNER_READ', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: staffWithoutPartnerRead,
        status: 'signed-in',
        signIn: vi.fn(),
        signOut: vi.fn(),
      });

      renderPage();

      expect(screen.getByRole('alert')).toHaveTextContent('PARTNER_READ permission required');
      expect(partnerClient.listPartners).not.toHaveBeenCalled();
    });

    it('permits authorized staff with PARTNER_READ to fetch directory', async () => {
      renderPage();

      await waitFor(() => {
        expect(partnerClient.listPartners).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByText('Apex Building Solutions')).toBeInTheDocument();
      expect(screen.getByText('Karnataka Brick Works')).toBeInTheDocument();
    });
  });

  describe('Directory Heading and Statistics', () => {
    it('renders page eyebrow, title, description, and total badge count', async () => {
      renderPage();

      expect(screen.getByText('PARTNER MANAGEMENT')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: 'Partners' })).toBeInTheDocument();
      expect(
        screen.getByText(
          /Directory of verified material distributors, fabricators, and hub fulfillment partners/i,
        ),
      ).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('2 partners')).toBeInTheDocument();
      });
    });
  });

  describe('Table Columns and DTO Rendering', () => {
    it('renders all required columns with formatted data', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Apex Building Solutions')).toBeInTheDocument();
      });

      // Business name & ID
      expect(screen.getByText('ID: 507f1f77bcf86cd799439011')).toBeInTheDocument();

      // Legal name
      expect(screen.getByText('Apex Infra Materials Ltd')).toBeInTheDocument();

      // Phone
      expect(screen.getByText('+919977000001')).toBeInTheDocument();

      // Email
      expect(screen.getByText('ops@apexinfra.com')).toBeInTheDocument();

      // Status badges
      expect(screen.getByText('Active')).toBeInTheDocument();
      expect(screen.getByText('Pending Verification')).toBeInTheDocument();

      // Delivery mode badges
      expect(screen.getByText('Partner Managed')).toBeInTheDocument();
      expect(screen.getByText('Platform Managed')).toBeInTheDocument();

      // Service areas count
      expect(screen.getByText('2')).toBeInTheDocument();

      // Nullable fallbacks (em-dash)
      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Search and Filter Controls', () => {
    it('triggers search query with trimmed value upon search submission', async () => {
      renderPage();

      await waitFor(() => {
        expect(partnerClient.listPartners).toHaveBeenCalledTimes(1);
      });

      const searchInput = screen.getByLabelText('Search partners');
      fireEvent.change(searchInput, { target: { value: 'Apex Infra' } });

      await waitFor(() => {
        expect(partnerClient.listPartners).toHaveBeenCalledWith(
          expect.objectContaining({ search: 'Apex Infra', page: 1 }),
          expect.any(Object),
        );
      });
    });

    it('refreshes directory data when clicking Refresh button', async () => {
      renderPage();

      await waitFor(() => {
        expect(partnerClient.listPartners).toHaveBeenCalledTimes(1);
      });

      const refreshBtn = screen.getByLabelText('Refresh partner directory');
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(partnerClient.listPartners).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Empty and Error States', () => {
    it('renders empty directory state with clear filters button when filters yield 0 results', async () => {
      vi.mocked(partnerClient.listPartners).mockResolvedValue({
        items: [],
        pagination: {
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
          hasNextPage: false,
          hasPrevPage: false,
        },
      });

      renderPage();

      const searchInput = screen.getByLabelText('Search partners');
      fireEvent.change(searchInput, { target: { value: 'NonExistentPartner' } });

      await waitFor(() => {
        expect(screen.getByText('No partners match the specified filters')).toBeInTheDocument();
      });

      const clearBtn = screen.getByRole('button', { name: 'Clear Active Filters' });
      expect(clearBtn).toBeInTheDocument();
      fireEvent.click(clearBtn);

      await waitFor(() => {
        expect(searchInput).toHaveValue('');
      });
    });

    it('renders error state and retry button on API failure', async () => {
      vi.mocked(partnerClient.listPartners).mockRejectedValueOnce(
        new ApiError('Failed to load partners from database', 500, 'INTERNAL_ERROR'),
      );

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(screen.getByText(/Failed to load partners from database/i)).toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /Retry Operation/i });
      expect(retryBtn).toBeInTheDocument();

      vi.mocked(partnerClient.listPartners).mockResolvedValueOnce(mockSuccessResponse);
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(screen.getByText('Apex Building Solutions')).toBeInTheDocument();
      });
    });
  });

  describe('Navigation to Detail Page', () => {
    it('navigates to partner detail page when clicking Inspect button', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('Apex Building Solutions')).toBeInTheDocument();
      });

      const inspectBtns = screen.getAllByRole('button', { name: /Inspect/i });
      fireEvent.click(inspectBtns[0]!);

      await waitFor(() => {
        expect(screen.getByTestId('detail-page')).toBeInTheDocument();
      });
    });
  });
});
