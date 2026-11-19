import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IPartnerAdminDetailDto,
  type IAdminPartnerAuditLogListResponseDto,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { partnerClient } from '../api/partner-client.js';
import { PartnerDetailPage } from './PartnerDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/partner-client.js', () => ({
  partnerClient: {
    listPartners: vi.fn(),
    getPartnerById: vi.fn(),
    updatePartnerStatus: vi.fn(),
    getPartnerAuditLogs: vi.fn(),
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

const mockPartnerDetail: IPartnerAdminDetailDto = {
  id: '507f1f77bcf86cd799439011',
  businessName: 'Apex Building Solutions',
  legalName: 'Apex Infra Materials Ltd',
  phone: '+919977000001',
  email: 'ops@apexinfra.com',
  status: 'ACTIVE',
  deliveryMode: 'PARTNER_MANAGED',
  serviceAreas: [
    {
      id: 'sa-1',
      code: 'SA-BLR-1',
      name: 'Bengaluru East',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincodeCount: 12,
      isActive: true,
    },
  ],
  linkedUserCount: 4,
  metadata: {
    region: 'South Hub',
    apiSecretKey: 'UNSAFE_SECRET',
    passwordHash: 'UNSAFE_HASH',
  },
  createdAt: '2026-11-19T00:00:00.000Z',
  updatedAt: '2026-11-19T00:00:00.000Z',
};

const mockAuditLogsResponse: IAdminPartnerAuditLogListResponseDto = {
  items: [
    {
      id: 'log-1',
      action: 'PARTNER_STATUS_CHANGED',
      previousState: { status: 'PENDING_VERIFICATION' },
      newState: { status: 'ACTIVE' },
      reason: 'Onboarding criteria verified by compliance committee',
      performedBy: {
        id: 'staff-1',
        email: 'verifier@thehomez.in',
        phone: '+919977100001',
      },
      createdAt: '2026-11-19T00:00:00.000Z',
    },
  ],
  pagination: {
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
};

describe('PartnerDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      user: staffWithPartnerRead,
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    vi.mocked(partnerClient.getPartnerById).mockResolvedValue(mockPartnerDetail);
    vi.mocked(partnerClient.getPartnerAuditLogs).mockResolvedValue(mockAuditLogsResponse);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderPage(partnerId = '507f1f77bcf86cd799439011') {
    return render(
      <MemoryRouter initialEntries={[`/partners/${partnerId}`]}>
        <Routes>
          <Route
            path="/partners"
            element={<div data-testid="directory-page">Partner Directory</div>}
          />
          <Route path="/partners/:partnerId" element={<PartnerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  describe('Security and Permission Enforcement', () => {
    it('blocks access and displays error alert when staff lacks PARTNER_READ', () => {
      vi.mocked(useAuth).mockReturnValue({
        user: staffWithoutPartnerRead,
        status: 'signed-in',
        signIn: vi.fn(),
        signOut: vi.fn(),
      });

      renderPage();

      expect(screen.getByRole('alert')).toHaveTextContent('PARTNER_READ permission required');
      expect(partnerClient.getPartnerById).not.toHaveBeenCalled();
    });

    it('allows authorized staff with PARTNER_READ to inspect partner detail', async () => {
      renderPage();

      await waitFor(() => {
        expect(partnerClient.getPartnerById).toHaveBeenCalledWith(
          '507f1f77bcf86cd799439011',
          expect.any(Object),
        );
      });
      expect(
        screen.getByRole('heading', { level: 1, name: 'Apex Building Solutions' }),
      ).toBeInTheDocument();
    });
  });

  describe('Section A: Business Overview Rendering', () => {
    it('renders all overview fields from the DTO correctly', async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 1, name: 'Apex Building Solutions' }),
        ).toBeInTheDocument();
      });

      expect(screen.getByText('Apex Infra Materials Ltd')).toBeInTheDocument();
      expect(screen.getByText('+919977000001')).toBeInTheDocument();
      expect(screen.getByText('ops@apexinfra.com')).toBeInTheDocument();
      expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Partner Managed').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('ID: 507f1f77bcf86cd799439011')).toBeInTheDocument();
    });

    it('renders fallback em-dash for null legalName and email', async () => {
      vi.mocked(partnerClient.getPartnerById).mockResolvedValueOnce({
        ...mockPartnerDetail,
        legalName: null,
        email: null,
      });

      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 1, name: 'Apex Building Solutions' }),
        ).toBeInTheDocument();
      });

      const dashes = screen.getAllByText('—');
      expect(dashes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Section B: Service Areas & Coverage', () => {
    it('renders service area details and operational status', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('SA-BLR-1')).toBeInTheDocument();
      });

      expect(screen.getByText('Bengaluru East')).toBeInTheDocument();
      expect(screen.getByText('Bengaluru')).toBeInTheDocument();
      expect(screen.getByText('Karnataka')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('Operational')).toBeInTheDocument();
    });
  });

  describe('Section C: Linked Tenant Accounts', () => {
    it('displays the linked user count metric clearly', async () => {
      renderPage();

      await waitFor(() => {
        expect(screen.getByText('4 Linked Partner Accounts')).toBeInTheDocument();
      });
      expect(
        screen.getByText(
          /Authorized operator credentials affiliated with this vendor organization tenant/i,
        ),
      ).toBeInTheDocument();
    });
  });

  describe('Metadata Sanitization', () => {
    it('safely excludes sensitive fields like secrets and password hashes from metadata card', async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 1, name: 'Apex Building Solutions' }),
        ).toBeInTheDocument();
      });

      expect(screen.getByText('South Hub')).toBeInTheDocument();
      expect(screen.queryByText('UNSAFE_SECRET')).not.toBeInTheDocument();
      expect(screen.queryByText('UNSAFE_HASH')).not.toBeInTheDocument();
    });
  });

  describe('Section D: Lifecycle Audit History', () => {
    it('renders chronological audit events with transition badges and actor identity', async () => {
      renderPage();

      await waitFor(() => {
        expect(
          screen.getByText('Onboarding criteria verified by compliance committee'),
        ).toBeInTheDocument();
      });

      expect(screen.getByText('verifier@thehomez.in')).toBeInTheDocument();
      expect(screen.getByText('+919977100001')).toBeInTheDocument();
    });
  });

  describe('404 Not Found & Error States', () => {
    it('renders 404 Result when partner does not exist', async () => {
      vi.mocked(partnerClient.getPartnerById).mockRejectedValueOnce(
        new ApiError('Partner not found', 404, 'PARTNER_NOT_FOUND'),
      );

      renderPage('non-existent-id');

      await waitFor(() => {
        expect(screen.getByText('Partner Not Found')).toBeInTheDocument();
      });

      const backBtn = screen.getByRole('button', { name: 'Back to Partner Directory' });
      fireEvent.click(backBtn);

      await waitFor(() => {
        expect(screen.getByTestId('directory-page')).toBeInTheDocument();
      });
    });

    it('renders error state and retries on API failure', async () => {
      vi.mocked(partnerClient.getPartnerById).mockRejectedValueOnce(
        new ApiError('Database connection error', 500, 'DB_ERROR'),
      );

      renderPage();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
      expect(screen.getByText(/Database connection error/i)).toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /Retry Operation/i });
      vi.mocked(partnerClient.getPartnerById).mockResolvedValueOnce(mockPartnerDetail);
      fireEvent.click(retryBtn);

      await waitFor(() => {
        expect(
          screen.getByRole('heading', { level: 1, name: 'Apex Building Solutions' }),
        ).toBeInTheDocument();
      });
    });
  });
});
