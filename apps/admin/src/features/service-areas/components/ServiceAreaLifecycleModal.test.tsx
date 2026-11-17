import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IServiceArea,
  type IServiceAreaPartnerItem,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { serviceAreaClient } from '../api/service-area-client.js';
import { ServiceAreaLifecycleModal } from './ServiceAreaLifecycleModal.js';

vi.mock('../../../providers/AuthProvider.js', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../api/service-area-client.js', () => ({
  serviceAreaClient: {
    update: vi.fn(),
    getPartners: vi.fn(),
  },
}));

const staff: IAuthUser = {
  id: 'staff-1',
  phone: '+919999999999',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE],
  createdAt: '2026-01-01T00:00:00.000Z',
};

function auth(permissions: PermissionCode[]) {
  return {
    user: { ...staff, permissions },
    status: 'signed-in' as const,
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
}

const mockActiveArea: IServiceArea = {
  id: 'sa-blr-north',
  code: 'BLR-NORTH',
  name: 'Bengaluru North (Yelahanka)',
  city: 'Bengaluru',
  state: 'Karnataka',
  countryCode: 'IN',
  pincodes: ['560064', '560065'],
  deliveryRadiusKm: 25,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockInactiveArea: IServiceArea = {
  ...mockActiveArea,
  id: 'sa-blr-east',
  code: 'BLR-EAST',
  name: 'Bengaluru East',
  isActive: false,
};

const mockPartners: IServiceAreaPartnerItem[] = [
  {
    partnerId: 'partner-101',
    businessName: 'Yelahanka Building Supplies',
    phone: '+919876543210',
    status: 'ACTIVE',
  },
  {
    partnerId: 'partner-102',
    businessName: 'North Hardware & Cement',
    phone: '+919876543211',
    status: 'ACTIVE',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServiceAreaLifecycleModal — Deactivation Mode', () => {
  it('renders deactivation warning, area information, and affected PIN codes count', () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="deactivate"
        serviceArea={mockActiveArea}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText(/Deactivate Service Area: Bengaluru North/i)).toBeInTheDocument();
    expect(screen.getAllByText('BLR-NORTH').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('2 PIN codes')).toBeInTheDocument();
    expect(screen.getByText('Immediate Downstream Operational Impact')).toBeInTheDocument();
    expect(screen.getByText(/immediately become/i)).toBeInTheDocument();
    expect(screen.getByText(/blocked from checkout/i)).toBeInTheDocument();
  });

  it('fetches and displays assigned active partners when operator has PARTNER_READ', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([
        PermissionCode.SERVICE_AREA_READ,
        PermissionCode.SERVICE_AREA_WRITE,
        PermissionCode.PARTNER_READ,
      ]),
    );
    vi.mocked(serviceAreaClient.getPartners).mockResolvedValueOnce(mockPartners);

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="deactivate"
        serviceArea={mockActiveArea}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(serviceAreaClient.getPartners).toHaveBeenCalledWith(mockActiveArea.id);
    expect(await screen.findByText('Yelahanka Building Supplies')).toBeInTheDocument();
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
    expect(screen.getByText('North Hardware & Cement')).toBeInTheDocument();
    expect(screen.getByText('+919876543211')).toBeInTheDocument();
  });

  it('does NOT call getPartners when operator lacks PARTNER_READ and displays restricted notice', () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="deactivate"
        serviceArea={mockActiveArea}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(serviceAreaClient.getPartners).not.toHaveBeenCalled();
    expect(screen.getByText('Partner preview restricted')).toBeInTheDocument();
    expect(screen.getByText(/Your account lacks PARTNER_READ permission/i)).toBeInTheDocument();
  });

  it('gracefully handles partner inspection HTTP 403 error without preventing deactivation', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([
        PermissionCode.SERVICE_AREA_READ,
        PermissionCode.SERVICE_AREA_WRITE,
        PermissionCode.PARTNER_READ,
      ]),
    );
    vi.mocked(serviceAreaClient.getPartners).mockRejectedValueOnce(
      new ApiError('Forbidden', 403, 'FORBIDDEN'),
    );

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="deactivate"
        serviceArea={mockActiveArea}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(await screen.findByText('Partner inspection unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(/Permission to inspect partner assignments was denied by the backend/i),
    ).toBeInTheDocument();

    // Verify typed confirmation and deactivation button are still available
    const confirmInput = screen.getByLabelText('Confirm service area code input');
    expect(confirmInput).toBeInTheDocument();
  });

  it('handles empty partner assignments cleanly', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([
        PermissionCode.SERVICE_AREA_READ,
        PermissionCode.SERVICE_AREA_WRITE,
        PermissionCode.PARTNER_READ,
      ]),
    );
    vi.mocked(serviceAreaClient.getPartners).mockResolvedValueOnce([]);

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="deactivate"
        serviceArea={mockActiveArea}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(
      await screen.findByText('No active partners are currently assigned to this service area.'),
    ).toBeInTheDocument();
  });

  it('enforces typed confirmation: button disabled until exact code matches', () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="deactivate"
        serviceArea={mockActiveArea}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    const deactBtn = screen.getByRole('button', { name: /Confirm deactivation button/i });
    const input = screen.getByLabelText('Confirm service area code input');

    // Initially disabled
    expect(deactBtn).toBeDisabled();

    // Partial code: still disabled
    fireEvent.change(input, { target: { value: 'BLR' } });
    expect(deactBtn).toBeDisabled();

    // Wrong code: disabled
    fireEvent.change(input, { target: { value: 'BLR-SOUTH' } });
    expect(deactBtn).toBeDisabled();

    // Exact code match: enabled
    fireEvent.change(input, { target: { value: 'BLR-NORTH' } });
    expect(deactBtn).not.toBeDisabled();
  });

  it('submits update with exact { isActive: false } upon confirmation and triggers callbacks', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );
    const deactivatedArea: IServiceArea = { ...mockActiveArea, isActive: false };
    vi.mocked(serviceAreaClient.update).mockResolvedValueOnce(deactivatedArea);

    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="deactivate"
        serviceArea={mockActiveArea}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />,
    );

    const input = screen.getByLabelText('Confirm service area code input');
    fireEvent.change(input, { target: { value: 'BLR-NORTH' } });

    const deactBtn = screen.getByRole('button', { name: /Confirm deactivation button/i });
    fireEvent.click(deactBtn);

    await waitFor(() => {
      expect(serviceAreaClient.update).toHaveBeenCalledWith('sa-blr-north', { isActive: false });
      expect(handleSuccess).toHaveBeenCalledWith(deactivatedArea);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('keeps modal open and displays error when deactivation API call fails', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );
    vi.mocked(serviceAreaClient.update).mockRejectedValueOnce(
      new ApiError('Database failure', 500, 'INTERNAL_SERVER_ERROR'),
    );

    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="deactivate"
        serviceArea={mockActiveArea}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />,
    );

    const input = screen.getByLabelText('Confirm service area code input');
    fireEvent.change(input, { target: { value: 'BLR-NORTH' } });

    const deactBtn = screen.getByRole('button', { name: /Confirm deactivation button/i });
    fireEvent.click(deactBtn);

    await waitFor(() => {
      expect(screen.getByText(/Database failure \(INTERNAL_SERVER_ERROR\)/i)).toBeInTheDocument();
    });

    expect(handleSuccess).not.toHaveBeenCalled();
    expect(handleClose).not.toHaveBeenCalled();
  });
});

describe('ServiceAreaLifecycleModal — Activation Mode', () => {
  it('renders activation explanation and inactive status', () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="activate"
        serviceArea={mockInactiveArea}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />,
    );

    expect(screen.getByText(/Activate Service Area: Bengaluru East/i)).toBeInTheDocument();
    expect(screen.getByText('BLR-EAST')).toBeInTheDocument();
    expect(screen.getByText('PIN Coverage Verification')).toBeInTheDocument();
    expect(
      screen.getByText(/Activating this service area will validate all configured PIN codes/i),
    ).toBeInTheDocument();

    const actBtn = screen.getByRole('button', { name: /Confirm activation button/i });
    expect(actBtn).toBeInTheDocument();
    expect(actBtn).not.toBeDisabled();
  });

  it('submits update with exact { isActive: true } upon activation and triggers callbacks', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );
    const activatedArea: IServiceArea = { ...mockInactiveArea, isActive: true };
    vi.mocked(serviceAreaClient.update).mockResolvedValueOnce(activatedArea);

    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="activate"
        serviceArea={mockInactiveArea}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />,
    );

    const actBtn = screen.getByRole('button', { name: /Confirm activation button/i });
    fireEvent.click(actBtn);

    await waitFor(() => {
      expect(serviceAreaClient.update).toHaveBeenCalledWith('sa-blr-east', { isActive: true });
      expect(handleSuccess).toHaveBeenCalledWith(activatedArea);
      expect(handleClose).toHaveBeenCalled();
    });
  });

  it('displays exact backend PIN_COVERAGE_CONFLICT message and keeps modal open on activation conflict', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );
    const conflictMsg =
      'PIN code coverage conflict: PIN(s) [560064] are already assigned to active service area "BLR-NORTH". An active PIN code cannot be ambiguously assigned to multiple active service areas.';
    vi.mocked(serviceAreaClient.update).mockRejectedValueOnce(
      new ApiError(conflictMsg, 409, 'PIN_COVERAGE_CONFLICT'),
    );

    const handleSuccess = vi.fn();
    const handleClose = vi.fn();

    render(
      <ServiceAreaLifecycleModal
        open={true}
        mode="activate"
        serviceArea={mockInactiveArea}
        onClose={handleClose}
        onSuccess={handleSuccess}
      />,
    );

    const actBtn = screen.getByRole('button', { name: /Confirm activation button/i });
    fireEvent.click(actBtn);

    await waitFor(() => {
      expect(screen.getByText(/PIN_COVERAGE_CONFLICT/i)).toBeInTheDocument();
      expect(screen.getByText(/PIN code coverage conflict/i)).toBeInTheDocument();
    });

    expect(handleSuccess).not.toHaveBeenCalled();
    expect(handleClose).not.toHaveBeenCalled();
  });
});
