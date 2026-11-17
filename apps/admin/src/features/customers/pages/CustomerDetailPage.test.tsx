import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  PermissionCode,
  UserStatus,
  UserType,
  type IAuthUser,
  type IAdminCustomerDetailDto,
} from '@thehomez/shared-types';
import { ApiError } from '../../../services/api-client.js';
import { useAuth } from '../../../providers/AuthProvider.js';
import { ProtectedRoute } from '../../../routes/ProtectedRoute.js';
import { AdminLayout } from '../../../layouts/AdminLayout.js';
import { customerClient } from '../api/customer-client.js';
import { CustomerDetailPage } from './CustomerDetailPage.js';
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

const staffWithSuspendPerm: IAuthUser = {
  id: 'staff-customer-suspender',
  phone: '+919999999998',
  email: 'suspender@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['CUSTOMER_SUPPORT_LEAD'],
  permissions: [PermissionCode.CUSTOMER_READ, PermissionCode.CUSTOMER_SUSPEND],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const staffWithB2bVerifyPerm: IAuthUser = {
  id: 'staff-b2b-verifier',
  phone: '+919999999997',
  email: 'b2b-verifier@thehomez.com',
  userType: UserType.STAFF,
  status: UserStatus.ACTIVE,
  roles: ['B2B_ONBOARDING_SPECIALIST'],
  permissions: [PermissionCode.CUSTOMER_READ, PermissionCode.B2B_VERIFY],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const mockCustomerDetail1: IAdminCustomerDetailDto = {
  id: '507f1f77bcf86cd799439011',
  phone: '+919876543210',
  email: 'ramesh.kumar@example.com',
  status: UserStatus.ACTIVE,
  roles: ['B2B_CUSTOMER'],
  customerSegment: 'B2B',
  metadata: {
    companyName: 'Kumar Construction Supplies Ltd',
    gstin: '29ABCDE1234F1Z5',
  },
  addresses: [
    {
      id: 'addr-001',
      label: 'Main Site Office',
      recipientName: 'Ramesh Kumar',
      phone: '+919876543210',
      streetAddress: 'Plot 42, Phase 2, Industrial Corridor',
      landmark: 'Near Metro Station Gate 3',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      siteContactPerson: {
        name: 'Vikas Site Supervisor',
        phone: '+919876543299',
      },
      heavyVehicleAccessInstructions:
        'Gate 2 access for 10-wheel tipper trucks between 9 AM and 5 PM.',
      isDefault: true,
      isServiceable: true,
      serviceArea: {
        id: 'sa-001',
        code: 'BLR-CENTRAL',
        name: 'Bengaluru Central Delivery Hub',
        city: 'Bengaluru',
        state: 'Karnataka',
      },
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-02-01T14:30:00.000Z',
    },
    {
      id: 'addr-002',
      label: 'Secondary Storage Yard',
      recipientName: 'Ramesh Kumar',
      phone: '+919876543210',
      streetAddress: 'Survey 88, Hosur Road Extension',
      landmark: null,
      city: 'Anekal',
      state: 'Karnataka',
      pincode: '562106',
      siteContactPerson: null,
      heavyVehicleAccessInstructions: null,
      isDefault: false,
      isServiceable: false,
      serviceArea: null,
      createdAt: '2026-02-10T11:00:00.000Z',
      updatedAt: '2026-02-10T11:00:00.000Z',
    },
  ],
  lastLoginAt: '2026-02-15T10:30:00.000Z',
  createdAt: '2026-01-10T08:00:00.000Z',
  updatedAt: '2026-02-15T10:30:00.000Z',
};

const mockCustomerDetailEmptyAddresses: IAdminCustomerDetailDto = {
  id: '507f1f77bcf86cd799439012',
  phone: '+919876543211',
  email: null,
  status: UserStatus.SUSPENDED,
  roles: [],
  customerSegment: 'B2C',
  metadata: {},
  addresses: [],
  lastLoginAt: null,
  createdAt: '2026-01-12T09:00:00.000Z',
  updatedAt: '2026-01-12T09:00:00.000Z',
};

function createAuthContext(user: IAuthUser | null) {
  return {
    user,
    status: user ? ('signed-in' as const) : ('signed-out' as const),
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
}

function renderCustomerDetail(
  initialPath = '/customers/507f1f77bcf86cd799439011',
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
          <Route
            path="/customers/:id"
            element={
              <AdminLayout>
                <CustomerDetailPage />
              </AdminLayout>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Admin Customer Detail View (Stage C-5)', () => {
  beforeEach(() => {
    vi.mocked(customerClient.getCustomerById).mockResolvedValue(mockCustomerDetail1);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Permissions and Security Enforcement', () => {
    it('allows authorized staff with CUSTOMER_READ to inspect customer details', async () => {
      renderCustomerDetail();

      expect(
        await screen.findByRole('heading', { level: 1, name: '+919876543210' }),
      ).toBeInTheDocument();
      expect(customerClient.getCustomerById).toHaveBeenCalledWith(
        '507f1f77bcf86cd799439011',
        expect.anything(),
      );
    });

    it('denies access with 403 message and does not request customer API when permission is missing', async () => {
      renderCustomerDetail('/customers/507f1f77bcf86cd799439011', staffWithoutCustomerRead);

      expect(await screen.findByText('Permission required')).toBeInTheDocument();
      expect(customerClient.getCustomerById).not.toHaveBeenCalled();
    });

    it('redirects unauthenticated users to /sign-in', async () => {
      renderCustomerDetail('/customers/507f1f77bcf86cd799439011', null);

      expect(await screen.findByTestId('sign-in-page')).toBeInTheDocument();
      expect(customerClient.getCustomerById).not.toHaveBeenCalled();
    });

    it('provides page-level defense-in-depth within CustomerDetailPage', async () => {
      vi.mocked(useAuth).mockReturnValue(createAuthContext(staffWithoutCustomerRead));
      render(
        <MemoryRouter initialEntries={['/customers/507f1f77bcf86cd799439011']}>
          <CustomerDetailPage />
        </MemoryRouter>,
      );

      expect(await screen.findByText('CUSTOMER_READ permission required')).toBeInTheDocument();
      expect(customerClient.getCustomerById).not.toHaveBeenCalled();
    });
  });

  describe('2. Customer Identity and Account Information Rendering', () => {
    it('renders customer ID, phone, email, and badges from actual DTO', async () => {
      renderCustomerDetail();

      expect(
        await screen.findByRole('heading', { level: 1, name: '+919876543210' }),
      ).toBeInTheDocument();
      const idMatches = screen.getAllByText('507f1f77bcf86cd799439011');
      expect(idMatches.length).toBeGreaterThanOrEqual(1);

      expect(screen.getByText('ramesh.kumar@example.com')).toBeInTheDocument();
      expect(screen.getAllByText('ACTIVE').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('B2B Wholesale').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('B2B_CUSTOMER')).toBeInTheDocument();
    });

    it('renders fallback em-dash for null email and Never for null lastLoginAt', async () => {
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(
        mockCustomerDetailEmptyAddresses,
      );

      renderCustomerDetail('/customers/507f1f77bcf86cd799439012');

      expect(
        await screen.findByRole('heading', { level: 1, name: '+919876543211' }),
      ).toBeInTheDocument();
      expect(screen.getAllByText('SUSPENDED').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('B2C Retail').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Never')).toBeInTheDocument();

      const emDashes = screen.getAllByText('—');
      expect(emDashes.length).toBeGreaterThanOrEqual(1);
    });

    it('renders safe account metadata when provided', async () => {
      renderCustomerDetail();

      expect(await screen.findByText('Kumar Construction Supplies Ltd')).toBeInTheDocument();
      expect(screen.getByText('29ABCDE1234F1Z5')).toBeInTheDocument();
    });

    it('gracefully handles missing optional metadata without errors', async () => {
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(
        mockCustomerDetailEmptyAddresses,
      );

      renderCustomerDetail('/customers/507f1f77bcf86cd799439012');

      expect(
        await screen.findByRole('heading', { level: 1, name: '+919876543211' }),
      ).toBeInTheDocument();
      expect(screen.queryByText('Account Metadata')).not.toBeInTheDocument();
    });
  });

  describe('3. Delivery Site Addresses & Serviceability Inspection', () => {
    it('renders multiple delivery site addresses with all supported fields', async () => {
      renderCustomerDetail();

      expect(await screen.findByText('Main Site Office')).toBeInTheDocument();
      expect(screen.getByText('Secondary Storage Yard')).toBeInTheDocument();
      expect(screen.getByText('Plot 42, Phase 2, Industrial Corridor')).toBeInTheDocument();
      expect(screen.getByText('Survey 88, Hosur Road Extension')).toBeInTheDocument();
      expect(screen.getByText('Bengaluru, Karnataka - 560001')).toBeInTheDocument();
      expect(screen.getByText('Anekal, Karnataka - 562106')).toBeInTheDocument();
    });

    it('clearly identifies the default delivery address', async () => {
      renderCustomerDetail();

      expect(await screen.findByText('Default Address')).toBeInTheDocument();
    });

    it('displays site contact person and heavy vehicle instructions when present', async () => {
      renderCustomerDetail();

      expect(await screen.findByText(/Vikas Site Supervisor/)).toBeInTheDocument();
      expect(screen.getByText(/\+919876543299/)).toBeInTheDocument();
      expect(
        screen.getByText('Gate 2 access for 10-wheel tipper trucks between 9 AM and 5 PM.'),
      ).toBeInTheDocument();
    });

    it('renders serviceability information matching backend resolution', async () => {
      renderCustomerDetail();

      // Address 1: Serviceable with hub details
      expect(await screen.findByText('Serviceable')).toBeInTheDocument();
      expect(screen.getByText('Bengaluru Central Delivery Hub')).toBeInTheDocument();
      expect(screen.getByText('BLR-CENTRAL')).toBeInTheDocument();

      // Address 2: Out of coverage
      expect(screen.getByText('Not Serviceable')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Outside active service coverage (no active service area covering PIN 562106)',
        ),
      ).toBeInTheDocument();
    });

    it('distinguishes undefined serviceability as Coverage Unchecked without claiming Not Serviceable', async () => {
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce({
        ...mockCustomerDetail1,
        addresses: [
          {
            id: 'addr-003',
            label: 'Unchecked Location',
            recipientName: 'Ramesh Kumar',
            phone: '+919876543210',
            streetAddress: '100 Outer Ring Road',
            landmark: null,
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560100',
            siteContactPerson: null,
            heavyVehicleAccessInstructions: null,
            isDefault: false,
            isServiceable: undefined as unknown as boolean,
            serviceArea: undefined as unknown as null,
            createdAt: '2026-02-10T11:00:00.000Z',
            updatedAt: '2026-02-10T11:00:00.000Z',
          },
        ],
      });

      renderCustomerDetail();

      expect(await screen.findByText('Coverage Unchecked')).toBeInTheDocument();
      expect(
        screen.getByText('Serviceability information not provided for this address'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Not Serviceable')).not.toBeInTheDocument();
      expect(screen.queryByText(/Outside active service coverage/)).not.toBeInTheDocument();
    });

    it('renders empty address collection state when customer has no saved addresses', async () => {
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(
        mockCustomerDetailEmptyAddresses,
      );

      renderCustomerDetail('/customers/507f1f77bcf86cd799439012');

      expect(
        await screen.findByText(
          'No saved delivery site addresses registered for this customer account.',
        ),
      ).toBeInTheDocument();
    });

    it('ensures address inspection remains strictly read-only without mutation controls', async () => {
      renderCustomerDetail();

      await screen.findByText('Main Site Office');
      expect(screen.queryByRole('button', { name: /Edit Address/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Delete Address/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add Address/i })).not.toBeInTheDocument();
    });
  });

  describe('4. Navigation and Lifecycle States', () => {
    it('provides back navigation to the customer directory', async () => {
      renderCustomerDetail();

      const backBtn = await screen.findByRole('button', { name: 'Back to customer directory' });
      expect(backBtn).toBeInTheDocument();

      // Mock listCustomers for when returning to /customers
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

      fireEvent.click(backBtn);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: 'Customers' })).toBeInTheDocument();
      });
    });

    it('renders 404 Not Found state when customer does not exist', async () => {
      vi.mocked(customerClient.getCustomerById).mockRejectedValueOnce(
        new ApiError('Customer not found', 404, 'CUSTOMER_NOT_FOUND'),
      );

      renderCustomerDetail('/customers/507f1f77bcf86cd799439999');

      expect(await screen.findByText('Customer Not Found')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Back to Customer Directory' }),
      ).toBeInTheDocument();
    });

    it('renders error state and retries on failure', async () => {
      vi.mocked(customerClient.getCustomerById)
        .mockRejectedValueOnce(new ApiError('Internal server error', 500, 'INTERNAL_ERROR'))
        .mockResolvedValueOnce(mockCustomerDetail1);

      renderCustomerDetail();

      expect(await screen.findByText('Service Unavailable')).toBeInTheDocument();
      const retryBtn = screen.getByRole('button', { name: /Retry/i });

      fireEvent.click(retryBtn);

      expect(
        await screen.findByRole('heading', { level: 1, name: '+919876543210' }),
      ).toBeInTheDocument();
      expect(customerClient.getCustomerById).toHaveBeenCalledTimes(2);
    });
  });

  describe('5. Directory Table Navigation to Detail Page', () => {
    it('navigates from directory table row link to detail page', async () => {
      vi.mocked(customerClient.listCustomers).mockResolvedValueOnce({
        items: [
          {
            id: '507f1f77bcf86cd799439011',
            phone: '+919876543210',
            email: 'ramesh.kumar@example.com',
            status: UserStatus.ACTIVE,
            roles: ['B2B_CUSTOMER'],
            customerSegment: 'B2B',
            addressCount: 2,
            defaultCity: 'Bengaluru',
            defaultPincode: '560001',
            lastLoginAt: '2026-02-15T10:30:00.000Z',
            createdAt: '2026-01-10T08:00:00.000Z',
            updatedAt: '2026-02-15T10:30:00.000Z',
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
      });

      renderCustomerDetail('/customers');

      // Click the customer phone link
      const phoneLink = await screen.findByRole('link', { name: 'Inspect customer +919876543210' });
      fireEvent.click(phoneLink);

      // Verify detail page is rendered
      expect(
        await screen.findByText('Customer Identity & Account Information'),
      ).toBeInTheDocument();
      expect(screen.getByText('Main Site Office')).toBeInTheDocument();
    });

    it('navigates from directory View Details action button to detail page', async () => {
      vi.mocked(customerClient.listCustomers).mockResolvedValueOnce({
        items: [
          {
            id: '507f1f77bcf86cd799439011',
            phone: '+919876543210',
            email: 'ramesh.kumar@example.com',
            status: UserStatus.ACTIVE,
            roles: ['B2B_CUSTOMER'],
            customerSegment: 'B2B',
            addressCount: 2,
            defaultCity: 'Bengaluru',
            defaultPincode: '560001',
            lastLoginAt: '2026-02-15T10:30:00.000Z',
            createdAt: '2026-01-10T08:00:00.000Z',
            updatedAt: '2026-02-15T10:30:00.000Z',
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
      });

      renderCustomerDetail('/customers');

      const viewBtn = await screen.findByRole('button', {
        name: 'View details for customer +919876543210',
      });
      fireEvent.click(viewBtn);

      expect(
        await screen.findByText('Customer Identity & Account Information'),
      ).toBeInTheDocument();
    });
  });

  describe('6. Stage C-6: Page-Level Action Permissions & Security Guards', () => {
    it('does not render account status action buttons when staff lacks CUSTOMER_SUSPEND permission', async () => {
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(mockCustomerDetail1);
      renderCustomerDetail('/customers/507f1f77bcf86cd799439011', staffWithCustomerRead);

      expect(
        await screen.findByText('Customer Identity & Account Information'),
      ).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /suspend customer account/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /reactivate customer account/i })).toBeNull();
    });

    it('renders Suspend Account button for ACTIVE customer when staff has CUSTOMER_SUSPEND', async () => {
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(mockCustomerDetail1);
      renderCustomerDetail('/customers/507f1f77bcf86cd799439011', staffWithSuspendPerm);

      expect(
        await screen.findByRole('button', { name: /suspend customer account/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /reactivate customer account/i })).toBeNull();
    });

    it('renders Reactivate Account button for SUSPENDED customer when staff has CUSTOMER_SUSPEND', async () => {
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(
        mockCustomerDetailEmptyAddresses,
      );
      renderCustomerDetail('/customers/507f1f77bcf86cd799439012', staffWithSuspendPerm);

      expect(
        await screen.findByRole('button', { name: /reactivate customer account/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /suspend customer account/i })).toBeNull();
    });

    it('does not render account status action buttons for PENDING_VERIFICATION customer', async () => {
      const pendingCustomer: IAdminCustomerDetailDto = {
        ...mockCustomerDetail1,
        id: '507f1f77bcf86cd799439013',
        status: UserStatus.PENDING_VERIFICATION,
      };
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(pendingCustomer);
      renderCustomerDetail('/customers/507f1f77bcf86cd799439013', staffWithSuspendPerm);

      expect(
        await screen.findByText('Customer Identity & Account Information'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /suspend customer account/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /reactivate customer account/i })).toBeNull();
    });

    it('does not render B2B action controls when staff lacks B2B_VERIFY permission', async () => {
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(mockCustomerDetail1);
      renderCustomerDetail('/customers/507f1f77bcf86cd799439011', staffWithCustomerRead);

      expect(
        await screen.findByText('Customer Identity & Account Information'),
      ).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /verify b2b/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /update b2b/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /revoke b2b/i })).toBeNull();
    });

    it('renders Verify B2B Contractor button for B2C customer when staff has B2B_VERIFY', async () => {
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(
        mockCustomerDetailEmptyAddresses,
      );
      renderCustomerDetail('/customers/507f1f77bcf86cd799439012', staffWithB2bVerifyPerm);

      expect(
        await screen.findByRole('button', { name: /verify b2b contractor/i }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /revoke b2b/i })).toBeNull();
    });

    it('renders Update B2B Details and Revoke B2B Status for B2B customer when staff has B2B_VERIFY', async () => {
      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(mockCustomerDetail1);
      renderCustomerDetail('/customers/507f1f77bcf86cd799439011', staffWithB2bVerifyPerm);

      expect(
        await screen.findByRole('button', { name: /update b2b details/i }),
      ).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /revoke b2b status/i })).toBeInTheDocument();
    });

    it('safely filters out credential and token metadata fields from display', async () => {
      const customerWithSensitiveData: IAdminCustomerDetailDto = {
        ...mockCustomerDetail1,
        metadata: {
          companyName: 'Legitimate Contractor Co',
          passwordHash: '$2b$10$supersecretneverexpose',
          token: 'sensitive-jwt-token-here',
          refreshToken: 'refresh-token-here',
          signupSource: 'Regional Trade Expo 2026',
        },
      };

      vi.mocked(customerClient.getCustomerById).mockResolvedValueOnce(customerWithSensitiveData);
      renderCustomerDetail('/customers/507f1f77bcf86cd799439011', staffWithCustomerRead);

      expect(await screen.findByText('Regional Trade Expo 2026')).toBeInTheDocument();

      // Assert that credentials are NEVER rendered in the document
      expect(screen.queryByText('$2b$10$supersecretneverexpose')).toBeNull();
      expect(screen.queryByText('sensitive-jwt-token-here')).toBeNull();
      expect(screen.queryByText('refresh-token-here')).toBeNull();
    });
  });
});
