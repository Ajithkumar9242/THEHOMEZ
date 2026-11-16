import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { UserStatus, UserType, type IAuthUser, type IUnit } from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { ProtectedRoute } from '../../../routes/ProtectedRoute.js';
import { AdminLayout } from '../../../layouts/AdminLayout.js';
import { unitClient } from '../api/unit-client.js';
import { UnitListPage } from './UnitListPage.js';
import { UnitDetailPage } from './UnitDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/unit-client.js', () => ({
  unitClient: { list: vi.fn(), getByCode: vi.fn() },
}));

const staffWithoutCataloguePermission: IAuthUser = {
  id: 'staff-1',
  phone: '+910000000000',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const unit: IUnit = {
  id: 'unit-id',
  code: 'SQ_FT',
  name: 'Square Foot',
  symbol: 'sq ft',
  singularLabel: 'Square Foot',
  pluralLabel: 'Square Feet',
  description: 'Flooring and surface area',
  classification: 'AREA',
  isDiscrete: false,
  allowedMaxPrecision: 2,
  isActive: true,
  isSystem: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function signedInAuth() {
  return {
    user: staffWithoutCataloguePermission,
    status: 'signed-in' as const,
    signIn: vi.fn(),
    requestOtp: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderList() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<UnitListPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function renderDetail(code: string) {
  return render(
    <MemoryRouter
      initialEntries={[`/catalogue/units/${code}`]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/catalogue/units/:code" element={<UnitDetailPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('unit browser pages', () => {
  it('loads active units in the signed-in shell without requiring CATALOG_READ', async () => {
    vi.mocked(useAuth).mockReturnValue(signedInAuth());
    vi.mocked(unitClient.list).mockResolvedValue([unit]);
    renderList();
    expect(await screen.findByText('SQ_FT')).toBeInTheDocument();
    expect(screen.getByText('Square Feet')).toBeInTheDocument();
    expect(unitClient.list).toHaveBeenCalledWith(
      expect.objectContaining({
        activeOnly: true,
        classification: undefined,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('shows the unit navigation for a signed-in staff account without catalogue permissions', () => {
    vi.mocked(useAuth).mockReturnValue(signedInAuth());
    render(
      <MemoryRouter>
        <AdminLayout>
          <div />
        </AdminLayout>
      </MemoryRouter>,
    );
    expect(screen.getByText('Units')).toBeInTheDocument();
  });

  it('applies only supported classification and include-inactive filters', async () => {
    vi.mocked(useAuth).mockReturnValue(signedInAuth());
    vi.mocked(unitClient.list).mockResolvedValue([unit]);
    renderList();
    await screen.findByText('SQ_FT');
    fireEvent.click(screen.getByRole('radio', { name: 'AREA' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Include inactive' }));
    fireEvent.click(screen.getByRole('button', { name: /Apply filters/ }));
    await waitFor(() =>
      expect(unitClient.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ classification: 'AREA', activeOnly: false }),
      ),
    );
    expect(screen.getByText(/returns active and inactive units/i)).toBeInTheDocument();
    expect(screen.getByText(/no inactive-only filter/i)).toBeInTheDocument();
  }, 15000);

  it('shows empty, loading and retry states', async () => {
    vi.mocked(useAuth).mockReturnValue(signedInAuth());
    vi.mocked(unitClient.list)
      .mockRejectedValueOnce(new ApiError('offline', 0, 'NETWORK_ERROR'))
      .mockResolvedValueOnce([]);
    const view = renderList();
    expect(view.container.querySelector('.ant-skeleton')).toBeInTheDocument();
    expect(await screen.findByText('Could not load units')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('No units match these filters')).toBeInTheDocument();
  });

  it('renders available DTO fields on the code detail route', async () => {
    vi.mocked(useAuth).mockReturnValue(signedInAuth());
    vi.mocked(unitClient.getByCode).mockResolvedValue(unit);
    renderDetail('SQ_FT');
    expect(await screen.findByText('Square Foot', { selector: 'h1' })).toBeInTheDocument();
    expect(screen.getByText('unit-id')).toBeInTheDocument();
    expect(screen.getByText('sq ft')).toBeInTheDocument();
    expect(screen.getByText('Flooring and surface area')).toBeInTheDocument();
    expect(screen.getByText('2 decimal places')).toBeInTheDocument();
    expect(screen.getByText(/Continuous/)).toBeInTheDocument();
    expect(unitClient.getByCode).toHaveBeenCalledWith('SQ_FT', {
      signal: expect.any(AbortSignal),
    });
  });

  it('does not request invalid codes and handles missing units', async () => {
    vi.mocked(useAuth).mockReturnValue(signedInAuth());
    renderDetail('bad-code!');
    expect(screen.getByText('Invalid unit code')).toBeInTheDocument();
    expect(unitClient.getByCode).not.toHaveBeenCalled();

    vi.mocked(unitClient.getByCode).mockRejectedValueOnce(
      new ApiError('Not found', 404, 'UNIT_NOT_FOUND'),
    );
    renderDetail('UNKNOWN');
    expect(await screen.findByText('Unit not found')).toBeInTheDocument();
  });

  it('renders inactive status and exposes no mutation controls', async () => {
    vi.mocked(useAuth).mockReturnValue(signedInAuth());
    vi.mocked(unitClient.list).mockResolvedValue([{ ...unit, isActive: false }]);
    renderList();
    await screen.findByText('SQ_FT');
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create|edit|delete|activate|deactivate/i }),
    ).not.toBeInTheDocument();
  });
});
