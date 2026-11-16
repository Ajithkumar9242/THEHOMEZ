import type { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import {
  UserType,
  UserStatus,
  COMMERCE_ERROR_CODES,
  type PermissionCode,
  type IApiErrorResponse,
} from '@thehomez/shared-types';
import { TokenService, TokenError } from '../services/token/token.service.js';
import { RbacService } from '../services/rbac/rbac.service.js';
import { UserModel } from '../models/user.model.js';

const tokenService = new TokenService();
const rbacService = new RbacService();

/**
 * Standard error response utility for security and authorization middlewares.
 */
function sendSecurityError(
  req: Request,
  res: Response,
  statusCode: number,
  code: string,
  message: string,
): void {
  const response: IApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    },
  };
  res.status(statusCode).json(response);
}

/**
 * Authentication Middleware
 *
 * Verifies short-lived Bearer access tokens from the Authorization header,
 * ensures the referenced account exists and is ACTIVE, dynamically resolves
 * the current permissions from the database via RbacService, and attaches
 * the authenticated principal to req.user.
 *
 * ARCHITECTURAL DESIGN & REVOCATION LIMITATION NOTE:
 * - Access tokens are stateless, short-lived signed JWTs (default 15 minutes).
 * - Instant account-level revocation is enforced on every request: if an account
 *   is suspended or deleted in the database, subsequent requests fail immediately
 *   regardless of the token's remaining lifespan.
 * - However, fine-grained token-level revocation of an active token before its
 *   15-minute TTL without changing account status is not supported without a
 *   distributed token blacklist (e.g. Redis). Token rotation and logout invalidate
 *   the session refresh token, preventing issuance of subsequent access tokens.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    sendSecurityError(req, res, 401, 'UNAUTHORIZED', 'Authentication token is required');
    return;
  }

  if (!authHeader.startsWith('Bearer ')) {
    sendSecurityError(
      req,
      res,
      401,
      'MALFORMED_TOKEN',
      'Invalid authorization format. Expected Bearer token',
    );
    return;
  }

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    sendSecurityError(req, res, 401, 'MALFORMED_TOKEN', 'Token missing from Bearer header');
    return;
  }

  try {
    // 1. Verify JWT signature, lifespan, and minimal claims
    const decoded = tokenService.verifyAccessToken(rawToken);

    // 2. Load latest user document from database (never trust client or stale JWT claims)
    const user = await UserModel.findById(decoded.sub);
    if (!user) {
      sendSecurityError(
        req,
        res,
        401,
        'USER_NOT_FOUND',
        'Authenticated user account no longer exists',
      );
      return;
    }

    // 3. Confirm account is ACTIVE
    if (user.status !== UserStatus.ACTIVE) {
      sendSecurityError(
        req,
        res,
        401,
        'ACCOUNT_NOT_ACTIVE',
        `Account is ${user.status.toLowerCase()}. Please contact support`,
      );
      return;
    }

    // 4. Confirm identity type consistency
    if (user.userType !== decoded.userType) {
      sendSecurityError(req, res, 401, 'IDENTITY_MISMATCH', 'Token identity type mismatch');
      return;
    }

    // 5. Dynamically resolve fresh database-backed roles & permissions
    const principal = await rbacService.resolveUserPrincipal(user);

    // 6. Attach principal to request
    req.user = principal;

    next();
  } catch (err: unknown) {
    if (err instanceof TokenError) {
      sendSecurityError(req, res, 401, err.code, err.message);
      return;
    }
    sendSecurityError(req, res, 401, 'INVALID_TOKEN', 'Invalid or expired authentication token');
  }
}

/**
 * Optional Authentication Middleware
 *
 * If Authorization header with Bearer token is present, verifies it and populates req.user.
 * If header is absent, simply continues next() as an unauthenticated request.
 * If header is present but malformed/invalid, fails with standard HTTP 401.
 */
export async function optionalAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return next();
  }
  return authenticate(req, res, next);
}

export type PermissionCheckMode = 'ALL' | 'ANY';

export interface IAuthorizeOptions {
  mode?: PermissionCheckMode;
}

/**
 * Authorization Guard Middleware
 *
 * Asserts that the authenticated principal possesses the required fine-grained permissions.
 *
 * Parameters:
 * - permissions: Single PermissionCode, list of PermissionCodes, or array.
 * - options: { mode: 'ALL' | 'ANY' } (default 'ALL' / AND semantics).
 *
 * Rules:
 * - Requires an authenticated req.user (placed after authenticate middleware).
 * - STAFF identity alone DOES NOT grant administrative access without explicit permissions.
 * - Role names are NEVER checked; access is governed purely by resolved permissions.
 */
export function authorize(
  permissions: PermissionCode | PermissionCode[],
  options: IAuthorizeOptions = { mode: 'ALL' },
) {
  const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
  const mode = options.mode || 'ALL';

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      sendSecurityError(
        req,
        res,
        401,
        'UNAUTHENTICATED',
        'Authentication required prior to authorization check',
      );
      return;
    }

    const userPermissions = new Set<string>(req.user.permissions);

    let isAuthorized = false;
    if (mode === 'ALL') {
      isAuthorized = requiredPermissions.every((perm) => userPermissions.has(perm));
    } else {
      isAuthorized = requiredPermissions.some((perm) => userPermissions.has(perm));
    }

    if (!isAuthorized) {
      sendSecurityError(
        req,
        res,
        403,
        'FORBIDDEN',
        'Access denied: insufficient permissions to perform this operation',
      );
      return;
    }

    next();
  };
}

/**
 * Partner Tenant Isolation Guard
 *
 * Enforces tenant boundary isolation for PARTNER identities:
 * 1. Verifies that an authenticated PARTNER principal has a valid partnerId.
 * 2. Injects req.partnerFilter = { partnerId: req.user.partnerId }.
 * 3. Rejects any client-supplied partnerId in req.params, req.query, or req.body
 *    that conflicts with the authenticated partner identity.
 * 4. Pass-through for CUSTOMER and STAFF identities without imposing partner scoping.
 *
 * RESOURCE-LEVEL TENANT CHECK LIMITATION:
 * - Request inspection guards against URL-level or body-level tenant parameter spoofing.
 * - However, when a partner fetches an individual record by an opaque resource ID
 *   (e.g. GET /orders/:orderId), the underlying service/query MUST query using
 *   { _id: orderId, ...req.partnerFilter } to verify that the entity actually belongs
 *   to this partner tenant.
 */
export function partnerTenantGuard(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    sendSecurityError(
      req,
      res,
      401,
      'UNAUTHENTICATED',
      'Authentication required prior to tenant boundary validation',
    );
    return;
  }

  // Only apply partner tenant scoping to PARTNER identities
  if (req.user.userType === UserType.PARTNER) {
    const partnerId = req.user.partnerId;

    if (!partnerId) {
      sendSecurityError(
        req,
        res,
        403,
        'PARTNER_CONTEXT_REQUIRED',
        'Partner principal lacks an associated partner tenant identifier',
      );
      return;
    }

    // Attach validated partner filter for database queries
    req.partnerFilter = { partnerId };

    // Inspect client-supplied parameters for spoofing attempts
    const clientParamPartnerId = req.params?.partnerId;
    const clientQueryPartnerId =
      typeof req.query?.partnerId === 'string' ? req.query.partnerId : undefined;
    const clientBodyPartnerId = req.body?.partnerId;

    if (clientParamPartnerId && clientParamPartnerId !== partnerId) {
      sendSecurityError(
        req,
        res,
        403,
        'TENANT_MISMATCH',
        'Access denied: route parameter partnerId does not match authenticated partner tenant',
      );
      return;
    }

    if (clientQueryPartnerId && clientQueryPartnerId !== partnerId) {
      sendSecurityError(
        req,
        res,
        403,
        'TENANT_MISMATCH',
        'Access denied: query parameter partnerId does not match authenticated partner tenant',
      );
      return;
    }

    if (clientBodyPartnerId && clientBodyPartnerId !== partnerId) {
      sendSecurityError(
        req,
        res,
        403,
        'TENANT_MISMATCH',
        'Access denied: request body partnerId does not match authenticated partner tenant',
      );
      return;
    }
  }

  next();
}

/**
 * Inspects request params, query, body, and x-user-id header for client-supplied
 * userId/customerId tampering. Customer identity is never derived from client input.
 */
function rejectClientIdentitySpoof(
  req: Request,
  res: Response,
  expectedUserId: string | null,
  expectedCustomerId?: string,
): boolean {
  const fields: Array<{
    name: 'userId' | 'customerId';
    expected: string | undefined;
    checkHeader: boolean;
  }> = [
    { name: 'userId', expected: expectedUserId ?? undefined, checkHeader: true },
    { name: 'customerId', expected: expectedCustomerId, checkHeader: false },
  ];

  const sources: Array<{ label: string; container: unknown }> = [
    { label: 'route parameter', container: req.params },
    { label: 'query parameter', container: req.query },
    { label: 'request body', container: req.body },
  ];

  for (const field of fields) {
    for (const { label, container } of sources) {
      if (
        container &&
        typeof container === 'object' &&
        field.name in container &&
        (container as Record<string, unknown>)[field.name] !== undefined
      ) {
        const supplied = (container as Record<string, unknown>)[field.name];
        if (!field.expected || supplied !== field.expected) {
          sendSecurityError(
            req,
            res,
            403,
            'CUSTOMER_IDENTITY_MISMATCH',
            `Access denied: ${label} ${field.name} does not match authenticated customer identity`,
          );
          return true;
        }
      }
    }

    if (field.checkHeader && req.headers['x-user-id'] !== undefined) {
      const suppliedHeader = req.headers['x-user-id'];
      if (!field.expected || suppliedHeader !== field.expected) {
        sendSecurityError(
          req,
          res,
          403,
          'CUSTOMER_IDENTITY_MISMATCH',
          'Access denied: request header userId does not match authenticated customer identity',
        );
        return true;
      }
    }
  }

  return false;
}

/**
 * Shared verification logic for customer-only and optional-customer routes:
 * reloads UserModel from MongoDB to confirm ACTIVE status, UserType.CUSTOMER,
 * fresh roles/permissions, and rejects client-supplied userId/customerId spoofing.
 */
async function verifyAndAttachCustomerPrincipal(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authenticatedUser = req.user;
  if (!authenticatedUser) {
    sendSecurityError(
      req,
      res,
      401,
      'UNAUTHENTICATED',
      'Authentication required prior to customer principal validation',
    );
    return;
  }

  if (authenticatedUser.userType !== UserType.CUSTOMER) {
    sendSecurityError(
      req,
      res,
      403,
      COMMERCE_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED,
      'Access denied: customer identity is required for this operation',
    );
    return;
  }

  if (!Types.ObjectId.isValid(authenticatedUser.id)) {
    sendSecurityError(
      req,
      res,
      401,
      'USER_NOT_FOUND',
      'Authenticated customer identity is invalid',
    );
    return;
  }

  try {
    // Reload latest user document from database to enforce instant revocation and fresh roles
    const freshUser = await UserModel.findById(authenticatedUser.id);
    if (!freshUser) {
      sendSecurityError(
        req,
        res,
        401,
        'USER_NOT_FOUND',
        'Authenticated user account no longer exists',
      );
      return;
    }

    if (freshUser.userType !== UserType.CUSTOMER) {
      sendSecurityError(
        req,
        res,
        403,
        COMMERCE_ERROR_CODES.CUSTOMER_IDENTITY_REQUIRED,
        'Access denied: customer identity is required for this operation',
      );
      return;
    }

    if (freshUser.status !== UserStatus.ACTIVE) {
      sendSecurityError(
        req,
        res,
        401,
        'ACCOUNT_NOT_ACTIVE',
        `Account is ${freshUser.status.toLowerCase()}. Please contact support`,
      );
      return;
    }

    const freshPrincipal = await rbacService.resolveUserPrincipal(freshUser);

    if (rejectClientIdentitySpoof(req, res, freshPrincipal.id, freshPrincipal.customerId)) {
      return;
    }

    req.user = freshPrincipal;
    req.customerFilter = { userId: freshPrincipal.id };

    next();
  } catch (err: unknown) {
    next(err);
  }
}

/**
 * Customer Principal Guard Middleware
 *
 * Enforces strict customer-only access for Customer Commerce endpoints:
 * 1. Requires an authenticated principal (req.user).
 * 2. Requires UserType.CUSTOMER (rejects PARTNER, STAFF/Admin, and other types with 403).
 * 3. Reloads the user record from MongoDB to verify ACTIVE status and current roles.
 * 4. Rejects client-supplied userId/customerId spoofing and injects req.customerFilter.
 */
export async function requireCustomerPrincipal(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    sendSecurityError(
      req,
      res,
      401,
      'UNAUTHENTICATED',
      'Authentication required prior to customer principal validation',
    );
    return;
  }

  await verifyAndAttachCustomerPrincipal(req, res, next);
}

/**
 * Optional Customer Principal Guard Middleware
 *
 * Designed for guest-capable commerce endpoints (e.g. cart routes after optionalAuthenticate):
 * - If req.user is absent (anonymous guest flow), rejects any spoofed client userId/customerId
 *   and proceeds next().
 * - If req.user is present, enforces the full customer principal check (UserType.CUSTOMER,
 *   ACTIVE DB status, fresh role resolution, and anti-spoofing).
 */
export async function enforceOptionalCustomerPrincipal(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    if (rejectClientIdentitySpoof(req, res, null)) {
      return;
    }
    next();
    return;
  }

  await verifyAndAttachCustomerPrincipal(req, res, next);
}
