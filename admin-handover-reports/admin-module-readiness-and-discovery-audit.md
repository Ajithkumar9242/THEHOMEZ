# TheHomez Admin Application Readiness & Module Discovery Audit

**Audit date:** 2026-11-13  
**Scope:** Read-only discovery of Admin application and its supporting backend  
**Disposition:** **READY WITH CONDITIONS** for a bounded, read-only Admin category discovery/list module; the Admin application as a whole is not ready for implementation as a production control plane.

## 1. Executive summary

The repository does not contain a working Admin application. `apps/admin/src/index.ts` is an 11-line Milestone 1 metadata stub. There are no React components, Vite configuration, routes, layouts, API client, state, styles, tests, or Admin browser entry. The Admin package has no React, Vite, or Ant Design dependencies. Thus none of the sitemap screens are functional merely because they are described in documentation.

The baseline is only partly realized: the backend is Node/Express/TypeScript and MongoDB/Mongoose; shared contracts are in `packages/shared-types`; but the Admin Vite/React/TypeScript/Ant Design layer is absent. Some usable, persisted backend capabilities exist for RBAC role discovery, catalog categories/products/variants/units/pricing, service areas, and partner availability oversight. These are APIs, not end-to-end Admin modules. No Admin API call originates in `apps/admin`.

Admin authentication is not a dedicated Admin session flow. Shared phone OTP auth issues identity tokens and `GET /auth/me` returns the current user; `GET /auth/roles` is permission-gated. Authentication reloads the user and resolves database-backed permissions per request. No MFA/TOTP implementation or Admin login UI was found. Role management, customer administration, partner verification, orders, payments, finance, support tickets, notifications, reports, platform settings, and general audit-log APIs are absent.

The safest first module is **read-only category hierarchy and category detail discovery**, backed by existing persistent CategoryModel/service/controller endpoints and CATALOG_READ enforcement. Its bounded scope excludes category writes, product creation/publication, pricing, inventory, partner workflows, and orders. It can be developed and verified without Partner development or order creation. This is readiness for discovery/specification-to-implementation planning, conditional on retaining the existing category contract and role permission policy; it does not imply stakeholder approval of any new business rule.

## 2. Sources/files inspected

The following source documents were reviewed: `docs/requirements-analysis.md`, `docs/requirements-traceability-matrix.md`, `docs/application-sitemap.md`, `docs/business-decisions.md`, `docs/thehomez-complete-platform-module-audit.md`, `docs/thehomez-remaining-development-roadmap.md`, and `docs/thehomez-independent-roadmap-review.md`. Related architecture/verification materials reviewed include `docs/system-architecture.md`, `docs/phase-1-implementation-readiness.md`, `docs/milestone-2-runtime-verification.md`, `docs/milestone-3-verification.md`, `docs/milestone-3-step-7-security-verification.md`, the Milestone 4 implementation/API/data-model/acceptance/step verification documents, Milestone 5A authentication security/readiness/remediation/sign-off reports, and Milestone 5B foundation/security and business-decision closure reports. Historical claims in those reports were treated as evidence to compare against current source, not as proof of current functionality.

Current source inspection covered:

- Admin: `apps/admin/package.json`, `apps/admin/tsconfig.json`, `apps/admin/src/index.ts` and the complete `apps/admin` file inventory.
- Backend entry/routing: `backend/src/app.ts`, `backend/src/routes/index.ts`, all Admin-relevant route files under `backend/src/routes/`, controllers under `backend/src/controllers/`, relevant catalog/pricing/service-area/RBAC/token services under `backend/src/services/`, Mongoose models under `backend/src/models/`, and middleware under `backend/src/middleware/`.
- Contracts: `packages/shared-types/src/auth/`, `packages/shared-types/src/catalog/`, commerce/common contracts and package metadata.
- Root and workspace `package.json` scripts.

**Repository state:** At inspection start, `git status --short` showed pre-existing edits to `apps/customer/src/context/StorefrontContext.tsx`, `apps/customer/src/test/navigation-routing.test.tsx`, `apps/customer/src/test/product-listing-responsive.test.tsx`, and `apps/customer/src/views/ProductListingView.tsx`. They were not changed. No Git state-changing command was used.

The requested `docs/thehomez-remaining-development-roadmap.md`, `docs/thehomez-complete-platform-module-audit.md`, and `docs/thehomez-independent-roadmap-review.md` exist. No standalone Admin specification or Admin milestone verification report was found; current Admin planning is embedded in broader roadmap, sitemap, and requirements documents.

## 3. Admin architecture and runtime entry points

| Layer | Observed implementation | Audit finding |
|---|---|---|
| Admin package | `apps/admin/package.json` | Only scripts `build` and `typecheck`; sole dependency is `@thehomez/shared-types`. No Vite, React, Ant Design, router, HTTP client, or UI test framework. |
| Admin source | `apps/admin/src/index.ts` | Exports `ADMIN_DASHBOARD_METADATA` with `UserType.STAFF` and seeded role count. Explicitly calls itself a Milestone 1 workspace verification stub. |
| Admin runtime | No Admin HTML, Vite config, route tree, page/layout/component, state/context, network client, or test found | No runnable Admin UI or user action exists to trace. |
| API runtime | `backend/src/app.ts` mounts `/auth`, `/service-areas`, `/partners`, `/categories`, `/products`, `/units`, `/pricing`, partner availability, storefront, customer address/cart/checkout | Express JSON API with 1 MiB body parser, Helmet, configured CORS, cookie parser, correlation IDs and request logging. No Admin-specific API router. |
| Persistence/contracts | Mongoose models exported from `backend/src/models/index.ts`; shared interfaces/enums in `packages/shared-types/src/` | Catalog, user, role, partner, service area, price history and commerce-foundation data persist. No order/payment/refund/settlement/invoice/support/ticket/system audit models in current model index. |

Backend builds have existing `backend/dist` artifacts, but those are not evidence of an Admin web runtime. The root `build` builds shared types and backend only; it does not build an Admin UI. The Admin package's TypeScript build checks the stub, not a web application.

## 4. Module-by-module status inventory

Categories use the user’s A–H labels. Since the Admin frontend is absent, no Admin module qualifies as A or B. “Persisted API” means current source reaches Mongoose-backed service logic; it does not imply a verified UI workflow.

| Admin module | Classification | Requirement IDs / traceability | Current source evidence and status |
|---|---|---|---|
| Authentication/session and RBAC | **C — partially implemented**; no Admin UI | FR-AUTH-001, FR-AUTH-007, FR-AUTH-009, FR-ADM-009; Decision 16 is TBD | Shared OTP/refresh/logout/me endpoints and backend auth/RBAC exist. `/auth/roles` requires RBAC_MANAGE. No Admin login/MFA/session UI, staff-user CRUD, role assignment, account suspension workflow or general audit trail. |
| Dashboard/operational overview | **F — not implemented** | FR-ADM-001 | Sitemap specifies KPIs; no dashboard endpoints, aggregation services, pages, or components. Orders/sales/settlement data models are absent. |
| Customer management / B2B review | **F — not implemented** | FR-ADM-003, FR-B2B-001, FR-B2B-004; FR-B2B-002 exact docs TBD; Decision 2 TBD | `UserModel` exists but no staff customer list/search/detail/approval routes or Admin service/UI. Customer APIs are self-service and do not equal management. Sensitive KYC docs workflow is absent. |
| Partner onboarding/verification/management | **F — not implemented** | FR-PART-001, -002, -007; Decisions 2, 16, 20 affect policy/security | `PartnerModel` exists. Current `partner.routes.ts` exposes service-area assignment and retrieval only. No create/invite, verification document access/review, approve/reject/suspend, or partner directory management endpoints/UI. Roadmap explicitly classifies it not implemented. |
| Product catalogue/categories/variants/SKU governance | **D — backend implemented; frontend missing** | FR-CAT-001..006; FR-ADM-002; FR-CAT-007 depends on Decision 20; FR-CAT-008 depends on orders | Category/product/variant/unit models, schemas, services, controllers, permission-protected routes and shared contracts exist. Persistent backend catalog governance has unit and test coverage in source inventory. No Admin UI or API client. SKU registry exists. Product/order snapshots are not order functionality. |
| Service areas and PIN configuration | **D — backend implemented; frontend missing** | FR-PART-003, FR-ADM-006, FR-SET-001; `SERVICE_AREA` permissions | Service area CRUD/list/detail/PIN APIs and partner mapping APIs use service-area/partner models. No Admin UI. Location/geography policy may depend on Decision 1. |
| Pricing/commercial configuration | **D — backend implemented; frontend missing**, policy-dependent extensions blocked | FR-ADM-002; FR-PART-006; Decisions 10 and 32/39 as relevant | Persistent platform pricing APIs are on product routes, gated by PRICING_READ/WRITE; price history model exists. `pricing.routes.ts` itself only exposes public calculation. No Admin pricing screens. Commission, partner rates, tax-inclusive pricing and settlement calculations are not authorized by the existing pricing engine. |
| Orders and vendor allocation | **F — not implemented** | FR-ADM-004, FR-ORD-007; Decisions 4, 6, 7 unresolved | No order/FulfilmentUnit models, routes, services or UI. Do not implement while allocation, partial acceptance, and delivery fee rules are unsettled. |
| Inventory/availability | **C — backend has binary availability; Admin oversight partial; no Admin UI** | FR-CAT-005; adjacent availability requirements; Decisions 5, 6 unresolved | Partner availability APIs persist `isAvailable` boolean and history. Staff oversight list/emergency toggle exists at `/admin/partners/:partnerId/availability`, gated by staff-only guard and permission. This is not numerical stock/inventory, and is excluded from the first module. |
| Payments/refunds/GST/invoices/finance | **F — not implemented** | FR-ADM-005, FR-PAY-001, FR-BILL-001..006; Decisions 8, 9, 11..14, 32 unresolved | No payment transaction, invoice, refund, ledger, or finance Admin routes/models. Customer checkout preparation is not payment execution. Tax/statutory invoicing expressly deferred by roadmap pending approval. |
| Partner settlements/commissions | **F — not implemented** | FR-PART-005, -006; FR-PAYOUT-004; Decisions 10, 14 TBD | No ledger, settlement, batch or payout models/routes/UI. Existing permission enum/role labels do not implement the feature. |
| Customer support/complaints | **F — not implemented** | FR-ADM-003 loosely; no distinct mapped support-ticket requirement found | No ticket/complaint model, route, service or Admin UI. Broad sitemap/roadmap mentions do not supply complete workflow acceptance criteria. |
| Notifications/templates | **F — not implemented** | FR-ADM-008, FR-NOTIF-005, -006; Decision 18 TBD | OTP provider is the only notification-like backend behavior. No template CRUD, delivery logs, consent workflow, or Admin template interface. |
| Reports/analytics/exports | **F — not implemented** | FR-ADM-007; AT-013 | No report/aggregation/export endpoints or UI. Dataset semantics, audit stamping and privacy controls need definition. |
| Audit logs/settings/platform configuration | **C — narrow price/availability histories only; platform features missing** | FR-ADM-008, FR-ADM-009, FR-SET-001..004; FR-AUTH-009 | Price and availability history models cover narrow domains; no general append-only audit log model/service/API or settings model/routes/UI. No general high-risk confirmation/audit workflow. |

**Requirement traceability note:** The IDs above come from the current traceability matrix. It is broad and sometimes maps entire roadmap concepts as “CONFIRMED,” while the business-decision register leaves policies TBD. A confirmed feature label is not treated as confirmation of unresolved workflow details. Where support/complaint work has only broad narrative references and no dedicated traceable requirement, this is stated explicitly rather than assigning a fabricated ID.

## 5. Frontend-to-backend traceability

There is **no actual Admin UI action → API client → route** chain in the repository: no Admin API client or action exists. The following are backend-only capability traces, and describe their current enforcement/persistence boundaries:

| Capability | Route → controller → service/model | Authorization/validation observations |
|---|---|---|
| Category tree and detail | `backend/src/routes/category.routes.ts` → `category.controller.ts` → `services/catalog/category.service.ts` → `CategoryModel` | Public tree/detail return active data. `includeInactive=true` is honored only for STAFF with CATALOG_READ. ID lookup requires authenticate + CATALOG_READ. Create/update/delete require CATALOG_WRITE and body schemas for create/update. Delete is guarded against child categories. |
| Products and variants | `product.routes.ts` → `product.controller.ts`/`product-variant.controller.ts` → catalog services → Product/Variant/SKU registry models | Admin list/detail/create/update/publish/deactivate/archive/delete endpoints use CATALOG_READ/WRITE/PUBLISH. Query/body/params schemas are applied; product list has bounded query schema. Persistent catalog lifecycle, not UI. |
| Platform pricing | Product-nested pricing routes → `pricing.controller.ts` → pricing service/validator/engine → `ProductPricingModel`, `PriceHistoryModel` | Reads/writes require PRICING_READ/WRITE, schemas validate body and query. Dedicated `pricing.routes.ts` exposes only public calculation. No Admin interface; do not extrapolate to partner commercial terms. |
| Units | `unit.routes.ts` → `unit.controller.ts` → unit service/model | Public reads; PATCH requires CATALOG_WRITE and params/body validation. |
| Service areas | `service-area.routes.ts` → `service-area.controller.ts` → `service-area.service.ts` → `ServiceAreaModel`, `PartnerModel` | CRUD/list require SERVICE_AREA_READ/WRITE; create/update validate bodies. Partner assignment/retrieval routes are in `partner.routes.ts`. Read list route does not attach a visible `validateQuery` middleware in the route file; service accepts pagination/filter fields, so callers’ query bounds deserve review. |
| Partner availability oversight | `partner-availability.routes.ts` → availability controller/service → PartnerProduct and availability history models | Staff-only guard precedes permission checks. Read and emergency toggle use a bounded parameter/query/body schema; toggle supports reason/version. Partner tenant guard passes through STAFF. There is no Admin UI. |
| Authentication/roles | `auth.routes.ts` → `AuthController` → token/RBAC services and User/Role/RefreshToken models | OTP endpoints are rate limited/validated; refresh/logout are CSRF-protected; `GET /me` authenticates; roles endpoint requires RBAC_MANAGE. No Admin login flow or UI. |

All administrative claims above were verified against current `backend/src/app.ts` mounts as well as route definitions. General customer APIs and storefront endpoints are not classified as Admin functions.

## 6. Security/RBAC/tenant-isolation findings

Severity reflects source-level exposure and missing control surface; no exploit execution was performed.

| Severity | Finding and evidence | Impact / boundary |
|---|---|---|
| **High** | **No Admin UI or Admin-specific MFA workflow.** `apps/admin` is a stub. `docs/business-decisions.md` Decision 16 remains TBD; shared OTP auth is not an MFA implementation. | There is no secure Admin operator experience to assess or deploy. Backend fine-grained permissions do exist, but no phishing-resistant/second-factor assurance was evidenced for privileged staff. |
| **High** | **General privileged-action audit trail absent.** `backend/src/models/index.ts` exports no general audit-log model; current histories are price and partner availability-specific. FR-SET-003/004 and FR-ADM-009 require broader auditability. | Category deletes, product lifecycle actions, settings/role changes and other privileged operations lack a demonstrated unified immutable actor/payload-diff audit record. Do not equate per-domain history with system audit. |
| **High** | **Sensitive-data admin workflows absent.** Partner and user models exist, but no admin document-review/access routes or controls were found. | Cannot verify document storage access controls, redaction, review trace, or purpose-limited exposure. Avoid building a document viewer until requirements/storage policy are resolved. |
| **Medium** | **Permission surface is wider than an Admin UI can safely expose by default.** `SYSTEM_ROLE_SEEDS` grants SUPER_ADMIN all permission codes; specialist roles have broad capability lists; current backend `authorize` checks exact permission codes and STAFF identity is required by role resolution/selected routes. | Backend enforcement is materially stronger than frontend-only role filtering, but least privilege and separation-of-duties remain unresolved in Decision 16. Any future UI must treat UI gating as usability only, never as security. |
| **Medium** | **RBAC role discovery exists, role administration does not.** `/auth/roles` requires RBAC_MANAGE, but no staff role/user assignment route was found. | No current role mutation endpoint to exploit in this API surface; do not mistake role seeds/discovery for role management. |
| **Medium** | **Partner tenant guard is identity-aware but intentionally passes through STAFF.** `partnerTenantGuard` enforces partner ID matching for PARTNER users; resource-level scoping is delegated to service queries. Admin availability routes add `staffOnlyGuard`. | Staff may access cross-partner records when authorized, by design. Each future route still needs explicit permission and resource scoping; current source comment warns that opaque IDs must be tenant-filtered in services for partner users. |
| **Medium** | **Query validation is inconsistent across mounted admin-like endpoints.** Product, pricing, and availability routes explicitly validate bounded queries; service-area list does not use `validateQuery` in its route. | Review `service-area.service.ts` list query and database limit/default behavior before exposing a screen; no claim of unbounded exploitation was established from this read-only inspection. |
| **Low/positive control** | **Body and transport protections exist.** `app.ts` uses Helmet, configured CORS, 1 MiB JSON/form limits, correlation IDs and request logger; validate middleware parses Zod schemas. Auth includes OTP rate limiters, CSRF for refresh/logout, and refresh rotation. | These controls reduce common risks but do not substitute for auditability, MFA, endpoint-level authorization, or functional security verification. |
| **Low/positive control** | **Request logger excludes bodies by default.** `request-logger.ts` records method, URL, status, duration, IP, user agent; `logger/redaction` tests are present. | URL query strings are included in logged URL (`originalUrl`); sensitive values should not be placed in query parameters. No evidence here that tokens or bodies are logged. |

No direct mass-assignment vulnerability was confirmed in the inspected category/product/service-area flows: mutation routes apply Zod schemas and services perform domain checks. This does not certify every schema’s unknown-key policy; partner-availability schemas explicitly call out rejection of injected fields. Destructive category deletion and product lifecycle transitions have business guards, but a general confirmation/audit trail is not evidenced. Security findings are static source observations, not penetration-test results.

## 7. Decision/dependency blockers

- **Decision 16 (Admin roles/MFA):** remains TBD and affects the final role model, mandatory MFA, JWT claims and privileged routes. Existing enum/seed roles are implementation scaffolding, not stakeholder closure.
- **Decision 2 (B2B verification):** required documents and review policy remain TBD; this blocks customer B2B and partner KYC workflows (and the data exposure choices around them).
- **Decisions 4, 5, 6, 7:** allocation, inventory ownership, partial acceptance/substitutions and delivery fee/ETA rules remain unresolved; block order control tower, inventory behaviors, dispatch and allocation.
- **Decisions 8–14 and 32:** returns/refunds, GST/invoicing, commissions, credit/pay-later, partial payment/COD and payout cadence remain unresolved. Roadmap defers statutory tax invoices to Milestone 8. Finance/settlement interfaces must not be started on assumptions.
- **Decision 18:** notification consent, language and DLT/template rules remain TBD; blocks notification-template management.
- **Decision 20:** storage provider/fallback remains TBD; blocks secure KYC/product-media workflows.
- **Decision 1:** launch geography/legal identity remains proposed; global service-area configuration should not invent market coverage.
- **Roadmap conflict:** `thehomez-independent-roadmap-review.md` documents older roadmap contradictions and recommends governance alignment. `thehomez-remaining-development-roadmap.md` is remediated but its milestones still describe future work, not current implementation.

## 8. Ranked candidates for first Admin module

Scoring is ordinal (High/Medium/Low) from repository evidence: requirement clarity, existing maturity, independence from open decisions, backend dependency burden, security/privacy risk, and independent verification without Partner development/orders.

| Rank | Candidate | Clarity | Maturity | Decision independence | Dependency / risk | Partner/orders-free verification | Assessment |
|---:|---|---|---|---|---|---|---|
| 1 | **Read-only category hierarchy and detail browser** | High: FR-CAT-001, FR-ADM-002; explicit category sitemap | High backend: persisted CategoryModel/service/DTO + public tree and staff ID route | High if limited to read-only active tree/detail; no service/partner/order action | Low-medium: catalog content policy/permission mapping still applies; category payload is operational data | High: seed/fixture-backed reads and permission tests, no Partner work or orders | Safest concrete vertical slice. |
| 2 | Read-only product/variant catalogue browser | High: FR-CAT-002..004, FR-ADM-002 | High backend, but broader endpoints and price/availability associations | Medium: publish/lifecycle, media and HSN policy dependencies | Medium: more product and potentially sensitive commercial metadata | High, but larger data surface | Reasonable later slice; avoid pricing/availability writes. |
| 3 | Read-only service-area directory | High: FR-PART-003 | High backend CRUD/read | Medium: geography/launch-area Decision 1 and operator coverage policy | Medium: service-area data impacts customer eligibility | High, though no writes | Possible after geography constraints are confirmed. |
| 4 | Dashboard summary | High at label level FR-ADM-001, low metric definitions | Low: no endpoints/models for its primary KPIs | Low: requires order, sales, settlement domains | High dependency/security risk due finance metrics | Poor | Not a safe first module. |

Partner onboarding, customer/KYC management, finance, orders, allocation, settlements, inventory operations, reports, and global settings are not ranked as first-module candidates due absent implementation and/or unresolved decisions and higher privacy/business risk.

## 9. Recommended first module and exact scope

**Implement a read-only Admin Category Browser** after the product owner accepts the existing permission contract for read-only use.

Included scope:

1. Admin route and shell entry for category discovery only.
2. Authenticated STAFF session handling using the existing auth contract; backend remains authoritative.
3. Category hierarchy list from `GET /api/v1/categories`; optional inactive visibility only when existing backend authorization accepts STAFF + CATALOG_READ.
4. Category detail from the existing ID or slug read endpoint; display fields returned by the current shared DTO.
5. Loading, empty, error, unauthorized and retry states; no mutation controls.
6. Unit/integration coverage for API contract mapping and role-aware visibility, plus an independent route/API verification plan.

Explicitly outside this slice: create/edit/delete, product/variant screens, SKU editing, media uploads, HSN/tax interpretation, pricing, partner mappings, service-area writes, availability/inventory, customer/partner records, orders, and audit settings. Existing public tree endpoints may be reused only with a real authenticated staff session and server-authorized inactive-data request; front-end route hiding is not an authorization boundary.

Requirement fit: FR-CAT-001 and the category portion of FR-ADM-002. No separate requirement specifies exact visual table fields or filter behavior, so these should be limited to shared contract fields and conventional read-only presentation, not expanded into new business rules.

## 10. Suggested Chat A / Chat B / Chat C workflow

- **Chat A — Admin shell and auth boundary:** establish the minimal Vite/React/TypeScript/Ant Design Admin runtime, route guard and API transport around existing auth endpoints. Resolve Decision 16 as a prerequisite for privileged production use; do not invent MFA or staff provisioning policy.
- **Chat B — Category Browser:** implement only the read-only category tree/detail slice in Section 9, map the existing shared contracts, and add focused tests. No category mutations or adjacent catalog modules.
- **Chat C — Independent verification:** separate review of route-to-API wiring, backend permission behavior, data states, accessibility/basic responsive behavior, tests/build evidence and scope adherence. Do not edit unrelated Customer/Partner code or data.

Chats are a suggested workflow partition, not authorization to build adjacent features or to treat recommendations as stakeholder decisions.

## 11. Acceptance criteria and independent verification plan

1. Admin app has a reproducible Vite/React/TypeScript/Ant Design runtime and does not modify Customer or Partner application behavior.
2. Unauthenticated access to protected Admin route returns to sign-in; an authenticated non-staff or staff user without CATALOG_READ cannot see inactive categories and receives backend denial for protected reads.
3. Authorized staff sees categories from persisted backend API responses; no hard-coded/mock/demo list is presented as live data.
4. Hierarchy and detail map from `packages/shared-types` contracts; loading, empty, malformed/error, 401, 403 and retry cases are handled.
5. No write request is sent by this module; no create/edit/delete buttons or endpoints are wired.
6. Browser network inspection confirms calls target mounted endpoints in `backend/src/app.ts`; API tests verify permission boundaries and response shape.
7. Independent reviewer traces each visible UI action and confirms there are no mock fallbacks that silently claim persistence.
8. Tests/build are run only after inspectable package scripts are confirmed not to seed, migrate, clear, or otherwise mutate external data; report exact commands and results.

This audit did not execute those tests/builds, as recorded in Section 13.

## 12. Explicit exclusions

No Customer or Partner development; no order creation or order management; no payment/refund, settlement, vendor allocation, or inventory behavior; no database migration, seed, destructive DB command, Gate 3 demo-data change, code/schema/API/config/shared-contract edit, Git mutation, business-decision edit, or implementation. No claim is made that historical verification reports prove current Admin runtime behavior.

## 13. Tests/builds run or not run

No tests or builds were run. The root scripts show `npm run build` builds shared types and backend; Admin has a separate TypeScript-only `npm --workspace=@thehomez/admin-dashboard run build` script; backend tests use `vitest run`. Although these are not seed commands by their declared scripts, builds write generated `dist` output and the request is a read-only audit. Tests could connect to test MongoDB or have side effects not established from script names alone. Therefore none was executed. No Gate 3 seed, database migration, or DB-mutating command was run.

## 14. Final disposition

**READY WITH CONDITIONS** for discovery/implementation planning of the strictly read-only Category Browser, conditional on confirming the existing CATALOG_READ contract and resolving Admin authentication/MFA governance before production access. **BLOCKED** for production Admin launch and for the rest of the Admin platform until the relevant requirements, business decisions, audit controls, and backend capabilities are closed. The repository itself is not ready to implement a complete Admin application without first creating its absent runtime foundation.
