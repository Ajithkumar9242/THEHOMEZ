import type { Request, Response, NextFunction } from 'express';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserStatus, UserType, PermissionCode } from '@thehomez/shared-types';
import { AuthController } from '../src/controllers/auth.controller.js';
import { UserModel } from '../src/models/user.model.js';
import { RoleModel } from '../src/models/role.model.js';
import * as database from '../src/database/database.js';
import { hashPassword } from '../src/services/auth/password.service.js';
import type { TokenService } from '../src/services/token/token.service.js';
import type { RbacService } from '../src/services/rbac/rbac.service.js';
import { RbacService as RbacServiceImpl } from '../src/services/rbac/rbac.service.js';
import { authorize } from '../src/middleware/auth.middleware.js';
import { createAuthRouter } from '../src/routes/auth.routes.js';
import { csrfProtectionMiddleware } from '../src/middleware/csrf.middleware.js';
import { createAuthRateLimiter } from '../src/middleware/rate-limiter.middleware.js';

const password = 'development-test-password';
const passwordHash = await hashPassword(password);

function makeUser(status = UserStatus.ACTIVE) {
  return {
    _id: { toString: () => 'opaque-test-id' },
    phone: '+919876543210',
    email: 'admin@example.test',
    userType: UserType.STAFF,
    status,
    roles: ['ADMIN_CATEGORY_READONLY'],
    passwordHash,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastLoginAt: undefined,
  };
}

function makeController(user: ReturnType<typeof makeUser> | null) {
  const query = { select: vi.fn().mockResolvedValue(user) };
  vi.spyOn(UserModel, 'findOne').mockReturnValue(query as never);
  vi.spyOn(database, 'getDatabaseDiagnostics').mockReturnValue({
    readyState: 1,
    status: 'connected',
    name: 'thehomez_admin_verify',
  });

  const tokenService = {
    generateTokenPair: vi.fn().mockResolvedValue({
      accessToken: 'test-access-token',
      refreshToken: 'test-family.test-secret',
      expiresIn: 900,
      tokenType: 'Bearer',
    }),
  } as unknown as TokenService;
  const rbacService = {
    getEffectivePermissions: vi.fn().mockResolvedValue([PermissionCode.CATALOG_READ]),
  } as unknown as RbacService;
  return { controller: new AuthController(undefined, tokenService, rbacService), tokenService };
}

async function invokeLogin(controller: AuthController, body: { email: string; password: string }) {
  let statusCode = 0;
  let payload: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      payload = value;
      return this;
    },
    cookie: vi.fn(),
  } as unknown as Response;
  const req = {
    body,
    headers: { 'x-auth-transport': 'cookie', 'x-client-type': 'browser' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    correlationId: 'test-correlation',
  } as unknown as Request;
  const next = vi.fn() as NextFunction;
  await controller.adminPasswordLogin(req, res, next);
  return { statusCode, payload, response: res, next };
}

function makeResponse() {
  let statusCode = 0;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: unknown) {
      payload = value;
      return this;
    },
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response;
  return {
    response,
    get statusCode() {
      return statusCode;
    },
    get payload() {
      return payload;
    },
  };
}

class MockRateLimitResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableEnded = false;
  payload: unknown;
  private headers = new Map<string, string>();

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  json(value: unknown) {
    this.payload = value;
    this.writableEnded = true;
    return this;
  }

  send(value: unknown) {
    this.payload = value;
    this.writableEnded = true;
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers.set(name, value);
    return this;
  }

  getHeader(name: string) {
    return this.headers.get(name);
  }
}

afterEach(() => vi.restoreAllMocks());

describe('temporary Admin email/password authentication', () => {
  it('authenticates active STAFF, resolves permissions, and uses the shared browser session contract', async () => {
    const { controller, tokenService } = makeController(makeUser());
    const result = await invokeLogin(controller, { email: 'ADMIN@example.test', password });
    const body = result.payload as { success: boolean; data: { tokens: object; user: object } };

    expect(result.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.user).toMatchObject({ userType: UserType.STAFF, status: UserStatus.ACTIVE });
    expect(body.data.tokens).toEqual({
      accessToken: 'test-access-token',
      expiresIn: 900,
      tokenType: 'Bearer',
    });
    expect(JSON.stringify(result.payload)).not.toContain(password);
    expect(JSON.stringify(result.payload)).not.toContain(passwordHash);
    expect(
      (result.response as unknown as { cookie: ReturnType<typeof vi.fn> }).cookie,
    ).toHaveBeenCalled();
    expect(tokenService.generateTokenPair).toHaveBeenCalledOnce();
  });

  it('returns the same generic response for unknown identities and wrong passwords', async () => {
    const unknown = makeController(null).controller;
    const missingUser = await invokeLogin(unknown, { email: 'missing@example.test', password });
    const wrongPassword = makeController(makeUser()).controller;
    const wrongSecret = await invokeLogin(wrongPassword, {
      email: 'admin@example.test',
      password: 'not-the-development-password',
    });

    expect(missingUser.statusCode).toBe(401);
    expect(wrongSecret.statusCode).toBe(401);
    expect(missingUser.payload).toMatchObject({
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
    });
    expect(wrongSecret.payload).toMatchObject({
      error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
    });
  });

  it('rejects inactive accounts with the same generic authentication failure', async () => {
    const { controller, tokenService } = makeController(makeUser(UserStatus.SUSPENDED));
    const result = await invokeLogin(controller, { email: 'admin@example.test', password });

    expect(result.statusCode).toBe(401);
    expect(result.payload).toMatchObject({ error: { code: 'INVALID_CREDENTIALS' } });
    expect(tokenService.generateTokenPair).not.toHaveBeenCalled();
  });

  it('refuses before user lookup when the connected database is not the isolated Admin database', async () => {
    const findOne = vi.spyOn(UserModel, 'findOne');
    const { controller } = makeController(null);
    vi.mocked(database.getDatabaseDiagnostics).mockReturnValue({
      readyState: 1,
      status: 'connected',
      name: 'thehomez',
    });
    const result = await invokeLogin(controller, { email: 'admin@example.test', password });

    expect(result.statusCode).toBe(404);
    expect(findOne).not.toHaveBeenCalled();
  });

  it('resolves only the permissions of the assigned least-privilege role', async () => {
    vi.spyOn(RoleModel, 'find').mockResolvedValue([
      { code: 'ADMIN_CATEGORY_READONLY', permissions: [PermissionCode.CATALOG_READ] },
    ] as never);

    await expect(
      new RbacServiceImpl().getEffectivePermissions(['ADMIN_CATEGORY_READONLY']),
    ).resolves.toEqual([PermissionCode.CATALOG_READ]);
  });

  it('allows CATALOG_READ and denies CATALOG_WRITE at the server authorization middleware', async () => {
    const principal = {
      id: 'opaque-test-id',
      userType: UserType.STAFF,
      roles: ['ADMIN_CATEGORY_READONLY'],
      permissions: [PermissionCode.CATALOG_READ],
    };
    const req = { user: principal, correlationId: 'test-correlation' } as never;
    const readResponse = makeResponse();
    let readAllowed = false;
    authorize(PermissionCode.CATALOG_READ)(req, readResponse.response, () => {
      readAllowed = true;
    });
    const writeResponse = makeResponse();
    let writeAllowed = false;
    authorize(PermissionCode.CATALOG_WRITE)(req, writeResponse.response, () => {
      writeAllowed = true;
    });

    expect(readAllowed).toBe(true);
    expect(writeAllowed).toBe(false);
    expect(writeResponse.statusCode).toBe(403);
  });

  it('places the auth rate limiter and CSRF guard before the password login handler', async () => {
    const controller = {
      requestOtp: (_req: Request, res: Response) => res.status(200).json({ success: true }),
      verifyOtp: (_req: Request, res: Response) => res.status(200).json({ success: true }),
      adminPasswordLogin: (_req: Request, res: Response) => res.status(200).json({ success: true }),
      refreshToken: (_req: Request, res: Response) => res.status(200).json({ success: true }),
      logout: (_req: Request, res: Response) => res.status(200).json({ success: true }),
      logoutAll: (_req: Request, res: Response) => res.status(200).json({ success: true }),
      getMe: (_req: Request, res: Response) => res.status(200).json({ success: true }),
      getRoles: (_req: Request, res: Response) => res.status(200).json({ success: true }),
    } as unknown as AuthController;
    const router = createAuthRouter(controller);
    const loginLayer = router.stack.find((layer) => layer.route?.path === '/admin/password');

    expect(loginLayer).toBeDefined();
    expect(loginLayer?.route?.stack).toHaveLength(4);
    expect(loginLayer?.route?.stack[0]?.handle).not.toBe(controller.adminPasswordLogin);
    expect(loginLayer?.route?.stack[1]?.handle).toBe(csrfProtectionMiddleware);
    expect(loginLayer?.route?.stack[3]?.handle).toBe(controller.adminPasswordLogin);

    const limiter = createAuthRateLimiter({ limit: 2, windowMs: 60_000, standardHeaders: false });
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const req = {
        ip: '192.0.2.10',
        socket: { remoteAddress: '192.0.2.10' },
        headers: {},
        body: { email: 'admin@example.test' },
      } as unknown as Request;
      const res = new MockRateLimitResponse();
      await new Promise<void>((resolve) => {
        const next = () => resolve();
        Promise.resolve(limiter(req, res as unknown as Response, next)).then(resolve);
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });

  it('preserves the existing CUSTOMER OTP request contract', async () => {
    const otpService = {
      requestOtp: vi.fn().mockResolvedValue({
        cooldownSeconds: 60,
        expiresInSeconds: 300,
        message: 'OTP challenge dispatched successfully',
      }),
    };
    const controller = new AuthController(otpService as never);
    const response = makeResponse();
    const req = {
      body: { phone: '+919876543210', userType: UserType.CUSTOMER },
      correlationId: undefined,
    } as unknown as Request;
    await controller.requestOtp(req, response.response, vi.fn());

    expect(response.statusCode).toBe(200);
    expect(otpService.requestOtp).toHaveBeenCalledWith(
      '+919876543210',
      UserType.CUSTOMER,
      undefined,
    );
  });

  it('keeps shared refresh rotation and logout revocation behavior available', async () => {
    const tokenService = {
      rotateRefreshToken: vi.fn().mockResolvedValue({
        accessToken: 'rotated-access-token',
        refreshToken: 'family.rotated-secret',
        expiresIn: 900,
        tokenType: 'Bearer',
      }),
      revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
    } as unknown as TokenService;
    const controller = new AuthController(undefined, tokenService);
    const refreshResponse = makeResponse();
    const requestBase = {
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      correlationId: 'test-correlation',
      cookies: {},
    };
    await controller.refreshToken(
      { ...requestBase, body: { refreshToken: 'family.old-secret' } } as unknown as Request,
      refreshResponse.response,
      vi.fn(),
    );
    const logoutResponse = makeResponse();
    await controller.logout(
      { ...requestBase, body: { refreshToken: 'family.rotated-secret' } } as unknown as Request,
      logoutResponse.response,
      vi.fn(),
    );

    expect(refreshResponse.statusCode).toBe(200);
    expect(tokenService.rotateRefreshToken).toHaveBeenCalledOnce();
    expect(logoutResponse.statusCode).toBe(200);
    expect(tokenService.revokeRefreshToken).toHaveBeenCalledWith('family.rotated-secret');
  });
});
