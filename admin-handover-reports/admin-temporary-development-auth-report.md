# Temporary Development Admin Authentication Report

**Date:** 2026-11-13  
**Verdict:** Development-only implementation. Production Admin authentication is **NOT approved**.

## 1. Existing authentication architecture

- The shared backend supports phone OTP for pre-provisioned `STAFF`/`PARTNER` and self-registration only for `CUSTOMER`. Admin OTP did not provision a missing STAFF account.
- `UserModel` already stores a normalized email, but previously had no password field. It requires an E.164 phone, `userType`, and status; roles default to an empty array.
- `AuthController` uses `TokenService` for short-lived JWT access tokens and rotating refresh tokens. Refresh token hashes are persisted; browser refresh tokens are sent only in an HTTP-only, `SameSite=Strict` cookie. Browser JSON responses omit the refresh token.
- `AuthProvider` restores sessions with the refresh cookie, keeps the access token in module memory, loads `/auth/me`, and enforces an active STAFF identity. The Admin API client already handles refresh, logout, CSRF transport headers, and one-time protected-request refresh.
- `RbacService` resolves assigned role codes from `RoleModel` and computes effective permissions. Protected backend routes continue to enforce permissions through `authorize()`.
- The Admin foundation report and verification report both identify staff provisioning and role assignment as absent, and mark the Admin MFA decision as unresolved. Business Decision #16 remains TBD.

## 2. Files inspected and changed

Inspected the authentication controller/routes/schemas, database utility, User and Role models, OTP and token services, cookie/CSRF/rate-limit/auth middleware, RBAC service and role templates, Admin AuthProvider/API client/routes/UI, Customer auth tests, and the Admin foundation and verification reports.

Changed for this implementation:

- `backend/src/models/user.model.ts`
- `backend/src/services/auth/password.service.ts`
- `backend/src/controllers/auth.controller.ts`
- `backend/src/routes/auth.schemas.ts`
- `backend/src/routes/auth.routes.ts`
- `backend/scripts/provision-admin-development-account.mjs`
- `backend/scripts/admin-provisioning-guards.mjs`
- `backend/test/password.service.test.ts`
- `backend/test/admin-password-auth.test.ts`
- `backend/test/admin-provisioning-guards.test.ts`
- `apps/admin/src/services/api-client.ts`
- `apps/admin/src/providers/AuthProvider.tsx`
- `apps/admin/src/providers/AuthProvider.test.tsx`
- `apps/admin/src/app/App.tsx`
- `apps/admin/src/features/categories/api/category-client.test.ts`
- This report.

No Customer or Partner application source, shared types, package manifests, normal `.env`, `.gitignore`, or Gate 3 seed was changed for this implementation. Four pre-existing Customer working-tree modifications were left untouched.

## 3. Temporary authentication design

The Admin uses `POST /api/v1/auth/admin/password`, mounted only in development and test environments. The handler also verifies that the current database connection is connected to `thehomez_admin_verify` before looking up a user or issuing a refresh-token session. It queries only an email-matched STAFF account.

After a successful password check, the handler resolves permissions through the existing `RbacService`, issues tokens through the existing `TokenService`, and uses the existing refresh-cookie behavior. The response formatter enumerates safe profile fields; it never returns `passwordHash`. The `passwordHash` model path is excluded from ordinary Mongoose selections.

The Admin client submits email/password to the new route, retains the access token only in memory, fetches `/auth/me`, restores sessions through the existing refresh flow, and logs out through the existing API. Protected routes remain in place, and server-side permission middleware is unchanged. The sign-in UI includes email validation, generic authentication errors, a password visibility toggle, loading state, and duplicate-submit protection.

## 4. Password and session security

- Uses Node’s established `node:crypto` `scrypt` KDF, with a random 16-byte salt, 64-byte derived key, and parameters `N=32768, r=8, p=1`. No new dependency was required.
- The provisioning flow requires passwords between 12 and 128 characters. Login accepts up to 128 characters and returns the same generic `401 Invalid email or password` response for unknown, inactive, or password-mismatched identities. Missing stored hashes incur dummy KDF work.
- Login is protected by the existing IP-based authentication rate limiter and the existing CSRF/origin middleware. Existing CORS, refresh-cookie, refresh-token rotation, and logout protections remain in use.
- The Admin client does not store passwords, refresh tokens, or access tokens in `localStorage`.
- This limiter uses the project’s in-memory store and is suitable for a single-process development environment only.

## 5. Provisioning procedure and database safeguards

The new one-time operator script is not called during application startup and was **not executed**. It requires `--confirm`, prompts locally for email, phone, and a hidden password, validates inputs, and requires the operator to type `YES` before writes. Phone is prompted because `UserModel` requires it.

Before importing backend modules, it loads `backend/.env.admin` with an explicit script-relative path and `override: true`. It rejects a production invocation and validates development mode, port `5001`, URI path, and any `dbName` override. It disables automatic index creation on the imported User/Role schemas and calls the existing `connectDatabase()` with `autoIndex: false` and `autoCreate: false`, preventing model initialization from writing indexes or creating collections before the name check. It then requires connected diagnostics naming exactly `thehomez_admin_verify` before database queries or writes.

The script refuses an existing matching email/STAFF phone or existing `ADMIN_CATEGORY_READONLY` role. It creates one active STAFF account and one non-system-managed STAFF role containing only `CATALOG_READ`, in one transaction. The user receives only that role. It verifies the created status, type, role assignment, and exact role permission before transaction commit, then disconnects in `finally`. Existing users and roles are never updated. If transactions are unavailable, the script fails without committing.

Manual command, from the repository root:

```powershell
node --import tsx backend/scripts/provision-admin-development-account.mjs --confirm
```

The command requires an interactive terminal. Do not place the password in command-line arguments or source files. The script has not been run; no account or role has been created.

## 6. Role and permission configuration

The provisioner uses the dedicated code `ADMIN_CATEGORY_READONLY`, scoped to `STAFF`, with only `CATALOG_READ`. It does not reuse `SUPER_ADMIN`, `CATALOG_MANAGER`, or other broader templates. This permission supports the existing read-only Category Browser; privileged write APIs continue to require their own permissions.

## 7. Existing and new provisioning paths

There was no pre-existing staff creation UI, general staff role-assignment API, or narrow authorized provisioning CLI. The Gate 3 seed is broad demo-data setup and is not used. This implementation adds only the guarded, explicitly operator-run development provisioner described above; it does not add public registration, password reset, invitation management, or staff-management APIs.

The responsible operator must use the isolated development configuration and confirm the target database diagnostics before writes. The script independently enforces those checks; the user must still review the email/phone they enter and approve the provisioning confirmation. No database writes have occurred as part of this implementation.

## 8. Validation commands and actual results

Passed:

- `npm --workspace=@thehomez/backend run typecheck`
- `npm --workspace=@thehomez/backend run build`
- `npx eslint backend/src/models/user.model.ts backend/src/services/auth/password.service.ts backend/src/routes/auth.schemas.ts backend/src/controllers/auth.controller.ts backend/src/routes/auth.routes.ts backend/scripts/provision-admin-development-account.mjs backend/scripts/admin-provisioning-guards.mjs backend/test/password.service.test.ts backend/test/admin-password-auth.test.ts backend/test/admin-provisioning-guards.test.ts`
- `npm --workspace=@thehomez/backend test -- test/password.service.test.ts test/admin-password-auth.test.ts test/admin-provisioning-guards.test.ts` — 16 tests passed. These are mocked/unit tests and do not connect to MongoDB.
- `npm --workspace=@thehomez/admin-dashboard run typecheck`
- `npm --workspace=@thehomez/admin-dashboard run build` — passed. Vite emitted existing non-fatal Zod annotation and large-chunk warnings.
- `npx eslint apps/admin/src/providers/AuthProvider.tsx apps/admin/src/providers/AuthProvider.test.tsx apps/admin/src/services/api-client.ts apps/admin/src/app/App.tsx apps/admin/src/features/categories/api/category-client.test.ts`
- `npm --workspace=@thehomez/admin-dashboard test` — 19 tests passed, including the new Admin sign-in/session tests.
- `npm --workspace=@thehomez/customer-app test -- --run src/test/auth-context.test.tsx src/test/auth-client.test.ts src/test/auth-integration.test.tsx src/components/auth/customer-auth-ui.test.tsx` — 45 Customer authentication regression tests passed.
- `node --check backend/scripts/provision-admin-development-account.mjs; node --check backend/scripts/admin-provisioning-guards.mjs`

The full backend suite was not run. Existing backend integration suites connect to a configured MongoDB and perform collection cleanup; running them could alter existing data. No database-backed integration test or browser verification was performed. The provisioner itself was not executed.

## 9. Known limitations

- MFA is not implemented. Password policy is intentionally basic for the isolated development bootstrap; the permanent policy and recovery process remain undefined.
- The in-memory login rate limiter is not a distributed production control.
- The provisioner requires an interactive terminal and a MongoDB deployment that supports transactions.
- The identity and role are manually pending. The current isolated database diagnostic found no matching STAFF user; that result has not been changed by this implementation.
- Browser sign-in against a live backend, refresh cookie, and live permission-gated category API remain unverified.
- Admin login is scoped to the isolated verification database. Running the normal backend against another database leaves this temporary login unavailable.

## 10. Production-readiness verdict

**Production Admin authentication is NOT approved.** This temporary flow is development-only, MFA is absent, and Business Decision #16 remains unresolved. A future approved design must address MFA, staff provisioning, password policy, account recovery, auditability, deployment controls, and production session policy before production use.
