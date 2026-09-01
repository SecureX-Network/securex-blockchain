# ADR-005: Core / Application Module Separation with a Module Registry

- **Status:** Accepted
- **Date:** 2024-01-01 (project inception)
- **Decision makers:** CTN Blockchain team

## Decision

The codebase will be split into a **domain-agnostic blockchain core** (`core/`) and **separate application modules** (`modules/`), connected through a **module registry**. The core understands blocks, transactions, state, validators, peers, signatures, and hashes — but knows nothing about credentials, issuers, or revocation. Domain logic lives exclusively in pluggable modules.

## Context

The blockchain mechanics (hashing, PoA consensus, block chaining, P2P, storage) are generic and reusable. The credential semantics (what an "issuer" is, when a credential is valid/revoked) are domain-specific and evolving:

- Multiple credential domains are planned (licenses, employment, accreditation, government attestation) — see [EXTENSIBILITY.md](../EXTENSIBILITY.md).
- Coupling the core to credential logic would make the core fragile, hard to test, and impossible to reuse.
- New domains must be addable without touching consensus, network, or storage.

## Alternatives Considered

- **Monolithic core** (credentials baked into the core) — rejected: couples two concerns, bloats the core, blocks future domains.
- **Full plug-in framework / microkernel** (heavy mediation, many SPI hooks) — rejected: over-engineered for the prototype; a simple registry satisfies the need.
- **Shared common types only, dispatching by string switch** — rejected: a type-switch inside the core inevitably re-couples it to domains; a registry inverts the dependency cleanly.

## Decision

## Consequences

### Positive
- **Core independence** — blockchain mechanics are credential-agnostic and reusable.
- **Extensibility** — new domains are new modules implementing `{ type, validate(), apply() }`, registered at startup.
- **Testability** — the core's generic pipeline and each module can be tested independently.
- **Deterministic dispatch** — dispatch depends only on the transaction, preserving consensus determinism.

### Negative / Trade-offs
- Requires occasionally ensuring module state namespaces stay consistent (each module owns its state keys; collisions must be avoided).
- Slightly more indirection than a monolith (registry lookup on validate/apply).

## Decision

Accepted. The registry pattern is the primary extensibility mechanism. See [EXTENSIBILITY.md](../EXTENSIBILITY.md) and [ARCHITECTURE.md](../ARCHITECTURE.md#module-architecture).