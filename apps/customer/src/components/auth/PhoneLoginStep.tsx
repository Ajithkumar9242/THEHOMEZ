import React, { useEffect, useRef, useState } from 'react';
import {
  SUPPORTED_COUNTRY_CODES,
  type NormalizedAuthError,
} from './auth-ui.types.js';
import {
  getCountryCodeOption,
  sanitizePhoneInput,
  validateLocalPhone,
} from './auth-utils.js';

declare global {
  interface ImportMeta {
    readonly env: {
      readonly DEV?: boolean;
    };
  }
}

export interface PhoneLoginStepProps {
  countryCode: string;
  phoneNumber: string;
  onCountryCodeChange: (nextCode: string) => void;
  onPhoneNumberChange: (nextDigits: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  apiError: NormalizedAuthError | null;
  onClearError: () => void;
  titleId?: string;
  autoFocus?: boolean;
}

/**
 * Screen 1: Customer Phone Number Login.
 *
 * Includes:
 * - Country code selector defaulting to India (+91)
 * - Mobile number input with E.164/Indian mobile validation
 * - Clear indication that a 6-digit OTP will be sent
 * - Loading state & accessible API error banner
 */
export const PhoneLoginStep: React.FC<PhoneLoginStepProps> = ({
  countryCode,
  phoneNumber,
  onCountryCodeChange,
  onPhoneNumberChange,
  onSubmit,
  isSubmitting,
  apiError,
  onClearError,
  titleId,
  autoFocus = true,
}) => {
  const [touched, setTouched] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);

  const selectedCountry = getCountryCodeOption(countryCode);

  useEffect(() => {
    if (autoFocus && phoneInputRef.current) {
      phoneInputRef.current.focus();
    }
  }, [autoFocus]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizePhoneInput(e.target.value, countryCode);
    onPhoneNumberChange(sanitized);
    if (validationError) {
      setValidationError(null);
    }
    if (apiError) {
      onClearError();
    }
  };

  const handleCountryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextCode = e.target.value;
    onCountryCodeChange(nextCode);
    onPhoneNumberChange(sanitizePhoneInput(phoneNumber, nextCode));
    setValidationError(null);
    if (apiError) {
      onClearError();
    }
  };

  const handleBlur = () => {
    if (!phoneNumber) return;
    setTouched(true);
    setValidationError(validateLocalPhone(countryCode, phoneNumber));
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const err = validateLocalPhone(countryCode, phoneNumber);
    if (err) {
      setValidationError(err);
      phoneInputRef.current?.focus();
      return;
    }
    setValidationError(null);
    onSubmit();
  };

  const displayError = validationError ?? (touched ? validateLocalPhone(countryCode, phoneNumber) : null);
  const hasFieldError = Boolean(validationError);

  return (
    <div className="thz-auth-step">
      <div className="thz-auth-header-copy">
        <h2 id={titleId} className="thz-auth-title">
          Sign in with mobile number
        </h2>
        <p className="thz-auth-subtitle">
          Access saved job-site addresses, persistent carts, and trade pricing. Request a{' '}
          <strong>6-digit one-time verification code (OTP)</strong> for your mobile number.
        </p>
      </div>

      {apiError ? (
        <div
          className={`thz-auth-alert ${
            apiError.category === 'cooldown_active' || apiError.category === 'rate_limited'
              ? 'warning'
              : 'error'
          }`}
          role="alert"
          aria-live="assertive"
        >
          <span className="thz-auth-alert-icon" aria-hidden="true">
            {apiError.category === 'network_error' ? '📡' : '⚠️'}
          </span>
          <div className="thz-auth-alert-content">
            <strong>
              {apiError.category === 'network_error'
                ? 'Connection error'
                : apiError.category === 'account_locked'
                  ? 'Account temporarily locked'
                  : apiError.category === 'cooldown_active'
                    ? 'Please wait before retrying'
                    : 'Unable to send OTP'}
            </strong>
            <p>{apiError.message}</p>
          </div>
        </div>
      ) : null}

      <form className="thz-auth-form" onSubmit={handleFormSubmit} noValidate>
        <div className="thz-auth-field">
          <label htmlFor="thz-auth-phone-input" className="thz-auth-label">
            Mobile number
          </label>
          <div className="thz-auth-phone-row">
            <div className="thz-auth-country-wrap">
              <label htmlFor="thz-auth-country-select" className="thz-sr-only">
                Country code
              </label>
              <select
                id="thz-auth-country-select"
                className="thz-auth-country-select"
                value={countryCode}
                onChange={handleCountryChange}
                disabled={isSubmitting}
                aria-label="Country code"
              >
                {SUPPORTED_COUNTRY_CODES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.flag} {country.code} ({country.iso})
                  </option>
                ))}
              </select>
            </div>

            <input
              ref={phoneInputRef}
              id="thz-auth-phone-input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              className={`thz-auth-phone-input${hasFieldError ? ' error' : ''}`}
              placeholder={selectedCountry.placeholder}
              value={phoneNumber}
              onChange={handlePhoneChange}
              onBlur={handleBlur}
              disabled={isSubmitting}
              maxLength={16}
              aria-invalid={hasFieldError ? 'true' : undefined}
              aria-describedby={
                hasFieldError ? 'thz-auth-phone-error thz-auth-otp-hint' : 'thz-auth-otp-hint'
              }
            />
          </div>

          {hasFieldError && displayError ? (
            <p id="thz-auth-phone-error" className="thz-auth-field-error" role="alert">
              {displayError}
            </p>
          ) : null}

          <p id="thz-auth-otp-hint" className="thz-auth-helper">
            Enter your mobile number to generate a 6-digit verification code to sign in.
          </p>
          {import.meta.env.DEV ? (
            <p className="thz-auth-helper" role="note" data-testid="thz-dev-otp-notice">
              Development mode: The generated verification code is printed in the backend terminal.
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          className="thz-auth-submit-btn"
          disabled={isSubmitting}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <span className="thz-auth-spinner" aria-hidden="true" />
              <span>Sending OTP...</span>
            </>
          ) : (
            <span>Continue</span>
          )}
        </button>
      </form>
    </div>
  );
};
