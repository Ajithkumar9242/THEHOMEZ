import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Grid } from 'antd';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IServiceArea,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { AdminLayout } from '../../../layouts/AdminLayout.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { serviceAreaClient } from '../api/service-area-client.js';
import { ServiceAreaListPage } from './ServiceAreaListPage.js';
import { ServiceAreaDetailPage } from './ServiceAreaDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/service-area-client.js', () => ({
  serviceAreaClient: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getPartners: vi.fn(),
  },
}));

const staff: IAuthUser = {
  id: 'staff-1',
  phone: '+910000000000',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [PermissionCode.SERVICE_AREA_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const area: IServiceArea = {
  id: 'area-1',
  code: 'BLR-CENTRAL',
  name: 'Bengaluru Central',
  city: 'Bengaluru',
  state: 'Karnataka',
  countryCode: 'IN',
  pincodes: ['560001', '560002'],
  deliveryRadiusKm: 12,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function auth(permissions: PermissionCode[] = [PermissionCode.SERVICE_AREA_READ]) {
  return {
    user: { ...staff, permissions },
    status: 'signed-in' as const,
    signIn: vi.fn(),
    requestOtp: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderPage(path = '/service-areas') {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/service-areas" element={<ServiceAreaListPage />} />
        <Route path="/service-areas/:serviceAreaId" element={<ServiceAreaDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('service-area browser pages', () => {
  it('renders the compact list and applies only trimmed city, state, and status filters', async () => {
    vi.mocked(useAuth).mockReturnValue(auth());
    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: [area],
      total: 31,
      page: 1,
      limit: 20,
      totalPages: 2,
    });
    renderPage();
    expect(await screen.findByText('BLR-CENTRAL')).toBeInTheDocument();
    expect(screen.getByText('2', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('12 km')).toBeInTheDocument();
    expect(serviceAreaClient.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, signal: expect.any(AbortSignal) }),
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Filter by city' }), {
      target: { value: '  Bengaluru  ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter by state' }), {
      target: { value: ' Karnataka ' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Inactive' }));
    fireEvent.click(screen.getByRole('button', { name: /Apply filters/ }));
    await waitFor(() =>
      expect(serviceAreaClient.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          city: 'Bengaluru',
          state: 'Karnataka',
          isActive: false,
          page: 1,
          limit: 20,
        }),
      ),
    );
  }, 15000);

  it('paginates from backend metadata and keeps supported page sizes', async () => {
    vi.mocked(useAuth).mockReturnValue(auth());
    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: [area],
      total: 41,
      page: 1,
      limit: 20,
      totalPages: 3,
    });
    renderPage();
    await screen.findByText('BLR-CENTRAL');
    fireEvent.click(screen.getByTitle('Next Page'));
    await waitFor(() =>
      expect(serviceAreaClient.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, limit: 20 }),
      ),
    );
  });

  it('shows loading, empty, and retry states without fake records', async () => {
    vi.mocked(useAuth).mockReturnValue(auth());
    vi.mocked(serviceAreaClient.list)
      .mockRejectedValueOnce(new ApiError('offline', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 20, totalPages: 1 });
    const view = renderPage();
    expect(view.container.querySelector('.ant-skeleton')).toBeInTheDocument();
    expect(await screen.findByText('Could not load service areas')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('No service areas match these filters')).toBeInTheDocument();
  });

  it('does not call the API without SERVICE_AREA_READ, even when CATALOG_READ exists', () => {
    vi.mocked(useAuth).mockReturnValue(auth([PermissionCode.CATALOG_READ]));
    const deniedList = renderPage();
    expect(screen.getByText('SERVICE_AREA_READ permission required')).toBeInTheDocument();
    expect(serviceAreaClient.list).not.toHaveBeenCalled();
    deniedList.unmount();
    renderPage('/service-areas/area-1');
    expect(screen.getByText('SERVICE_AREA_READ permission required')).toBeInTheDocument();
    expect(serviceAreaClient.get).not.toHaveBeenCalled();
  });

  it('shows active coverage metadata and paginates large configured PIN lists', async () => {
    vi.mocked(useAuth).mockReturnValue(auth());
    const pins = Array.from({ length: 120 }, (_, index) => String(100000 + index));
    vi.mocked(serviceAreaClient.get).mockResolvedValue({ ...area, pincodes: pins });
    renderPage('/service-areas/area-1');
    expect(await screen.findByText('Active service area')).toBeInTheDocument();
    expect(screen.getByText('12 km')).toBeInTheDocument();
    const pinTable = screen
      .getByText('Configured PIN codes (120)')
      .closest('.ant-card') as HTMLElement;
    expect(within(pinTable).getByText('100000')).toBeInTheDocument();
    expect(within(pinTable).queryByText('100050')).not.toBeInTheDocument();
    fireEvent.click(within(pinTable).getByTitle('Next Page'));
    expect(await within(pinTable).findByText('100050')).toBeInTheDocument();
    expect(serviceAreaClient.get).toHaveBeenCalledWith(
      'area-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('labels inactive PINs as stored configuration and handles invalid IDs and missing records', async () => {
    vi.mocked(useAuth).mockReturnValue(auth());
    vi.mocked(serviceAreaClient.get).mockResolvedValueOnce({ ...area, isActive: false });
    const inactiveView = renderPage('/service-areas/area-1');
    expect(await screen.findByText('Inactive service area')).toBeInTheDocument();
    expect(
      screen.getByText(/does not consider inactive service areas serviceable/i),
    ).toBeInTheDocument();
    inactiveView.unmount();

    vi.mocked(serviceAreaClient.get).mockRejectedValueOnce(
      new ApiError('Invalid service area ID format', 400, 'INVALID_ID'),
    );
    const invalid = renderPage('/service-areas/not-an-id');
    expect(await screen.findByText('Invalid request')).toBeInTheDocument();
    invalid.unmount();

    vi.mocked(serviceAreaClient.get).mockRejectedValueOnce(
      new ApiError('Not found', 404, 'SERVICE_AREA_NOT_FOUND'),
    );
    renderPage('/service-areas/missing');
    expect(await screen.findByText('Service area not found')).toBeInTheDocument();
  });

  it('distinguishes 401 and 403 and keeps service-area navigation permission-aware', async () => {
    vi.mocked(useAuth).mockReturnValue(auth());
    vi.mocked(serviceAreaClient.list)
      .mockRejectedValueOnce(new ApiError('Expired', 401, 'UNAUTHORIZED'))
      .mockRejectedValueOnce(new ApiError('Denied', 403, 'FORBIDDEN'));
    const unauthorized = renderPage();
    expect(await screen.findByText('Session expired')).toBeInTheDocument();
    unauthorized.unmount();
    const forbidden = renderPage();
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    forbidden.unmount();

    vi.spyOn(Grid, 'useBreakpoint').mockReturnValue({
      md: true,
      xs: false,
      sm: true,
      lg: true,
      xl: true,
      xxl: true,
    });
    vi.mocked(useAuth).mockReturnValue(auth());
    const allowed = render(
      <MemoryRouter>
        <AdminLayout>
          <div />
        </AdminLayout>
      </MemoryRouter>,
    );
    expect(screen.getByText('Service Areas')).toBeInTheDocument();
    allowed.unmount();
    vi.mocked(useAuth).mockReturnValue(auth([PermissionCode.CATALOG_READ]));
    render(
      <MemoryRouter>
        <AdminLayout>
          <div />
        </AdminLayout>
      </MemoryRouter>,
    );
    expect(screen.queryByText('Service Areas')).not.toBeInTheDocument();
  });

  it('exposes no service-area mutation controls for read-only staff', async () => {
    vi.mocked(useAuth).mockReturnValue(auth([PermissionCode.SERVICE_AREA_READ]));
    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: [area],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    renderPage();
    await screen.findByText('BLR-CENTRAL');
    expect(
      screen.queryByRole('button', {
        name: /create|edit|delete|activate|deactivate|add pin|remove pin/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('renders Create Service Area button and opens drawer when user has SERVICE_AREA_WRITE', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );
    vi.mocked(serviceAreaClient.list).mockResolvedValue({
      items: [area],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    renderPage('/service-areas');
    await screen.findByText('BLR-CENTRAL');

    const createBtn = screen.getByRole('button', { name: /create service area/i });
    expect(createBtn).toBeInTheDocument();

    fireEvent.click(createBtn);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Service area code')).toBeInTheDocument();
  });

  it('renders Edit Service Area button on detail page when user has SERVICE_AREA_WRITE', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );
    vi.mocked(serviceAreaClient.get).mockResolvedValue(area);

    renderPage('/service-areas/area-1');
    await screen.findByText('BLR-CENTRAL');

    const editBtn = screen.getByRole('button', { name: `Edit ${area.name}` });
    expect(editBtn).toBeInTheDocument();

    fireEvent.click(editBtn);
    expect(await screen.findByText(`Edit Service Area: ${area.name}`)).toBeInTheDocument();
    expect(screen.getByLabelText('Service area code disabled')).toBeDisabled();
  });

  it('hides Edit Service Area button on detail page when user lacks SERVICE_AREA_WRITE', async () => {
    vi.mocked(useAuth).mockReturnValue(auth([PermissionCode.SERVICE_AREA_READ]));
    vi.mocked(serviceAreaClient.get).mockResolvedValue(area);

    renderPage('/service-areas/area-1');
    await screen.findByText('BLR-CENTRAL');

    expect(screen.queryByRole('button', { name: /edit service area/i })).not.toBeInTheDocument();
  });

  it('renders Deactivate Service Area button for active hub and executes deactivation', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );
    vi.mocked(serviceAreaClient.get).mockResolvedValue(area);
    const deactivatedArea = { ...area, isActive: false };
    vi.mocked(serviceAreaClient.update).mockResolvedValueOnce(deactivatedArea);

    renderPage('/service-areas/area-1');
    await screen.findByText('BLR-CENTRAL');

    const deactBtn = screen.getByRole('button', { name: `Deactivate ${area.name}` });
    expect(deactBtn).toBeInTheDocument();

    fireEvent.click(deactBtn);

    // Modal opens
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Immediate Downstream Operational Impact')).toBeInTheDocument();

    // Type code to confirm
    const codeInput = screen.getByLabelText('Confirm service area code input');
    fireEvent.change(codeInput, { target: { value: 'BLR-CENTRAL' } });

    const confirmBtn = screen.getByRole('button', { name: /Confirm deactivation button/i });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(serviceAreaClient.update).toHaveBeenCalledWith('area-1', { isActive: false });
    });
  });

  it('renders Activate Service Area button for inactive hub and executes activation', async () => {
    vi.mocked(useAuth).mockReturnValue(
      auth([PermissionCode.SERVICE_AREA_READ, PermissionCode.SERVICE_AREA_WRITE]),
    );
    const inactiveArea = { ...area, isActive: false };
    vi.mocked(serviceAreaClient.get).mockResolvedValue(inactiveArea);
    const activatedArea = { ...inactiveArea, isActive: true };
    vi.mocked(serviceAreaClient.update).mockResolvedValueOnce(activatedArea);

    renderPage('/service-areas/area-1');
    await screen.findByText('BLR-CENTRAL');

    const actBtn = screen.getByRole('button', { name: `Activate ${area.name}` });
    expect(actBtn).toBeInTheDocument();

    fireEvent.click(actBtn);

    // Modal opens
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('PIN Coverage Verification')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /Confirm activation button/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(serviceAreaClient.update).toHaveBeenCalledWith('area-1', { isActive: true });
    });
  });

  it('hides lifecycle mutation buttons on detail page when user lacks SERVICE_AREA_WRITE', async () => {
    vi.mocked(useAuth).mockReturnValue(auth([PermissionCode.SERVICE_AREA_READ]));
    vi.mocked(serviceAreaClient.get).mockResolvedValue(area);

    renderPage('/service-areas/area-1');
    await screen.findByText('BLR-CENTRAL');

    expect(
      screen.queryByRole('button', { name: /deactivate service area/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /activate service area/i }),
    ).not.toBeInTheDocument();
  });
});
