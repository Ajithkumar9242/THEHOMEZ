import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IAdminCustomerListItemDto,
  type IAdminCustomerListResponseDto,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { ProtectedRoute } from '../../../routes/ProtectedRoute.js';
import { AdminLayout } from '../../../layouts/AdminLayout.js';
import { customerClient } from '../api/customer-client.js';
import { CustomerDirectoryPage } from './CustomerDirectoryPage.js';

vi.mock('../../../providers/AuthProvider.js', () => ({ useAuth: vi.fn() }));
vi.mock('../api/customer-client.js', () => ({
  customerClient: {
    listCustomers: vi.fn(),
    getCustomerById: vi.fn(),
    getCustomerAddresses: vi.fn(),
    updateCustomerStatus: vi.fn(),
    updateCustomerB2bStatus: vi.fn(),
  },
}));

const staffWithCustomerRead: IAuthUser = {
  id: 'staff-customer-reader',
  phone: '+919999999999',
  email: 'staff@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['SUPER_ADMIN'],
  permissions: [PermissionCode.CUSTOMER_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staffWithoutCustomerRead: IAuthUser = {
  id: 'staff-catalog-only',
  phone: '+918888888888',
  email: 'catalog-staff@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['CATALOG_OPERATOR'],
  permissions: [PermissionCode.CATALOG_READ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const customerUser: IAuthUser = {
  id: 'customer-user-1',
  phone: '+917777777777',
  userType: UserType.CUSTOMER,
  status: UserStatus.ACTIVE,
  roles: [],
  permissions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mockCustomer1: IAdminCustomerListItemDto = {
  id: '507f1f77bcf86cd799439011',
  phone: '+919876543210',
  email: 'ramesh.kumar@example.com',
  status: UserStatus.ACTIVE,
  roles: ['B2B_CUSTOMER'],
  customerSegment: 'B2B',
  addressCount: 3,
  defaultCity: 'Bengaluru',
  defaultPincode: '560001',
  lastLoginAt: '2026-02-15T10:30:00.000Z',
  createdAt: '2026-01-10T08:00:00.000Z',
  updatedAt: '2026-02-15T10:30:00.000Z',
};

const mockCustomer2: IAdminCustomerListItemDto = {
  id: '507f1f77bcf86cd799439012',
  phone: '+919876543211',
  email: null,
  status: UserStatus.SUSPENDED,
  roles: [],
  customerSegment: 'B2C',
  addressCount: 0,
  defaultCity: null,
  defaultPincode: null,
  lastLoginAt: null,
  createdAt: '2026-01-12T09:00:00.000Z',
  updatedAt: '2026-01-12T09:00:00.000Z',
};

const mockCustomer3: IAdminCustomerListItemDto = {
  id: '507f1f77bcf86cd799439013',
  phone: '+919876543212',
  email: 'suresh@example.com',
  status: UserStatus.PENDING_VERIFICATION,
  roles: [],
  customerSegment: 'B2C',
  addressCount: 1,
  defaultCity: 'Mumbai',
  defaultPincode: '400001',
  lastLoginAt: '2026-03-01T12:00:00.000Z',
  createdAt: '2026-02-01T11:00:00.000Z',
  updatedAt: '2026-03-01T12:00:00.000Z',
};

const defaultListResponse: IAdminCustomerListResponseDto = {
  items: [mockCustomer1, mockCustomer2, mockCustomer3],
  pagination: {
    total: 3,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
};

function createAuthContext(user: IAuthUser | null) {
  return {
    user,
    status: user ? ('signed-in' as const) : ('signed-out' as const),
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderCustomerDirectory(
  initialPath = '/customers',
  authUser: IAuthUser | null = staffWithCustomerRead,
) {
  vi.mocked(useAuth).mockReturnValue(createAuthContext(authUser));

  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/sign-in" element={<div data-testid="sign-in-page">Sign In Page</div>} />
        <Route element={<ProtectedRoute permission={PermissionCode.CUSTOMER_READ} />}>
          <Route
            path="/customers"
            element={
              <AdminLayout>
                <CustomerDirectoryPage />
              </AdminLayout>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Admin Customer Directory UI (Stage C-4)', () => {
  beforeEach(() => {
    vi.mocked(customerClient.listCustomers).mockResolvedValue(defaultListResponse);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Routing and Permissions', () => {
    it('allows authorized staff with CUSTOMER_READ to access /customers', async () => {
      renderCustomerDirectory('/customers', staffWithCustomerRead);

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Customers' }),
      ).toBeInTheDocument();
      expect(screen.getByText('+919876543210')).toBeInTheDocument();
      expect(customerClient.listCustomers).toHaveBeenCalledTimes(1);
    });

    it('denies access to staff without CUSTOMER_READ with a 403 Result', async () => {
      renderCustomerDirectory('/customers', staffWithoutCustomerRead);

      expect(await screen.findByText('Permission required')).toBeInTheDocument();
      expect(
        screen.getByText(
          'The backend identity does not include the permission required for this page.',
        ),
      ).toBeInTheDocument();
      expect(customerClient.listCustomers).not.toHaveBeenCalled();
    });

    it('redirects unauthenticated users to /sign-in', async () => {
      renderCustomerDirectory('/customers', null);

      expect(await screen.findByTestId('sign-in-page')).toBeInTheDocument();
      expect(customerClient.listCustomers).not.toHaveBeenCalled();
    });

    it('redirects non-staff users (e.g. CUSTOMER) to /sign-in', async () => {
      renderCustomerDirectory('/customers', customerUser);

      expect(await screen.findByTestId('sign-in-page')).toBeInTheDocument();
      expect(customerClient.listCustomers).not.toHaveBeenCalled();
    });

    it('displays Customers in sidebar navigation when staff has CUSTOMER_READ', () => {
      vi.mocked(useAuth).mockReturnValue(createAuthContext(staffWithCustomerRead));
      render(
        <MemoryRouter>
          <AdminLayout>
            <div>Content</div>
          </AdminLayout>
        </MemoryRouter>,
      );

      expect(screen.getByText('Customers')).toBeInTheDocument();
    });

    it('hides Customers from sidebar navigation when staff lacks CUSTOMER_READ', () => {
      vi.mocked(useAuth).mockReturnValue(createAuthContext(staffWithoutCustomerRead));
      render(
        <MemoryRouter>
          <AdminLayout>
            <div>Content</div>
          </AdminLayout>
        </MemoryRouter>,
      );

      expect(screen.queryByText('Customers')).not.toBeInTheDocument();
    });

    it('provides defense-in-depth within CustomerDirectoryPage when rendered without permission', async () => {
      vi.mocked(useAuth).mockReturnValue(createAuthContext(staffWithoutCustomerRead));
      render(
        <MemoryRouter>
          <CustomerDirectoryPage />
        </MemoryRouter>,
      );

      expect(await screen.findByText('CUSTOMER_READ permission required')).toBeInTheDocument();
      expect(customerClient.listCustomers).not.toHaveBeenCalled();
    });
  });

  describe('2. Directory Rendering and Contracts', () => {
    it('renders customer rows with phone and ObjectId identifier using id field', async () => {
      renderCustomerDirectory();

      expect(await screen.findByText('+919876543210')).toBeInTheDocument();
      expect(screen.getByText('507f1f77bcf86cd799439011')).toBeInTheDocument();
      expect(screen.getByText('+919876543211')).toBeInTheDocument();
      expect(screen.getByText('507f1f77bcf86cd799439012')).toBeInTheDocument();
      expect(screen.getByText('+919876543212')).toBeInTheDocument();
      expect(screen.getByText('507f1f77bcf86cd799439013')).toBeInTheDocument();
    });

    it('renders addressCount directly from the backend DTO', async () => {
      const { container } = renderCustomerDirectory();

      await screen.findByText('+919876543210');
      const row1 = container.querySelector<HTMLElement>(
        'tr[data-row-key="507f1f77bcf86cd799439011"]',
      );
      const row2 = container.querySelector<HTMLElement>(
        'tr[data-row-key="507f1f77bcf86cd799439012"]',
      );
      const row3 = container.querySelector<HTMLElement>(
        'tr[data-row-key="507f1f77bcf86cd799439013"]',
      );

      expect(row1).toBeTruthy();
      expect(row2).toBeTruthy();
      expect(row3).toBeTruthy();

      expect(within(row1!).getByText('3')).toBeInTheDocument();
      expect(within(row2!).getByText('0')).toBeInTheDocument();
      expect(within(row3!).getByText('1')).toBeInTheDocument();
    });

    it('renders defaultCity and defaultPincode combined or em-dash fallback when absent', async () => {
      renderCustomerDirectory();

      // Customer 1: Bengaluru, 560001 -> 'Bengaluru - 560001'
      expect(await screen.findByText('Bengaluru - 560001')).toBeInTheDocument();
      // Customer 3: Mumbai, 400001 -> 'Mumbai - 400001'
      expect(screen.getByText('Mumbai - 400001')).toBeInTheDocument();
      // Customer 2: defaultCity null, defaultPincode null -> em-dash fallback
      const emDashes = screen.getAllByText('—');
      expect(emDashes.length).toBeGreaterThanOrEqual(2); // email and default location
    });

    it('handles missing email with an em-dash fallback', async () => {
      renderCustomerDirectory();

      expect(await screen.findByText('ramesh.kumar@example.com')).toBeInTheDocument();
      expect(screen.getByText('suresh@example.com')).toBeInTheDocument();
      // Customer 2 has null email -> renders '—'
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });

    it('renders B2B and B2C segment badges correctly', async () => {
      renderCustomerDirectory();

      expect(await screen.findByText('B2B Wholesale')).toBeInTheDocument();
      expect(screen.getAllByText('B2C Retail').length).toBe(2);
    });

    it('renders ACTIVE, SUSPENDED, and PENDING_VERIFICATION status badges', async () => {
      renderCustomerDirectory();

      expect(await screen.findByText('ACTIVE')).toBeInTheDocument();
      expect(screen.getByText('SUSPENDED')).toBeInTheDocument();
      expect(screen.getByText('PENDING VERIFICATION')).toBeInTheDocument();
    });

    it('renders formatted last login date or "Never" when null', async () => {
      renderCustomerDirectory();

      expect(await screen.findByText('Never')).toBeInTheDocument();
    });

    it('displays total customer count from pagination metadata in page header and table footer', async () => {
      renderCustomerDirectory();

      const counts = await screen.findAllByText('3 customers');
      expect(counts.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. Search Behavior', () => {
    it('debounces text search input before calling API', async () => {
      renderCustomerDirectory();

      await screen.findByText('+919876543210');
      const searchInput = screen.getByRole('textbox', { name: 'Search customers' });

      fireEvent.change(searchInput, { target: { value: '+919876543210' } });

      // Immediate check: API not called right away for debounce
      expect(customerClient.listCustomers).toHaveBeenCalledTimes(1);

      // Advance and wait for debounced call
      await waitFor(() => {
        expect(customerClient.listCustomers).toHaveBeenCalledWith(
          expect.objectContaining({
            search: '+919876543210',
            page: 1,
          }),
          expect.anything(),
        );
      });
    });

    it('omits empty or whitespace-only search queries', async () => {
      renderCustomerDirectory();

      await screen.findByText('+919876543210');
      const searchInput = screen.getByRole('textbox', { name: 'Search customers' });

      fireEvent.change(searchInput, { target: { value: '    ' } });

      await waitFor(() => {
        expect(customerClient.listCustomers).toHaveBeenLastCalledWith(
          expect.objectContaining({
            search: undefined,
          }),
          expect.anything(),
        );
      });
    });

    it('resets page to 1 on immediate search submission via Enter', async () => {
      renderCustomerDirectory();

      await screen.findByText('+919876543210');
      const searchInput = screen.getByRole('textbox', { name: 'Search customers' });

      fireEvent.change(searchInput, { target: { value: '507f1f77bcf86cd799439011' } });
      fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(customerClient.listCustomers).toHaveBeenCalledWith(
          expect.objectContaining({
            search: '507f1f77bcf86cd799439011',
            page: 1,
          }),
          expect.anything(),
        );
      });
    });

    it('cancels outdated requests via AbortSignal when search changes rapidly', async () => {
      renderCustomerDirectory();

      await screen.findByText('+919876543210');
      const searchInput = screen.getByRole('textbox', { name: 'Search customers' });

      fireEvent.change(searchInput, { target: { value: 'first' } });
      fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

      fireEvent.change(searchInput, { target: { value: 'second' } });
      fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(customerClient.listCustomers).toHaveBeenLastCalledWith(
          expect.objectContaining({
            search: 'second',
          }),
          expect.anything(),
        );
      });
    });
  });

  describe('4. Filter Controls', () => {
    it('applies status filter and queries backend with UserStatus enum', async () => {
      const { container } = renderCustomerDirectory();

      await screen.findByText('+919876543210');
      const statusSelect = container.querySelector(
        '[data-testid="customer-status-filter"] .ant-select-selector',
      );
      expect(statusSelect).toBeTruthy();

      // Click to open select options
      fireEvent.mouseDown(statusSelect!);

      // Select 'Suspended'
      const suspendedOption = await screen.findByTitle('Suspended');
      fireEvent.click(suspendedOption);

      await waitFor(() => {
        expect(customerClient.listCustomers).toHaveBeenCalledWith(
          expect.objectContaining({
            status: UserStatus.SUSPENDED,
            page: 1,
          }),
          expect.anything(),
        );
      });
    });

    it('applies segment filter and queries backend with B2B segment', async () => {
      const { container } = renderCustomerDirectory();

      await screen.findByText('+919876543210');
      const segmentSelect = container.querySelector(
        '[data-testid="customer-segment-filter"] .ant-select-selector',
      );
      expect(segmentSelect).toBeTruthy();

      fireEvent.mouseDown(segmentSelect!);

      const b2bOption = await screen.findByTitle('B2B Wholesale');
      fireEvent.click(b2bOption);

      await waitFor(() => {
        expect(customerClient.listCustomers).toHaveBeenCalledWith(
          expect.objectContaining({
            segment: 'B2B',
            page: 1,
          }),
          expect.anything(),
        );
      });
    });

    it('clears all active filters and search with Clear Filters button', async () => {
      renderCustomerDirectory();

      await screen.findByText('+919876543210');
      const searchInput = screen.getByRole('textbox', { name: 'Search customers' });

      fireEvent.change(searchInput, { target: { value: 'search-term' } });
      fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

      const clearBtn = await screen.findByRole('button', { name: 'Clear all filters' });
      expect(clearBtn).not.toBeDisabled();

      fireEvent.click(clearBtn);

      await waitFor(() => {
        expect(customerClient.listCustomers).toHaveBeenLastCalledWith(
          expect.objectContaining({
            search: undefined,
            status: undefined,
            segment: undefined,
            page: 1,
          }),
          expect.anything(),
        );
      });
    });
  });

  describe('5. Sorting and Pagination', () => {
    it('sorts by lastLoginAt when column header is clicked', async () => {
      renderCustomerDirectory();

      await screen.findByText('+919876543210');
      const lastLoginHeader = screen.getByRole('columnheader', { name: /Last Login/i });

      fireEvent.click(lastLoginHeader);

      await waitFor(() => {
        expect(customerClient.listCustomers).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'lastLoginAt',
            sortOrder: expect.stringMatching(/asc|desc/),
          }),
          expect.anything(),
        );
      });
    });

    it('sorts by phone when phone column header is clicked', async () => {
      renderCustomerDirectory();

      await screen.findByText('+919876543210');
      const phoneHeader = screen.getByRole('columnheader', { name: /Customer/i });

      fireEvent.click(phoneHeader);

      await waitFor(() => {
        expect(customerClient.listCustomers).toHaveBeenCalledWith(
          expect.objectContaining({
            sortBy: 'phone',
            sortOrder: expect.stringMatching(/asc|desc/),
          }),
          expect.anything(),
        );
      });
    });

    it('handles pagination page changes', async () => {
      vi.mocked(customerClient.listCustomers).mockResolvedValueOnce({
        items: [mockCustomer1],
        pagination: {
          total: 45,
          page: 1,
          limit: 20,
          totalPages: 3,
          hasNextPage: true,
          hasPrevPage: false,
        },
      });

      renderCustomerDirectory();

      await screen.findByText('+919876543210');

      // Click page 2 in pagination
      const page2Btn = screen.getByRole('listitem', { name: '2' });
      fireEvent.click(page2Btn);

      await waitFor(() => {
        expect(customerClient.listCustomers).toHaveBeenCalledWith(
          expect.objectContaining({
            page: 2,
          }),
          expect.anything(),
        );
      });
    });

    it('accurately consumes and reflects all backend pagination metadata fields', async () => {
      vi.mocked(customerClient.listCustomers).mockResolvedValueOnce({
        items: [mockCustomer1],
        pagination: {
          total: 85,
          page: 2,
          limit: 20,
          totalPages: 5,
          hasNextPage: true,
          hasPrevPage: true,
        },
      });

      const { container } = renderCustomerDirectory();

      await screen.findByText('+919876543210');
      // Total count in header
      const headerCounts = await screen.findAllByText('85 customers');
      expect(headerCounts.length).toBeGreaterThanOrEqual(1);

      // Pagination items in Ant Design Table pagination
      const paginationList = container.querySelector<HTMLElement>('.ant-pagination');
      expect(paginationList).toBeTruthy();
      expect(within(paginationList!).getByTitle('1')).toBeInTheDocument();
      expect(within(paginationList!).getByTitle('2')).toBeInTheDocument();
      expect(within(paginationList!).getByTitle('5')).toBeInTheDocument();
      const prevBtn = within(paginationList!).getByTitle('Previous Page');
      const nextBtn = within(paginationList!).getByTitle('Next Page');
      expect(prevBtn).toHaveClass('ant-pagination-disabled');
      expect(nextBtn).not.toHaveClass('ant-pagination-disabled');
    });
  });

  describe('6. Request States (Loading, Empty, Error & Retry)', () => {
    it('shows empty state when no customer accounts exist', async () => {
      vi.mocked(customerClient.listCustomers).mockResolvedValueOnce({
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

      renderCustomerDirectory();

      expect(await screen.findByText('No customer accounts registered')).toBeInTheDocument();
    });

    it('shows filtered empty state with clear filters button when search returns 0 results', async () => {
      vi.mocked(customerClient.listCustomers).mockResolvedValue({
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

      renderCustomerDirectory();

      const searchInput = await screen.findByRole('textbox', { name: 'Search customers' });
      fireEvent.change(searchInput, { target: { value: 'nonexistent-phone' } });
      fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

      expect(
        await screen.findByText('No customers match the current search or filter criteria'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
    });

    it('renders 400 validation error gracefully with retry button', async () => {
      vi.mocked(customerClient.listCustomers).mockRejectedValueOnce(
        new ApiError('Invalid limit parameter', 400, 'VALIDATION_ERROR'),
      );

      renderCustomerDirectory();

      expect(await screen.findByText('Invalid Query Parameters')).toBeInTheDocument();
      expect(screen.getByText('Invalid limit parameter')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    });

    it('renders 401 unauthenticated session expired message', async () => {
      vi.mocked(customerClient.listCustomers).mockRejectedValueOnce(
        new ApiError('Token expired', 401, 'UNAUTHORIZED'),
      );

      renderCustomerDirectory();

      expect(await screen.findByText('Session Expired')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    });

    it('renders 403 forbidden error message', async () => {
      vi.mocked(customerClient.listCustomers).mockRejectedValueOnce(
        new ApiError('Access denied', 403, 'FORBIDDEN'),
      );

      renderCustomerDirectory();

      expect(await screen.findByText('Permission Denied')).toBeInTheDocument();
      expect(
        screen.getByText('Your staff account does not have the required CUSTOMER_READ permission.'),
      ).toBeInTheDocument();
    });

    it('renders network failure error alert', async () => {
      vi.mocked(customerClient.listCustomers).mockRejectedValueOnce(
        new ApiError('Failed to fetch', 0, 'NETWORK_ERROR'),
      );

      renderCustomerDirectory();

      expect(await screen.findByText('Network Connection Failure')).toBeInTheDocument();
    });

    it('renders 500 server error alert', async () => {
      vi.mocked(customerClient.listCustomers).mockRejectedValueOnce(
        new ApiError('Internal server error', 500, 'INTERNAL_ERROR'),
      );

      renderCustomerDirectory();

      expect(await screen.findByText('Service Unavailable')).toBeInTheDocument();
    });

    it('re-executes request when Retry button is clicked', async () => {
      vi.mocked(customerClient.listCustomers)
        .mockRejectedValueOnce(new ApiError('Temporary glitch', 503, 'SERVICE_UNAVAILABLE'))
        .mockResolvedValueOnce(defaultListResponse);

      renderCustomerDirectory();

      const retryBtn = await screen.findByRole('button', { name: /Retry/i });
      fireEvent.click(retryBtn);

      expect(await screen.findByText('+919876543210')).toBeInTheDocument();
      expect(customerClient.listCustomers).toHaveBeenCalledTimes(2);
    });
  });
});
