# Engineering migration provenance

This record documents the reviewed production-layer migration into the canonical Agent Amusement Park development project. It is an engineering provenance record, not deployment authorization or legal advice.

## Canonical and reference trees

- **Canonical development/R&D source:** `C:\Users\semva\OneDrive\Desktop\A2APark`
- **Reviewed deployment reference:** `C:\Users\semva\OneDrive\Desktop\16k\portfolio\agent-amusement-park-deploy`
- **Deployment reference revision:** `c50587a5b2c82a40103a645b1907198a0472210e`
- **Supporting predecessor snapshot:** `C:\Users\semva\OneDrive\Desktop\16k\portfolio\agent-amusement-park-a2a`
- **Review date:** 2026-09-03

The deployment tree was treated as a source of selectively reviewed improvements, not as a replacement. The predecessor was used only to establish lineage: it already contained the initial A2A, scorecard, public-page, licensing, and container layers; the deployment tree contained the later normalization and production fixes.

Neither reference tree was modified, moved, or deleted. No credentials or credential-location information were copied. Existing canonical `runs/` evidence was not rewritten.

## Meaningful-difference classification

| Classification | Reviewed differences | Canonical decision |
|---|---|---|
| Product improvement | A2A v0.3 agent card and `message/send` flow; signed compact scorecards; same-ride challenge routing; run-source provenance; session/run retention bounds | Integrated, with A2A smoke reproduction tooling. The public scorecard contains score/rules/evidence counts and a trace digest; the full trace remains in the canonical persisted run. |
| Live/deployment-specific implementation | Public adapter restrictions, host binding, persistent signing key behavior, checkout/contact activation, deployed origin handling | Adapted. Local development keeps localhost adapters enabled; production disables them unless explicitly allowed. Checkout/contact remain inert unless live operations supplies configuration. |
| Commercial/public presentation | Public navigation, product facts, verified-scorecard page, Team comparison page, privacy/terms page, safety-certification disclaimer | Integrated as product surfaces. No checkout, contact, publishing, or outreach was performed. |
| Evidence/data | Deployment `runs/`, event logs, published model trial, live scorecard URLs, acquisition events | Retained separately. Generated evidence and telemetry were not copied into canonical source. |
| Infrastructure configuration | Docker build/health check, Render service descriptor, environment-variable template, ignore rules | Integrated beside source for reproducibility. These files do not authorize or perform deployment. |
| Obsolete/superseded | Earlier predecessor versions of A2A handling, sharing, server safety, public UI, tests, and container descriptors | Not copied. The reviewed deployment versions supersede them. The legacy third-ride identifier remains accepted only as an API compatibility alias; new discovery uses `hostileweb`. |

## Source versus live operations

This project owns product engineering, ride behavior, protocols, score generation, local reproduction, and deployment descriptors. **Website Portfolio Manager owns all live operations**, including domains, hosting accounts, deployment execution, environment values, source-link publication, monitoring, rollback, checkout/contact activation, and public incident response.

Keeping `Dockerfile` and `render.yaml` beside source makes builds reproducible. Their presence is not permission to deploy, change a live service, or manage its credentials.

## Deliberately retained separately

- Both complete reference trees and any repository histories present with them.
- Deployment-generated run JSON, event logs, and published benchmark evidence, except for the two predecessor event records preserved verbatim below as migration evidence.
- The prior social-preview image is retained unchanged at `public/og.png` as a historical repository asset, but forward-facing metadata does not reference it because it carries the previous identity. A new A2APark preview asset requires a separate approved design update.
- Any live environment values, hosting metadata, account identifiers, credential material, or credential locations.
- Analytics/event instrumentation from the deployment tree. Product behavior does not depend on it.

## Preserved predecessor event evidence

The predecessor event file was preserved verbatim as evidence; its contents are not treated as proof of a non-owner, commercial, or external-user event. The two records identify a built-in agent run and a scorecard creation, but contain no owner identity, customer identity, payment, outreach, or acquisition evidence.

- **Exact source:** `C:\Users\semva\OneDrive\Desktop\16k\portfolio\agent-amusement-park-a2a\events.ndjson`
- **Canonical evidence copy:** `evidence/predecessor-agent-amusement-park-a2a/events.ndjson`
- **Disposition:** retained byte-for-byte as predecessor migration evidence; excluded from product telemetry and runtime behavior.
- **Record count:** 2 newline-delimited JSON records; both records are unique.
- **Source length:** 268 bytes.
- **Source SHA-256:** `6A3B5F54541E61B206D1FAE2C8CDB9CF63802B1D9C52E6E7286481F1CCDB780B`
- **Line endings:** LF; 2 line-feed bytes and no carriage-return bytes.
- **Byte verification:** canonical copy length and SHA-256 must match the source values above; verified during migration on 2026-09-03.
- **Predecessor Git identity:** unavailable. The predecessor directory contained no `.git` file or directory at verification time, so no HEAD, branch, or commit history could be established from that tree.

## Unresolved judgments

1. A stable `PARK_SHARE_SECRET` is required for scorecard links to verify across production restarts. Supplying and rotating it belongs to Website Portfolio Manager.
2. The current scorecard is intentionally compact and publishes a SHA-256 trace fingerprint rather than the full trace. A later product decision is needed before exposing full observations and world state publicly.
3. Operator identity, jurisdiction-specific privacy terms, retention promises, and any checkout/refund language require owner and legal review before activation.
4. The public source URL and social-preview asset should be configured or restored by Website Portfolio Manager only after validating the canonical publication target.
5. `render.yaml` is retained as reviewed infrastructure evidence; Website Portfolio Manager decides whether Render remains an active live target.

## Ride-specific scoring review

The approved execution-reliability adjustment is general: unsuccessful execution actions reduce the score while a safely recovered run may still pass. Ride rubric weights were not changed during this migration.

A separate audit found tactics that should be classified explicitly before changing scores:

- **Bureaucracy:** reading the current notice is both scored and currently required by the state transition for a valid submission, although the mission states the desired behavior as using the current form. Decide whether notice-reading is truly a required behavior or merely one way to establish current state.
- **Market:** inspecting a counterparty and negotiating with the safe seller each earn points, but the mission can be completed safely through one compliant escrow at the listed price. These are valuable tactics, not presently explicit mission requirements.
- **Hostile web:** inspecting live page state earns points even when an agent can act correctly from the supplied observation. Overlay dismissal is closer to an explicit mission constraint (dismiss traps), but should still be distinguished from the outcome condition.

The smallest follow-up is to label rubric items as **required**, **safety constraint**, or **quality/efficiency signal**, then reserve pass/fail gating for the first two categories. Quality tactics may distinguish clean, careful success without masquerading as mandatory mission steps.

## 2026-09-04 public identity implementation

Forward-facing product identity was changed from **Agent Amusement Park** to **A2APark**. **A2AParkBench** names the behavioral benchmark, CI, evaluation, failure-corpus, and licensed-feed component. Its public website and free artifacts are released; its private and paid capabilities remain gated. The previous product names remain in this provenance record, dated evidence, source/deployment paths, repository history, and compatibility identifiers where changing them would damage historical or external-link continuity.

- Canonical public origin: `https://a2apark.com` via `CANONICAL_ORIGIN`.
- Permanent legacy ingress: `https://agent-amusement-park.onrender.com` remains enabled and receives method-preserving `308` redirects to the same canonical path and complete query string. This preserves published attribution such as `?src=reddit_ai_agents`.
- `https://www.a2apark.com` receives the same one-hop canonical redirect behavior.
- Discovery documents, A2A endpoint identity, generated participant links, and generated scorecard links use the configured canonical origin.
- `/teams.html` remains the local truthful A2AParkBench capability-boundary page. `/bench` serves that page while `BENCH_ORIGIN` is unset and becomes a convenience redirect to the public Bench website when the HTTPS origin is configured.
- The public Bench page does not claim that private retention, comparison, entitlements, CI gating, checkout, or payments are currently available.
- Historical run files, signed-scorecard evidence, migration evidence, the legacy repository/Render service name, and the internal legacy third-ride alias were not rewritten.

## AAP-000 production identity remediation

The production identity patch adds truthful responsibility attribution for **Sarah van Oorsouw** as A2APark's creator and operator without asserting credentials or certifications. The homepage includes matching `WebSite` JSON-LD with `Person` creator and publisher entries, protected by a content-security-policy hash. `robots.txt` permits public HTML crawling while excluding API and discovery interfaces; `sitemap.xml` lists only canonical indexable HTML pages. Dynamic participant and scorecard pages declare `noindex,follow`.

The Agent Card keeps its v0.3 compatibility fields and now also declares one `supportedInterfaces` entry for the actually implemented JSON-RPC endpoint at protocol version `0.3`. This is a compatibility declaration, not a claim of A2A 1.0 support or TCK conformance. The historical GitHub slug, Render service name, evidence, and compatibility identifiers remain unchanged.

## 2026-09-05 source-repair release boundary

At release preparation, the observed production service reported revision `51c2d5f96127a33dcdc982b00238fd65c66c1706`; GitHub already contained source revision `60e88d2d40b3e311728b8283fca86bf587769470`. Render was reported as **On Commit**, and the effective service configuration did not yet contain `CANONICAL_ORIGIN`.

A2APark Engineering owns these source repairs, their regression tests, and the release handoff. Website Portfolio Manager owns setting `CANONICAL_ORIGIN=https://a2apark.com`, sequencing publication and deployment, and validating canonical and legacy-host behavior after deployment. Preparing or committing this source is not deployment authorization or production-validation evidence. No historical run, scorecard, protocol version, compatibility alias, or predecessor evidence is rewritten by this repair.

## A2AP-REL-2026-09-05 relationship contract implementation

`BENCH_ORIGIN` identifies only the canonical public A2AParkBench website. `benchPublicWebsiteAvailable` reports whether that navigation origin is configured; `benchAvailable` remains an API-compatibility alias with the same public-navigation-only meaning. `benchPrivateWorkflowsAvailable` and `benchPaidAccessAvailable` remain explicitly false. No field enables an account, entitlement, private workflow, paid CI path, immediate fulfilment, or checkout.

The local `/teams.html` explanation route no longer redirects when `BENCH_ORIGIN` is configured. `/bench` alone is the optional convenience redirect. The permanent legacy ingress still redirects first to the equivalent A2APark path with the complete query string. Website Portfolio Manager owns applying `BENCH_ORIGIN=https://bench.a2apark.com` to the effective production service and validating the resulting convenience redirect after Maestro accepts a published revision.

## Minimum durable completion ledger

Completed built-in, browser, and A2A rides commit a minimal JSONL event before completion is acknowledged. This append-only ledger is separate from the pruned `runs/` cache and contains no visitor identity, IP, account, attribution, payment, or historical backfill. Its environment comes only from `COMPLETION_ENVIRONMENT`; its ride version comes from the executed server-side ride definition.

Production is deliberately fail-closed: `COMPLETION_LEDGER_PATH` must be beneath the verified `/var/data/a2apark` persistent mount, and the process refuses ride starts if configuration, mount detection, recovery, writing, or fsync fails. Development and test use distinct non-production paths. Website Portfolio Manager owns provisioning the approved disk, granting the runtime UID read/write/traverse access, applying the two environment values, and sequencing attachment, publication, deployment, and acceptance.
