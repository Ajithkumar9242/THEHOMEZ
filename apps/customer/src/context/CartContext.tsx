/**
 * TheHomez Customer Cart Context
 *
 * Manages live server-authoritative Cart state for the authenticated customer
 * via `CartClient` + `AuthContext.authorizedFetch`.
 *
 * Key Invariants:
 * - Never performs eager `/cart` network calls when unauthenticated or on unrelated
 *   storefront/account routes unless explicitly loaded or mutated.
 * - Does NOT persist access tokens, refresh tokens, or client-side fake carts in browser storage.
 * - Prevents duplicate concurrent mutations per line item or add-to-cart action.
 * - Refreshes cart state cleanly on 409 `CART_VERSION_CONFLICT`.
 * - Wipes cart state immediately on logout or session expiry.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  IAddCartItemRequestDto,
  ICartSummaryDto,
  ICartValidationResultDto,
  IValidateCartRequestDto,
} from '@thehomez/shared-types';
import { CartApiError, CartClient } from '../api/cart-client.js';
import { useAuth } from './AuthContext.js';
import { useOptionalStorefront } from './StorefrontContext.js';
import { mapCartApiErrorMessage } from '../components/cart/cart-quantity.utils.js';

export interface CartContextValue {
  cart: ICartSummaryDto | null;
  isLoading: boolean;
  hasLoaded: boolean;
  error: string | null;
  notice: string | null;
  isMutatingCart: boolean;
  isAddingKey: string | null;
  pendingItemIds: Record<string, boolean>;
  validationResult: ICartValidationResultDto | null;
  validationError: string | null;
  isValidating: boolean;
  isAcknowledging: boolean;
  acknowledgingItemIds: Record<string, boolean>;
  isValidationStale: boolean;
  loadCart: (options?: { syncPincodeIfSet?: string | null }) => Promise<ICartSummaryDto | null>;
  addItem: (dto: Omit<IAddCartItemRequestDto, 'expectedVersion'>) => Promise<ICartSummaryDto>;
  updateItemQuantity: (itemId: string, quantity: string) => Promise<ICartSummaryDto>;
  removeItem: (itemId: string) => Promise<ICartSummaryDto>;
  clearCart: () => Promise<ICartSummaryDto>;
  syncLocation: (pincode: string | null) => Promise<ICartSummaryDto | null>;
  validateCart: (
    options?: Omit<IValidateCartRequestDto, 'expectedVersion'>,
  ) => Promise<ICartValidationResultDto>;
  acknowledgePrices: (itemIds?: string[]) => Promise<ICartSummaryDto>;
  invalidateValidation: () => void;
  clearError: () => void;
  clearNotice: () => void;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export interface CartProviderProps {
  children: React.ReactNode;
  cartClient?: CartClient;
}

export function buildCartAddKey(productId: string, variantId?: string | null): string {
  return `${productId}:${variantId ?? ''}`;
}

export const CartProvider: React.FC<CartProviderProps> = ({
  children,
  cartClient: injectedClient,
}) => {
  const { authorizedFetch, isAuthenticated, status } = useAuth();
  const storefront = useOptionalStorefront();
  const storefrontPincode = storefront?.pincode;

  const client = useMemo(
    () =>
      injectedClient ??
      new CartClient({
        fetchWithAuth: authorizedFetch,
      }),
    [authorizedFetch, injectedClient],
  );

  const [cart, setCart] = useState<ICartSummaryDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isMutatingCart, setIsMutatingCart] = useState<boolean>(false);
  const [isAddingKey, setIsAddingKey] = useState<string | null>(null);
  const [pendingItemIds, setPendingItemIds] = useState<Record<string, boolean>>({});
  const [validationResult, setValidationResult] = useState<ICartValidationResultDto | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [isAcknowledging, setIsAcknowledging] = useState<boolean>(false);
  const [acknowledgingItemIds, setAcknowledgingItemIds] = useState<Record<string, boolean>>({});
  const [isValidationStale, setIsValidationStale] = useState<boolean>(false);

  // Refs for synchronous duplicate-submit guards before React re-renders
  const cartRef = useRef<ICartSummaryDto | null>(null);
  cartRef.current = cart;
  const validationResultRef = useRef<ICartValidationResultDto | null>(null);
  validationResultRef.current = validationResult;
  const prevPincodeRef = useRef<string | null | undefined>(storefrontPincode);
  const inFlightAddKeysRef = useRef<Set<string>>(new Set());
  const inFlightItemIdsRef = useRef<Set<string>>(new Set());
  const inFlightCartWideRef = useRef<boolean>(false);
  const inFlightValidateRef = useRef<boolean>(false);
  const inFlightAckAllRef = useRef<boolean>(false);
  const inFlightAckItemIdsRef = useRef<Set<string>>(new Set());
  const loadRequestIdRef = useRef<number>(0);

  const invalidateValidation = useCallback(() => {
    const hadValidation = validationResultRef.current !== null;
    setValidationResult(null);
    setValidationError(null);
    setIsValidationStale(hadValidation);
  }, []);

  const markValidationStale = useCallback(() => {
    if (validationResultRef.current !== null) {
      setValidationResult(null);
      setIsValidationStale(true);
    }
    setValidationError(null);
  }, []);

  useEffect(() => {
    const expiresAt = validationResult?.validationSnapshotExpiresAt
      ? Date.parse(validationResult.validationSnapshotExpiresAt)
      : NaN;
    if (!validationResult?.validationSnapshotId || !Number.isFinite(expiresAt)) return;

    const delay = expiresAt - Date.now();
    if (delay <= 0) {
      setIsValidationStale(true);
      return;
    }

    const timer = window.setTimeout(() => setIsValidationStale(true), delay);
    return () => window.clearTimeout(timer);
  }, [validationResult]);

  // Immediately clear cart state when user logs out or session expires
  useEffect(() => {
    if (status === 'unauthenticated') {
      loadRequestIdRef.current += 1;
      setCart(null);
      setHasLoaded(false);
      setIsLoading(false);
      setError(null);
      setNotice(null);
      setIsMutatingCart(false);
      setIsAddingKey(null);
      setPendingItemIds({});
      setValidationResult(null);
      setValidationError(null);
      setIsValidating(false);
      setIsAcknowledging(false);
      setAcknowledgingItemIds({});
      setIsValidationStale(false);
      inFlightAddKeysRef.current.clear();
      inFlightItemIdsRef.current.clear();
      inFlightCartWideRef.current = false;
      inFlightValidateRef.current = false;
      inFlightAckAllRef.current = false;
      inFlightAckItemIdsRef.current.clear();
    }
  }, [status]);

  const recoverVersionConflict = useCallback(async () => {
    try {
      const fresh = await client.getCart();
      setCart(fresh);
      setHasLoaded(true);
      markValidationStale();
    } catch {
      // Best-effort refresh on version conflict; keep existing error surface
    }
  }, [client, markValidationStale]);

  const loadCart = useCallback(
    async (options?: { syncPincodeIfSet?: string | null }): Promise<ICartSummaryDto | null> => {
      if (!isAuthenticated) {
        return null;
      }

      const requestId = ++loadRequestIdRef.current;
      setIsLoading(true);
      setError(null);

      try {
        let loaded = await client.getCart();
        if (loadRequestIdRef.current !== requestId) {
          return loaded;
        }

        const requestedPin = options?.syncPincodeIfSet;
        if (requestedPin && loaded.pincode !== requestedPin) {
          loaded = await client.updateLocation({
            pincode: requestedPin,
            expectedVersion: loaded.version,
          });
        }

        if (loadRequestIdRef.current === requestId) {
          setCart(loaded);
          setHasLoaded(true);
          setIsLoading(false);
        }
        return loaded;
      } catch (err: unknown) {
        if (loadRequestIdRef.current === requestId) {
          setError(mapCartApiErrorMessage(err));
          setIsLoading(false);
        }
        return null;
      }
    },
    [client, isAuthenticated],
  );

  const addItem = useCallback(
    async (dto: Omit<IAddCartItemRequestDto, 'expectedVersion'>): Promise<ICartSummaryDto> => {
      if (!isAuthenticated) {
        throw new CartApiError(
          'Please sign in with OTP to add materials to your cart.',
          'AUTHENTICATION_REQUIRED',
          401,
        );
      }

      const key = buildCartAddKey(dto.productId, dto.variantId);
      if (inFlightAddKeysRef.current.has(key) || inFlightCartWideRef.current) {
        throw new CartApiError(
          'An add-to-cart request for this item is already in progress.',
          'DUPLICATE_SUBMISSION_PREVENTED',
          409,
        );
      }

      inFlightAddKeysRef.current.add(key);
      setIsAddingKey(key);
      setError(null);
      setNotice(null);

      try {
        const expectedVersion = cartRef.current?.version;
        const updated = await client.addItem({
          ...dto,
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        });
        setCart(updated);
        setHasLoaded(true);
        markValidationStale();
        return updated;
      } catch (err: unknown) {
        if (err instanceof CartApiError && err.code === 'CART_VERSION_CONFLICT') {
          await recoverVersionConflict();
        }
        const message = mapCartApiErrorMessage(err);
        setError(message);
        throw err;
      } finally {
        inFlightAddKeysRef.current.delete(key);
        setIsAddingKey((prev) => (prev === key ? null : prev));
      }
    },
    [client, isAuthenticated, isValidationStale, markValidationStale, recoverVersionConflict],
  );

  const updateItemQuantity = useCallback(
    async (itemId: string, quantity: string): Promise<ICartSummaryDto> => {
      if (inFlightItemIdsRef.current.has(itemId) || inFlightCartWideRef.current) {
        throw new CartApiError(
          'Please wait for the current cart update to finish.',
          'DUPLICATE_SUBMISSION_PREVENTED',
          409,
        );
      }

      inFlightItemIdsRef.current.add(itemId);
      setPendingItemIds((prev) => ({ ...prev, [itemId]: true }));
      setError(null);
      setNotice(null);

      try {
        const expectedVersion = cartRef.current?.version;
        const updated = await client.updateItemQuantity(itemId, {
          quantity,
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        });
        setCart(updated);
        setHasLoaded(true);
        markValidationStale();
        setNotice('Cart quantity updated.');
        return updated;
      } catch (err: unknown) {
        if (err instanceof CartApiError && err.code === 'CART_VERSION_CONFLICT') {
          await recoverVersionConflict();
        }
        const message = mapCartApiErrorMessage(err);
        setError(message);
        throw err;
      } finally {
        inFlightItemIdsRef.current.delete(itemId);
        setPendingItemIds((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      }
    },
    [client, markValidationStale, recoverVersionConflict],
  );

  const removeItem = useCallback(
    async (itemId: string): Promise<ICartSummaryDto> => {
      if (inFlightItemIdsRef.current.has(itemId) || inFlightCartWideRef.current) {
        throw new CartApiError(
          'Please wait for the current cart update to finish.',
          'DUPLICATE_SUBMISSION_PREVENTED',
          409,
        );
      }

      inFlightItemIdsRef.current.add(itemId);
      setPendingItemIds((prev) => ({ ...prev, [itemId]: true }));
      setError(null);
      setNotice(null);

      try {
        const expectedVersion = cartRef.current?.version;
        const updated = await client.removeItem(itemId, expectedVersion);
        setCart(updated);
        setHasLoaded(true);
        markValidationStale();
        setNotice('Item removed from cart.');
        return updated;
      } catch (err: unknown) {
        if (err instanceof CartApiError && err.code === 'CART_VERSION_CONFLICT') {
          await recoverVersionConflict();
        }
        const message = mapCartApiErrorMessage(err);
        setError(message);
        throw err;
      } finally {
        inFlightItemIdsRef.current.delete(itemId);
        setPendingItemIds((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      }
    },
    [client, markValidationStale, recoverVersionConflict],
  );

  const clearCart = useCallback(async (): Promise<ICartSummaryDto> => {
    if (inFlightCartWideRef.current) {
      throw new CartApiError(
        'Cart is already being cleared.',
        'DUPLICATE_SUBMISSION_PREVENTED',
        409,
      );
    }

    inFlightCartWideRef.current = true;
    setIsMutatingCart(true);
    setError(null);
    setNotice(null);

    try {
      const expectedVersion = cartRef.current?.version;
      const updated = await client.clearCart(expectedVersion);
      setCart(updated);
      setHasLoaded(true);
      invalidateValidation();
      setNotice('All items removed from your cart.');
      return updated;
    } catch (err: unknown) {
      if (err instanceof CartApiError && err.code === 'CART_VERSION_CONFLICT') {
        await recoverVersionConflict();
      }
      const message = mapCartApiErrorMessage(err);
      setError(message);
      throw err;
    } finally {
      inFlightCartWideRef.current = false;
      setIsMutatingCart(false);
    }
  }, [client, invalidateValidation, recoverVersionConflict]);

  const syncLocation = useCallback(
    async (pincode: string | null): Promise<ICartSummaryDto | null> => {
      if (!isAuthenticated || !cartRef.current) {
        return null;
      }
      if (cartRef.current.pincode === pincode) {
        return cartRef.current;
      }
      if (inFlightCartWideRef.current) {
        return null;
      }

      inFlightCartWideRef.current = true;
      setIsMutatingCart(true);
      setError(null);

      try {
        const updated = await client.updateLocation({
          pincode,
          expectedVersion: cartRef.current.version,
        });
        setCart(updated);
        setHasLoaded(true);
        markValidationStale();
        return updated;
      } catch (err: unknown) {
        if (err instanceof CartApiError && err.code === 'CART_VERSION_CONFLICT') {
          await recoverVersionConflict();
        }
        setError(mapCartApiErrorMessage(err));
        return null;
      } finally {
        inFlightCartWideRef.current = false;
        setIsMutatingCart(false);
      }
    },
    [client, isAuthenticated, markValidationStale, recoverVersionConflict],
  );

  const validateCart = useCallback(
    async (
      options: Omit<IValidateCartRequestDto, 'expectedVersion'> = {},
    ): Promise<ICartValidationResultDto> => {
      if (!isAuthenticated) {
        throw new CartApiError(
          'Please sign in with OTP to validate your cart.',
          'AUTHENTICATION_REQUIRED',
          401,
        );
      }
      if (inFlightValidateRef.current || inFlightCartWideRef.current) {
        throw new CartApiError(
          'Cart validation is already in progress.',
          'DUPLICATE_SUBMISSION_PREVENTED',
          409,
        );
      }
      if (options.pincode !== undefined && options.addressId !== undefined) {
        throw new CartApiError(
          'Provide either a delivery PIN or a saved address, not both.',
          'VALIDATION_ERROR',
          400,
        );
      }

      inFlightValidateRef.current = true;
      setIsValidating(true);
      setValidationError(null);
      setError(null);

      try {
        const expectedVersion = cartRef.current?.version;
        const result = await client.validateCart({
          ...(options.pincode !== undefined ? { pincode: options.pincode } : {}),
          ...(options.addressId !== undefined ? { addressId: options.addressId } : {}),
          ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        });
        setValidationResult(result);
        setIsValidationStale(false);
        if (!options.pincode && !options.addressId) {
          setCart(result.cart);
          setHasLoaded(true);
        }
        return result;
      } catch (err: unknown) {
        if (err instanceof CartApiError && err.code === 'CART_VERSION_CONFLICT') {
          await recoverVersionConflict();
        }
        const message = mapCartApiErrorMessage(err);
        setValidationError(message);
        throw err;
      } finally {
        inFlightValidateRef.current = false;
        setIsValidating(false);
      }
    },
    [client, isAuthenticated, recoverVersionConflict],
  );

  const acknowledgePrices = useCallback(
    async (itemIds?: string[]): Promise<ICartSummaryDto> => {
      if (!isAuthenticated) {
        throw new CartApiError(
          'Please sign in with OTP to acknowledge price updates.',
          'AUTHENTICATION_REQUIRED',
          401,
        );
      }
      const targetIds = itemIds && itemIds.length > 0 ? itemIds : undefined;
      if (
        inFlightAckAllRef.current ||
        inFlightCartWideRef.current ||
        (targetIds
          ? targetIds.some((id) => inFlightAckItemIdsRef.current.has(id))
          : inFlightAckItemIdsRef.current.size > 0)
      ) {
        throw new CartApiError(
          'Price acknowledgement is already in progress.',
          'DUPLICATE_SUBMISSION_PREVENTED',
          409,
        );
      }

      if (targetIds) {
        for (const id of targetIds) {
          inFlightAckItemIdsRef.current.add(id);
        }
        setAcknowledgingItemIds((prev) => {
          const next = { ...prev };
          for (const id of targetIds) {
            next[id] = true;
          }
          return next;
        });
      } else {
        inFlightAckAllRef.current = true;
        setIsAcknowledging(true);
      }

      setError(null);
      setNotice(null);
      setValidationError(null);

      try {
        const reviewedValidation = validationResultRef.current;
        const expiresAt = reviewedValidation?.validationSnapshotExpiresAt
          ? Date.parse(reviewedValidation.validationSnapshotExpiresAt)
          : NaN;
        if (
          !reviewedValidation?.validationSnapshotId ||
          !Number.isFinite(expiresAt) ||
          expiresAt <= Date.now() ||
          !cartRef.current ||
          reviewedValidation.cart.version !== cartRef.current.version ||
          isValidationStale
        ) {
          markValidationStale();
          throw new CartApiError(
            'Run Validate Cart again to create a current validation snapshot before acknowledging updated prices.',
            'VALIDATION_SNAPSHOT_REQUIRED',
            422,
          );
        }
        const updated = await client.acknowledgePrices({
          ...(targetIds ? { itemIds: targetIds } : {}),
          expectedVersion: reviewedValidation.cart.version,
          validationSnapshotId: reviewedValidation.validationSnapshotId,
        });
        const activeCart = cartRef.current;
        setCart(activeCart ? {
          ...updated,
          pincode: activeCart.pincode,
          localizationState: activeCart.localizationState,
          isServiceable: activeCart.isServiceable,
          serviceArea: activeCart.serviceArea,
        } : updated);
        setHasLoaded(true);
        markValidationStale();
        setNotice(
          targetIds && targetIds.length === 1
            ? 'Updated price accepted for this item. Run Validate Cart to confirm cart readiness.'
            : 'Updated prices accepted. Run Validate Cart to confirm cart readiness.',
        );
        return updated;
      } catch (err: unknown) {
        if (err instanceof CartApiError && err.code === 'CART_VERSION_CONFLICT') {
          await recoverVersionConflict();
        }
        const message = mapCartApiErrorMessage(err);
        setError(message);
        throw err;
      } finally {
        if (targetIds) {
          for (const id of targetIds) {
            inFlightAckItemIdsRef.current.delete(id);
          }
          setAcknowledgingItemIds((prev) => {
            const next = { ...prev };
            for (const id of targetIds) {
              delete next[id];
            }
            return next;
          });
        } else {
          inFlightAckAllRef.current = false;
          setIsAcknowledging(false);
        }
      }
    },
    [client, isAuthenticated, isValidationStale, markValidationStale, recoverVersionConflict],
  );

  const clearError = useCallback(() => setError(null), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    if (prevPincodeRef.current === storefrontPincode) {
      return;
    }
    prevPincodeRef.current = storefrontPincode;

    if (
      storefront &&
      isAuthenticated &&
      cartRef.current !== null &&
      cartRef.current.pincode !== (storefrontPincode ?? null)
    ) {
      void syncLocation(storefrontPincode ?? null);
    }
  }, [storefront, storefrontPincode, isAuthenticated, syncLocation]);

  const value: CartContextValue = useMemo(
    () => ({
      cart,
      isLoading,
      hasLoaded,
      error,
      notice,
      isMutatingCart,
      isAddingKey,
      pendingItemIds,
      validationResult,
      validationError,
      isValidating,
      isAcknowledging,
      acknowledgingItemIds,
      isValidationStale,
      loadCart,
      addItem,
      updateItemQuantity,
      removeItem,
      clearCart,
      syncLocation,
      validateCart,
      acknowledgePrices,
      invalidateValidation,
      clearError,
      clearNotice,
    }),
    [
      cart,
      isLoading,
      hasLoaded,
      error,
      notice,
      isMutatingCart,
      isAddingKey,
      pendingItemIds,
      validationResult,
      validationError,
      isValidating,
      isAcknowledging,
      acknowledgingItemIds,
      isValidationStale,
      loadCart,
      addItem,
      updateItemQuantity,
      removeItem,
      clearCart,
      syncLocation,
      validateCart,
      acknowledgePrices,
      invalidateValidation,
      clearError,
      clearNotice,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};

export function useOptionalCart(): CartContextValue | undefined {
  return useContext(CartContext);
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
