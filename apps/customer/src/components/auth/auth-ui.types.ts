import type {
  IAuthResponse,
  IAuthUser,
  IOtpRequestResponse,
} from '@thehomez/shared-types';
import type { IAuthError } from '../../types/auth.js';

/**
 * Supported country codes for customer phone authentication.
 * Defaults to India (+91) per TheHomez launch geography.
 */
export interface CountryCodeOption {
  code: string;
  iso: string;
  label: string;
  flag: string;
  placeholder: string;
  minDigits: number;
  maxDigits: number;
}

export const DEFAULT_COUNTRY_CODE = '+91';

export const SUPPORTED_COUNTRY_CODES: readonly CountryCodeOption[] = [
  {
    code: '+91',
    iso: 'IN',
    label: 'India (+91)',
    flag: '🇮🇳',
    placeholder: '98765 43210',
    minDigits: 10,
    maxDigits: 10,
  },
  {
    code: '+971',
    iso: 'AE',
    label: 'UAE (+971)',
    flag: '🇦🇪',
    placeholder: '50 123 4567',
    minDigits: 9,
    maxDigits: 9,
  },
  {
    code: '+65',
    iso: 'SG',
    label: 'Singapore (+65)',
    flag: '🇸🇬',
    placeholder: '8123 4567',
    minDigits: 8,
    maxDigits: 8,
  },
  {
    code: '+1',
    iso: 'US',
    label: 'US / Canada (+1)',
    flag: '🇺🇸',
    placeholder: '415 555 2671',
    minDigits: 10,
    maxDigits: 10,
  },
  {
    code: '+44',
    iso: 'GB',
    label: 'United Kingdom (+44)',
    flag: '🇬🇧',
    placeholder: '7911 123456',
    minDigits: 10,
    maxDigits: 10,
  },
] as const;

export const DEFAULT_OTP_RESEND_COOLDOWN_SECONDS = 60;
export const DEFAULT_OTP_TTL_SECONDS = 300;
export const OTP_LENGTH = 6;

/**
 * Visual step inside the 2-step authentication flow + authenticated confirmation.
 */
export type AuthStep = 'phone' | 'otp' | 'success';

/**
 * Explicit authentication state machine states.
 */
export type AuthFlowStatus =
  | 'idle'
  | 'requesting_otp'
  | 'otp_requested'
  | 'verifying_otp'
  | 'verification_failed'
  | 'authenticated'
  | 'network_error';

/**
 * Normalized backend / network error categories surfaced by the UI.
 */
export type AuthErrorCategory =
  | 'invalid_otp'
  | 'otp_expired'
  | 'cooldown_active'
  | 'account_locked'
  | 'rate_limited'
  | 'delivery_failed'
  | 'account_inactive'
  | 'validation_error'
  | 'network_error'
  | 'not_connected'
  | 'generic';

export interface NormalizedAuthError {
  category: AuthErrorCategory;
  code: string;
  message: string;
  remainingSeconds?: number;
}

/**
 * Integration contract expected from Chat A's AuthContext (`apps/customer/src/context/AuthContext.tsx`).
 *
 * UI components call `requestOtp` and `verifyOtp` through this contract rather than
 * implementing a separate API client.
 */
export interface ICustomerAuthContextContract {
  isAuthenticated: boolean;
  isLoading?: boolean;
  user: IAuthUser | null;
  requestOtp: (phone: string) => Promise<IOtpRequestResponse | void>;
  verifyOtp: (phone: string, otp: string) => Promise<IAuthResponse | IAuthUser | void>;
  logout?: () => Promise<void>;
  error?: IAuthError | string | null;
  clearError?: () => void;
}
