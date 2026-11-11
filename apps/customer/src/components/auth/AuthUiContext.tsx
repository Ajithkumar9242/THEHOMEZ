import React, { createContext, useContext } from 'react';
import { useAuth, type AuthContextValue } from '../../context/AuthContext.js';
import type { ICustomerAuthContextContract } from './auth-ui.types.js';

const CustomerAuthUiContext = createContext<ICustomerAuthContextContract | null>(null);

export interface CustomerAuthBridgeProviderProps {
  value: ICustomerAuthContextContract;
  children: React.ReactNode;
}

/**
 * Integration bridge provider allowing explicit AuthContext injection
 * (used in isolated unit tests or custom containers).
 */
export const CustomerAuthBridgeProvider: React.FC<CustomerAuthBridgeProviderProps> = ({
  value,
  children,
}) => {
  return (
    <CustomerAuthUiContext.Provider value={value}>{children}</CustomerAuthUiContext.Provider>
  );
};

/**
 * Safely resolves Chat A's AuthContext (`useAuth()`) when inside `<AuthProvider>`,
 * returning `null` if rendered outside `<AuthProvider>` (e.g. isolated component tests).
 */
export function useOptionalAuthContext(): AuthContextValue | null {
  try {
    return useAuth();
  } catch {
    return null;
  }
}

/**
 * Resolves the active AuthContext contract from explicit prop override,
 * bridge provider, or Chat A's `AuthProvider` (`useAuth()`).
 */
export function useCustomerAuthBridge(
  override?: ICustomerAuthContextContract | null,
): ICustomerAuthContextContract | null {
  const fromBridge = useContext(CustomerAuthUiContext);
  const fromAuthProvider = useOptionalAuthContext();
  return override ?? fromBridge ?? fromAuthProvider;
}
