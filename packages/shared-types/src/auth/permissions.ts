/**
 * Fine-Grained Permission Capabilities for Configurable RBAC
 *
 * Permissions are assigned dynamically to Roles in the database.
 * No business logic is tied to hardcoded role strings; endpoints assert
 * required permissions.
 */
export enum PermissionCode {
  // Catalog Domain
  CATALOG_READ = 'catalog:read',
  CATALOG_WRITE = 'catalog:write',
  CATALOG_PUBLISH = 'catalog:publish',

  // Pricing & Price Lists
  PRICING_READ = 'pricing:read',
  PRICING_WRITE = 'pricing:write',

  // Partner Domain
  PARTNER_READ = 'partner:read',
  PARTNER_ONBOARD = 'partner:onboard',
  PARTNER_VERIFY = 'partner:verify',
  PARTNER_SUSPEND = 'partner:suspend',

  // Partner Product Availability Domain (Milestone 4 Step 6 / Decision #46)
  PARTNER_AVAILABILITY_READ = 'partner_availability:read',
  PARTNER_AVAILABILITY_WRITE = 'partner_availability:write',

  // Customer & B2B Verification
  CUSTOMER_READ = 'customer:read',
  B2B_VERIFY = 'b2b:verify',
  CUSTOMER_SUSPEND = 'customer:suspend',

  // Order & Fulfilment
  ORDER_READ = 'order:read',
  ORDER_CANCEL = 'order:cancel',
  ORDER_REASSIGN = 'order:reassign',
  FULFILMENT_UPDATE = 'fulfilment:update',

  // Finance, Settlements & Payouts
  FINANCE_READ = 'finance:read',
  FINANCE_RECONCILE = 'finance:reconcile',
  REFUND_TRIGGER = 'refund:trigger',
  SETTLEMENT_APPROVE = 'settlement:approve',
  PAYOUT_EXECUTE = 'payout:execute',

  // System Administration & Security
  RBAC_MANAGE = 'rbac:manage',
  SETTINGS_WRITE = 'settings:write',
  AUDIT_READ = 'audit:read',

  // Service Area & Geography
  SERVICE_AREA_READ = 'service_area:read',
  SERVICE_AREA_WRITE = 'service_area:write',
}
