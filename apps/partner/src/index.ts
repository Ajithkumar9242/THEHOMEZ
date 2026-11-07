/**
 * @thehomez/partner-dashboard entrypoint stub for Milestone 1 workspace verification.
 */
import { UserType, FulfilmentStatus, DeliveryMode } from '@thehomez/shared-types';

export const PARTNER_DASHBOARD_METADATA = {
  app: '@thehomez/partner-dashboard',
  target: UserType.PARTNER,
  supportedDeliveryModes: Object.values(DeliveryMode),
  initialStatus: FulfilmentStatus.PENDING_ASSIGNMENT,
} as const;
