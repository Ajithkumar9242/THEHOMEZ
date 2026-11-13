// @vitest-environment jsdom
/**
 * Unit Tests for AddressClient & Address Form Validation Utilities (Milestone 5B.1)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MAX_ADDRESSES_PER_CUSTOMER,
  type ICustomerAddressDto,
} from '@thehomez/shared-types';
import { AddressApiError, AddressClient } from '../api/address-client.js';
import {
  addressDtoToFormValues,
  createEmptyAddressFormValues,
  mapServerValidationErrors,
  normalizeAddressPhone,
  validateAddressForm,
} from '../components/addresses/address-form.utils.js';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

const SAMPLE_ADDRESS: ICustomerAddressDto = {
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
};

describe('AddressClient & Address Form Utilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('normalizeAddressPhone()', () => {
    it('normalizes 10-digit Indian mobile numbers to +91 E.164 format', () => {
      expect(normalizeAddressPhone('9876543210')).toBe('+919876543210');
      expect(normalizeAddressPhone('98765 43210')).toBe('+919876543210');
      expect(normalizeAddressPhone('+91 98765-43210')).toBe('+919876543210');
      expect(normalizeAddressPhone('+14155552671')).toBe('+14155552671');
    });
  });

  describe('validateAddressForm()', () => {
    it('accepts valid create payload and normalizes 10-digit phones to E.164', () => {
      const result = validateAddressForm(
        {
          ...createEmptyAddressFormValues(true),
          label: '  Site Alpha  ',
          recipientName: '  Ramesh Rao  ',
          phone: '9876543210',
          streetAddress: 'Plot 14, KIADB Industrial Area',
          landmark: '',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560037',
          siteContactName: 'Suresh Kumar',
          siteContactPhone: '9811122233',
          heavyVehicleAccessInstructions: '',
          isDefault: true,
        },
        'create',
      );

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.dto.label).toBe('Site Alpha');
        expect(result.dto.phone).toBe('+919876543210');
        expect(result.dto.siteContactPerson).toEqual({
          name: 'Suresh Kumar',
          phone: '+919811122233',
        });
        expect(result.dto.landmark).toBeNull();
        expect(result.dto.heavyVehicleAccessInstructions).toBeNull();
      }
    });

    it('rejects invalid PIN codes, invalid phones, and partial site contact info', () => {
      const invalidPincodes = ['056001', '56001', '5600001', '56A001', ''];
      for (const pincode of invalidPincodes) {
        const res = validateAddressForm(
          {
            ...createEmptyAddressFormValues(false),
            label: 'Site',
            recipientName: 'Ramesh Rao',
            phone: '+919876543210',
            streetAddress: 'Plot 14, KIADB Industrial Area',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode,
          },
          'create',
        );
        expect(res.valid).toBe(false);
        if (!res.valid) {
          expect(res.errors.pincode).toBeTruthy();
        }
      }

      const partialSiteContact = validateAddressForm(
        {
          ...createEmptyAddressFormValues(false),
          label: 'Site',
          recipientName: 'Ramesh Rao',
          phone: '12345',
          streetAddress: 'Plot 14, KIADB Industrial Area',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560037',
          siteContactName: 'Suresh Kumar',
          siteContactPhone: '',
        },
        'create',
      );

      expect(partialSiteContact.valid).toBe(false);
      if (!partialSiteContact.valid) {
        expect(partialSiteContact.errors.phone).toBeTruthy();
        expect(partialSiteContact.errors.siteContactPhone).toBeTruthy();
      }
    });

    it('sends null for cleared optional fields in edit mode', () => {
      const formValues = addressDtoToFormValues(SAMPLE_ADDRESS);
      formValues.landmark = '';
      formValues.siteContactName = '';
      formValues.siteContactPhone = '';
      formValues.heavyVehicleAccessInstructions = '';

      const result = validateAddressForm(formValues, 'edit');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.dto.landmark).toBeNull();
        expect(result.dto.siteContactPerson).toBeNull();
        expect(result.dto.heavyVehicleAccessInstructions).toBeNull();
      }
    });
  });

  describe('mapServerValidationErrors()', () => {
    it('maps backend Zod field paths including nested siteContactPerson fields', () => {
      const mapped = mapServerValidationErrors([
        { field: 'pincode', message: 'Invalid pincode', code: 'invalid_string' },
        { field: 'siteContactPerson.phone', message: 'Invalid phone', code: 'invalid_string' },
      ]);
      expect(mapped.pincode).toBe('Invalid pincode');
      expect(mapped.siteContactPhone).toBe('Invalid phone');
    });
  });

  describe('AddressClient HTTP methods', () => {
    it('executes CRUD + setDefault endpoints through authorizedFetch', async () => {
      const fetchWithAuth = vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/customer/addresses' && init?.method === 'GET') {
          return jsonResponse({ success: true, data: [SAMPLE_ADDRESS] });
        }
        if (url === '/customer/addresses' && init?.method === 'POST') {
          return jsonResponse({ success: true, data: SAMPLE_ADDRESS }, 201);
        }
        if (url === `/customer/addresses/${SAMPLE_ADDRESS.id}` && init?.method === 'PUT') {
          return jsonResponse({
            success: true,
            data: { ...SAMPLE_ADDRESS, label: 'Updated Gate' },
          });
        }
        if (
          url === `/customer/addresses/${SAMPLE_ADDRESS.id}/default` &&
          init?.method === 'PATCH'
        ) {
          return jsonResponse({ success: true, data: SAMPLE_ADDRESS });
        }
        if (url === `/customer/addresses/${SAMPLE_ADDRESS.id}` && init?.method === 'DELETE') {
          return jsonResponse({
            success: true,
            data: { deletedAddressId: SAMPLE_ADDRESS.id, promotedDefaultAddressId: null },
          });
        }
        throw new Error(`Unexpected call: ${init?.method} ${url}`);
      });

      const client = new AddressClient({ fetchWithAuth });

      const list = await client.listAddresses();
      expect(list).toHaveLength(1);

      const created = await client.createAddress({
        label: SAMPLE_ADDRESS.label,
        recipientName: SAMPLE_ADDRESS.recipientName,
        phone: SAMPLE_ADDRESS.phone,
        streetAddress: SAMPLE_ADDRESS.streetAddress,
        city: SAMPLE_ADDRESS.city,
        state: SAMPLE_ADDRESS.state,
        pincode: SAMPLE_ADDRESS.pincode,
      });
      expect(created.id).toBe(SAMPLE_ADDRESS.id);

      const updated = await client.updateAddress(SAMPLE_ADDRESS.id, { label: 'Updated Gate' });
      expect(updated.label).toBe('Updated Gate');

      const defaulted = await client.setDefaultAddress(SAMPLE_ADDRESS.id);
      expect(defaulted.isDefault).toBe(true);

      const deleted = await client.deleteAddress(SAMPLE_ADDRESS.id);
      expect(deleted.deletedAddressId).toBe(SAMPLE_ADDRESS.id);
    });

    it('surfaces structured AddressApiError on HTTP failure and network errors', async () => {
      const fetchWithAuth = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(
            {
              success: false,
              error: {
                code: 'ADDRESS_LIMIT_EXCEEDED',
                message: `Cannot save more than ${MAX_ADDRESSES_PER_CUSTOMER} addresses per customer account`,
              },
            },
            400,
          ),
        )
        .mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const client = new AddressClient({ fetchWithAuth });

      await expect(
        client.createAddress({
          label: 'Site 21',
          recipientName: 'Ramesh Rao',
          phone: '+919876543210',
          streetAddress: 'Plot 21, Whitefield',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560037',
        }),
      ).rejects.toMatchObject({
        name: 'AddressApiError',
        code: 'ADDRESS_LIMIT_EXCEEDED',
        status: 400,
      });

      await expect(client.listAddresses()).rejects.toBeInstanceOf(AddressApiError);
    });
  });
});
