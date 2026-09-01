# Public and private licensing boundary

This is an engineering boundary, not legal advice. Obtain qualified counsel before materially relying on it for a high-value commercial deployment.

## Public program

Everything in this repository is the **public Agent Amusement Park program** and is released under `AGPL-3.0-only`, unless a file explicitly states another license.

That includes:

- the HTTP server and public web interface;
- ride execution, state transitions, traces, scoring, and signed scorecards;
- the three bundled public rides;
- the browser-participant and local-adapter protocols;
- container and deployment configuration; and
- bundled visual assets.

Anyone operating a modified version of this program for users over a network must comply with the AGPL, including its network-source obligations. Improvements to this public program are expected to remain public.

## Separately monetized product

**Private Park** is a separate product and must be implemented outside this repository. Candidate proprietary components include:

- account, organisation, tenant, role, and entitlement services;
- billing, invoicing, tax, cancellation, and refund systems;
- private run indexing, retention policies, comparison history, and customer dashboards;
- commercial pack catalogues, customer configuration, and licensed scenario content;
- commercial analytics and operational tooling; and
- orchestration across isolated public-engine workers.

These components should live in separate repositories, deploy as separate processes or services, and communicate with the public program through a documented, coarse, versioned HTTP/JSON protocol. They must not import AGPL modules, link them into the same process, copy AGPL implementation code, exchange undocumented internal object graphs, or present themselves as one combined executable.

A process boundary alone is not a magic exemption. If the communication becomes sufficiently intimate that the components are effectively one combined program, obtain specific legal advice or publish the combined source under AGPL.

## Public engine use inside Private Park

The conservative architecture is:

1. Run the AGPL public engine as its own container or worker.
2. Publish the exact source for any modifications to that worker.
3. Let the proprietary control plane send bounded evaluation requests through a stable public protocol.
4. Keep identities, billing, history, entitlements, and commercial content out of the engine process.
5. Make the source link for the public worker visible to network users.

Public-engine outputs and factual run results are not automatically licensed as program source merely because the engine produced them. Separately authored commercial scenario content should nevertheless avoid copying code or expressive ride content from the public repository.

## Alternative commercial licences

The copyright holder may offer operator-owned code under additional commercial terms while continuing to publish it under AGPL. This option is only clean for code whose necessary copyrights are controlled by the operator.

Do not copy a third-party AGPL contribution into a proprietary component or commercially relicense it unless that contributor has separately granted the necessary rights. If future strategy depends on commercially relicensing the public engine itself, establish a contributor licence agreement before accepting such code.

## Repository rule

No proprietary Private Park source, customer data, secrets, private ride packs, checkout credentials, or commercial deployment configuration belongs in this repository.
