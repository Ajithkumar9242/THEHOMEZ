import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IPartnerAdminDetailDto,
} from '@thehomez/shared-types';
import { useAuth } from '../../../providers/AuthProvider.js';
import { partnerClient } from '../api/partner-client.js';
import { PartnerReactivateModal } from './PartnerReactivateModal.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/partner-client.js', () => ({
  partnerClient: {
    reactivatePartner: vi.fn(),
  },
}));

function createStaff(permissions: PermissionCode[]): IAuthUser {
  return {
    id: 'staff-test-user',
    phone: '+919999999999',
    email: 'staff@thehomez.com',
    userType: UserType.STAFF,
    status: UserStatus.ACTIVE,
    roles: ['OPERATOR'],
    permissions,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const mockInactivePartner: IPartnerAdminDetailDto = {
  id: '507f1f77bcf86cd799439011',
  businessName: 'Apex Building Solutions',
  legalName: 'Apex Infra Materials Ltd',
  phone: '9876543210',
  email: 'ops@apexinfra.com',
  status: 'INACTIVE',
  deliveryMode: 'PARTNER_MANAGED',
  serviceAreas: [],
  linkedUserCount: 2,
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

describe('PartnerReactivateModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal with mandatory attestation checkboxes', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([PermissionCode.PARTNER_READ, PermissionCode.PARTNER_VERIFY]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <PartnerReactivateModal
        open={true}
        partner={mockInactivePartner}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText(/Reactivate Partner Organization/i)).toBeInTheDocument();
    expect(
      screen.getByText(/I attest that business identity has been verified/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/I attest that the physical operating premise/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/I confirm that the partner has at least one active fulfillment hub/i),
    ).toBeInTheDocument();
  });

  it('displays waiver controls when staff possesses RBAC_MANAGE permission', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([
        PermissionCode.PARTNER_READ,
        PermissionCode.PARTNER_VERIFY,
        PermissionCode.RBAC_MANAGE,
      ]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <PartnerReactivateModal
        open={true}
        partner={mockInactivePartner}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const waiverCheckbox = screen.getByRole('checkbox', {
      name: /Apply Supervisory Waiver/i,
    });
    expect(waiverCheckbox).toBeInTheDocument();

    fireEvent.click(waiverCheckbox);

    await waitFor(() => {
      expect(
        screen.getByText(/Supervisory Override Invocation/i),
      ).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText(/Provide full audit rationale for waiving/i),
      ).toBeInTheDocument();
    });
  });

  it('submits reactivation with attestations and calls onSuccess', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: createStaff([PermissionCode.PARTNER_READ, PermissionCode.PARTNER_VERIFY]),
      status: 'signed-in',
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    const onSuccess = vi.fn();
    const onClose = vi.fn();

    vi.mocked(partnerClient.reactivatePartner).mockResolvedValue({
      ...mockInactivePartner,
      status: 'ACTIVE',
    });

    render(
      <PartnerReactivateModal
        open={true}
        partner={mockInactivePartner}
        onClose={onClose}
        onSuccess={onSuccess}
      />,
    );

    const reasonInput = screen.getByPlaceholderText(
      /e\.g\., Compliance verification completed and approved by legal counsel/i,
    );
    fireEvent.change(reasonInput, {
      target: { value: 'Compliance review completed and approved by senior management.' },
    });

    const checkboxes = screen.getAllByRole('checkbox');
    checkboxes.forEach((cb) => fireEvent.click(cb));

    const submitBtn = screen.getByRole('button', { name: /Confirm Reactivation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(partnerClient.reactivatePartner).toHaveBeenCalledWith(
        mockInactivePartner.id,
        expect.objectContaining({
          reason: 'Compliance review completed and approved by senior management.',
          attestations: {
            identityVerified: true,
            addressVerified: true,
            activeHubsConfirmed: true,
          },
        }),
      );
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});
