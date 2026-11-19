import type { Request, Response, NextFunction } from 'express';
import { PermissionCode, type IApiErrorResponse } from '@thehomez/shared-types';

/**
 * Dynamic Target-Dependent Authorization Middleware for Partner Status Mutation
 *
 * Enforces dynamic permission requirements based on the requested target status:
 * - Target 'INACTIVE'             -> Requires PermissionCode.PARTNER_VERIFY
 * - Target 'SUSPENDED'            -> Requires PermissionCode.PARTNER_SUSPEND
 * - Target 'ACTIVE'               -> Requires PermissionCode.PARTNER_VERIFY (prior to verification gate)
 * - Target 'PENDING_VERIFICATION' -> Requires PermissionCode.PARTNER_VERIFY (prior to service lifecycle check)
 *
 * Runs immediately following body validation and BEFORE partner lookup or verification gate,
 * guaranteeing that unprivileged callers cannot discover entity existence or bypass authorization.
 */
export function authorizePartnerStatusMutation(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    const response: IApiErrorResponse = {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required prior to status authorization check',
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    };
    res.status(401).json(response);
    return;
  }

  const targetStatus = req.body?.status;
  const userPermissions = new Set<string>(req.user.permissions);

  let requiredPermission: PermissionCode;
  if (targetStatus === 'SUSPENDED') {
    requiredPermission = PermissionCode.PARTNER_SUSPEND;
  } else {
    // For INACTIVE, ACTIVE, PENDING_VERIFICATION
    requiredPermission = PermissionCode.PARTNER_VERIFY;
  }

  if (!userPermissions.has(requiredPermission)) {
    const response: IApiErrorResponse = {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Access denied: insufficient permissions to perform this operation',
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      },
    };
    res.status(403).json(response);
    return;
  }

  next();
}
