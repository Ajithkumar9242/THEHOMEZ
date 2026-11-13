/**
 * Customer Delivery Address Create / Edit Modal Form
 *
 * Uses the exact fields defined in `@thehomez/shared-types`:
 * - label, recipientName, phone, streetAddress, landmark (optional)
 * - city, state, pincode
 * - siteContactPerson { name, phone } (optional)
 * - heavyVehicleAccessInstructions (optional)
 * - isDefault (optional)
 *
 * Enforces client-side Zod validation, prevents duplicate submissions,
 * disables controls while saving, and maps server validation details cleanly.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ADDRESS_CITY_MAX_LENGTH,
  ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH,
  ADDRESS_LABEL_MAX_LENGTH,
  ADDRESS_LANDMARK_MAX_LENGTH,
  ADDRESS_RECIPIENT_MAX_LENGTH,
  ADDRESS_SITE_CONTACT_NAME_MAX_LENGTH,
  ADDRESS_STATE_MAX_LENGTH,
  ADDRESS_STREET_MAX_LENGTH,
  type ICreateCustomerAddressDto,
  type ICustomerAddressDto,
  type IUpdateCustomerAddressDto,
} from '@thehomez/shared-types';
import {
  addressDtoToFormValues,
  createEmptyAddressFormValues,
  validateAddressForm,
  type AddressFormErrorKey,
  type AddressFormErrors,
  type AddressFormValues,
} from './address-form.utils.js';

export interface AddressFormModalProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialAddress?: ICustomerAddressDto | null;
  isFirstAddress?: boolean;
  isSaving: boolean;
  serverError: string | null;
  serverFieldErrors?: AddressFormErrors;
  onClearServerError: () => void;
  onSubmit: (payload: ICreateCustomerAddressDto | IUpdateCustomerAddressDto) => void;
  onClose: () => void;
}

const FIELD_ORDER: AddressFormErrorKey[] = [
  'label',
  'recipientName',
  'phone',
  'streetAddress',
  'landmark',
  'city',
  'state',
  'pincode',
  'siteContactName',
  'siteContactPhone',
  'heavyVehicleAccessInstructions',
];

export const AddressFormModal: React.FC<AddressFormModalProps> = ({
  isOpen,
  mode,
  initialAddress = null,
  isFirstAddress = false,
  isSaving,
  serverError,
  serverFieldErrors,
  onClearServerError,
  onSubmit,
  onClose,
}) => {
  const [values, setValues] = useState<AddressFormValues>(() =>
    mode === 'edit' && initialAddress
      ? addressDtoToFormValues(initialAddress)
      : createEmptyAddressFormValues(isFirstAddress),
  );
  const [fieldErrors, setFieldErrors] = useState<AddressFormErrors>({});

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const labelInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const onCloseRef = useRef(onClose);
  const isSavingRef = useRef(isSaving);

  onCloseRef.current = onClose;
  isSavingRef.current = isSaving;

  // Reset form state whenever modal opens or target address changes
  useEffect(() => {
    if (!isOpen) return;
    setValues(
      mode === 'edit' && initialAddress
        ? addressDtoToFormValues(initialAddress)
        : createEmptyAddressFormValues(isFirstAddress),
    );
    setFieldErrors({});
  }, [isOpen, mode, initialAddress, isFirstAddress]);

  // Focus management & Escape key handling (only capture/restore focus on open/close transitions)
  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    labelInputRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSavingRef.current) {
        e.preventDefault();
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocusRef.current && document.contains(previousFocusRef.current)) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const mergedErrors: AddressFormErrors = {
    ...(serverFieldErrors ?? {}),
    ...fieldErrors,
  };

  const handleFieldChange = <K extends keyof AddressFormValues>(
    field: K,
    nextValue: AddressFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [field]: nextValue }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
    if (serverError || (serverFieldErrors && Object.keys(serverFieldErrors).length > 0)) {
      onClearServerError();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) {
      return;
    }

    const result = validateAddressForm(values, mode);
    if (!result.valid) {
      setFieldErrors(result.errors);
      const firstInvalidKey = FIELD_ORDER.find((key) => Boolean(result.errors[key]));
      if (firstInvalidKey && formRef.current) {
        const el = formRef.current.querySelector<HTMLElement>(
          `[name="${firstInvalidKey}"]`,
        );
        el?.focus();
      }
      return;
    }

    setFieldErrors({});
    onSubmit(result.dto);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !isSaving) {
      onClose();
    }
  };

  const titleText = mode === 'edit' ? 'Edit Delivery Address' : 'Add Delivery Address';
  const submitText =
    mode === 'edit'
      ? isSaving
        ? 'Saving Changes…'
        : 'Save Changes'
      : isSaving
        ? 'Saving Address…'
        : 'Save Address';

  return (
    <div
      className="thz-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="thz-address-form-title"
      onClick={handleBackdropClick}
    >
      <div className="thz-modal-box thz-address-modal-box">
        <div className="thz-modal-header">
          <div>
            <h2 id="thz-address-form-title" className="thz-modal-title">
              {titleText}
            </h2>
            <p className="thz-address-modal-subtitle">
              Enter your delivery site details and PIN code for serviceability verification.
            </p>
          </div>
          <button
            type="button"
            className="thz-close-btn"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close address form"
          >
            ×
          </button>
        </div>

        {serverError ? (
          <div className="thz-notice-banner error" role="alert" style={{ marginBottom: '16px' }}>
            <span aria-hidden="true">⚠️</span>
            <div>
              <strong>Unable to save address</strong>
              <p style={{ fontSize: '0.875rem', marginTop: '2px' }}>{serverError}</p>
            </div>
          </div>
        ) : null}

        <form ref={formRef} className="thz-address-form" onSubmit={handleSubmit} noValidate>
          <div className="thz-address-form-grid">
            {/* Label */}
            <div className="thz-form-field thz-form-field-full">
              <label htmlFor="thz-addr-label" className="thz-form-label">
                Address Label <span aria-hidden="true">*</span>
              </label>
              <input
                ref={labelInputRef}
                id="thz-addr-label"
                name="label"
                type="text"
                className={`thz-form-input${mergedErrors.label ? ' error' : ''}`}
                placeholder="e.g. Whitefield Site Gate 2"
                value={values.label}
                onChange={(e) => handleFieldChange('label', e.target.value)}
                maxLength={ADDRESS_LABEL_MAX_LENGTH}
                disabled={isSaving}
                aria-required="true"
                aria-invalid={mergedErrors.label ? 'true' : undefined}
                aria-describedby={mergedErrors.label ? 'thz-addr-label-err' : undefined}
              />
              {mergedErrors.label ? (
                <p id="thz-addr-label-err" className="thz-form-error" role="alert">
                  {mergedErrors.label}
                </p>
              ) : null}
            </div>

            {/* Recipient Name */}
            <div className="thz-form-field">
              <label htmlFor="thz-addr-recipient" className="thz-form-label">
                Recipient Name <span aria-hidden="true">*</span>
              </label>
              <input
                id="thz-addr-recipient"
                name="recipientName"
                type="text"
                autoComplete="name"
                className={`thz-form-input${mergedErrors.recipientName ? ' error' : ''}`}
                placeholder="e.g. Ramesh Rao"
                value={values.recipientName}
                onChange={(e) => handleFieldChange('recipientName', e.target.value)}
                maxLength={ADDRESS_RECIPIENT_MAX_LENGTH}
                disabled={isSaving}
                aria-required="true"
                aria-invalid={mergedErrors.recipientName ? 'true' : undefined}
                aria-describedby={mergedErrors.recipientName ? 'thz-addr-recipient-err' : undefined}
              />
              {mergedErrors.recipientName ? (
                <p id="thz-addr-recipient-err" className="thz-form-error" role="alert">
                  {mergedErrors.recipientName}
                </p>
              ) : null}
            </div>

            {/* Recipient Phone */}
            <div className="thz-form-field">
              <label htmlFor="thz-addr-phone" className="thz-form-label">
                Recipient Phone <span aria-hidden="true">*</span>
              </label>
              <input
                id="thz-addr-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className={`thz-form-input thz-mono${mergedErrors.phone ? ' error' : ''}`}
                placeholder="+919876543210 or 9876543210"
                value={values.phone}
                onChange={(e) => handleFieldChange('phone', e.target.value)}
                disabled={isSaving}
                aria-required="true"
                aria-invalid={mergedErrors.phone ? 'true' : undefined}
                aria-describedby={
                  mergedErrors.phone ? 'thz-addr-phone-err thz-addr-phone-hint' : 'thz-addr-phone-hint'
                }
              />
              <p id="thz-addr-phone-hint" className="thz-form-helper">
                E.164 format (+919876543210) or 10-digit Indian mobile.
              </p>
              {mergedErrors.phone ? (
                <p id="thz-addr-phone-err" className="thz-form-error" role="alert">
                  {mergedErrors.phone}
                </p>
              ) : null}
            </div>

            {/* Street Address */}
            <div className="thz-form-field thz-form-field-full">
              <label htmlFor="thz-addr-street" className="thz-form-label">
                Street / Plot Address <span aria-hidden="true">*</span>
              </label>
              <input
                id="thz-addr-street"
                name="streetAddress"
                type="text"
                autoComplete="street-address"
                className={`thz-form-input${mergedErrors.streetAddress ? ' error' : ''}`}
                placeholder="e.g. Plot 14, KIADB Industrial Area, Whitefield"
                value={values.streetAddress}
                onChange={(e) => handleFieldChange('streetAddress', e.target.value)}
                maxLength={ADDRESS_STREET_MAX_LENGTH}
                disabled={isSaving}
                aria-required="true"
                aria-invalid={mergedErrors.streetAddress ? 'true' : undefined}
                aria-describedby={mergedErrors.streetAddress ? 'thz-addr-street-err' : undefined}
              />
              {mergedErrors.streetAddress ? (
                <p id="thz-addr-street-err" className="thz-form-error" role="alert">
                  {mergedErrors.streetAddress}
                </p>
              ) : null}
            </div>

            {/* Landmark */}
            <div className="thz-form-field thz-form-field-full">
              <label htmlFor="thz-addr-landmark" className="thz-form-label">
                Landmark <span className="thz-form-optional">(Optional)</span>
              </label>
              <input
                id="thz-addr-landmark"
                name="landmark"
                type="text"
                className={`thz-form-input${mergedErrors.landmark ? ' error' : ''}`}
                placeholder="e.g. Near ITPL Main Gate"
                value={values.landmark}
                onChange={(e) => handleFieldChange('landmark', e.target.value)}
                maxLength={ADDRESS_LANDMARK_MAX_LENGTH}
                disabled={isSaving}
                aria-invalid={mergedErrors.landmark ? 'true' : undefined}
                aria-describedby={mergedErrors.landmark ? 'thz-addr-landmark-err' : undefined}
              />
              {mergedErrors.landmark ? (
                <p id="thz-addr-landmark-err" className="thz-form-error" role="alert">
                  {mergedErrors.landmark}
                </p>
              ) : null}
            </div>

            {/* City */}
            <div className="thz-form-field">
              <label htmlFor="thz-addr-city" className="thz-form-label">
                City <span aria-hidden="true">*</span>
              </label>
              <input
                id="thz-addr-city"
                name="city"
                type="text"
                autoComplete="address-level2"
                className={`thz-form-input${mergedErrors.city ? ' error' : ''}`}
                placeholder="e.g. Bengaluru"
                value={values.city}
                onChange={(e) => handleFieldChange('city', e.target.value)}
                maxLength={ADDRESS_CITY_MAX_LENGTH}
                disabled={isSaving}
                aria-required="true"
                aria-invalid={mergedErrors.city ? 'true' : undefined}
                aria-describedby={mergedErrors.city ? 'thz-addr-city-err' : undefined}
              />
              {mergedErrors.city ? (
                <p id="thz-addr-city-err" className="thz-form-error" role="alert">
                  {mergedErrors.city}
                </p>
              ) : null}
            </div>

            {/* State */}
            <div className="thz-form-field">
              <label htmlFor="thz-addr-state" className="thz-form-label">
                State <span aria-hidden="true">*</span>
              </label>
              <input
                id="thz-addr-state"
                name="state"
                type="text"
                autoComplete="address-level1"
                className={`thz-form-input${mergedErrors.state ? ' error' : ''}`}
                placeholder="e.g. Karnataka"
                value={values.state}
                onChange={(e) => handleFieldChange('state', e.target.value)}
                maxLength={ADDRESS_STATE_MAX_LENGTH}
                disabled={isSaving}
                aria-required="true"
                aria-invalid={mergedErrors.state ? 'true' : undefined}
                aria-describedby={mergedErrors.state ? 'thz-addr-state-err' : undefined}
              />
              {mergedErrors.state ? (
                <p id="thz-addr-state-err" className="thz-form-error" role="alert">
                  {mergedErrors.state}
                </p>
              ) : null}
            </div>

            {/* PIN Code */}
            <div className="thz-form-field">
              <label htmlFor="thz-addr-pincode" className="thz-form-label">
                PIN Code <span aria-hidden="true">*</span>
              </label>
              <input
                id="thz-addr-pincode"
                name="pincode"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                className={`thz-form-input thz-mono${mergedErrors.pincode ? ' error' : ''}`}
                placeholder="e.g. 560037"
                value={values.pincode}
                onChange={(e) => handleFieldChange('pincode', e.target.value)}
                maxLength={6}
                disabled={isSaving}
                aria-required="true"
                aria-invalid={mergedErrors.pincode ? 'true' : undefined}
                aria-describedby={
                  mergedErrors.pincode
                    ? 'thz-addr-pincode-err thz-addr-pincode-hint'
                    : 'thz-addr-pincode-hint'
                }
              />
              <p id="thz-addr-pincode-hint" className="thz-form-helper">
                6-digit Indian postal PIN code.
              </p>
              {mergedErrors.pincode ? (
                <p id="thz-addr-pincode-err" className="thz-form-error" role="alert">
                  {mergedErrors.pincode}
                </p>
              ) : null}
            </div>

            {/* Optional Site Contact Person */}
            <fieldset className="thz-form-fieldset thz-form-field-full">
              <legend className="thz-form-legend">
                On-Site Contact Person <span className="thz-form-optional">(Optional)</span>
              </legend>
              <div className="thz-address-form-grid">
                <div className="thz-form-field">
                  <label htmlFor="thz-addr-site-name" className="thz-form-label">
                    Site Contact Name
                  </label>
                  <input
                    id="thz-addr-site-name"
                    name="siteContactName"
                    type="text"
                    className={`thz-form-input${mergedErrors.siteContactName ? ' error' : ''}`}
                    placeholder="e.g. Suresh Kumar"
                    value={values.siteContactName}
                    onChange={(e) => handleFieldChange('siteContactName', e.target.value)}
                    maxLength={ADDRESS_SITE_CONTACT_NAME_MAX_LENGTH}
                    disabled={isSaving}
                    aria-invalid={mergedErrors.siteContactName ? 'true' : undefined}
                    aria-describedby={
                      mergedErrors.siteContactName ? 'thz-addr-site-name-err' : undefined
                    }
                  />
                  {mergedErrors.siteContactName ? (
                    <p id="thz-addr-site-name-err" className="thz-form-error" role="alert">
                      {mergedErrors.siteContactName}
                    </p>
                  ) : null}
                </div>

                <div className="thz-form-field">
                  <label htmlFor="thz-addr-site-phone" className="thz-form-label">
                    Site Contact Phone
                  </label>
                  <input
                    id="thz-addr-site-phone"
                    name="siteContactPhone"
                    type="tel"
                    inputMode="tel"
                    className={`thz-form-input thz-mono${mergedErrors.siteContactPhone ? ' error' : ''}`}
                    placeholder="+919811122233 or 9811122233"
                    value={values.siteContactPhone}
                    onChange={(e) => handleFieldChange('siteContactPhone', e.target.value)}
                    disabled={isSaving}
                    aria-invalid={mergedErrors.siteContactPhone ? 'true' : undefined}
                    aria-describedby={
                      mergedErrors.siteContactPhone ? 'thz-addr-site-phone-err' : undefined
                    }
                  />
                  {mergedErrors.siteContactPhone ? (
                    <p id="thz-addr-site-phone-err" className="thz-form-error" role="alert">
                      {mergedErrors.siteContactPhone}
                    </p>
                  ) : null}
                </div>
              </div>
            </fieldset>

            {/* Heavy Vehicle Access Instructions */}
            <div className="thz-form-field thz-form-field-full">
              <label htmlFor="thz-addr-access" className="thz-form-label">
                Heavy Vehicle Access Instructions{' '}
                <span className="thz-form-optional">(Optional)</span>
              </label>
              <textarea
                id="thz-addr-access"
                name="heavyVehicleAccessInstructions"
                rows={3}
                className={`thz-form-textarea${mergedErrors.heavyVehicleAccessInstructions ? ' error' : ''}`}
                placeholder="e.g. 12-wheeler tipper entry allowed between 6 AM and 9 PM."
                value={values.heavyVehicleAccessInstructions}
                onChange={(e) =>
                  handleFieldChange('heavyVehicleAccessInstructions', e.target.value)
                }
                maxLength={ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH}
                disabled={isSaving}
                aria-invalid={mergedErrors.heavyVehicleAccessInstructions ? 'true' : undefined}
                aria-describedby={
                  mergedErrors.heavyVehicleAccessInstructions
                    ? 'thz-addr-access-err thz-addr-access-count'
                    : 'thz-addr-access-count'
                }
              />
              <p id="thz-addr-access-count" className="thz-form-helper">
                {values.heavyVehicleAccessInstructions.length}/
                {ADDRESS_HEAVY_VEHICLE_ACCESS_MAX_LENGTH} characters
              </p>
              {mergedErrors.heavyVehicleAccessInstructions ? (
                <p id="thz-addr-access-err" className="thz-form-error" role="alert">
                  {mergedErrors.heavyVehicleAccessInstructions}
                </p>
              ) : null}
            </div>

            {/* Default Address Toggle */}
            <div className="thz-form-field thz-form-field-full">
              <label className="thz-checkbox-row" htmlFor="thz-addr-default">
                <input
                  id="thz-addr-default"
                  name="isDefault"
                  type="checkbox"
                  checked={values.isDefault}
                  onChange={(e) => handleFieldChange('isDefault', e.target.checked)}
                  disabled={isSaving}
                />
                <span>Set as default delivery address</span>
              </label>
              {mode === 'create' && isFirstAddress ? (
                <p className="thz-form-helper">
                  Your first saved address is automatically set as your default delivery address.
                </p>
              ) : null}
            </div>
          </div>

          <div className="thz-address-modal-footer">
            <button
              type="button"
              className="thz-btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="thz-btn-primary"
              disabled={isSaving}
              aria-busy={isSaving}
            >
              {submitText}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
