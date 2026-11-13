/**
 * Authenticated Customer Cart View (/cart)
 *
 * Milestone 5B.2 & 5B.3 — Customer Cart, Validation & Price Acknowledgement Page:
 * - Mounted inside `<ProtectedRoute>` so logged-out customers redirect to `/login?redirect=%2Fcart`.
 * - Fetches live hydrated cart state from `GET /api/v1/cart` via `CartContext`.
 * - Supports quantity updates (BigInt exact), item removal, clear cart with confirmation,
 *   delivery PIN localization sync, explicit cart validation (`POST /api/v1/cart/validate`),
 *   explicit price drift acknowledgement (`POST /api/v1/cart/acknowledge-prices`),
 *   saved address selection for validation, loading skeletons, empty state, and error + retry states.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ICartValidationIssueDto, ICustomerAddressDto } from '@thehomez/shared-types';
import { AddressClient } from '../api/address-client.js';
import { useAuth } from '../context/AuthContext.js';
import { useCart } from '../context/CartContext.js';
import { useStorefront } from '../context/StorefrontContext.js';
import {
  CartItemRow,
  CartSummaryCard,
  CartValidationPanel,
  ClearCartDialog,
  type CartValidationSummaryStatus,
} from '../components/cart/index.js';

export const CartView: React.FC = () => {
  const { authorizedFetch } = useAuth();
  const {
    pincode,
    openLocationModal,
    navigateToHome,
    navigateToPlp,
    navigateToProduct,
    navigateToAddresses,
    navigateToCheckout,
  } = useStorefront();
  const {
    cart,
    isLoading,
    error,
    notice,
    isMutatingCart,
    pendingItemIds,
    validationResult,
    validationError,
    isValidating,
    isAcknowledging,
    acknowledgingItemIds,
    isValidationStale,
    loadCart,
    updateItemQuantity,
    removeItem,
    clearCart,
    validateCart,
    acknowledgePrices,
    invalidateValidation,
    clearError,
    clearNotice,
  } = useCart();

  const addressClient = useMemo(
    () => new AddressClient({ fetchWithAuth: authorizedFetch }),
    [authorizedFetch],
  );

  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const [clearDialogError, setClearDialogError] = useState<string | null>(null);
  const [savedAddresses, setSavedAddresses] = useState<ICustomerAddressDto[] | null>(null);
  const [isLoadingAddresses, setIsLoadingAddresses] = useState(false);
  const [addressLoadError, setAddressLoadError] = useState<string | null>(null);
  const didInitialLoadRef = useRef(false);

  useEffect(() => {
    if (didInitialLoadRef.current) return;
    didInitialLoadRef.current = true;
    void loadCart({ syncPincodeIfSet: pincode });
  }, [loadCart, pincode]);

  const handleLoadSavedAddresses = useCallback(async () => {
    setIsLoadingAddresses(true);
    setAddressLoadError(null);
    try {
      const list = await addressClient.listAddresses();
      setSavedAddresses(list);
    } catch (err: unknown) {
      setAddressLoadError(
        err instanceof Error
          ? err.message
          : 'Unable to load saved addresses right now.',
      );
    } finally {
      setIsLoadingAddresses(false);
    }
  }, [addressClient]);

  const handleRetry = () => {
    void loadCart({ syncPincodeIfSet: pincode });
  };

  const handleUpdateQuantity = async (itemId: string, quantity: string) => {
    await updateItemQuantity(itemId, quantity);
  };

  const handleRemoveItem = async (itemId: string) => {
    try {
      await removeItem(itemId);
    } catch {
      // CartContext already captures and surfaces the API error state cleanly
    }
  };

  const handleAcknowledgeItemPrice = async (itemId: string) => {
    try {
      await acknowledgePrices([itemId]);
    } catch {
      // CartContext already captures and surfaces the API error state cleanly
    }
  };

  const handleQuickValidate = async () => {
    try {
      await validateCart({});
    } catch {
      // CartContext already captures and surfaces validationError cleanly
    }
  };

  const handleOpenClearDialog = () => {
    setClearDialogError(null);
    setIsClearDialogOpen(true);
  };

  const handleCancelClearDialog = () => {
    if (isMutatingCart) return;
    setClearDialogError(null);
    setIsClearDialogOpen(false);
  };

  const handleConfirmClearCart = async () => {
    setClearDialogError(null);
    try {
      await clearCart();
      setIsClearDialogOpen(false);
    } catch (err: unknown) {
      setClearDialogError(
        err instanceof Error ? err.message : 'Unable to clear cart. Please try again.',
      );
    }
  };

  const hasAnyPendingRow = Object.keys(pendingItemIds).length > 0;
  const hasAnyAcknowledging =
    isAcknowledging || Object.values(acknowledgingItemIds).some(Boolean);
  const isSummaryBusy = isMutatingCart || isLoading || hasAnyPendingRow || hasAnyAcknowledging;
  const hasCurrentValidationSnapshot = Boolean(
    validationResult?.validationSnapshotId &&
    validationResult.validationSnapshotExpiresAt &&
    Date.parse(validationResult.validationSnapshotExpiresAt) > Date.now() &&
    cart?.version === validationResult.cart.version &&
    !isValidationStale,
  );

  const validationStatus: CartValidationSummaryStatus = useMemo(() => {
    if (isValidationStale) return 'STALE';
    if (!validationResult) return 'UNVALIDATED';
    if (!hasCurrentValidationSnapshot) return 'STALE';
    if (
      validationResult.isValidForCheckout &&
      validationResult.blockingReasons.length === 0 &&
      validationResult.priceChangedItems.length === 0
    ) {
      return 'READY';
    }
    return 'ACTION_NEEDED';
  }, [hasCurrentValidationSnapshot, isValidationStale, validationResult]);

  const issuesByItemId = useMemo(() => {
    const map: Record<string, ICartValidationIssueDto[]> = {};
    if (!validationResult || isValidationStale) {
      return map;
    }
    for (const issue of validationResult.blockingReasons) {
      if (issue.itemId) {
        const list = map[issue.itemId] ?? [];
        list.push(issue);
        map[issue.itemId] = list;
      }
    }
    return map;
  }, [isValidationStale, validationResult]);

  return (
    <section className="thz-cart-page" aria-labelledby="thz-cart-page-title">
      {/* Breadcrumbs */}
      <nav className="thz-breadcrumbs" aria-label="Breadcrumb">
        <button type="button" className="thz-breadcrumb-btn" onClick={navigateToHome}>
          Home
        </button>
        <span aria-hidden="true">/</span>
        <span aria-current="page">Shopping Cart</span>
      </nav>

      {/* Page Header */}
      <header className="thz-cart-header">
        <div>
          <h1 id="thz-cart-page-title" className="thz-cart-title">
            Shopping Cart
          </h1>
          <p className="thz-cart-subtitle">
            Review material quantities, active hub availability, and GST-exclusive subtotals.
          </p>
        </div>

        {cart ? (
          <div className="thz-cart-header-count" aria-live="polite">
            {cart.totalItemCount} {cart.totalItemCount === 1 ? 'item' : 'items'}
          </div>
        ) : null}
      </header>

      {/* Success / Status Notice Banner */}
      {notice ? (
        <div className="thz-account-notice success" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="thz-notice-dismiss"
            onClick={clearNotice}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      ) : null}

      {/* API Error Banner */}
      {error ? (
        <div className="thz-account-error-banner" role="alert">
          <div>
            <strong>Cart Error:</strong> <span>{error}</span>
          </div>
          <div className="thz-cart-error-actions">
            <button
              type="button"
              className="thz-btn-secondary thz-btn-compact"
              onClick={handleRetry}
              disabled={isLoading}
            >
              Retry
            </button>
            <button
              type="button"
              className="thz-notice-dismiss"
              onClick={clearError}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      {/* Initial Loading Skeleton */}
      {isLoading && !cart ? (
        <div className="thz-cart-loading" role="status" aria-label="Loading your shopping cart">
          <div className="thz-skeleton-card thz-cart-skeleton-row" />
          <div className="thz-skeleton-card thz-cart-skeleton-row" />
        </div>
      ) : null}

      {/* Hard Initial Load Failure State (no cached cart yet) */}
      {!isLoading && !cart && error ? (
        <div className="thz-cart-empty-card">
          <div className="thz-cart-empty-icon" aria-hidden="true">
            ⚠️
          </div>
          <h2>Unable to load your cart</h2>
          <p>{error}</p>
          <div className="thz-cart-empty-actions">
            <button type="button" className="thz-btn-primary" onClick={handleRetry}>
              Retry Loading Cart
            </button>
            <button
              type="button"
              className="thz-btn-secondary"
              onClick={() => navigateToPlp({})}
            >
              Browse Materials
            </button>
          </div>
        </div>
      ) : null}

      {/* Empty Cart State */}
      {cart && cart.items.length === 0 ? (
        <div className="thz-cart-empty-card">
          <div className="thz-cart-empty-icon" aria-hidden="true">
            🛒
          </div>
          <h2>Your cart is empty</h2>
          <p>
            Explore cement, TMT steel, aggregates, and building supplies with live local hub
            availability.
          </p>
          <div className="thz-cart-empty-actions">
            <button
              type="button"
              className="thz-btn-primary"
              onClick={() => navigateToPlp({})}
            >
              Browse Materials
            </button>
            <button type="button" className="thz-btn-secondary" onClick={openLocationModal}>
              {cart.pincode ? `Delivery PIN: ${cart.pincode}` : 'Set Delivery PIN'}
            </button>
          </div>
        </div>
      ) : null}

      {/* Populated Cart Layout */}
      {cart && cart.items.length > 0 ? (
        <div className="thz-cart-layout">
          <div className="thz-cart-items-col" aria-label="Cart line items and validation">
            <CartValidationPanel
              cart={cart}
              validationResult={validationResult}
              validationError={validationError}
              isValidating={isValidating}
              isAcknowledging={isAcknowledging}
              acknowledgingItemIds={acknowledgingItemIds}
              isValidationStale={isValidationStale}
              hasCurrentValidationSnapshot={hasCurrentValidationSnapshot}
              isCartBusy={isMutatingCart}
              savedAddresses={savedAddresses}
              isLoadingAddresses={isLoadingAddresses}
              addressLoadError={addressLoadError}
              onLoadSavedAddresses={handleLoadSavedAddresses}
              onValidateCart={validateCart}
              onInvalidateValidation={invalidateValidation}
              onAcknowledgePrices={acknowledgePrices}
              onOpenAddresses={navigateToAddresses}
              onOpenLocationModal={openLocationModal}
            />

            {cart.items.map((item) => (
              <CartItemRow
                key={item.itemId}
                item={item}
                isPending={Boolean(pendingItemIds[item.itemId])}
                isCartBusy={isMutatingCart}
                isAcknowledging={isAcknowledging || Boolean(acknowledgingItemIds[item.itemId])}
                canAcknowledgePrice={hasCurrentValidationSnapshot}
                validationIssues={issuesByItemId[item.itemId]}
                onUpdateQuantity={handleUpdateQuantity}
                onRemoveItem={handleRemoveItem}
                onAcknowledgePrice={handleAcknowledgeItemPrice}
                onNavigateToProduct={navigateToProduct}
                onChangeLocation={openLocationModal}
              />
            ))}
          </div>

          <div className="thz-cart-summary-col">
            <CartSummaryCard
              cart={cart}
              isBusy={isSummaryBusy}
              validationStatus={validationStatus}
              isValidating={isValidating}
              onValidateCart={() => void handleQuickValidate()}
              onChangeLocation={openLocationModal}
              onRequestClearCart={handleOpenClearDialog}
              onBrowseCatalog={() => navigateToPlp({})}
            />
            {cart.isValidForCheckout ? <button type="button" className="thz-btn-primary thz-checkout-cta" onClick={navigateToCheckout} disabled={isSummaryBusy}>
              Proceed to Checkout Preparation
            </button> : null}
          </div>
        </div>
      ) : null}

      {/* Clear Cart Confirmation Dialog */}
      <ClearCartDialog
        isOpen={isClearDialogOpen}
        itemCount={cart?.totalItemCount ?? 0}
        isClearing={isMutatingCart}
        error={clearDialogError}
        onConfirm={() => void handleConfirmClearCart()}
        onCancel={handleCancelClearDialog}
      />
    </section>
  );
};
