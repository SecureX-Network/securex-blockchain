# ADR-002: Proof-of-Authority Consensus with Round-Robin Proposal

- **Status:** Accepted
- **Date:** 2024-01-01 (project inception)
- **Decision makers:** CTN Blockchain team

## Decision

CTN Blockchain will use **Proof-of-Authority (PoA)** consensus with **round-robin block proposal**: the authorized validator set rotates the proposer role deterministically per height. The proposer builds and signs a block, commits it locally, then broadcasts it; every other validator independently verifies and commits it. As implemented, a block commits with a **single proposer signature** (`minSignatures = 1`), not a multi-validator quorum.

## Context

CTN Blockchain is permissioned ([ADR-001](./ADR-001-PERMISSIONED-BLOCKCHAIN.md)) and must be built within a short timeframe (hackathon/prototype). Requirements:

- **Deterministic finality** — every honest node must agree on block order, with no probabilistic confirmation delays.
- **Known validator set** — participants are authorized and known in advance, so leader election can be pre-determined.
- **Simplicity** — easy to implement, reason about, and verify under time pressure.
- **No tokens** — there is no currency to reward miners or stake.

## Alternatives Considered

- **PBFT (Byzantine Fault Tolerance)** — offers strong Byzantine guarantees with `f < n/3`, but is **complex** (view-change protocols, multiple message phases, prepare/commit machinery) and too heavy for the prototype timeframe.
- **Raft** — simple and crash-fault-tolerant, but Raft is **not Byzantine-resistant**; it assumes crash-only failures, and credential networks must tolerate malicious behavior.
- **Proof-of-Work** — **inappropriate**: requires tokens/mining, wastes energy, yields probabilistic (non-immediate) finality, and is nonsensical with a known, trusted validator set.

## Consequences

### Positive
- Deterministic, immediate commit with a simple, single-committer rule.
- Cheap (no mining), simple to implement and test.
- Appropriate for a known, trustworthy validator set.

### Negative / Trade-offs
- Weaker Byzantine properties than PBFT or a multi-signature quorum: blocks commit on the proposer's signature alone, so a malicious or compromised proposer can insert a block that honest validators will still validate and commit. The `validatorSignatures` field supports future multi-signature quorum but the prototype uses `minSignatures = 1` for simplicity (see [CONSENSUS_SPEC.md](../CONSENSUS_SPEC.md#commit)).
- Trusts the validator set operator(s) for validator membership.
- If a validator misbehaves, protection relies on the proposer-signature rule + timeout-based proposer skip.

## Decision

Accepted. Equilibrium between **implementability** and **sufficient security** for a permissioned credential network, given the prototype's single-proposer-commit scope.