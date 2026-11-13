// @vitest-environment jsdom
/**
 * Customer Address Book Integration & Component Tests (Milestone 5B.1)
 *
 * Covers:
 * - Address list rendering & live serviceability badges
 * - Address details modal
 * - Empty address list state
 * - Add address (including E.164 phone normalization, loading/saving disablement, duplicate prevention)
 * - Edit address (including clearing optional fields to null)
 * - Set default address
 * - Delete address with confirmation dialog (cancel + confirm + default promotion message)
 * - Client-side & server-side form validation errors
 * - API error handling & retry
 * - Initial loading skeleton & mutation loading states
 * - Authentication-required route protection & post-login restoration (/account/addresses)
 * - Session expiration handling on 401 + failed refresh
 * - Account navigation & browser Back/Forward (popstate)
 * - Responsive mobile CSS rules & WCAG touch targets
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import {
  UserStatus,
  UserType,
  type IAuthUser,
  type ICustomerAddressDto,
} from '@thehomez/shared-types';
import { App } from '../App.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

function makeCustomerUser(overrides: Partial<IAuthUser> = {}): IAuthUser {
  return {
    id: 'cust-addr-001',
    phone: '+919876543210',
    userType: UserType.CUSTOMER,
    status: UserStatus.ACTIVE,
    roles: [],
    permissions: [],
    createdAt: '2026-11-01T10:00:00.000Z',
    lastLoginAt: '2026-11-12T04:00:00.000Z',
    ...overrides,
  };
}

function makeAddress(overrides: Partial<ICustomerAddressDto> = {}): ICustomerAddressDto {
  return {
    id: '673300000000000000000101',
    label: 'Whitefield Site Gate 2',
    recipientName: 'Ramesh Rao',
    phone: '+919876543210',
    streetAddress: 'Plot 14, KIADB Industrial Area, Whitefield',
    landmark: 'Near ITPL Main Gate',
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560037',
    siteContactPerson: {
      name: 'Suresh Kumar',
      phone: '+919811122233',
    },
    heavyVehicleAccessInstructions: '12-wheeler tipper entry allowed between 6 AM and 9 PM.',
    isDefault: true,
    isServiceable: true,
    serviceArea: {
      id: '673300000000000000000010',
      code: 'BLR-EAST',
      name: 'Bengaluru East (Marathahalli)',
      city: 'Bengaluru',
      state: 'Karnataka',
    },
    createdAt: '2026-11-12T04:29:06.000Z',
    updatedAt: '2026-11-12T04:29:06.000Z',
    ...overrides,
  };
}

function mockPublicUrls(url: string): Response | null {
  if (url.startsWith('/api/v1/categories')) {
    return jsonResponse({ success: true, data: { categories: [] } });
  }
  if (url.startsWith('/api/v1/storefront/products')) {
    return jsonResponse({
      success: true,
      data: {
        items: [],
        pagination: {
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
        facets: { brands: [] },
      },
    });
  }
  return null;
}

describe('Customer Address Book Frontend (Milestone 5B.1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, '', '/account/addresses');
  });

  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('redirects unauthenticated /account/addresses visitor to /login?redirect=%2Faccount%2Faddresses and restores after OTP login', async () => {
    const user = makeCustomerUser();
    const addr = makeAddress();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);

      if (url === '/api/v1/auth/refresh') {
        return jsonResponse(
          {
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Refresh cookie missing' },
          },
          400,
        );
      }
      if (url === '/api/v1/auth/otp/request') {
        return jsonResponse({
          success: true,
          data: { cooldownSeconds: 60, expiresInSeconds: 300, message: 'OTP sent' },
        });
      }
      if (url === '/api/v1/auth/otp/verify') {
        return jsonResponse({
          success: true,
          data: {
            tokens: { accessToken: 'addr-jwt', expiresIn: 900, tokenType: 'Bearer' },
            user,
          },
        });
      }
      if (url === '/api/v1/customer/addresses') {
        return jsonResponse({ success: true, data: [addr] });
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /Sign in with mobile number/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(window.location.search).toBe('?redirect=%2Faccount%2Faddresses');

    fireEvent.change(screen.getByRole('textbox', { name: /Mobile number/i }), {
      target: { value: '9876543210' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));

    expect(await screen.findByLabelText(/Digit 1 of 6/i)).toBeInTheDocument();
    for (let i = 0; i < 6; i++) {
      fireEvent.change(screen.getByLabelText(`Digit ${i + 1} of 6`), {
        target: { value: String(i + 1) },
      });
    }
    fireEvent.click(screen.getByRole('button', { name: /Verify & Continue/i }));

    expect(
      await screen.findByRole('heading', { name: /Saved Delivery Addresses/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/account/addresses');
    expect(await screen.findByText('Whitefield Site Gate 2')).toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('shows initial loading skeleton, then renders address list and address details modal', async () => {
    const user = makeCustomerUser();
    const addr1 = makeAddress();
    const addr2 = makeAddress({
      id: '673300000000000000000102',
      label: 'Mysuru Highway Yard',
      recipientName: 'Anita Sharma',
      phone: '+919900112233',
      streetAddress: 'Survey 42, Mysore Road',
      landmark: null,
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560059',
      siteContactPerson: null,
      heavyVehicleAccessInstructions: null,
      isDefault: false,
      isServiceable: false,
      serviceArea: null,
    });

    let resolveAddresses!: (res: Response) => void;
    const addressesPromise = new Promise<Response>((resolve) => {
      resolveAddresses = resolve;
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        return addressesPromise;
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    // Loading state appears while address list is pending
    const loadingSkeleton = await screen.findByLabelText(/Loading saved addresses/i);
    expect(loadingSkeleton).toHaveAttribute('aria-busy', 'true');

    // Resolve addresses response
    resolveAddresses(jsonResponse({ success: true, data: [addr1, addr2] }));

    expect(await screen.findByText('Whitefield Site Gate 2')).toBeInTheDocument();
    expect(screen.getByText('Mysuru Highway Yard')).toBeInTheDocument();
    expect(screen.getByText('2 of 20 saved')).toBeInTheDocument();
    expect(screen.getByText(/Serviceable • BLR-EAST/i)).toBeInTheDocument();
    expect(screen.getByText(/Outside delivery area/i)).toBeInTheDocument();

    // Open Address Details modal
    fireEvent.click(screen.getByRole('button', { name: /View details for Whitefield Site Gate 2/i }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/Bengaluru East \(Marathahalli\) \(BLR-EAST\) — Bengaluru, Karnataka/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/12-wheeler tipper entry allowed/i)).toBeInTheDocument();

    // Close modal via Close button
    fireEvent.click(within(dialog).getByRole('button', { name: /^Close$/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders empty state when customer has zero addresses', async () => {
    const user = makeCustomerUser();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        return jsonResponse({ success: true, data: [] });
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    expect(await screen.findByText(/No saved delivery addresses yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Your First Address/i })).toBeInTheDocument();
    expect(screen.getByText('0 of 20 saved')).toBeInTheDocument();
  });

  it('validates required fields, PIN code, and phone number before submitting and prevents invalid POST', async () => {
    const user = makeCustomerUser();
    const postSpy = vi.fn();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        if (init?.method === 'POST') {
          postSpy();
          return jsonResponse({ success: true, data: makeAddress() }, 201);
        }
        return jsonResponse({ success: true, data: [] });
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    const addFirstBtn = await screen.findByRole('button', { name: /Add Your First Address/i });
    fireEvent.click(addFirstBtn);

    const dialog = screen.getByRole('dialog');

    // Submit empty form
    fireEvent.click(within(dialog).getByRole('button', { name: /Save Address/i }));

    expect(await within(dialog).findByText(/Address label is required/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Recipient name must be at least/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Phone number is required/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/PIN code is required/i)).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();

    // Enter invalid PIN and invalid phone
    fireEvent.change(within(dialog).getByLabelText(/Address Label/i), {
      target: { value: 'Site A' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Recipient Name/i), {
      target: { value: 'Ramesh Rao' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Recipient Phone/i), {
      target: { value: '12345' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Street \/ Plot Address/i), {
      target: { value: 'Plot 14, Whitefield' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^City/i), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^State/i), {
      target: { value: 'Karnataka' },
    });
    fireEvent.change(within(dialog).getByLabelText(/PIN Code/i), {
      target: { value: '056001' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: /Save Address/i }));

    expect(
      await within(dialog).findByText(/Pincode must be a valid 6-digit Indian postal code/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Enter a valid 10-digit Indian mobile number/i),
    ).toBeInTheDocument();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('adds an address, disables save button while saving, and updates the list', async () => {
    const user = makeCustomerUser();
    let stored: ICustomerAddressDto[] = [];
    let resolvePost!: (res: Response) => void;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        if (init?.method === 'POST') {
          const parsedBody = JSON.parse(String(init.body));
          expect(parsedBody.phone).toBe('+919876543210');
          expect(parsedBody.pincode).toBe('560037');
          const created = makeAddress({
            label: parsedBody.label,
            recipientName: parsedBody.recipientName,
            phone: parsedBody.phone,
            streetAddress: parsedBody.streetAddress,
            city: parsedBody.city,
            state: parsedBody.state,
            pincode: parsedBody.pincode,
          });
          stored = [created];
          return new Promise<Response>((resolve) => {
            resolvePost = () => resolve(jsonResponse({ success: true, data: created }, 201));
          });
        }
        return jsonResponse({ success: true, data: stored });
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Add Your First Address/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/Address Label/i), {
      target: { value: 'Whitefield Site Gate 2' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Recipient Name/i), {
      target: { value: 'Ramesh Rao' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Recipient Phone/i), {
      target: { value: '9876543210' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Street \/ Plot Address/i), {
      target: { value: 'Plot 14, KIADB Industrial Area, Whitefield' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^City/i), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^State/i), {
      target: { value: 'Karnataka' },
    });
    fireEvent.change(within(dialog).getByLabelText(/PIN Code/i), {
      target: { value: '560037' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: /Save Address/i }));

    // Disabled saving state prevents duplicate submissions
    const savingBtn = await within(dialog).findByRole('button', { name: /Saving Address…/i });
    expect(savingBtn).toBeDisabled();

    resolvePost(jsonResponse({}, 201));

    expect(
      await screen.findByText(/Address "Whitefield Site Gate 2" added to your address book/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Whitefield Site Gate 2')).toBeInTheDocument();
  });

  it('edits an existing address and sets default address', async () => {
    const user = makeCustomerUser();
    let stored: ICustomerAddressDto[] = [
      makeAddress({
        id: '673300000000000000000101',
        label: 'Primary Site',
        isDefault: true,
      }),
      makeAddress({
        id: '673300000000000000000102',
        label: 'Secondary Depot',
        isDefault: false,
      }),
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        return jsonResponse({ success: true, data: stored });
      }
      if (url === '/api/v1/customer/addresses/673300000000000000000102' && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        expect(body.landmark).toBeNull();
        const updated = { ...stored[1]!, ...body };
        stored = [stored[0]!, updated];
        return jsonResponse({ success: true, data: updated });
      }
      if (
        url === '/api/v1/customer/addresses/673300000000000000000102/default' &&
        init?.method === 'PATCH'
      ) {
        const nextDefault = { ...stored[1]!, isDefault: true };
        const prevDefault = { ...stored[0]!, isDefault: false };
        stored = [nextDefault, prevDefault];
        return jsonResponse({ success: true, data: nextDefault });
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    expect(await screen.findByText('Secondary Depot')).toBeInTheDocument();

    // Edit Secondary Depot & clear landmark
    fireEvent.click(screen.getByRole('button', { name: /Edit Secondary Depot/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Address Label/i), {
      target: { value: 'Secondary Depot East' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Landmark/i), {
      target: { value: '' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save Changes/i }));

    expect(
      await screen.findByText(/Address "Secondary Depot East" updated successfully/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Secondary Depot East')).toBeInTheDocument();

    // Set Secondary Depot East as Default
    fireEvent.click(
      screen.getByRole('button', { name: /Set Secondary Depot East as default address/i }),
    );
    expect(
      await screen.findByText(/"Secondary Depot East" is now your default delivery address/i),
    ).toBeInTheDocument();
  });

  it('deletes an address only after confirmation and shows promotion feedback', async () => {
    const user = makeCustomerUser();
    let stored: ICustomerAddressDto[] = [
      makeAddress({
        id: '673300000000000000000101',
        label: 'Primary Site',
        isDefault: true,
      }),
      makeAddress({
        id: '673300000000000000000102',
        label: 'Backup Yard',
        isDefault: false,
      }),
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        return jsonResponse({ success: true, data: stored });
      }
      if (
        url === '/api/v1/customer/addresses/673300000000000000000101' &&
        init?.method === 'DELETE'
      ) {
        stored = [{ ...stored[1]!, isDefault: true }];
        return jsonResponse({
          success: true,
          data: {
            deletedAddressId: '673300000000000000000101',
            promotedDefaultAddressId: '673300000000000000000102',
          },
        });
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    expect(await screen.findByText('Primary Site')).toBeInTheDocument();

    // Open confirmation dialog and cancel first
    fireEvent.click(screen.getByRole('button', { name: /Delete Primary Site/i }));
    const confirmDialog = screen.getByRole('alertdialog');
    expect(within(confirmDialog).getByText(/promoted to default/i)).toBeInTheDocument();

    fireEvent.click(within(confirmDialog).getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByText('Primary Site')).toBeInTheDocument();

    // Re-open and confirm delete
    fireEvent.click(screen.getByRole('button', { name: /Delete Primary Site/i }));
    const dialog2 = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog2).getByRole('button', { name: /^Delete Address$/i }));

    expect(
      await screen.findByText(/Address "Primary Site" deleted\. Another saved address was promoted to default/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Primary Site')).not.toBeInTheDocument();
    expect(screen.getByText('Backup Yard')).toBeInTheDocument();
  });

  it('surfaces initial load API error with retry and maps server validation details on save', async () => {
    const user = makeCustomerUser();
    let listAttempts = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        if (init?.method === 'POST') {
          return jsonResponse(
            {
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Pincode rejected by server',
                details: [
                  {
                    field: 'pincode',
                    message: 'Server validation: invalid PIN code',
                    code: 'invalid_string',
                  },
                ],
              },
            },
            400,
          );
        }
        listAttempts += 1;
        if (listAttempts === 1) {
          return jsonResponse(
            {
              success: false,
              error: {
                code: 'INTERNAL_SERVER_ERROR',
                message: 'Unable to process address request at this time',
              },
            },
            500,
          );
        }
        return jsonResponse({ success: true, data: [] });
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    expect(await screen.findByText(/Unable to load saved addresses/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Unable to process address request at this time/i),
    ).toBeInTheDocument();

    // Retry succeeds
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(await screen.findByText(/No saved delivery addresses yet/i)).toBeInTheDocument();

    // Submit valid client form that gets server 400 validation error
    fireEvent.click(screen.getByRole('button', { name: /Add Your First Address/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/Address Label/i), {
      target: { value: 'Site Beta' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Recipient Name/i), {
      target: { value: 'Ramesh Rao' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Recipient Phone/i), {
      target: { value: '+919876543210' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Street \/ Plot Address/i), {
      target: { value: 'Plot 14, Whitefield' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^City/i), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^State/i), {
      target: { value: 'Karnataka' },
    });
    fireEvent.change(within(dialog).getByLabelText(/PIN Code/i), {
      target: { value: '560037' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save Address/i }));

    expect(await within(dialog).findByText(/Pincode rejected by server/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Server validation: invalid PIN code/i),
    ).toBeInTheDocument();
  });

  it('handles session expiration during address fetch and redirects to /login with notice', async () => {
    const user = makeCustomerUser();
    let refreshCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        refreshCalls += 1;
        if (refreshCalls === 1) {
          return jsonResponse({
            success: true,
            data: { tokens: { accessToken: 'expiring-jwt', expiresIn: 900, tokenType: 'Bearer' } },
          });
        }
        return jsonResponse(
          {
            success: false,
            error: { code: 'REFRESH_TOKEN_EXPIRED', message: 'Refresh token expired' },
          },
          401,
        );
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        return jsonResponse(
          {
            success: false,
            error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'Access token expired' },
          },
          401,
        );
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    // 401 -> refresh fails -> onSessionExpired -> ProtectedRoute redirects to /login?redirect=%2Faccount%2Faddresses
    await waitFor(() => {
      expect(window.location.pathname).toBe('/login');
    });
    expect(window.location.search).toBe('?redirect=%2Faccount%2Faddresses');
    expect(
      await screen.findByText(/Your session has expired\. Please sign in again\./i),
    ).toBeInTheDocument();
  });

  it('integrates with Account navigation and supports browser Back/Forward', async () => {
    window.history.replaceState(null, '', '/account');
    const user = makeCustomerUser();
    const addr = makeAddress();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        return jsonResponse({ success: true, data: [addr] });
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    expect(await screen.findByRole('heading', { name: /Customer Account/i })).toBeInTheDocument();

    // Navigate from Account Overview to Saved Addresses via Account button
    fireEvent.click(screen.getByRole('button', { name: /Manage Saved Addresses/i }));
    expect(
      await screen.findByRole('heading', { name: /Saved Delivery Addresses/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe('/account/addresses');

    // Simulate Browser Back button -> /account
    window.history.pushState(null, '', '/account');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(await screen.findByRole('heading', { name: /Customer Account/i })).toBeInTheDocument();

    // Simulate Browser Forward button -> /account/addresses
    window.history.pushState(null, '', '/account/addresses');
    fireEvent(window, new PopStateEvent('popstate'));
    expect(
      await screen.findByRole('heading', { name: /Saved Delivery Addresses/i }),
    ).toBeInTheDocument();
  });

  it('enforces mobile responsive CSS breakpoints and >= 44px touch targets for address book controls', () => {
    const cssPath = path.resolve(__dirname, '../styles/customer.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    expect(cssContent).toMatch(/\.thz-account-nav-tab\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/);
    expect(cssContent).toMatch(/\.thz-btn-danger\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/);
    expect(cssContent).toMatch(
      /\.thz-form-input,\s*\.thz-form-textarea\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/,
    );
    expect(cssContent).toMatch(/\.thz-checkbox-row\s*\{[^}]*min-height:\s*var\(--thz-touch-target\);/);
    expect(cssContent).toContain('@media (max-width: 640px)');
    expect(cssContent).toMatch(/\.thz-address-grid,\s*\.thz-address-skeleton-grid\s*\{\s*grid-template-columns:\s*1fr;/);
    expect(cssContent).toMatch(/\.thz-address-form-grid\s*\{\s*grid-template-columns:\s*1fr;/);
  });

  it('preserves active input focus when server validation error clears on typing in AddressFormModal', async () => {
    const user = makeCustomerUser();

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        if (init?.method === 'POST') {
          return jsonResponse(
            {
              success: false,
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Pincode rejected by server',
                details: [
                  { field: 'pincode', message: 'Server PIN check failed', code: 'invalid_string' },
                ],
              },
            },
            400,
          );
        }
        return jsonResponse({ success: true, data: [] });
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Add Your First Address/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/Address Label/i), {
      target: { value: 'Focus Test Site' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Recipient Name/i), {
      target: { value: 'Ramesh Rao' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Recipient Phone/i), {
      target: { value: '+919876543210' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Street \/ Plot Address/i), {
      target: { value: 'Plot 14, Whitefield' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^City/i), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^State/i), {
      target: { value: 'Karnataka' },
    });
    const pincodeInput = within(dialog).getByLabelText(/PIN Code/i);
    fireEvent.change(pincodeInput, { target: { value: '560037' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /Save Address/i }));
    expect(await within(dialog).findByText(/Server PIN check failed/i)).toBeInTheDocument();

    pincodeInput.focus();
    expect(document.activeElement).toBe(pincodeInput);
    fireEvent.change(pincodeInput, { target: { value: '560001' } });

    expect(document.activeElement).toBe(pincodeInput);
  });

  it('closes modal and updates address list cleanly even if post-create list refresh fails', async () => {
    const user = makeCustomerUser();
    const createdAddr = makeAddress({ label: 'Resilient Site' });
    let listCalls = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/v1/auth/refresh') {
        return jsonResponse({
          success: true,
          data: { tokens: { accessToken: 'valid-jwt', expiresIn: 900, tokenType: 'Bearer' } },
        });
      }
      if (url === '/api/v1/auth/me') {
        return jsonResponse({ success: true, data: { user } });
      }
      if (url === '/api/v1/customer/addresses') {
        if (init?.method === 'POST') {
          return jsonResponse({ success: true, data: createdAddr }, 201);
        }
        listCalls += 1;
        if (listCalls === 1) {
          return jsonResponse({ success: true, data: [] });
        }
        return jsonResponse(
          { success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: 'Transient error' } },
          500,
        );
      }
      const pub = mockPublicUrls(url);
      if (pub) return pub;
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Add Your First Address/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/Address Label/i), {
      target: { value: 'Resilient Site' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Recipient Name/i), {
      target: { value: 'Ramesh Rao' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Recipient Phone/i), {
      target: { value: '+919876543210' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Street \/ Plot Address/i), {
      target: { value: 'Plot 14, Whitefield' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^City/i), {
      target: { value: 'Bengaluru' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^State/i), {
      target: { value: 'Karnataka' },
    });
    fireEvent.change(within(dialog).getByLabelText(/PIN Code/i), {
      target: { value: '560037' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: /Save Address/i }));

    expect(
      await screen.findByText(/Address "Resilient Site" added to your address book/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Resilient Site')).toBeInTheDocument();
  });
});
