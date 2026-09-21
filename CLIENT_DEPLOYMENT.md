# Client deployment configuration

This repository provides a fail-closed production configuration baseline. It does not make an untested vendor integration safe for production. Every enabled connector must pass the client acceptance gates below before go-live, and remediation must remain disabled until executor certification is complete.

## Identity and access

The API requires a signed OIDC access token in `Authorization: Bearer <token>` when `AUTH_REQUIRED=true`. Configure `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URI`, the client role claim in `OIDC_ROLE_CLAIM`, and an explicit asymmetric algorithm allowlist. Unmapped users receive `READONLY`; no default administrator exists in the production profile.

Map client IdP groups to the exact application roles `Administrator`, `DevOps Platform Engineer`, `Network Reliability Engineer`, `Auditor`, or `Read-Only Executive`. Require MFA and conditional access at the IdP. Use an approved ingress/BFF Authorization Code with PKCE flow for browser access; the current browser does not contain a production login flow.

## Integration inventory

| System | Connection | Required configuration | Secrets and minimum access |
| --- | --- | --- | --- |
| ServiceNow | Direct HTTPS for incident/CMDB reads and optional work notes | Instance URL, assignment scope, CI class allowlist, ingest/write flags | Separate OAuth tokens: incident + CMDB read; incident `work_notes` write only |
| SolarWinds Platform/Orion | Direct HTTPS SWIS read API | API URL, auth mode, allowlisted SWQL `SELECT` | Dedicated read-only Orion account or approved relay bearer token |
| Cisco Catalyst Center (DNAC) | Governed gRPC proxy | Appliance URL, API version, device/site scope, trusted CA | Dedicated least-privilege username/password held only by proxy; token is returned by `/dna/system/api/v1/auth/token` |
| Cisco Catalyst SD-WAN Manager | Governed gRPC proxy | Manager URL, JWT/session auth selection, tenant/device scope, trusted CA | Dedicated API account held only by proxy; JWT is preferred on supported releases |
| Cisco FMC, Panorama, FortiManager | Governed gRPC proxy | Manager type allowlist, manager URLs and device scope, trusted CA bundle | Per-manager read account; separate approval-bound change identity |
| Command proxy | mTLS gRPC | DNS endpoint, CA, client certificate/key, timeout | Rotated service token and workload certificate; device secrets never enter the web process |
| PostgreSQL | TLS database connection | `DATABASE_URL`, SSL verification, pool and backup policy | App role with insert/select on ledger; migration owner kept separate |

The environment names are enumerated in `.env.example`. `GET /api/configuration/readiness` returns a redacted inventory to Administrator and Auditor roles. It reports names of missing settings and secret IDs, never values.

## Network and certificate prerequisites

- Permit egress only to the configured IdP JWKS host, ServiceNow, SolarWinds, approved monitoring APIs, PostgreSQL, and the gRPC proxy.
- Use DNS names in certificates. Import client-approved CA chains; certificate verification must remain enabled.
- Terminate public TLS at an approved ingress and use TLS or mTLS on every internal hop.
- Synchronize time through the client NTP service because JWT validation, evidence freshness, and ledger ordering depend on it.
- Define proxy-side device/site/tenant allowlists and separate read, remediation, and rollback credentials.

## ServiceNow preparation

Create separate OAuth clients or service identities for reads and work-note writes. Confirm incident pagination, assignment-group filters, CMDB reference expansion, custom field mappings, rate limits, and ACLs in a non-production instance. Supply canonical CI IDs so diagnostic evidence can pass the exact-CMDB governance gate.

## Production acceptance gates

1. Exercise OIDC login, expiry, key rotation, logout/revocation, disabled users, role changes, and streaming endpoints.
2. Verify every connector with a non-production tenant, including pagination, rate limiting, schema drift, TLS failure, timeout, stale-data, and credential-rotation cases.
3. Run restore tests for PostgreSQL and verify the event hash chain after restore. Export ledger events to the client's immutable audit/SIEM platform.
4. Load and soak test the API, proxy, event stream, speech worker, database pool, and vendor rate limits.
5. Generate an SBOM, scan dependencies/images, sign images, verify provenance, run penetration testing, and document patch SLAs.
6. Keep `ENABLE_LIVE_EXECUTION=false` until change adapters have idempotency, concurrency locking, maintenance-window checks, scoped approval, verification, and rehearsed rollback.
7. Approve SLOs, alerts, on-call ownership, disaster recovery objectives, data retention, privacy classification, and client incident runbooks.

Start from `compose.yaml` plus `compose.production.yaml` only as a deployment reference. Use the client's Kubernetes/secret platform and managed PostgreSQL for the actual highly available deployment.
