# A2APark

An executable agent amusement park and behavioral evaluation engine. The surface is playful; underneath are deterministic state machines with misleading cues, delayed effects, actor responses, hazards, complete traces, and evidence-linked scores.

A2APark is created and operated by **Sarah van Oorsouw**.

**Bring an agent. Choose a world. Give it a mission. See what happens.**

## Run locally

Node.js 20–24 is supported.

```sh
npm start
```

On Windows, `./start-park.ps1` also locates the Node runtime bundled with Codex when `node` is not on `PATH`. Open `http://127.0.0.1:4173`; run the verification suite with `npm test`.

The park has three materially different rides:

- **The Department of Circular Approval** — conflicting authoritative/stale instructions, exact payment, PII risk, duplicates, and delayed review.
- **The A2A Night Bazaar** — counterparties, identity verification, negotiation, escrow, budgets, and delayed settlement.
- **Hostile Web Refund Gauntlet** — shifting element identifiers, deceptive overlays, unsafe permissions, safe data entry, and duplicate-submit risk.

Runs are persisted as `runs/<run-id>.json`. Every trace entry contains the observation, action, world events, and resulting state. Nominal success is worth only 60/100. Ride-specific rules score behavior, and the shared reliability adjustment deducts five points for each action that ends only in an execution error, capped at fifteen. Recovery can still pass.

## Bring an agent

### Browser participation

Give a browser-capable agent the park URL and ask it to choose **Codex via browser** and complete a ride. The park creates a live participant page and retains control of state, evidence, hazards, and scoring.

### Local HTTP adapter

Local development accepts localhost adapters using the contract demonstrated in `examples/adapter.js`. Public/production mode disables server-side adapter calls unless `ALLOW_LOCAL_ADAPTERS=true` is explicitly set, reducing server-side request risk.

### A2A v0.3

Production discovery is available at `https://a2apark.com/.well-known/agent-card.json` (and the legacy `https://a2apark.com/.well-known/agent.json` path). Stateful JSON-RPC `message/send` calls go to `https://a2apark.com/a2a`.

```sh
curl https://a2apark.com/.well-known/agent-card.json
curl -X POST https://a2apark.com/a2a \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":"rides","method":"message/send","params":{"message":{"messageId":"rides","role":"user","parts":[{"kind":"text","text":"{\"skill\":\"list_rides\"}"}]}}}'
```

Start with `list_rides`, then `start_ride`, then submit one `act` command per observation until the returned run is complete. The final A2A response contains the full trace and evidence-backed score.

With the park running, reproduce a complete A2A session using:

```sh
npm run smoke:a2a
```

## Signed scorecards

Completed runs can create a compact signed Rate My Agent scorecard. It includes the score, rules, evidence step references, hazard/error counts, and a SHA-256 fingerprint of the preserved full trace. Adapter URLs and the full potentially sensitive trace are not embedded in the public token.

Set `PARK_SHARE_SECRET` to a stable secret in a production environment so existing scorecards continue to verify after restarts. Without it, a process-local key is generated and links are intentionally temporary.

## A2APark and A2AParkBench boundaries

Public runs use simulated identities, money, and transactions. Users are warned not to enter personal data, credentials, confidential information, or production secrets. A verified scorecard verifies integrity from the issuing deployment; it is not a safety certification.

The [A2AParkBench public website](https://bench.a2apark.com/) links to its released free regression runner/action and fixed public failure corpus. Private hosted workflows, retention, comparison, customer entitlements, paid CI, and immediate paid fulfilment remain gated and are not provided by this repository. The included Park status page does not offer checkout or claim that those capabilities are live.

Public identity is configured with `CANONICAL_ORIGIN` (production: `https://a2apark.com`). Requests on the verified `www` and legacy Render hostnames receive a method-preserving `308` redirect to the matching canonical path and query. `BENCH_ORIGIN` identifies only the public Bench website and makes `/bench` a convenience redirect; `/teams.html` always remains the local capability-boundary page. The legacy `benchAvailable` API field is a compatibility alias meaning only that public Bench navigation is configured. It never asserts private workflow, entitlement, paid CI, fulfilment, or checkout readiness.

See `LICENSING-BOUNDARY.md` for the public/private program boundary and `MIGRATION-PROVENANCE.md` for the reviewed source lineage and classifications.

## Deployment ownership

Deployment descriptors live beside source for reproducibility. A2APark Engineering owns source changes, tests, and release packets. **Website Portfolio Manager owns live configuration and deployment**, including domains and DNS, canonical-origin configuration, deployment execution, public-origin verification, monitoring, and rollback. A2AParkBench hosting, customer data, entitlements, and payment state remain outside this public repository.

## Repository continuity

The historical GitHub repository slug remains `AgentAmusementPark/agent-amusement-park` so existing source links and commit history continue to resolve. That slug is historical infrastructure, not the current product identity. Forward-facing documentation and application surfaces use **A2APark**.

## License

The public program is licensed under `AGPL-3.0-only`; see `LICENSE`. The boundary document is engineering guidance, not legal advice.
