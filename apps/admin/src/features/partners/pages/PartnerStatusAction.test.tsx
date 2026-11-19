import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IPartnerAdminDetailDto,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { partnerClient } from '../api/partner-client.js';
import { PartnerStatusActionModal } from '../components/PartnerStatusActionModal.js';
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

function createStaff(permissions: PermissionCode[]): IAuthUser {
  return {
    id: `staff-${permissions.join('-')}`,
    phone: '+919999999999',
    email: 'staff@thehomez.com',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['OPERATOR'],
    permissions,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const mockActivePartner: IPartnerAdminDetailDto = {
  id: '507f1f77bcf86cd799439011',
  businessName: 'Apex Building Solutions',
  legalName: 'Apex Infra Materials Ltd',
  phone: '+919977000001',
  email: 'ops@apexinfra.com',
  status: 'ACTIVE',
  deliveryMode: 'PARTNER_MANAGED',
  serviceAreas: [],
  linkedUserCount: 3,
  metadata: {},
  createdAt: '2026-11-19T00:00:00.000Z',
  updatedAt: '2026-11-19T00:00:00.000Z',
};

describe('PartnerStatusActionModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when modal is closed or targetStatus is null', () => {
    const { container } = render(
      <PartnerStatusActionModal
        open={false}
        partner={mockActivePartner}
        targetStatus="SUSPENDED"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders confirmation modal with operational consequence warning', () => {
    render(
      <PartnerStatusActionModal
        open={true}
        partner={mockActivePartner}
        targetStatus="SUSPENDED"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText('Confirm Partner Suspension')).toBeInTheDocument();
    expect(
      screen.getByText(
        /atomically revoke all active refresh tokens across all linked partner users \(3 user accounts\)/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Individual user credentials and accounts remain intact and will not be deleted/i,
      ),
    ).toBeInTheDocument();
  });

  it('allows cancellation without calling the update API', () => {
    const onClose = vi.fn();
    render(
      <PartnerStatusActionModal
        open={true}
        partner={mockActivePartner}
        targetStatus="SUSPENDED"
        onClose={onClose}
        onSuccess={vi.fn()}
      />,
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(partnerClient.updatePartnerStatus).not.toHaveBeenCalled();
  });

  it('validates that audit reason is required and at least 10 characters', async () => {
    render(
      <PartnerStatusActionModal
        open={true}
        partner={mockActivePartner}
        targetStatus="SUSPENDED"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const confirmBtn = screen.getByRole('button', { name: 'Confirm Suspension' });
    fireEvent.click(confirmBtn);

    expect(await screen.findByText('Audit reason is required')).toBeInTheDocument();
    expect(partnerClient.updatePartnerStatus).not.toHaveBeenCalled();
  });

  it('successfully submits valid reason and triggers onSuccess callback', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    const updatedPartner = { ...mockActivePartner, status: 'SUSPENDED' as const };
    vi.mocked(partnerClient.updatePartnerStatus).mockResolvedValueOnce(updatedPartner);

    render(
      <PartnerStatusActionModal
        open={true}
        partner={mockActivePartner}
        targetStatus="SUSPENDED"
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const textarea = screen.getByLabelText('Audit reason');
    fireEvent.change(textarea, {
      target: { value: 'Compliance audit failed safety requirements inspection' },
    });

    const confirmBtn = screen.getByRole('button', { name: 'Confirm Suspension' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(partnerClient.updatePartnerStatus).toHaveBeenCalledWith('507f1f77bcf86cd799439011', {
        status: 'SUSPENDED',
        reason: 'Compliance audit failed safety requirements inspection',
      });
    });

    expect(onSuccess).toHaveBeenCalledWith(updatedPartner);
    expect(onClose).toHaveBeenCalled();
  });

  it('handles CONCURRENT_MODIFICATION error and triggers onConcurrentModification callback', async () => {
    const onConcurrent = vi.fn();
    vi.mocked(partnerClient.updatePartnerStatus).mockRejectedValueOnce(
      new ApiError(
        'Partner status was concurrently modified by another transaction',
        409,
        'CONCURRENT_MODIFICATION',
      ),
    );

    render(
      <PartnerStatusActionModal
        open={true}
        partner={mockActivePartner}
        targetStatus="SUSPENDED"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        onConcurrentModification={onConcurrent}
      />,
    );

    const textarea = screen.getByLabelText('Audit reason');
    fireEvent.change(textarea, {
      target: { value: 'Compliance audit failed safety requirements inspection' },
    });

    const confirmBtn = screen.getByRole('button', { name: 'Confirm Suspension' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByText(/Concurrent modification conflict/i)).toBeInTheDocument();
    });

    expect(onConcurrent).toHaveBeenCalled();
  });
});

describe('PartnerDetailPage Action Buttons & Permission Visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(partnerClient.getPartnerById).mockResolvedValue(mockActivePartner);
    vi.mocked(partnerClient.getPartnerAuditLogs).mockResolvedValue({
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderDetailPage(partnerId = '507f1f77bcf86cd799439011') {
    return render(
      <MemoryRouter initialEntries={[`/partners/${partnerId}`]}>
        <Routes>
          <Route path="/partners/:partnerId" element={<PartnerDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('renders no action buttons when staff possesses only PARTNER_READ', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([PermissionCode.PARTNER_READ]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    renderDetailPage();

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { level: 1, name: 'Apex Building Solutions' }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Inactivate partner/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Suspend partner/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reactivate partner/i })).not.toBeInTheDocument();
  });

  it('renders only Inactivate Partner button when staff has PARTNER_VERIFY', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([PermissionCode.PARTNER_READ, PermissionCode.PARTNER_VERIFY]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Inactivate partner/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Suspend partner/i })).not.toBeInTheDocument();
  });

  it('renders only Suspend Partner button when staff has PARTNER_SUSPEND', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([PermissionCode.PARTNER_READ, PermissionCode.PARTNER_SUSPEND]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Suspend partner/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Inactivate partner/i })).not.toBeInTheDocument();
  });

  it('for INACTIVE partner: only renders Suspend button (prohibits same-status and reactivation)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([
        PermissionCode.PARTNER_READ,
        PermissionCode.PARTNER_VERIFY,
        PermissionCode.PARTNER_SUSPEND,
      ]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    vi.mocked(partnerClient.getPartnerById).mockResolvedValue({
      ...mockActivePartner,
      status: 'INACTIVE',
    });

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Suspend partner/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Inactivate partner/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reactivate partner/i })).not.toBeInTheDocument();
  });

  it('for SUSPENDED partner: only renders Inactivate button (prohibits same-status and reactivation)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([
        PermissionCode.PARTNER_READ,
        PermissionCode.PARTNER_VERIFY,
        PermissionCode.PARTNER_SUSPEND,
      ]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    vi.mocked(partnerClient.getPartnerById).mockResolvedValue({
      ...mockActivePartner,
      status: 'SUSPENDED',
    });

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Inactivate partner/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /Suspend partner/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reactivate partner/i })).not.toBeInTheDocument();
  });

  it('for PENDING_VERIFICATION partner: renders both Inactivate and Suspend buttons (prohibits direct activation)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([
        PermissionCode.PARTNER_READ,
        PermissionCode.PARTNER_VERIFY,
        PermissionCode.PARTNER_SUSPEND,
      ]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    vi.mocked(partnerClient.getPartnerById).mockResolvedValue({
      ...mockActivePartner,
      status: 'PENDING_VERIFICATION',
    });

    renderDetailPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Inactivate partner/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Suspend partner/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /^Activate partner$/i })).not.toBeInTheDocument();
  });
});
