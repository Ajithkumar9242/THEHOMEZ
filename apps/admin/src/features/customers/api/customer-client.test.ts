import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  type IAdminCustomerDetailDto,
  type IAdminCustomerListItemDto,
  type IAdminCustomerListResponseDto,
  type ICustomerAddressDto,
  type IUpdateCustomerB2bStatusDto,
  type IUpdateCustomerStatusDto,
  UserStatus,
} from '@thehomez/shared-types';
import { ApiError, authApi, clearAccessToken } from '../../../services/api-client.js';
import { customerClient, type CustomerListQuery } from './customer-client.js';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(status >= 400 ? payload : { success: true, data: payload }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function establishMemorySession(): Promise<void> {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(
      json({
        tokens: { accessToken: 'memory-admin-customer-token', expiresIn: 900, tokenType: 'Bearer' },
        user: {
          id: 'staff-admin-1',
          phone: '+919988000001',
          userType: 'STAFF',
          status: 'ACTIVE',
          roles: ['SUPER_ADMIN'],
          permissions: ['customer:read', 'customer:suspend', 'b2b:verify'],
          createdAt: new Date().toISOString(),
        },
      }),
    ),
  );
  await authApi.loginWithPassword('admin@thehomez.in', 'secure-admin-pass');
}

const mockCustomerAddress: ICustomerAddressDto = {
  id: 'addr-001',
  label: 'Headquarters Site',
  recipientName: 'Ajith Site Supervisor',
  phone: '+919876543210',
  streetAddress: 'Plot 42, EPIP Industrial Zone',
  landmark: 'Near Water Tower',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560066',
  siteContactPerson: {
    name: 'Ramesh Foreman',
    phone: '+919876543219',
  },
  heavyVehicleAccessInstructions: 'Unload via Gate 3 for 40-ton trailer clearance',
  isDefault: true,
  isServiceable: true,
  serviceArea: {
    id: 'sa-blr-core',
    code: 'BLR-CORE',
    name: 'Bengaluru Core Hub',
    city: 'Bengaluru',
    state: 'Karnataka',
  },
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const mockCustomerListItem: IAdminCustomerListItemDto = {
  id: 'cust-001',
  phone: '+919876543210',
  email: 'contractor@apexinfra.in',
  status: UserStatus.ACTIVE,
  roles: ['B2B_CUSTOMER'],
  customerSegment: 'B2B',
  addressCount: 2,
  defaultCity: 'Bengaluru',
  defaultPincode: '560066',
  lastLoginAt: '2026-11-17T06:00:00.000Z',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-17T06:00:00.000Z',
};

const mockCustomerListResponse: IAdminCustomerListResponseDto = {
  items: [mockCustomerListItem],
  pagination: {
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  },
};

const mockCustomerDetail: IAdminCustomerDetailDto = {
  id: 'cust-001',
  phone: '+919876543210',
  email: 'contractor@apexinfra.in',
  status: UserStatus.ACTIVE,
  roles: ['B2B_CUSTOMER'],
  customerSegment: 'B2B',
  metadata: {
    companyName: 'Apex Infra Projects Pvt Ltd',
    gstin: '29AAAAA0000A1Z5',
    b2bVerification: {
      isB2B: true,
      companyName: 'Apex Infra Projects Pvt Ltd',
      gstin: '29AAAAA0000A1Z5',
      verifiedByStaffId: 'staff-admin-1',
      verifiedAt: '2026-11-10T12:00:00.000Z',
      reason: 'Verified valid GSTIN registration and commercial trade certificate',
    },
  },
  addresses: [mockCustomerAddress],
  lastLoginAt: '2026-11-17T06:00:00.000Z',
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-17T06:00:00.000Z',
};

afterEach(() => {
  clearAccessToken();
  vi.unstubAllGlobals();
});

describe('customerClient (Stage C-3 API Client & Contract Tests)', () => {
  // =========================================================================
  // 1. API 1: CUSTOMER DIRECTORY (listCustomers)
  // =========================================================================
  describe('listCustomers (GET /api/v1/admin/customers)', () => {
    it('requests /api/v1/admin/customers without query parameters when query is empty', async () => {
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerListResponse));
      vi.stubGlobal('fetch', fetchMock);

      const result = await customerClient.listCustomers();

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockCustomerListResponse);
      expectTypeOf(result).toEqualTypeOf<IAdminCustomerListResponseDto>();
    });

    it('serializes all supported directory query filters accurately', async () => {
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerListResponse));
      vi.stubGlobal('fetch', fetchMock);

      const query: CustomerListQuery = {
        page: 2,
        limit: 10,
        search: '  +919876543210  ',
        status: UserStatus.ACTIVE,
        segment: 'B2B',
        sortBy: 'phone',
        sortOrder: 'asc',
      };

      await customerClient.listCustomers(query);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers?page=2&limit=10&search=%2B919876543210&status=ACTIVE&segment=B2B&sortBy=phone&sortOrder=asc',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('omits empty or whitespace-only search query string', async () => {
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerListResponse));
      vi.stubGlobal('fetch', fetchMock);

      await customerClient.listCustomers({ search: '    ' });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('attaches Authorization Bearer token from established memory session', async () => {
      await establishMemorySession();
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerListResponse));
      vi.stubGlobal('fetch', fetchMock);

      await customerClient.listCustomers({ page: 1 });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers?page=1',
        expect.objectContaining({
          method: 'GET',
          headers: expect.any(Headers),
        }),
      );

      const headers = fetchMock.mock.calls[0]![1].headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer memory-admin-customer-token');
    });

    it('forwards AbortSignal options to fetch request', async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerListResponse));
      vi.stubGlobal('fetch', fetchMock);

      await customerClient.listCustomers({ page: 1 }, { signal: controller.signal });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers?page=1',
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it('propagates backend 400 validation error (e.g. invalid query boundary)', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json(
              { error: { code: 'VALIDATION_ERROR', message: 'limit must be between 1 and 100' } },
              400,
            ),
          ),
      );

      await expect(customerClient.listCustomers({ limit: 150 })).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'limit must be between 1 and 100',
      });
    });

    it('propagates backend 401 unauthenticated error', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json(
              { error: { code: 'UNAUTHORIZED', message: 'Authentication token is required' } },
              401,
            ),
          ),
      );

      await expect(customerClient.listCustomers()).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    });

    it('propagates backend 403 insufficient permission error (CUSTOMER_READ missing)', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json(
              { error: { code: 'FORBIDDEN', message: 'Access denied: requires customer:read' } },
              403,
            ),
          ),
      );

      await expect(customerClient.listCustomers()).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });
    });

    it('propagates network failure as ApiError with code NETWORK_ERROR', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

      await expect(customerClient.listCustomers()).rejects.toMatchObject({
        status: 0,
        code: 'NETWORK_ERROR',
      });
    });
  });

  // =========================================================================
  // 2. API 2: CUSTOMER DETAIL (getCustomerById)
  // =========================================================================
  describe('getCustomerById (GET /api/v1/admin/customers/:id)', () => {
    it('requests /api/v1/admin/customers/:id with encoded path parameter and returns typed customer detail', async () => {
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerDetail));
      vi.stubGlobal('fetch', fetchMock);

      const result = await customerClient.getCustomerById('cust /001');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers/cust%20%2F001',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual(mockCustomerDetail);
      expectTypeOf(result).toEqualTypeOf<IAdminCustomerDetailDto>();
    });

    it('propagates backend 404 customer not found error', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } }, 404),
          ),
      );

      await expect(customerClient.getCustomerById('missing-cust-id')).rejects.toMatchObject({
        status: 404,
        code: 'CUSTOMER_NOT_FOUND',
      });
    });

    it('passes abort signal to customer detail request', async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerDetail));
      vi.stubGlobal('fetch', fetchMock);

      await customerClient.getCustomerById('cust-001', { signal: controller.signal });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers/cust-001',
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  // =========================================================================
  // 3. API 3: CUSTOMER ADDRESS INSPECTION (getCustomerAddresses)
  // =========================================================================
  describe('getCustomerAddresses (GET /api/v1/admin/customers/:id/addresses)', () => {
    it('requests /api/v1/admin/customers/:id/addresses and returns typed address array', async () => {
      const fetchMock = vi.fn().mockResolvedValue(json([mockCustomerAddress]));
      vi.stubGlobal('fetch', fetchMock);

      const result = await customerClient.getCustomerAddresses('cust-001');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers/cust-001/addresses',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual([mockCustomerAddress]);
      expectTypeOf(result).toEqualTypeOf<ICustomerAddressDto[]>();
    });

    it('propagates backend 404 when customer does not exist for address inspection', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } }, 404),
          ),
      );

      await expect(customerClient.getCustomerAddresses('cust-missing')).rejects.toMatchObject({
        status: 404,
        code: 'CUSTOMER_NOT_FOUND',
      });
    });

    it('passes abort signal to customer address request', async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn().mockResolvedValue(json([mockCustomerAddress]));
      vi.stubGlobal('fetch', fetchMock);

      await customerClient.getCustomerAddresses('cust-001', { signal: controller.signal });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers/cust-001/addresses',
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  // =========================================================================
  // 4. API 4: CUSTOMER ACCOUNT STATUS (updateCustomerStatus)
  // =========================================================================
  describe('updateCustomerStatus (PATCH /api/v1/admin/customers/:id/status)', () => {
    const payload: IUpdateCustomerStatusDto = {
      status: 'SUSPENDED',
      reason: 'Suspicious unauthorized high-volume order attempts',
    };

    it('sends PATCH to /api/v1/admin/customers/:id/status with JSON body and returns updated detail', async () => {
      const suspendedDetail: IAdminCustomerDetailDto = {
        ...mockCustomerDetail,
        status: UserStatus.SUSPENDED,
        customerSegment: 'B2C', // Suspended B2B customer reverts to B2C runtime pricing
      };
      const fetchMock = vi.fn().mockResolvedValue(json(suspendedDetail));
      vi.stubGlobal('fetch', fetchMock);

      const payloadCopy = { ...payload };
      const result = await customerClient.updateCustomerStatus('cust-001', payloadCopy);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers/cust-001/status',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
      );
      // Ensures caller's payload was not mutated
      expect(payloadCopy).toEqual(payload);
      expect(result).toEqual(suspendedDetail);
      expectTypeOf(result).toEqualTypeOf<IAdminCustomerDetailDto>();
    });

    it('encodes customer ID with special characters in status update endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerDetail));
      vi.stubGlobal('fetch', fetchMock);

      await customerClient.updateCustomerStatus('cust /special #1', payload);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers/cust%20%2Fspecial%20%231/status',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('propagates backend 400 invalid state transition error (e.g. already active)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          json(
            {
              error: {
                code: 'INVALID_STATE_TRANSITION',
                message: 'Customer account is already active',
              },
            },
            400,
          ),
        ),
      );

      await expect(
        customerClient.updateCustomerStatus('cust-001', {
          status: 'ACTIVE',
          reason: 'Redundant activation',
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_STATE_TRANSITION',
      });
    });

    it('propagates backend 400 self-suspension prohibited error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          json(
            {
              error: {
                code: 'SELF_SUSPENSION_PROHIBITED',
                message: 'Staff members cannot suspend their own identity',
              },
            },
            400,
          ),
        ),
      );

      await expect(
        customerClient.updateCustomerStatus('staff-admin-1', payload),
      ).rejects.toMatchObject({
        status: 400,
        code: 'SELF_SUSPENSION_PROHIBITED',
      });
    });

    it('propagates backend 403 insufficient permission error (CUSTOMER_SUSPEND missing)', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json(
              { error: { code: 'FORBIDDEN', message: 'Access denied: requires customer:suspend' } },
              403,
            ),
          ),
      );

      await expect(customerClient.updateCustomerStatus('cust-001', payload)).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });
    });

    it('passes abort signal to customer status update request', async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerDetail));
      vi.stubGlobal('fetch', fetchMock);

      await customerClient.updateCustomerStatus('cust-001', payload, { signal: controller.signal });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers/cust-001/status',
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  // =========================================================================
  // 5. API 5: B2B CUSTOMER VERIFICATION (updateCustomerB2bStatus)
  // =========================================================================
  describe('updateCustomerB2bStatus (PATCH /api/v1/admin/customers/:id/b2b-status)', () => {
    const grantPayload: IUpdateCustomerB2bStatusDto = {
      isB2B: true,
      companyName: 'Apex Infra Projects Pvt Ltd',
      gstin: '29AAAAA0000A1Z5',
      reason: 'Verified official tax invoice and GST registration certificate',
    };

    const revokePayload: IUpdateCustomerB2bStatusDto = {
      isB2B: false,
      reason: 'Contractor requested conversion to individual retail homeowner',
    };

    it('sends PATCH to /api/v1/admin/customers/:id/b2b-status with grant payload', async () => {
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerDetail));
      vi.stubGlobal('fetch', fetchMock);

      const payloadCopy = { ...grantPayload };
      const result = await customerClient.updateCustomerB2bStatus('cust-001', payloadCopy);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers/cust-001/b2b-status',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(grantPayload),
        }),
      );
      // Caller payload integrity
      expect(payloadCopy).toEqual(grantPayload);
      expect(result).toEqual(mockCustomerDetail);
      expectTypeOf(result).toEqualTypeOf<IAdminCustomerDetailDto>();
    });

    it('sends PATCH to /api/v1/admin/customers/:id/b2b-status with revoke payload', async () => {
      const revokedDetail: IAdminCustomerDetailDto = {
        ...mockCustomerDetail,
        roles: [],
        customerSegment: 'B2C',
      };
      const fetchMock = vi.fn().mockResolvedValue(json(revokedDetail));
      vi.stubGlobal('fetch', fetchMock);

      const result = await customerClient.updateCustomerB2bStatus('cust-001', revokePayload);

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers/cust-001/b2b-status',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(revokePayload),
        }),
      );
      expect(result).toEqual(revokedDetail);
    });

    it('propagates backend 400 validation error (e.g. missing company name on B2B grant)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Company name is required when granting B2B wholesale status',
              },
            },
            400,
          ),
        ),
      );

      await expect(
        customerClient.updateCustomerB2bStatus('cust-001', {
          isB2B: true,
          reason: 'Missing company name',
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    });

    it('propagates backend 400 validation error on malformed GSTIN format', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid GSTIN format (e.g. 29AAAAA0000A1Z5)',
              },
            },
            400,
          ),
        ),
      );

      await expect(
        customerClient.updateCustomerB2bStatus('cust-001', {
          isB2B: true,
          companyName: 'Apex Infra',
          gstin: 'INVALID_GST',
          reason: 'Testing malformed GSTIN',
        }),
      ).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    });

    it('propagates backend 403 insufficient permission error (B2B_VERIFY missing)', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json(
              { error: { code: 'FORBIDDEN', message: 'Access denied: requires b2b:verify' } },
              403,
            ),
          ),
      );

      await expect(
        customerClient.updateCustomerB2bStatus('cust-001', grantPayload),
      ).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });
    });

    it('passes abort signal to B2B status update request', async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn().mockResolvedValue(json(mockCustomerDetail));
      vi.stubGlobal('fetch', fetchMock);

      await customerClient.updateCustomerB2bStatus('cust-001', grantPayload, {
        signal: controller.signal,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/admin/customers/cust-001/b2b-status',
        expect.objectContaining({ signal: controller.signal }),
      );
    });
  });

  // =========================================================================
  // 6. CREDENTIAL PRIVACY & ERROR ENVELOPE AUDIT
  // =========================================================================
  describe('Security & Privacy Guarantees', () => {
    it('never leaks tokens or credentials into thrown ApiError properties or message', async () => {
      await establishMemorySession();
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            json({ error: { code: 'INTERNAL_ERROR', message: 'Database connection failed' } }, 500),
          ),
      );

      try {
        await customerClient.listCustomers();
        expect.fail('Should have thrown an ApiError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.message).not.toContain('memory-admin-customer-token');
        expect(apiErr.message).not.toContain('password');
        expect(apiErr.message).not.toContain('otp');
        expect(apiErr.code).toBe('INTERNAL_ERROR');
        expect(apiErr.status).toBe(500);
      }
    });
  });
});
