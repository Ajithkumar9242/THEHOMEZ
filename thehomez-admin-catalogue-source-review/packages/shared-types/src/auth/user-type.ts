/**
 * Core User / Principal Types in TheHomez Platform
 *
 * Defines the fundamental entity category for identity, authentication,
 * and base tenant isolation. Specific operational capabilities are governed
 * dynamically via configurable Roles and Permissions (RBAC).
 */
export enum UserType {
  CUSTOMER = 'CUSTOMER', // Retail B2C buyers and verified B2B commercial accounts
  PARTNER = 'PARTNER', // Supplier merchants, yard operators, and trade contractor firms
  STAFF = 'STAFF', // Internal platform operators, managers, and administrators
}
