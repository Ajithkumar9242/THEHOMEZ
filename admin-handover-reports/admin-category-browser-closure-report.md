# TheHomez Admin Category Browser — Closure Report

**Date:** 2026-11-13  
**Scope:** Runtime verification, isolated test environment, dependency review, and development acceptance  
**Verdict:** **APPROVED WITH CONDITIONS** for development work; final runtime acceptance remains outstanding.

## 1. Executive summary

The Category Browser’s current implementation passed its Admin unit/UI tests (14/14), typecheck, production build, changed-file lint, and shared-types tests (75/75). Source review confirms a GET-only category client, backend-derived `CATALOG_READ` UI gating, and backend filtering of inactive categories. No implementation, shared contract, backend, Customer, Partner, `.gitignore`, or database content was changed for this closure task.

A process-only MongoDB URI override targeting `thehomez_admin_verify` was used for an attempted category integration test. The normal configured URI was confirmed to target `thehomez`; it was not used for the test. The sandbox denied the isolated connection (`EACCES 127.0.0.1:27017`), and the suite subsequently timed out on database operations. No database connection or writes occurred. Backend startup and real browser verification were therefore not performed. An existing demo-data seed can provision a demo STAFF user as part of a broad dataset operation, but it is not an appropriate narrow or authorized staff-provisioning procedure for this verification.

The smallest API contract follow-up remains a recommendation only: reject unauthorized `includeInactive=true` requests with HTTP 403 rather than silently returning active-only data with HTTP 200. No API change was made. Dependency advisories remain pending fresh registry data. Decision #16/MFA and production authentication readiness are still outside this development acceptance.

## 2. Database isolation investigation

### Source/configuration findings

- `backend/src/database/database.ts` connects using `customUri || getConfig().mongodb.uri`; config takes `MONGODB_URI` from the process environment and otherwise defaults to `mongodb://127.0.0.1:27017/thehomez?...`.
- `backend/.env` has a local URI resolving to host `127.0.0.1:27017`, database `thehomez`, and `NODE_ENV=development`. Credentials were not displayed.
- `backend/test/category.test.ts` calls `connectDatabase()` without a custom URI. Its setup/teardown `deleteMany` calls include category slug patterns, user phone prefixes, role prefixes, and partner names. The suite also deletes a fixed category slug list before running the category seed. Those operations would be unsafe against the normal database.
- Environment override is supported without modifying production configuration: the test process received `MONGODB_URI=mongodb://127.0.0.1:27017/thehomez_admin_verify?replicaSet=rs0&directConnection=true` and `NODE_ENV=test`. This URI’s effective database name is separate from `thehomez`; the normal `.env` was not modified. The URI was checked before the test invocation.
- Cleanup queries use the current Mongoose connection, so if this test runs against the verified override they are scoped to `thehomez_admin_verify`. There is no `dropDatabase()` in this category test.

### Attempt and result

Command attempted: `npm --workspace=@thehomez/backend test -- --run test/category.test.ts --reporter=verbose`, with the process-only isolated URI override above.

Result: MongoDB connection failed with `connect EACCES 127.0.0.1:27017`. The test’s `beforeAll` catches connection failure but still starts database-dependent test cases; initial category inserts then timed out. The run was interrupted after the connection failure and initial buffered-operation failures. It is **not a passing integration test**. No MongoDB operation could complete, and no data was written or deleted. The test harness should fail fast or skip DB-dependent tests when connection is unavailable in a future separately authorized harness change.

Isolation is configurable through the existing connection utility, but actual runtime isolation could not be exercised because local MongoDB access is blocked by the sandbox. Backend integration must remain pending until a reachable isolated MongoDB instance is supplied and its effective database is checked before testing.

## 3. Backend startup safety

`backend/src/server.ts` calls `connectDatabase()`, then `RbacService.seedDefaultRoles()`, before listening. The seed writes role templates. A separate process can be configured with a distinct `MONGODB_URI`, `PORT`, `NODE_ENV`, and existing CORS origin, but no backend was started because:

1. The isolated database endpoint is not reachable from this sandbox.
2. Starting would attempt DB connection and role writes; isolation could not be confirmed by an established connection.
3. No valid test STAFF identity/session is available.

The normal backend port is 5000 and the Admin Vite config uses 3001 with `/api` proxy target `http://localhost:5000`. A distinct test backend port would need to be selected and its Vite proxy target separately configured for a real run. No auth, CORS, CSRF, trusted-origin, or production configuration was weakened.

## 4. STAFF identity prerequisite

Source confirms OTP only permits an already-existing active STAFF account; STAFF is not auto-provisioned. Mock OTP is selected by the development `.env`, but no OTP request was made and no OTP or credential was generated or displayed.

`backend/src/scripts/seed-gate3-demo-data.ts` includes a demo STAFF identity as part of a broad Gate 3 demo dataset. This is not a narrow Admin verification provisioner and was not run. Running it against `thehomez` is prohibited; running the broad seed against an isolated DB was also not attempted because the database endpoint is unavailable and the task supplies no authorization to provision the demo identity for this verification. No public route, OTP bypass, invented credential, or CUSTOMER-as-STAFF identity was used.

**Manual prerequisite:** an authorized stakeholder/operator must provide or approve a dedicated active STAFF test identity in the isolated database and approve the mock/development OTP flow for that test. If policy requires new provisioning, it must be explicitly authorized and performed through an approved isolated-environment procedure.

## 5. Browser verification results

**Not performed.** No actual browser session or page interaction occurred. The required Admin flow at `http://localhost:3001` remains unverified against a live backend. Specifically, no claims are made for OTP request/verification, `/auth/me`, protected route access, persisted category reads, inactive visibility, refresh on reload, logout, expired session behavior, separate 401/403 behavior over HTTP, network request contents, browser console, or 375x812/desktop rendering.

The prior report recorded that Vite could start but browser/socket access was blocked. In this closure turn no backend was started and no browser interaction was attempted because the isolated database and STAFF prerequisites were unavailable. A real browser run must inspect actual network traffic and confirm no category mutation requests before runtime acceptance can be closed.

## 6. Category API contract and permission verification

### Verified from source and tests

- Category tree and slug detail use existing GET endpoints and shared DTO/envelope types.
- The feature category client exposes no mutation method. Admin page tests assert there are no mutation controls.
- The Admin route/navigation and inactive toggle use backend-derived `CATALOG_READ`; the page avoids requesting data without that permission.
- Backend inactive inclusion checks for STAFF plus `CATALOG_READ`; unauthorized callers receive active-only results. The source and previous category integration test assertions support no inactive-row disclosure.
- Admin unit/UI tests exercise permission gating and mock a 403 separately from 401. These are frontend tests with mocked API responses, not proof of live backend authorization.

### Contract limitation

For unauthorized `GET /api/v1/categories?includeInactive=true` and slug equivalent, current source returns HTTP 200 with active-only data instead of HTTP 403. No inactive data exposure was found. This makes denial indistinguishable from a successful active-only response at the HTTP layer. **Recommendation for a separately approved backend/API change:** explicitly return 403 when `includeInactive=true` is requested by a caller who is not active STAFF with `CATALOG_READ`, while preserving the current active-only default when the parameter is omitted. This is a recommendation only; no backend behavior or shared contract was changed here.

## 7. Session lifecycle verification

Source review shows the Admin auth provider uses existing OTP request/verify, refresh, `/auth/me`, and logout endpoints; access token state is in memory and the refresh token uses the HTTP-only cookie convention. The shared API client preserves one bounded refresh retry, treats 401 as session expiry, and does not convert 403 into logout.

Those behaviors are covered by source review and Admin mocked tests only. No live session was established, so OTP, active STAFF `/auth/me`, cookie restoration, logout revocation, expired refresh, and live 401/403 transitions remain **unverified**.

## 8. Dependency security review

A fresh read-only command was attempted: `npm audit --workspace=@thehomez/admin-dashboard --json`. It failed because registry DNS lookup returned `ENOTFOUND registry.npmjs.org`. Advisory ranges and compatible fixes therefore remain pending a reachable registry.

Prior reports identify the following installed packages and advisory review priorities (not refreshed in this run):

| Package | Installed / dependency type | Impact and prior advisory summary |
|---|---|---|
| `react-router-dom` / `react-router` | Admin direct runtime `6.30.6` | Runtime dependency included in the Admin client bundle. Prior audit cited a React Router advisory and reported a fixed version requiring a major v7 migration. Confirm current affected range and fix before release. |
| `vite` | Admin direct dev dependency `5.4.21` | Development/build tooling, not a production runtime dependency. Prior audit cited Vite/esbuild and Windows `launch-editor` advisories; reported fix required a major Vite upgrade. Dev-server exposure still matters. |
| `vitest`, `tinypool`, `@vitest/mocker`, `vite-node` | Admin direct test dependency `vitest 2.1.9`; others transitive | Test-only, not in production bundle. Prior audit included critical Vitest/Tinypool and moderate transitive advisories; reported fix required a major Vitest migration. |
| `typescript-eslint`, `minimatch` | Root lint tooling / transitive | Development-only, not Admin runtime. Prior report described moderate findings and an available compatible fix; current package range and remediation need refresh. |

No `npm audit fix`, package upgrade, or lockfile modification was performed. The vulnerability review is **pending**, not cleared. Production readiness remains blocked until the registry-backed audit is refreshed and reviewed remediation is separately approved.

## 9. Automated test results

| Check | Result |
|---|---|
| `npm --workspace=@thehomez/admin-dashboard test -- --reporter=verbose` | **PASS** — 14 tests across 2 files. API transport/client behavior and category page behavior use mocks. |
| `npm --workspace=@thehomez/admin-dashboard run typecheck` | **PASS** — exit 0. |
| `npm --workspace=@thehomez/admin-dashboard run build` | **PASS** — Vite build completed. Non-fatal Zod annotation warnings; JS bundle 980.49 kB minified / 306.39 kB gzip, above the 500 kB warning threshold. |
| `npx eslint apps/admin/src apps/admin/vite.config.ts` | **PASS** — exit 0. |
| `npm --workspace=@thehomez/shared-types test -- --reporter=verbose` | **PASS** — 75 tests across 3 files. |
| Isolated category backend integration attempt | **BLOCKED/INCOMPLETE** — isolated URI selected, but sandbox denied local MongoDB socket; initial DB operations timed out. No successful DB interaction. |
| Fresh Admin npm audit | **BLOCKED** — registry DNS `ENOTFOUND`. |

No full backend test suite was run because it contains database-backed suites and destructive cleanup patterns. No backend startup, seed command, migration, or database cleanup completed.

## 10. Customer and Partner regression review

The initial and final `git status --short` snapshots retain the four specified pre-existing Customer modifications and the Admin/package/lockfile changes already present before verification. This task made no edits to Customer or Partner source. No Partner modification appeared in status. The Admin build generated its normal ignored output only. Git branch, index, remotes, and tracked changes were not intentionally altered; no commit, push, reset, stash, checkout, or branch operation was used. `.gitignore` was not changed.

## 11. Remaining limitations and required actions

- Provide a reachable isolated MongoDB service and verify the effective database after connection, before running destructive DB tests or backend startup.
- Approve a dedicated active STAFF test identity/provisioning procedure for that isolated database and the test OTP flow.
- Run actual browser verification at `localhost:3001` against the separate backend/proxy, with network inspection and both required viewport sizes.
- Obtain fresh npm audit data and approve a reviewed remediation plan; do not treat prior advisory summaries as current.
- Consider the explicit 403 behavior for unauthorized `includeInactive=true` as a separate API-contract decision.
- Resolve Decision #16 and define approved MFA/session governance before any production Admin use.

## 12. Production-readiness assessment

**Not production-ready.** Admin authentication remains development-only; Decision #16/MFA is unresolved; there is no live browser session evidence; database integration could not run; the fresh dependency audit is pending; and the inactive-query HTTP contract is less explicit than the desired denial behavior. The source-level confidentiality and GET-only findings do not substitute for these runtime/governance checks.

## 13. Final development acceptance verdict

**APPROVED WITH CONDITIONS.** The Category Browser implementation and safe automated frontend/shared-contract checks are accepted for continued development. Final runtime acceptance is not closed: isolated database integration, live STAFF session, persisted category response, permission behavior over HTTP, and browser/network verification remain outstanding. This verdict does not approve production deployment and does not claim that the essential runtime acceptance criteria have been verified.
