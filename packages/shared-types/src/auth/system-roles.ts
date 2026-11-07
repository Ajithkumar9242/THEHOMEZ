import { PermissionCode } from './permissions.js';
import { UserType } from './user-type.js';

/**
 * Standard Partner Role Permissions (Decision #46).
 * Standard partner roles receive read and write capabilities for partner availability,
 * but are strictly barred from platform-wide CATALOG_WRITE and CATALOG_PUBLISH.
 */
export const STANDARD_PARTNER_ROLE_PERMISSIONS: readonly PermissionCode[] = [
  PermissionCode.PARTNER_AVAILABILITY_READ,
  PermissionCode.PARTNER_AVAILABILITY_WRITE,
] as const;

/**
 * Standard System Role Identifiers (Initial Seeds)
 *
 * Note: These role codes are baseline suggestions and initial seed templates.
 * Role definitions and permission assignments are stored in and evaluated against
 * the database, allowing platform administrators to customize or add roles.
 *
 * Milestone 4 Step 6 (Decision #46):
 * - SUPER_ADMIN: Full system access (includes PARTNER_AVAILABILITY_READ & WRITE)
 * - CATALOG_MANAGER: PARTNER_AVAILABILITY_READ & PARTNER_AVAILABILITY_WRITE
 * - PARTNER_MANAGER: PARTNER_AVAILABILITY_READ & PARTNER_AVAILABILITY_WRITE
 * - OPS_MANAGER: PARTNER_AVAILABILITY_READ (read-only inspection)
 * - SUPPORT: PARTNER_AVAILABILITY_READ (read-only inspection)
 * - Standard partner roles (PARTNER_OPERATOR): PARTNER_AVAILABILITY_READ & WRITE (never CATALOG_WRITE)
 */
export const SYSTEM_ROLE_SEEDS = {
  SUPER_ADMIN: {
    code: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'System-wide access and security configuration',
    userType: UserType.STAFF,
    isSystemManaged: true,
    permissions: Object.values(PermissionCode),
  },
  OPS_MANAGER: {
    code: 'OPS_MANAGER',
    name: 'Operations Manager',
    description: 'Manages orders, fulfilment units, delivery, and operational escalations',
    userType: UserType.STAFF,
    isSystemManaged: false,
    permissions: [
      PermissionCode.ORDER_READ,
      PermissionCode.ORDER_CANCEL,
      PermissionCode.ORDER_REASSIGN,
      PermissionCode.FULFILMENT_UPDATE,
      PermissionCode.CUSTOMER_READ,
      PermissionCode.PARTNER_READ,
      PermissionCode.AUDIT_READ,
      PermissionCode.PARTNER_AVAILABILITY_READ,
    ],
  },
  CATALOG_MANAGER: {
    code: 'CATALOG_MANAGER',
    name: 'Catalog Manager',
    description: 'Manages categories, products, variants, units, and price lists',
    userType: UserType.STAFF,
    isSystemManaged: false,
    permissions: [
      PermissionCode.CATALOG_READ,
      PermissionCode.CATALOG_WRITE,
      PermissionCode.CATALOG_PUBLISH,
      PermissionCode.PRICING_READ,
      PermissionCode.PRICING_WRITE,
      PermissionCode.PARTNER_READ,
      PermissionCode.SERVICE_AREA_READ,
      PermissionCode.SERVICE_AREA_WRITE,
      PermissionCode.PARTNER_AVAILABILITY_READ,
      PermissionCode.PARTNER_AVAILABILITY_WRITE,
    ],
  },
  PARTNER_MANAGER: {
    code: 'PARTNER_MANAGER',
    name: 'Partner Manager',
    description: 'Manages partner onboarding, document review, and service areas',
    userType: UserType.STAFF,
    isSystemManaged: false,
    permissions: [
      PermissionCode.PARTNER_READ,
      PermissionCode.PARTNER_ONBOARD,
      PermissionCode.PARTNER_VERIFY,
      PermissionCode.PARTNER_SUSPEND,
      PermissionCode.CATALOG_READ,
      PermissionCode.AUDIT_READ,
      PermissionCode.SERVICE_AREA_READ,
      PermissionCode.SERVICE_AREA_WRITE,
      PermissionCode.PARTNER_AVAILABILITY_READ,
      PermissionCode.PARTNER_AVAILABILITY_WRITE,
    ],
  },
  FINANCE_OFFICER: {
    code: 'FINANCE_OFFICER',
    name: 'Finance Officer',
    description: 'Manages payment reconciliation, invoices, ledger, and payouts',
    userType: UserType.STAFF,
    isSystemManaged: false,
    permissions: [
      PermissionCode.FINANCE_READ,
      PermissionCode.FINANCE_RECONCILE,
      PermissionCode.REFUND_TRIGGER,
      PermissionCode.SETTLEMENT_APPROVE,
      PermissionCode.PAYOUT_EXECUTE,
      PermissionCode.ORDER_READ,
      PermissionCode.AUDIT_READ,
    ],
  },
  SUPPORT: {
    code: 'SUPPORT',
    name: 'Customer Support Executive',
    description: 'Customer assistance and order status inspection',
    userType: UserType.STAFF,
    isSystemManaged: false,
    permissions: [
      PermissionCode.CUSTOMER_READ,
      PermissionCode.ORDER_READ,
      PermissionCode.CATALOG_READ,
      PermissionCode.PARTNER_AVAILABILITY_READ,
    ],
  },
  PARTNER_OPERATOR: {
    code: 'PARTNER_OPERATOR',
    name: 'Partner Operator',
    description: 'Standard partner merchant and yard inventory manager',
    userType: UserType.PARTNER,
    isSystemManaged: true,
    permissions: STANDARD_PARTNER_ROLE_PERMISSIONS,
  },
} as const;

export type SystemRoleCode = keyof typeof SYSTEM_ROLE_SEEDS;
