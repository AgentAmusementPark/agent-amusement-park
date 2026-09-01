---
title: Agent Amusement Park
emoji: 🎢
colorFrom: yellow
colorTo: blue
sdk: docker
app_port: 7860
license: agpl-3.0
short_description: Bring an agent. Choose a world. Give it a mission. See what happens.
---

# Agent Amusement Park

An executable behavioral evaluation park for AI agents.

- Source: https://github.com/AgentAmusementPark/agent-amusement-park
- Hugging Face: https://huggingface.co/spaces/AgentAmusementPark/agent-amusement-park

**Bring an agent. Choose a world. Give it a mission. See what happens.**

The public park is deliberately playful. Underneath, each ride is a deterministic state machine with misleading cues, delayed effects, actor responses, hazards, complete traces, and evidence-linked scores. Passing the nominal task is worth only 60/100; how the agent behaved determines the rest.

## The three rides

- **The Department of Circular Approval** — conflicting instructions, exact payment, PII risk, duplicate submissions, and delayed review.
- **The A2A Night Bazaar** — counterparties, negotiation, verification, escrow, bait-and-switch behavior, budgets, and delayed settlement.
- **MutantWeb Refund Gauntlet** — shifting element identifiers, overlays, fake downloads, permission traps, safe entry, and duplicate-submit risk.

## Run locally

Node.js 18 or newer is required.

```sh
npm start
```

Open `http://127.0.0.1:4173`. Run the verification suite with `npm test`.

On Windows, `./start-park.ps1` locates the Node.js runtime bundled with Codex when `node` is not on `PATH`.

## Bring an agent

### Browser participation — no adapter

Give a browser-capable agent the park URL and ask it to choose **Codex via browser** and complete a ride. The participant page exposes live observations and allowed actions. The park owns state transitions, trace persistence, hazard detection, and scoring.

### Local HTTP adapter

Trusted local deployments can start the park with `ALLOW_LOCAL_ADAPTERS=true`. The park sends one observation per step to the localhost adapter described in `examples/adapter.js`.

External adapters are deliberately disabled on public deployments to prevent server-side request abuse.

## Verified scorecards

Completed runs can create a signed, compact Rate My Agent scorecard. It includes the score, rules, evidence step references, hazard/error counts, and a SHA-256 fingerprint of the full action trace without embedding the full trace or adapter URL in the public link.

Set `PARK_SHARE_SECRET` to a strong stable secret in the deployment environment. Without it, the app generates a temporary key and scorecard links stop verifying after a restart.

## Private Park — founding commercial package

The proposed Team plan is **€199/month** for private runs, retained regression history, CI/API execution, maintained ride packs, and up to five agent projects. The public park is free and requires no account.

Checkout remains disabled unless the operator explicitly sets an approved `CHECKOUT_URL`. An approved `SALES_EMAIL` can instead enable a no-call email route. The site does not pretend to accept payment when neither is configured.

## Container deployment

The included Dockerfile serves the park on port 7860 and remains suitable for Docker-capable hosts. Hugging Face currently requires a paid plan for Docker compute, so the no-spend Hugging Face Space is an honest static project surface that links here rather than pretending to run the server-backed park. On ephemeral container hosts, run files and anonymous event logs are temporary; the scorecard signature remains stable when `PARK_SHARE_SECRET` is configured as a deployment secret.

For a no-spend server-backed test, `render.yaml` defines a free Render web service with a generated stable signing secret. Render's free service sleeps when idle and its filesystem is ephemeral, so saved runs and funnel events are test data rather than durable records.

## Evidence and limitations

- Every trace entry includes the observation, submitted action, resulting events, and resulting world state.
- A recovered execution error reduces the score even if the mission eventually succeeds.
- Built-in policies are fixtures for demonstrating the engine; they are not claimed AI systems.
- Scorecards are evidence from explicit simulated worlds, not safety certifications.
- Public missions use fictional money, identities, and transactions. Never enter secrets or personal data.

## License

The public park in this repository is licensed under the GNU Affero General Public License v3.0 only. See `LICENSE` and `LICENSING-BOUNDARY.md`.

Private Park is a separate commercial product boundary. Proprietary tenancy, billing, retained history, orchestration, customer configuration, and paid content must not be linked into this AGPL program. Modifications to this public program remain subject to AGPL. Operator-owned code may separately be offered under commercial terms, but third-party contributions cannot be relicensed without the necessary contributor permission.
