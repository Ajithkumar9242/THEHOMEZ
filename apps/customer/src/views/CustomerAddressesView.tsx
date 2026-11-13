/**
 * TheHomez Customer Address Book Management View (`/account/addresses`)
 *
 * Protected customer-only route guarded by `<ProtectedRoute>`.
 * Integrates with backend Milestone 5B.1 endpoints via `AuthContext.authorizedFetch`:
 * - List saved delivery site addresses with live serviceability
 * - View complete address details
 * - Add new delivery site address (up to MAX_ADDRESSES_PER_CUSTOMER = 20)
 * - Edit existing address
 * - Promote an address as default
 * - Delete address with confirmation
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_ADDRESSES_PER_CUSTOMER,
  type ICreateCustomerAddressDto,
  type ICustomerAddressDto,
  type IUpdateCustomerAddressDto,
} from '@thehomez/shared-types';
import { AddressApiError, AddressClient } from '../api/address-client.js';
import { useAuth } from '../context/AuthContext.js';
import { useStorefront } from '../context/StorefrontContext.js';
import { AccountNavigation } from '../components/addresses/AccountNavigation.js';
import { AddressCard } from '../components/addresses/AddressCard.js';
import { AddressFormModal } from '../components/addresses/AddressFormModal.js';
import { AddressDetailsModal } from '../components/addresses/AddressDetailsModal.js';
import { DeleteAddressDialog } from '../components/addresses/DeleteAddressDialog.js';
import {
  mapServerValidationErrors,
  type AddressFormErrors,
} from '../components/addresses/address-form.utils.js';

export const CustomerAddressesView: React.FC = () => {
  const { isAuthenticated, user, authorizedFetch } = useAuth();
  const { navigateToHome, navigateToAccount } = useStorefront();

  const addressClient = useMemo(
    () => new AddressClient({ fetchWithAuth: authorizedFetch }),
    [authorizedFetch],
  );

  const [addresses, setAddresses] = useState<ICustomerAddressDto[]>([]);
  const [isLoadingList, setIsLoadingList] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Add / Edit modal state
  const [formModalState, setFormModalState] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    address: ICustomerAddressDto | null;
  }>({ open: false, mode: 'create', address: null });
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [formServerError, setFormServerError] = useState<string | null>(null);
  const [formServerFieldErrors, setFormServerFieldErrors] = useState<AddressFormErrors>({});

  // Details modal state
  const [detailsAddress, setDetailsAddress] = useState<ICustomerAddressDto | null>(null);

  // Delete confirmation dialog state
  const [deleteTarget, setDeleteTarget] = useState<ICustomerAddressDto | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Set default state
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadAddresses = useCallback(
    async (signal?: AbortSignal) => {
      if (!isAuthenticated) {
        return;
      }
      setIsLoadingList(true);
      setLoadError(null);
      try {
        const items = await addressClient.listAddresses(signal);
        if (!isMountedRef.current || signal?.aborted) return;
        setAddresses(Array.isArray(items) ? items : []);
      } catch (err) {
        if (!isMountedRef.current || signal?.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof Error && err.name === 'AbortError') return;

        setLoadError(
          err instanceof Error
            ? err.message
            : 'Unable to load your saved delivery addresses. Please try again.',
        );
      } finally {
        if (isMountedRef.current && !signal?.aborted) {
          setIsLoadingList(false);
        }
      }
    },
    [addressClient, isAuthenticated],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setAddresses([]);
      return;
    }
    const controller = new AbortController();
    void loadAddresses(controller.signal);
    return () => {
      controller.abort();
    };
  }, [isAuthenticated, user?.id, loadAddresses]);

  const syncAddressesAfterMutation = useCallback(
    async (fallbackUpdater: (prev: ICustomerAddressDto[]) => ICustomerAddressDto[]) => {
      try {
        const items = await addressClient.listAddresses();
        if (isMountedRef.current) {
          setAddresses(Array.isArray(items) ? items : []);
        }
      } catch {
        // Mutation already succeeded on the server; apply deterministic local update so
        // the modal/dialog still closes cleanly without risking duplicate retries.
        if (isMountedRef.current) {
          setAddresses(fallbackUpdater);
        }
      }
    },
    [addressClient],
  );

  const atAddressLimit = addresses.length >= MAX_ADDRESSES_PER_CUSTOMER;

  const openCreateModal = () => {
    if (atAddressLimit) {
      setPageError(
        `You have reached the maximum limit of ${MAX_ADDRESSES_PER_CUSTOMER} saved addresses. Delete an older address before adding a new one.`,
      );
      return;
    }
    setSuccessMessage(null);
    setPageError(null);
    setFormServerError(null);
    setFormServerFieldErrors({});
    setFormModalState({ open: true, mode: 'create', address: null });
  };

  const openEditModal = (address: ICustomerAddressDto) => {
    setSuccessMessage(null);
    setPageError(null);
    setDetailsAddress(null);
    setFormServerError(null);
    setFormServerFieldErrors({});
    setFormModalState({ open: true, mode: 'edit', address });
  };

  const closeFormModal = () => {
    if (isSaving) return;
    setFormModalState((prev) => ({ ...prev, open: false }));
    setFormServerError(null);
    setFormServerFieldErrors({});
  };

  const handleFormSubmit = async (
    payload: ICreateCustomerAddressDto | IUpdateCustomerAddressDto,
  ) => {
    if (isSaving) return;
    setIsSaving(true);
    setFormServerError(null);
    setFormServerFieldErrors({});
    setPageError(null);
    setSuccessMessage(null);

    try {
      if (formModalState.mode === 'create') {
        const created = await addressClient.createAddress(payload as ICreateCustomerAddressDto);
        await syncAddressesAfterMutation((prev) => {
          const normalizedPrev = created.isDefault
            ? prev.map((item) => ({ ...item, isDefault: false }))
            : prev;
          return created.isDefault ? [created, ...normalizedPrev] : [...normalizedPrev, created];
        });
        if (!isMountedRef.current) return;
        setFormModalState({ open: false, mode: 'create', address: null });
        setSuccessMessage(`Address "${created.label}" added to your address book.`);
      } else if (formModalState.address) {
        const updated = await addressClient.updateAddress(
          formModalState.address.id,
          payload as IUpdateCustomerAddressDto,
        );
        await syncAddressesAfterMutation((prev) =>
          prev.map((item) => {
            if (item.id === updated.id) return updated;
            return updated.isDefault ? { ...item, isDefault: false } : item;
          }),
        );
        if (!isMountedRef.current) return;
        setFormModalState({ open: false, mode: 'create', address: null });
        setSuccessMessage(`Address "${updated.label}" updated successfully.`);
      }
    } catch (err) {
      if (!isMountedRef.current) return;
      if (err instanceof AddressApiError) {
        setFormServerError(err.message);
        if (err.details) {
          setFormServerFieldErrors(mapServerValidationErrors(err.details));
        }
      } else {
        setFormServerError(
          err instanceof Error ? err.message : 'Unable to save address. Please try again.',
        );
      }
    } finally {
      if (isMountedRef.current) {
        setIsSaving(false);
      }
    }
  };

  const handleSetDefault = async (address: ICustomerAddressDto) => {
    if (settingDefaultId || isDeleting) return;
    setSettingDefaultId(address.id);
    setPageError(null);
    setSuccessMessage(null);

    try {
      const updated = await addressClient.setDefaultAddress(address.id);
      await syncAddressesAfterMutation((prev) => {
        const mapped = prev.map((item) =>
          item.id === updated.id ? updated : { ...item, isDefault: false },
        );
        return mapped.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      });
      if (!isMountedRef.current) return;
      if (detailsAddress?.id === address.id) {
        setDetailsAddress(updated);
      }
      setSuccessMessage(`"${updated.label}" is now your default delivery address.`);
    } catch (err) {
      if (!isMountedRef.current) return;
      setPageError(
        err instanceof Error
          ? err.message
          : 'Unable to update default delivery address. Please try again.',
      );
    } finally {
      if (isMountedRef.current) {
        setSettingDefaultId(null);
      }
    }
  };

  const openDeleteDialog = (address: ICustomerAddressDto) => {
    setDetailsAddress(null);
    setDeleteError(null);
    setPageError(null);
    setSuccessMessage(null);
    setDeleteTarget(address);
  };

  const closeDeleteDialog = () => {
    if (isDeleting) return;
    setDeleteTarget(null);
    setDeleteError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    setPageError(null);
    setSuccessMessage(null);

    const targetId = deleteTarget.id;
    const targetLabel = deleteTarget.label;

    try {
      const result = await addressClient.deleteAddress(targetId);
      await syncAddressesAfterMutation((prev) =>
        prev
          .filter((item) => item.id !== targetId)
          .map((item) =>
            result.promotedDefaultAddressId && item.id === result.promotedDefaultAddressId
              ? { ...item, isDefault: true }
              : item,
          ),
      );
      if (!isMountedRef.current) return;
      setDeleteTarget(null);
      setSuccessMessage(
        result.promotedDefaultAddressId
          ? `Address "${targetLabel}" deleted. Another saved address was promoted to default.`
          : `Address "${targetLabel}" deleted from your address book.`,
      );
    } catch (err) {
      if (!isMountedRef.current) return;
      setDeleteError(
        err instanceof Error ? err.message : 'Unable to delete address. Please try again.',
      );
    } finally {
      if (isMountedRef.current) {
        setIsDeleting(false);
      }
    }
  };

  return (
    <section className="thz-account-section" aria-labelledby="thz-addresses-heading">
      <nav className="thz-breadcrumb-nav" aria-label="Breadcrumb">
        <button type="button" className="thz-breadcrumb-btn" onClick={navigateToHome}>
          Home
        </button>
        <span aria-hidden="true">/</span>
        <button type="button" className="thz-breadcrumb-btn" onClick={navigateToAccount}>
          My Account
        </button>
        <span aria-hidden="true">/</span>
        <span className="thz-breadcrumb-current">Saved Addresses</span>
      </nav>

      <AccountNavigation activeTab="addresses" />

      <div className="thz-account-header">
        <div>
          <span className="thz-account-eyebrow">Customer Address Book</span>
          <h1 id="thz-addresses-heading" className="thz-account-title">
            Saved Delivery Addresses
          </h1>
          <p className="thz-account-subtitle">
            Manage your job-site and delivery addresses, site contacts, and PIN serviceability.
            {!isLoadingList && !loadError ? (
              <span className="thz-address-count-pill">
                {addresses.length} of {MAX_ADDRESSES_PER_CUSTOMER} saved
              </span>
            ) : null}
          </p>
        </div>

        <div className="thz-account-header-actions">
          <button
            type="button"
            className="thz-btn-primary"
            onClick={openCreateModal}
            disabled={isLoadingList || atAddressLimit}
            title={
              atAddressLimit
                ? `Maximum of ${MAX_ADDRESSES_PER_CUSTOMER} addresses reached`
                : 'Add a new delivery address'
            }
          >
            + Add New Address
          </button>
        </div>
      </div>

      {atAddressLimit && !isLoadingList ? (
        <div className="thz-notice-banner warning" role="status">
          <span aria-hidden="true">ℹ️</span>
          <span>
            You have reached the maximum of {MAX_ADDRESSES_PER_CUSTOMER} saved addresses. Delete an
            existing address to add a new one.
          </span>
        </div>
      ) : null}

      {successMessage ? (
        <div className="thz-notice-banner success" role="status" aria-live="polite">
          <span aria-hidden="true">✓</span>
          <p style={{ flex: 1, fontSize: '0.9rem', fontWeight: 500 }}>{successMessage}</p>
          <button
            type="button"
            className="thz-btn-secondary"
            onClick={() => setSuccessMessage(null)}
            aria-label="Dismiss success message"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {pageError ? (
        <div className="thz-notice-banner error" role="alert">
          <span aria-hidden="true">⚠️</span>
          <div style={{ flex: 1 }}>
            <strong>Action failed</strong>
            <p style={{ fontSize: '0.875rem', marginTop: '2px' }}>{pageError}</p>
          </div>
          <button
            type="button"
            className="thz-btn-secondary"
            onClick={() => setPageError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {isLoadingList ? (
        <div
          className="thz-address-skeleton-grid"
          aria-busy="true"
          aria-label="Loading saved addresses"
          role="status"
        >
          <div className="thz-skeleton-card thz-address-skeleton-card" />
          <div className="thz-skeleton-card thz-address-skeleton-card" />
        </div>
      ) : loadError ? (
        <div className="thz-address-error-panel" role="alert">
          <h2>Unable to load saved addresses</h2>
          <p>{loadError}</p>
          <button
            type="button"
            className="thz-btn-primary"
            onClick={() => {
              void loadAddresses();
            }}
          >
            Retry
          </button>
        </div>
      ) : addresses.length === 0 ? (
        <div className="thz-address-empty-state" role="status">
          <div className="thz-address-empty-icon" aria-hidden="true">
            📍
          </div>
          <h2 className="thz-address-empty-title">No saved delivery addresses yet</h2>
          <p className="thz-address-empty-copy">
            Save your construction site or delivery locations with PIN codes, on-site supervisor
            contacts, and heavy-vehicle access notes.
          </p>
          <button type="button" className="thz-btn-primary" onClick={openCreateModal}>
            Add Your First Address
          </button>
        </div>
      ) : (
        <div className="thz-address-grid">
          {addresses.map((address) => (
            <AddressCard
              key={address.id}
              address={address}
              isSettingDefault={settingDefaultId === address.id}
              isDeleting={isDeleting && deleteTarget?.id === address.id}
              onViewDetails={(addr) => setDetailsAddress(addr)}
              onEdit={openEditModal}
              onSetDefault={(addr) => {
                void handleSetDefault(addr);
              }}
              onDelete={openDeleteDialog}
            />
          ))}
        </div>
      )}

      <AddressFormModal
        isOpen={formModalState.open}
        mode={formModalState.mode}
        initialAddress={formModalState.address}
        isFirstAddress={addresses.length === 0}
        isSaving={isSaving}
        serverError={formServerError}
        serverFieldErrors={formServerFieldErrors}
        onClearServerError={() => {
          setFormServerError(null);
          setFormServerFieldErrors({});
        }}
        onSubmit={(payload) => {
          void handleFormSubmit(payload);
        }}
        onClose={closeFormModal}
      />

      <AddressDetailsModal
        address={detailsAddress}
        isSettingDefault={Boolean(detailsAddress && settingDefaultId === detailsAddress.id)}
        onClose={() => setDetailsAddress(null)}
        onEdit={openEditModal}
        onSetDefault={(addr) => {
          void handleSetDefault(addr);
        }}
        onDelete={openDeleteDialog}
      />

      <DeleteAddressDialog
        address={deleteTarget}
        hasOtherAddresses={addresses.length > 1}
        isDeleting={isDeleting}
        error={deleteError}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        onCancel={closeDeleteDialog}
      />
    </section>
  );
};
