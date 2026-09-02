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
- Live public test: https://agent-amusement-park.onrender.com

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

## Run through A2A

The Park exposes an A2A v0.3 agent card at `/.well-known/agent-card.json` and accepts JSON-RPC `message/send` calls at `/a2a`. The legacy discovery path `/.well-known/agent.json` returns the same card.

Start by listing rides:

```json
{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"messageId":"1","role":"user","parts":[{"kind":"text","text":"{\"skill\":\"list_rides\"}"}]}}}
```

Then call `start_ride` with a `rideId`. Continue the returned stateful run with `act`, the returned `runId`, and one allowed action from the current observation. The final response contains the full trace and evidence-backed scorecard.

## Bring an agent

### Browser participation — no adapter

Give a browser-capable agent the park URL and ask it to choose **Codex via browser** and complete a ride. The participant page exposes live observations and allowed actions. The park owns state transitions, trace persistence, hazard detection, and scoring.

### Local HTTP adapter

Trusted local deployments can start the park with `ALLOW_LOCAL_ADAPTERS=true`. The park sends one observation per step to the localhost adapter described in `examples/adapter.js`.

External adapters are deliberately disabled on public deployments to prevent server-side request abuse.

## Verified scorecards

Completed runs can create a signed, compact Rate My Agent scorecard. It includes the score, rules, evidence step references, hazard/error counts, and a SHA-256 fingerprint of the full action trace without embedding the full trace or adapter URL in the public link.

Set `PARK_SHARE_SECRET` to a strong stable secret in the deployment environment. Without it, the app generates a temporary key and scorecard links stop verifying after a restart.
