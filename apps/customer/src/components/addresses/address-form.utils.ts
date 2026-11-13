/**
 * Address Form Validation, Normalization & Server Error Mapping Utilities
 *
 * Strictly reuses shared contracts and Zod schemas from `@thehomez/shared-types`.
 */

import {
  createCustomerAddressSchema,
  E164_PHONE_REGEX,
  PINCODE_REGEX,
  updateCustomerAddressSchema,
  type IApiErrorDetail,
  type ICreateCustomerAddressDto,
  type ICustomerAddressDto,
  type IUpdateCustomerAddressDto,
} from '@thehomez/shared-types';

export interface AddressFormValues {
  label: string;
  recipientName: string;
  phone: string;
  streetAddress: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  siteContactName: string;
  siteContactPhone: string;
  heavyVehicleAccessInstructions: string;
  isDefault: boolean;
}

export type AddressFormErrorKey = keyof AddressFormValues;
export type AddressFormErrors = Partial<Record<AddressFormErrorKey, string>>;

const INDIAN_10_DIGIT_MOBILE_REGEX = /^[6-9]\d{9}$/;

export function createEmptyAddressFormValues(isFirstAddress = false): AddressFormValues {
  return {
    label: '',
    recipientName: '',
    phone: '',
    streetAddress: '',
    landmark: '',
    city: '',
    state: '',
    pincode: '',
    siteContactName: '',
    siteContactPhone: '',
    heavyVehicleAccessInstructions: '',
    isDefault: isFirstAddress,
  };
}

export function addressDtoToFormValues(address: ICustomerAddressDto): AddressFormValues {
  return {
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    streetAddress: address.streetAddress,
    landmark: address.landmark ?? '',
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    siteContactName: address.siteContactPerson?.name ?? '',
    siteContactPhone: address.siteContactPerson?.phone ?? '',
    heavyVehicleAccessInstructions: address.heavyVehicleAccessInstructions ?? '',
    isDefault: address.isDefault,
  };
}

/**
 * Normalizes phone input for backend E.164 compliance:
 * - Strips spaces, hyphens, and parentheses.
 * - Converts 10-digit Indian local numbers (starting with 6-9) to `+91XXXXXXXXXX`.
 */
export function normalizeAddressPhone(raw: string): string {
  const compact = raw.trim().replace(/[\s()-]/g, '');
  if (!compact) {
    return '';
  }
  if (INDIAN_10_DIGIT_MOBILE_REGEX.test(compact)) {
    return `+91${compact}`;
  }
  return compact;
}

function mapZodIssueFieldToFormKey(path: readonly PropertyKey[]): AddressFormErrorKey | null {
  const joined = path.map(String).join('.');
  switch (joined) {
    case 'label':
      return 'label';
    case 'recipientName':
      return 'recipientName';
    case 'phone':
      return 'phone';
    case 'streetAddress':
      return 'streetAddress';
    case 'landmark':
      return 'landmark';
    case 'city':
      return 'city';
    case 'state':
      return 'state';
    case 'pincode':
      return 'pincode';
    case 'siteContactPerson.name':
      return 'siteContactName';
    case 'siteContactPerson.phone':
      return 'siteContactPhone';
    case 'heavyVehicleAccessInstructions':
      return 'heavyVehicleAccessInstructions';
    case 'isDefault':
      return 'isDefault';
    default:
      return null;
  }
}

export type ValidatedAddressResult =
  | { valid: true; mode: 'create'; dto: ICreateCustomerAddressDto }
  | { valid: true; mode: 'edit'; dto: IUpdateCustomerAddressDto }
  | { valid: false; errors: AddressFormErrors };

/**
 * Validates form inputs against the shared `@thehomez/shared-types` Zod contracts
 * and returns either typed DTO payloads or field-keyed validation errors.
 */
export function validateAddressForm(
  values: AddressFormValues,
  mode: 'create' | 'edit',
): ValidatedAddressResult {
  const errors: AddressFormErrors = {};

  const trimmedLabel = values.label.trim();
  const trimmedRecipient = values.recipientName.trim();
  const normalizedPhone = normalizeAddressPhone(values.phone);
  const trimmedStreet = values.streetAddress.trim();
  const trimmedLandmark = values.landmark.trim();
  const trimmedCity = values.city.trim();
  const trimmedState = values.state.trim();
  const trimmedPincode = values.pincode.trim();
  const trimmedSiteName = values.siteContactName.trim();
  const normalizedSitePhone = normalizeAddressPhone(values.siteContactPhone);
  const trimmedAccess = values.heavyVehicleAccessInstructions.trim();

  // Enforce partial site contact completeness clearly before schema parse
  const hasSiteName = trimmedSiteName.length > 0;
  const hasSitePhone = normalizedSitePhone.length > 0;
  if (hasSiteName && !hasSitePhone) {
    errors.siteContactPhone = 'Site contact phone is required when site contact name is provided';
  } else if (!hasSiteName && hasSitePhone) {
    errors.siteContactName = 'Site contact name is required when site contact phone is provided';
  }

  // Helpful explicit checks for required fields & Indian formats
  if (!trimmedPhoneOrPresent(normalizedPhone)) {
    errors.phone = 'Phone number is required (e.g. +919876543210 or 10-digit mobile)';
  } else if (!E164_PHONE_REGEX.test(normalizedPhone)) {
    errors.phone = 'Enter a valid 10-digit Indian mobile number or E.164 phone (e.g. +919876543210)';
  }

  if (hasSitePhone && !E164_PHONE_REGEX.test(normalizedSitePhone)) {
    errors.siteContactPhone =
      'Enter a valid 10-digit Indian mobile number or E.164 phone (e.g. +919876543210)';
  }

  if (!trimmedPincode) {
    errors.pincode = 'PIN code is required';
  } else if (!PINCODE_REGEX.test(trimmedPincode)) {
    errors.pincode = 'Pincode must be a valid 6-digit Indian postal code';
  }

  const candidatePayload: ICreateCustomerAddressDto = {
    label: trimmedLabel,
    recipientName: trimmedRecipient,
    phone: normalizedPhone,
    streetAddress: trimmedStreet,
    landmark: trimmedLandmark.length > 0 ? trimmedLandmark : null,
    city: trimmedCity,
    state: trimmedState,
    pincode: trimmedPincode,
    siteContactPerson:
      hasSiteName && hasSitePhone
        ? {
            name: trimmedSiteName,
            phone: normalizedSitePhone,
          }
        : null,
    heavyVehicleAccessInstructions: trimmedAccess.length > 0 ? trimmedAccess : null,
    isDefault: values.isDefault,
  };

  if (mode === 'create') {
    const parsed = createCustomerAddressSchema.safeParse(candidatePayload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = mapZodIssueFieldToFormKey(issue.path);
        if (key && !errors[key]) {
          errors[key] = issue.message;
        }
      }
    }
    if (Object.keys(errors).length > 0) {
      return { valid: false, errors };
    }
    return { valid: true, mode: 'create', dto: parsed.data! };
  }

  // Edit mode sends the complete editable contract fields so cleared optional fields send `null`
  const parsedEdit = createCustomerAddressSchema.safeParse(candidatePayload);
  if (!parsedEdit.success) {
    for (const issue of parsedEdit.error.issues) {
      const key = mapZodIssueFieldToFormKey(issue.path);
      if (key && !errors[key]) {
        errors[key] = issue.message;
      }
    }
  }
  const updateParsed = updateCustomerAddressSchema.safeParse(candidatePayload);
  if (!updateParsed.success) {
    for (const issue of updateParsed.error.issues) {
      const key = mapZodIssueFieldToFormKey(issue.path);
      if (key && !errors[key]) {
        errors[key] = issue.message;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, mode: 'edit', dto: updateParsed.data! };
}

function trimmedPhoneOrPresent(val: string): boolean {
  return val.trim().length > 0;
}

/**
 * Maps backend Zod validation `details` (`IApiErrorDetail[]`) into form field errors.
 */
export function mapServerValidationErrors(details?: IApiErrorDetail[]): AddressFormErrors {
  const mapped: AddressFormErrors = {};
  if (!Array.isArray(details)) {
    return mapped;
  }

  for (const detail of details) {
    if (!detail || typeof detail.field !== 'string' || typeof detail.message !== 'string') {
      continue;
    }
    const key = mapZodIssueFieldToFormKey(detail.field.split('.'));
    if (key && !mapped[key]) {
      mapped[key] = detail.message;
    }
  }

  return mapped;
}

export function formatAddressTimestamp(value?: string): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
