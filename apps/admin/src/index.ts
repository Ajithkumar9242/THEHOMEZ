/**
 * @thehomez/admin-dashboard entrypoint stub for Milestone 1 workspace verification.
 */
import { UserType, SYSTEM_ROLE_SEEDS } from '@thehomez/shared-types';

export const ADMIN_DASHBOARD_METADATA = {
  app: '@thehomez/admin-dashboard',
  target: UserType.STAFF,
  defaultRolesCount: Object.keys(SYSTEM_ROLE_SEEDS).length,
} as const;
