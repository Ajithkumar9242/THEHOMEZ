# TheHomez Admin Category Browser — Independent Final Verification

**Date:** 2026-11-13  
**Scope:** Admin foundation, STAFF session boundary, category read UI and its backend contracts.  
**Verdict:** **APPROVED WITH CONDITIONS** for continued development only. This is not production approval or end-to-end acceptance.

## 1. Executive summary

Independent source review and safe Admin checks support the implementation's development readiness. The Admin application uses backend-derived STAFF identity and permissions; category UI uses shared category response types and GET-only endpoints; the API client distinguishes HTTP errors and bounds refresh retry; and the backend only includes inactive categories for active STAFF principals with `CATALOG_READ`.

Admin tests passed (14/14), typecheck passed, and the production build completed. No database-backed test, backend startup, or real browser sign-in was performed. The category integration suite has destructive cleanup against the configured `thehomez` database, which is not isolated. Browser verification remains a blocker, including actual staff OTP, session restoration, logout, and persisted category data. Decision #16/MFA remains unresolved. Dependency advisories remain open; this verification's npm audit refresh could not reach the registry.

One API-contract nuance remains: unauthorized `includeInactive=true` requests to the public tree/slug endpoints return HTTP 200 with active-only data, rather than explicit 403. Source tests confirm inactive records are excluded; the Admin UI does not make the request without `CATALOG_READ`. Thus no inactive data exposure was found, but a caller cannot distinguish denied inactive visibility from an empty/active-only result at the HTTP layer.

## 2. Independent source review

Inspected the two prior implementation reports, the readiness audit, business decisions, shared category/auth contracts, Admin application/routes/providers/layout/API client/category feature/tests, backend category route/controller/service/model, authentication middleware/routes/services, RBAC service and category integration test. Relevant evidence is cited by repository path throughout this report.

| Check | Result | Evidence |
|---|---|---|
| Uses actual shared category DTOs and API envelope | PASS | `apps/admin/src/features/categories/api/category-client.ts`; `packages/shared-types/src/catalog/category.ts`; backend controller response envelopes. |
| No fabricated category content represented as persisted | PASS | Category page renders only API results; tests supply fixtures as mocks, not runtime records. |
| Staff identity originates from backend | PASS (source) | `AuthProvider.tsx` obtains refresh then `/auth/me`; OTP verification response is checked and then `/auth/me` is fetched again. Backend auth middleware reloads the user and resolves permissions from DB roles. |
| `CATALOG_READ` originates from backend | PASS (source) | `/auth/me` shared `IAuthUser.permissions`; `ProtectedRoute` and page use it for UI gating only. |
| Frontend is not the sole authorization boundary | PASS | Category ID endpoint uses `authenticate` + `authorize(CATALOG_READ)`; inactive inclusion checks backend-resolved staff principal/permission. The tree/slug active-data endpoints are intentionally contextual/public. |
| Inactive data is withheld without permission | PASS (source) | `CategoryController.canViewInactive` requires `STAFF` and `CATALOG_READ`; service filters inactive categories otherwise; integration test assertions cover anonymous, customer, partner and unauthorized STAFF principals. |
| Unauthorized inactive request gets explicit HTTP 403 | NOT VERIFIED / contract mismatch | Tree and slug routes use `optionalAuthenticate`; controller coerces unauthorized `includeInactive=true` to false, yielding active-only HTTP 200. Only protected ID lookup returns 403 without permission. UI avoids this query when permission is absent. |
| Category mutation requests in feature | PASS | `category-client.ts` exposes only GET tree and GET slug detail. No mutation control/API method exists in feature. UI test checks absence of mutation controls. |
| 401/403/404/422/5xx/network/cancellation handling | PASS (unit behavior) | Central `ApiError`; bounded refresh in `apiFetch`; pages distinguish 401/403/404/400/422/network/5xx; tests cover these cases. Not browser tested. |
| No insecure refresh-token storage or sensitive logging | PASS (source) | Access token is module-memory only; refresh cookie handled via credentials; no local/session storage or auth payload logging found in reviewed client/provider. |
| Unauthenticated protected route is denied | PASS (source) | `ProtectedRoute` redirects non-signed-in state to `/sign-in`; auth provider initially blocks children while restoring session. Automated real-router/auth-provider integration was not run. |

## 3. Backend API contract verification

Source paths: `backend/src/routes/category.routes.ts`, `backend/src/controllers/category.controller.ts`, `backend/src/services/catalog/category.service.ts`, `backend/src/models/category.model.ts`, `backend/src/routes/category.schemas.ts`, and `packages/shared-types/src/catalog/category.ts`.

| Endpoint | Contract and authorization verified from source |
|---|---|
| `GET /api/v1/categories` | `{ success: true, data: { categories: ICategoryTreeItem[] } }`; active tree by default, ordered by display order/name; no pagination. `includeInactive=true` is honored only for STAFF with `CATALOG_READ`; other callers get active-only data and HTTP 200. |
| `GET /api/v1/categories/:slug` | `{ success: true, data: ICategoryDetailsResponse }`; category detail by slug, with parent/subcategories where applicable. Inactive category or inactive parent is not found in active-only mode (404 `CATEGORY_NOT_FOUND`). Inactive inclusion has the same staff permission predicate as tree. |
| `GET /api/v1/categories/id/:id` | `{ success: true, data: { category: ICategory } }`; authentication and explicit `CATALOG_READ` middleware required. |
| Category writes | Backend POST/PATCH/DELETE exist and use `CATALOG_WRITE`; the Admin feature has no calls to them. |

Tree items and detail use shared `ICategoryTreeItem` / `ICategoryDetailsResponse`. DTO content includes identifiers, slug, name, description where present, parent, level, display order, active status, image/icon URLs where present, and timestamps on full `ICategory`. The UI's displayed fields are drawn from these DTOs. No supplier/partner fields occur in these contracts. The backend read routes do not attach the defined `validateQuery` middleware; the current UI only passes the supported boolean `includeInactive` query. There is no 422 validation behavior on these read routes in current source, though centralized error handling preserves a 422 from an API response.

## 4. STAFF authentication review

**Source-level result: PASS, with external verification outstanding.** `apps/admin/src/services/api-client.ts` uses the existing `/auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `/auth/me`, and `/auth/logout` contracts; request bodies specify shared `UserType.STAFF`. It does not create staff or accept browser-supplied roles/permissions. The provider requires active STAFF identity and fetches `/auth/me` after OTP verification and cookie refresh. Refresh credentials are not read by JavaScript; access tokens remain in memory. Logout clears local state even on API failure and uses the existing cookie transport convention.

Backend `auth.middleware.ts` verifies bearer identity and reloads current account/roles; `rbac.service.ts` resolves permissions from persisted role data. OTP service supports existing active staff identities; it does not self-provision staff. The verified source does not include an Admin-specific MFA contract. Business Decision #16 remains unresolved, so this is development-only and not a production assurance boundary.

**Not verified in a real session:** OTP delivery/request and verification, `/auth/me` against a provisioned staff account, actual refresh-cookie restoration, logout revocation, inactive STAFF denial over HTTP, and real 401/403 transitions. No pre-provisioned credentials/provider access was supplied. No account was created.

## 5. RBAC and `CATALOG_READ`

The Catalogue entry in `AdminLayout.tsx`, category route in `app/App.tsx`, and page affordances use backend-derived `CATALOG_READ`. A staff identity without the permission cannot enter the protected route; the page itself also avoids a tree request and renders a permission state. These are usability controls, not security enforcement. The backend's protected ID lookup and inactive-data predicate remain authoritative.

For the requested matrix case “inactive categories without permission — backend denies access,” source behavior is more specific: the public tree/slug routes return active-only data rather than a 403. The test suite verifies no inactive record is present for anonymous/customer/partner/unauthorized staff cases. The UI's authorized control and route behavior are appropriate, but explicit HTTP denial for that query is not implemented. The existing UI 403 rendering is covered with mocked client behavior; that particular 403 cannot be generated by the current unauthorized tree/slug query path.

## 6. Inactive-category authorization review

**PASS for data confidentiality from source.** The checkbox is only rendered for `CATALOG_READ`; a normal staff user without it is blocked by the route and does not invoke `getTree`. If a user manually changes the query string while authorized, the frontend may request inactive data, but the backend independently checks the current principal. Unauthorized API callers receive only active records. Authorized STAFF receive inactive records only when requesting `includeInactive=true`.

**Limitation:** The API silently downgrades unauthorized requests to active-only HTTP 200 instead of returning explicit 403. This is not an observed leakage, but makes authorization denial indistinguishable from successful active-only output at the HTTP layer. Recommended minimal correction for a future approved backend change: explicitly reject `includeInactive=true` unless the resolved principal is STAFF with `CATALOG_READ`; preserve the active-only default for ordinary requests. No change was made in this verification.

## 7. Automated test results

Run during this independent verification:

- `npm --workspace=@thehomez/admin-dashboard test -- --reporter=verbose` — **passed, 14 tests across 2 files**. Coverage includes category client success, inactive query, detail slug encoding, 401/403/404/422/server/network/cancellation handling, loading/empty, hierarchy expand/collapse, permission gate, inactive option, detail rendering, retry and no mutation controls. API and identity are mocked; this is not backend integration.
- `npm --workspace=@thehomez/admin-dashboard run typecheck` — **passed** (exit 0).
- `npm --workspace=@thehomez/admin-dashboard run build` — **passed** (exit 0). Vite emitted two non-fatal Zod annotation warnings and a large-chunk warning: JS 980.49 kB minified / 306.39 kB gzip; CSS 12.53 kB / 3.75 kB gzip.
- `npm audit --workspace=@thehomez/admin-dashboard --json` — **not completed**: npm registry lookup failed with `ENOTFOUND registry.npmjs.org`; no current audit report was obtained.
- Backend category integration test — **not run**, due destructive setup/teardown and unisolated URI (see Section 9).
- Changed-file lint and shared-types tests — **not run** in this verification.

No check result above is inferred from the prior implementation report; commands listed as passed were run in this verification turn.

## 8. Browser verification results

**NOT VERIFIED.** No actual browser session was completed. The Admin Vite dev server did start and printed `VITE v5.4.21 ready` at `http://localhost:3001/`, but an HTTP probe from this sandbox was blocked with “socket ... forbidden by its access permissions”; therefore no page response or browser rendering was confirmed. No backend was started and no OTP request was made. The Admin Vite port is configured as 3001 and backend default trusted origins include localhost ports 3000/3001/3002; source uses matching `localhost` host and `/api` proxy. There was no live browser evidence for OTP, `/auth/me`, protected route entry, category data, inactive visibility, refresh reload, logout, 401/403 behavior, tablet layout, console errors, or network absence of mutation requests.

The earlier reports likewise disclose missing browser authentication evidence. A visual browser smoke test without a backend could not satisfy the requested real category/session scenarios. No browser outcome is claimed.

## 9. Database safety assessment

`backend/test/category.test.ts` was inspected and **not run**. In `beforeAll` and `afterAll`, when the database connects, it deletes categories whose slugs match `test-`, `civil-`, `steel-`, `plumbing-`, `electrical-`, or `services-`; users with phones beginning `+919333`; roles with codes beginning `CAT_TEST_`; and partners whose business names begin `Test Category Partner`. `beforeEach` deletes all categories matching `^test-`, and the seed case also deletes a hard-coded list of real category slugs before invoking a seed routine. These operations can affect non-test records if such records match.

The test calls the shared `connectDatabase()` and does not set or override `MONGODB_URI`. The inspected environment resolves to local MongoDB `127.0.0.1:27017`, database `thehomez`, with `NODE_ENV=development` (only host/database/environment were read; no credentials were printed). This is the normal development database, not an isolated test database. Cleanup is not restricted to an isolated DB. Therefore the category integration test is unsafe under the current configuration and was not run. No migration, seed, cleanup or database command was executed.

Backend `startServer()` connects to this configured database and calls `RbacService.seedDefaultRoles()`, which writes role templates. It was not started. No Gate 3 data was touched.

## 10. Dependency vulnerability assessment

The Category Browser implementation report records an earlier `npm audit --json` result of **15 advisories: 12 moderate, 1 high, 2 critical**. The current verification attempted a fresh audit, but registry DNS resolution failed; advisory ranges and fixes could not be independently refreshed. Installed versions below were independently checked with `npm ls` and `package-lock.json`.

| Package(s) | Installed/directness | Runtime/bundle impact | Audit evidence available in prior report | Priority |
|---|---|---|---|---|
| `react-router-dom` / `react-router` | Admin direct `react-router-dom@6.30.6`; `react-router@6.30.6` transitive | Runtime dependency; router code is bundled in Admin. Exact vulnerability reachability in this app was not independently proven. | Prior audit cited router advisories including GHSA-wrjc-x8rr-h8h6 and said npm's fix was `react-router-dom@7.18.5` (major). | High review priority because runtime/bundled; assess affected ranges and plan compatible migration. |
| `vite` | Admin direct dev dependency `vite@5.4.21`; shared by workspace build tooling | Development/build tooling; not shipped as app runtime bundle. Dev server exposure remains relevant locally. | Prior report cited Vite/esbuild GHSA-67mh-4wv8-2f99 and Windows launch-editor GHSA-587h-7wmj-h5pm; npm's listed Vite fix was `8.3.8` (major). | High before exposing dev server; schedule reviewed major upgrade. |
| `vitest`, `tinypool`, `@vitest/mocker`, `vite-node` | Admin direct `vitest@2.1.9`; `tinypool@1.1.1` transitive; related Vitest packages transitive | Test-only tooling; not in production app bundle. | Prior report cited GHSA-5xrq-8626-4rwp and GHSA-5gmw-xhrv-c9v3; npm's listed Vitest fix was `5.1.0` (major); moderate findings were attributed to mocker/vite-node. | Medium; upgrade test tooling in a reviewed major migration. |
| `typescript-eslint` family and `minimatch` | Root lint tooling; transitive packages include `@typescript-eslint/*` and minimatch; not Admin runtime | Development lint tooling; not in app bundle. `npm ls` showed installed `typescript-eslint@8.72.1`, nested `minimatch@10.2.6`, and root `minimatch@3.1.5`. | Prior audit categorized moderate findings and reported a compatible fix. Exact affected package versions/ranges/fix cannot be refreshed here. | Lower runtime risk; apply compatible audited updates separately. |

This report does not claim those advisories are currently exploitable or that the installed versions remain in affected ranges. No automatic fixes, package upgrades or lockfile changes were made. Prioritize fresh advisory confirmation and remediation of the bundled router; next review locally exposed Vite tooling, then update test/lint-only packages. Preserve dependency compatibility and avoid blanket upgrades.

## 11. Responsive and accessibility review

**Source review: PASS with limitations.** CSS collapses the category list/detail grid at widths below 900px; mobile styles adjust page heading and tree labels. Ant Design Tree provides standard keyboard interaction and visible branch controls; the checkbox and buttons have text labels. Loading uses an `aria-busy` region; errors use `role="alert"`. No horizontal overflow was evident from the inspected CSS constraints (`minmax(0, …)`, `min-width: 0`) at source level.

No real viewport/browser or keyboard-only accessibility test was performed. Therefore tablet/mobile visual behavior, focus order, contrast and screen-reader announcements remain NOT VERIFIED at runtime.

## 12. Customer/Partner regression review

`git status --short` was inspected before and after checks. It shows the four known Customer modifications and the existing Admin/package-lock changes/untracked foundation and feature files. No Customer or Partner source file was changed by verification; builds/tests run were scoped to the Admin workspace. The four specified Customer modifications remain present. The Partner source tree has no reported modification in status. No Git state-changing operation was run.

The required reports live under `docs/`, which `.gitignore` excludes (`docs/` rule). This file is present in the workspace but may not appear in ordinary Git status unless explicitly force-added later. `.gitignore` was not changed.

## 13. Findings by severity

### Medium

1. **Real end-to-end staff/browser integration is unverified.** No live backend session, OTP provider, provisioned STAFF account or category API response was exercised. This blocks end-to-end acceptance and production sign-off. A safe isolated backend plus authorized staff test identity is required.
2. **Dependency advisories remain unresolved.** Prior audit shows a critical Vitest/Tinypool finding, high Vite finding and moderate runtime React Router finding among 15 total; fresh audit could not run due registry DNS failure. Confirm current ranges and plan reviewed upgrades before production or exposing development tooling.
3. **Unauthorized `includeInactive` request is downgraded, not explicitly denied.** The backend leaks no inactive rows, and the Admin UI gates the option. However, the exact “backend returns 403” matrix expectation is not met for tree/slug endpoints. Minimal future correction: explicit 403 when the query is requested without qualifying principal.

### Low

4. **Bundle size exceeds Vite's warning threshold.** Build passes, but 980.49 kB minified JS / 306.39 kB gzip merits code-splitting/performance follow-up.
5. **Build emits two non-fatal Zod annotation warnings.** No build failure observed.

No source change was made to address these findings.

## 14. Outstanding blockers

- Safe isolated DB configuration and cleanup bounds for backend integration tests.
- A pre-provisioned active STAFF identity and usable OTP provider for live verification.
- Browser evidence for session lifecycle, category reads, permission behavior, responsive display, and no mutation traffic.
- Decision #16 approval and an approved Admin MFA contract before production use.
- Fresh npm audit data and reviewed dependency remediation.

## 15. Production-readiness limitations

This is a development-only foundation. There is no approved Admin MFA workflow, and no live browser session was independently verified. The category UI's 403 path is tested with mocked responses, while the current inactive tree/slug endpoint silently returns active-only data for unauthorized `includeInactive` requests. Dependency advisories require current confirmation and remediation. No general append-only administrative audit log exists, as noted in prior reports. These constraints preclude production readiness.

## 16. Final verdict

**APPROVED WITH CONDITIONS** for continued development and a subsequent independent/browser verification phase. The source and safe Admin checks support the read-only module's current development scope, and no inactive-category disclosure or mutation path was identified. This verdict does **not** mean end-to-end acceptance: browser authentication and persisted backend integration are NOT VERIFIED, the database-backed test was correctly withheld as unsafe, and production use remains blocked by Decision #16/MFA and unresolved dependency advisories.
