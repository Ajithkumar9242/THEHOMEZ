import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IUnit,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { ProtectedRoute } from '../../../routes/ProtectedRoute.js';
import { AdminLayout } from '../../../layouts/AdminLayout.js';
import { Grid } from 'antd';
import { unitClient } from '../api/unit-client.js';
import { UnitListPage } from './UnitListPage.js';
import { UnitDetailPage } from './UnitDetailPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/unit-client.js', () => ({
  unitClient: {
    list: vi.fn(),
    getByCode: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    listConversions: vi.fn(),
  },
}));

const staffWithCatalogWrite: IAuthUser = {
  id: 'staff-write-1',
  phone: '+919999999999',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['CATALOG_MANAGER'],
  permissions: [PermissionCode.CATALOG_READ, PermissionCode.CATALOG_WRITE],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staffWithCatalogRead: IAuthUser = {
  id: 'staff-read-1',
  phone: '+918888888888',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['CATALOG_VIEWER'],
  permissions: [PermissionCode.CATALOG_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staffWithoutCatalog: IAuthUser = {
  id: 'staff-none-1',
  phone: '+917777777777',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const sqftUnit: IUnit = {
  id: 'unit-sqft-id',
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

const tonneUnit: IUnit = {
  id: 'unit-tonne-id',
  code: 'TONNE',
  name: 'Metric Tonne',
  symbol: 't',
  singularLabel: 'Metric Tonne',
  pluralLabel: 'Metric Tonnes',
  description: 'Bulk structural steel and cement',
  classification: 'MASS',
  isDiscrete: false,
  allowedMaxPrecision: 3,
  isActive: true,
  isSystem: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

function authContext(user: IAuthUser) {
  return {
    user,
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
        <Route element={<ProtectedRoute permission={PermissionCode.CATALOG_READ} />}>
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
        <Route element={<ProtectedRoute permission={PermissionCode.CATALOG_READ} />}>
          <Route path="/catalogue/units/:code" element={<UnitDetailPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('Catalogue Units Management Pages', () => {
  describe('Directory & Listings', () => {
    it('renders directory with units, summary metrics, and columns', async () => {
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithCatalogWrite));
      vi.mocked(unitClient.list).mockResolvedValue([sqftUnit, tonneUnit]);

      renderList();

      expect(await screen.findByText('SQ_FT')).toBeInTheDocument();
      expect(screen.getByText('TONNE')).toBeInTheDocument();
      expect(screen.getByText('Square Foot')).toBeInTheDocument();
      expect(screen.getByText('Metric Tonne')).toBeInTheDocument();

      // Check statistics cards
      expect(screen.getByText('Total Displayed')).toBeInTheDocument();
      expect(screen.getByText('Active Units')).toBeInTheDocument();

      expect(unitClient.list).toHaveBeenCalledWith(
        expect.objectContaining({
          activeOnly: true,
          classification: undefined,
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('shows unit navigation in AdminLayout for staff with CATALOG_READ', () => {
      vi.spyOn(Grid, 'useBreakpoint').mockReturnValue({ md: true, xs: false, sm: true, lg: true, xl: true, xxl: true });
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithCatalogRead));
      render(
        <MemoryRouter>
          <AdminLayout>
            <div />
          </AdminLayout>
        </MemoryRouter>,
      );
      expect(screen.getByText('Units')).toBeInTheDocument();
    });

    it('hides unit navigation in AdminLayout for staff without CATALOG_READ', () => {
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithoutCatalog));
      render(
        <MemoryRouter>
          <AdminLayout>
            <div />
          </AdminLayout>
        </MemoryRouter>,
      );
      expect(screen.queryByText('Units')).not.toBeInTheDocument();
    });

    it('applies classification, status, and search filters', async () => {
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithCatalogWrite));
      vi.mocked(unitClient.list).mockResolvedValue([sqftUnit]);

      renderList();
      await screen.findByText('SQ_FT');

      // Classification filter
      fireEvent.click(screen.getByRole('radio', { name: 'AREA' }));

      // Status filter
      fireEvent.click(screen.getByRole('radio', { name: 'All units' }));

      // Search input
      const searchInput = screen.getByPlaceholderText(/e\.g\. SQ_FT, Tonne/i);
      fireEvent.change(searchInput, { target: { value: 'SQ_FT' } });

      // Apply
      fireEvent.click(screen.getByRole('button', { name: /Apply filters/i }));

      await waitFor(() => {
        expect(unitClient.list).toHaveBeenLastCalledWith(
          expect.objectContaining({
            classification: 'AREA',
            activeOnly: false,
            search: 'SQ_FT',
          }),
        );
      });
    });

    it('shows empty, loading, and error retry states', async () => {
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithCatalogWrite));
      vi.mocked(unitClient.list)
        .mockRejectedValueOnce(new ApiError('Network error', 0, 'NETWORK_ERROR'))
        .mockResolvedValueOnce([]);

      const view = renderList();
      expect(view.container.querySelector('.ant-skeleton')).toBeInTheDocument();

      expect(await screen.findByText('Could not load units')).toBeInTheDocument();

      // Retry
      fireEvent.click(screen.getByRole('button', { name: /retry/i }));
      expect(await screen.findByText('No units match these filters')).toBeInTheDocument();
    });
  });

  describe('Unit Creation & Mutations', () => {
    it('displays Create Unit button for staff with CATALOG_WRITE', async () => {
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithCatalogWrite));
      vi.mocked(unitClient.list).mockResolvedValue([sqftUnit]);

      renderList();
      await screen.findByText('SQ_FT');

      const createBtn = screen.getByRole('button', { name: /Create Unit/i });
      expect(createBtn).toBeInTheDocument();

      // Opens drawer
      fireEvent.click(createBtn);
      expect(await screen.findByText('Create Measurement Unit')).toBeInTheDocument();
    });

    it('hides Create Unit button for staff without CATALOG_WRITE (read-only)', async () => {
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithCatalogRead));
      vi.mocked(unitClient.list).mockResolvedValue([sqftUnit]);

      renderList();
      await screen.findByText('SQ_FT');

      expect(screen.queryByRole('button', { name: /Create Unit/i })).not.toBeInTheDocument();
    });

    it('opens and cancels unit creation drawer', async () => {
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithCatalogWrite));
      vi.mocked(unitClient.list).mockResolvedValue([sqftUnit]);

      renderList();
      await screen.findByText('SQ_FT');

      fireEvent.click(screen.getByRole('button', { name: /Create Unit/i }));
      expect(await screen.findByText('Create Measurement Unit')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    });
  });

  describe('Unit Details Page', () => {
    it('renders complete unit details and universal conversions', async () => {
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithCatalogWrite));
      vi.mocked(unitClient.getByCode).mockResolvedValue(tonneUnit);
      vi.mocked(unitClient.listConversions).mockResolvedValue([
        {
          fromUnit: 'TONNE',
          toUnit: 'KG',
          factor: 1000,
          precision: 3,
          formula: '1 TONNE = 1000 KG',
        },
      ]);

      renderDetail('TONNE');

      expect(await screen.findByText('Metric Tonne', { selector: 'h1' })).toBeInTheDocument();
      expect(screen.getByText('unit-tonne-id')).toBeInTheDocument();
      expect(screen.getByText('t')).toBeInTheDocument();
      expect(screen.getByText('1 TONNE = 1000 KG')).toBeInTheDocument();
      expect(screen.getByText('Configured Universal Conversions')).toBeInTheDocument();

      // Edit and Deactivate buttons visible for write staff
      expect(screen.getByRole('button', { name: /Edit Unit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Deactivate/i })).toBeInTheDocument();
    });

    it('handles invalid code and not found errors', async () => {
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithCatalogWrite));
      renderDetail('invalid*code');

      expect(screen.getByText('Invalid unit code')).toBeInTheDocument();
      expect(unitClient.getByCode).not.toHaveBeenCalled();

      vi.mocked(unitClient.getByCode).mockRejectedValueOnce(
        new ApiError('Unit not found', 404, 'UNIT_NOT_FOUND'),
      );
      renderDetail('NONEXISTENT');
      expect(await screen.findByText('Unit not found')).toBeInTheDocument();
    });

    it('hides edit and deactivate buttons for read-only staff on details page', async () => {
      vi.mocked(useAuth).mockReturnValue(authContext(staffWithCatalogRead));
      vi.mocked(unitClient.getByCode).mockResolvedValue(sqftUnit);
      vi.mocked(unitClient.listConversions).mockResolvedValue([]);

      renderDetail('SQ_FT');

      await screen.findByText('Square Foot', { selector: 'h1' });
      expect(screen.queryByRole('button', { name: /Edit Unit/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Deactivate|Activate/i })).not.toBeInTheDocument();
    });
  });
});
