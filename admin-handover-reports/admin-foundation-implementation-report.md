# TheHomez Admin Foundation — Implementation Report

**Date:** 2026-11-13  
**Scope:** Admin frontend shell and development authentication boundary only  
**Readiness:** Foundation implemented and verified by Admin typecheck/build; development-only. Not production authentication.

## 1. Initial repository findings

Before changes, `apps/admin/src/index.ts` was a metadata-only stub. The Admin workspace had no HTML entry, Vite config, React runtime, Ant Design, routing, API transport, auth context, or UI. Root npm workspaces include `packages/*`, `backend`, and `apps/*`. The Customer app provides an existing React/Vite example and an auth client that uses the backend cookie transport headers and in-memory access tokens. Existing root worktree changes were four Customer files; they remain untouched.

The shared UI specification is `docs/design-system.md`, whose shared tokens are implemented in `src/styles/tokens.css`. The Admin foundation imports that existing token file and maps the brand primary and slate colors into Ant Design's theme rather than establishing a competing palette.

## 2. Verified existing authentication architecture

The backend mounts `createAuthRouter()` at `${apiPrefix}/auth` in `backend/src/app.ts`. `backend/src/routes/auth.routes.ts` exposes:

- `POST /api/v1/auth/otp/request` and `/otp/verify` with Zod validation and dual rate limiters.
- `POST /api/v1/auth/refresh`, protected by rate limiting and CSRF middleware.
- `POST /api/v1/auth/logout`, protected by rate limiting and CSRF middleware; optional authentication allows cookie revocation when the access token has expired.
- `POST /api/v1/auth/logout-all`, protected by bearer authentication.
- `GET /api/v1/auth/me`, protected by bearer authentication.
- `GET /api/v1/auth/roles`, protected by authentication and `RBAC_MANAGE`.

Shared contracts in `packages/shared-types/src/auth/contracts.ts` define `IOtpRequestResponse`, `IAuthResponse`, `IAuthUser`, `IRefreshTokenResponse`, `ILogoutResponse`, and profile response. OTP identity input uses `phone`, `otp`, and `userType`. Browser auth in Customer uses `credentials: 'include'`, `X-Auth-Transport: cookie`, and `X-Client-Type: browser`; refresh credentials are HTTP-only cookies while the short-lived access token stays in memory.

`backend/src/services/otp/otp.service.ts` confirms active STAFF/PARTNER accounts must already exist. Only CUSTOMER identities may be auto-created by OTP. Unprovisioned STAFF OTP requests return a uniform anti-enumeration response; OTP verification never provisions staff. This implementation therefore adds no staff registration or provisioning behavior.

## 3. STAFF and RBAC capabilities

`backend/src/middleware/auth.middleware.ts` validates the bearer access token, reloads the user from MongoDB, rejects missing/inactive accounts and identity mismatch, then calls `RbacService.resolveUserPrincipal`. `backend/src/services/rbac/rbac.service.ts` loads role records from the database and computes current effective permissions. Client-provided role or permission claims are not authoritative.

`IAuthUser` returns backend identity, status, roles and permissions. The new protected route component checks STAFF identity and, where supplied, a required permission from this backend response. This is presentation/navigation control only: backend routes must continue enforcing authorization. Category reads are authorized by backend routes (`CATALOG_READ` for ID lookup; the public category tree only includes inactive categories when request principal is STAFF with `CATALOG_READ`).

The backend has no Admin-specific authentication routes, MFA/TOTP, staff provisioning UI, or general staff role assignment API. Business Decision #16 in `docs/business-decisions.md` remains unresolved.

## 4. Implemented Admin frontend structure

- `apps/admin/index.html`: Vite document entry.
- `apps/admin/vite.config.ts`: React plugin, local port 3001, `/api` proxy to `http://localhost:5000` (override with `VITE_API_PROXY_TARGET`), build output.
- `apps/admin/src/main.tsx`: React root, BrowserRouter, Ant Design ConfigProvider and theme.
- `apps/admin/src/app/App.tsx`: application routes, protected staff shell, development-status landing page.
- `apps/admin/src/layouts/AdminLayout.tsx`: collapsible responsive sidebar, header, breadcrumb, identity display and sign-out.
- `apps/admin/src/routes/ProtectedRoute.tsx`: signed-in STAFF guard and optional permission guard.
- `apps/admin/src/providers/AuthProvider.tsx`: session restoration, OTP sign-in, identity verification, staff check, logout and sign-in UI.
- `apps/admin/src/services/api-client.ts`: central JSON transport, error type, auth cookie headers, in-memory access-token state and one bounded 401 refresh/retry for feature requests.
- `apps/admin/src/styles/admin.css`: shared token import, responsive shell and Ant Design reset.
- `apps/admin/src/vite-env.d.ts`: environment variable types.
- `apps/admin/package.json` and `apps/admin/tsconfig.json`: frontend dependencies, scripts, DOM/Vite config.

## 5. Authentication integration details

The sign-in UI asks for a phone number, requests OTP with the existing `UserType.STAFF` contract, then verifies the OTP. It does not claim to determine access from the submitted form or locally chosen role. On verification, the browser holds the returned access token only in module memory, then calls `/auth/me` and requires an active `STAFF` identity before entering the shell. On reload, it attempts the supported cookie-based `/auth/refresh`, then obtains `/auth/me`; missing/invalid refresh or identity clears access and shows sign-in. Logout calls the existing `/auth/logout`, includes cookie transport headers and credentials, and clears local in-memory state even if the API request fails.

401 responses trigger session expiry. Feature `apiRequest`/`apiFetch` retries a protected fetch at most once after refresh; a final 401 expires the frontend session. 403 is not converted to logout and remains a permission/authorization failure. No refresh token is read or stored by JavaScript. The generic feature transport accepts `AbortSignal` through `RequestInit`.

The API base defaults to `/api/v1`, which uses the Vite proxy. `VITE_API_BASE_URL` can set a deployment-specific API prefix. Credentials are included to support the backend's HTTP-only refresh cookie and CSRF transport. No token, OTP or response payload is written to logs.

## 6. Navigation and routes

The shell displays placeholders for Dashboard, Catalogue, Service Areas, Customers, Partners, Orders, Finance, Settlements, Support, Notifications, Reports and Settings. Only the shell landing route is active. All future modules are visibly marked “In development” and disabled; no operations or fake metrics are presented. The landing page describes current development status and staff identity using actual `/auth/me` data. No Category Browser has been implemented in this phase.

`ProtectedRoute` supports a backend-permission requirement for future module routes. The next category page should use `CATALOG_READ` for frontend affordances while continuing to rely on the API's permission checks, and should avoid showing inactive data to staff without that permission.

## 7. Security decisions and limitations

- **Verified:** Existing OTP route requires existing active STAFF; verification does not auto-create staff. `/auth/me` returns fresh backend-derived roles and permissions. Auth middleware refreshes principal state from MongoDB on every authenticated request.
- **Implemented:** No public registration or staff-provisioning path; STAFF-only identity gate; active-account check; memory-only access token; HTTP-only cookie transport conventions; no client-side fake roles; bounded refresh retry; separate 401 and 403 behavior; disabled unfinished modules.
- **Not implemented:** Admin-specific MFA, staff account provisioning, role assignment, general append-only audit log, production-specific session policy, or any backend change. Existing `PriceHistoryModel` and availability history do not constitute a general Admin audit trail.
- **Integration point for future MFA:** Keep the auth provider as the session boundary. After an approved backend MFA challenge/completion contract exists, insert its explicit challenge and completion stages before setting Admin status to signed-in. Do not accept a frontend-only “MFA verified” flag. The current API does not expose that contract, so no simulated stage exists.
- **Decision #16 blockers:** Production Admin access and sensitive/privileged workflows must remain blocked until stakeholders approve Admin roles, MFA requirements, separation of duties, recovery and route enforcement. This development OTP flow is not a substitute for MFA and is not production-ready.

## 8. Files created and modified

Created: `apps/admin/index.html`, `apps/admin/vite.config.ts`, `apps/admin/src/main.tsx`, `apps/admin/src/vite-env.d.ts`, `apps/admin/src/app/App.tsx`, `apps/admin/src/layouts/AdminLayout.tsx`, `apps/admin/src/providers/AuthProvider.tsx`, `apps/admin/src/routes/ProtectedRoute.tsx`, `apps/admin/src/services/api-client.ts`, `apps/admin/src/styles/admin.css`, and this report.

Modified: `apps/admin/package.json`, `apps/admin/tsconfig.json`, and `package-lock.json`. Replaced the old `apps/admin/src/index.ts` metadata stub with the actual application structure; the old file was deleted. No Customer or Partner source files, backend code, shared contracts, business decisions, `.gitignore`, database data, or seed scripts were changed.

Dependencies added to Admin workspace: React, React DOM, Ant Design, React Router DOM; Vite, React Vite plugin, React type packages (build tooling and type packages are recorded under devDependencies). `npm install` reported 8 dependency audit findings (5 moderate, 1 high, 2 critical); this task did not run `npm audit` to identify individual advisories or apply automated upgrades.

## 9. Commands and verification

Executed:

- `npm install --workspace=@thehomez/admin-dashboard react@^18.3.1 react-dom@^18.3.1 antd@^5.22.0 react-router-dom@^6.28.0 @types/react@^18.3.12 @types/react-dom@^18.3.1 @vitejs/plugin-react@^4.3.3 vite@^5.4.10` — completed; npm resolved compatible versions and reported 8 audit findings. Dev-only package classification was then aligned in the workspace manifest and lockfile.
- `npm --workspace=@thehomez/admin-dashboard run typecheck` — passed.
- `npm --workspace=@thehomez/admin-dashboard run build` — passed; output generated under `apps/admin/dist`.
- `npx eslint apps/admin/src apps/admin/vite.config.ts` — passed with exit code 0.
- `npm ls --workspace=@thehomez/admin-dashboard --depth=0` — passed; resolved dependencies include React 18.3.1, React Router 6.30.6, Ant Design 5.29.3 and Vite 5.4.21.

The package reclassification install attempt did not complete, so the dev-only dependency placement was corrected directly in the Admin workspace manifest and corresponding lockfile workspace entry; resolved package versions were confirmed by `npm ls`. Final typecheck, build and lint were rerun after the last API-client change. No automated tests were added or run. No browser verification was performed. The final build emitted non-fatal warnings: two Zod comment annotations were dropped by Rollup, and the minified JS chunk exceeded 500 kB (872.58 kB, 273.11 kB gzip). This is recorded as a performance follow-up, not a build failure.

## 10. Known issues

1. No browser-based sign-in/session flow was verified against a running backend. A pre-provisioned staff identity and its OTP provider are prerequisites.
2. Decision #16 remains unresolved; this auth flow must not be used as production Admin assurance.
3. Bundle size warning should be addressed with measured code splitting after the first functional module is in place.
4. npm reported dependency audit findings; no advisory-level analysis or remediation was performed.
5. No Admin tests exist yet.

## 11. Explicitly excluded functionality

No Category Browser, category CRUD, catalog/product/variant/SKU management, pricing, service-area operations, customer or partner management, order/allocation/inventory/payment/refund/tax/settlement workflows, support/notification/reporting/settings modules, staff provisioning, role-management API, MFA implementation, general audit-log backend, database migration/seed, Customer/Partner implementation, or business-decision changes.

## 12. Readiness assessment

**Development foundation: READY FOR CHAT B WITH CONDITIONS.** The Admin application now has a real Vite/React/TypeScript/Ant Design entry point, navigation shell, protected STAFF boundary, backend-backed identity check, reusable permission guard and API transport. Chat B should verify the current API against the running backend, use only the existing category endpoints, apply `CATALOG_READ` as a UI affordance, and preserve backend authorization as the enforcement boundary.

**Production Admin authentication: NOT READY.** Decision #16 and the missing approved MFA contract prevent production sign-off. The foundation explicitly labels itself as development-only and does not simulate MFA.

## 13. Recommended next implementation phase

Proceed to **Chat B — Admin Read-only Category Browser** after running the final checks recorded as outstanding above. Implement only category hierarchy/detail, active/inactive visibility governed by backend response/authorization, loading/empty/error/retry behavior, and `CATALOG_READ` presentation gating. Add no mutations or unrelated modules.
