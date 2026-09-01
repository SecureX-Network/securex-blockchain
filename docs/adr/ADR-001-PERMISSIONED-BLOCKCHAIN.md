# ADR-001: Use a Permissioned Private Blockchain

- **Status:** Accepted
- **Date:** 2024-01-01 (project inception)
- **Decision makers:** CTN Blockchain team

## Decision

CTN Blockchain will be a **permissioned, private blockchain**: a closed network whose participants (nodes, issuers, validators) are explicitly authorized, rather than a public, permissionless network where anyone can join and participate.

## Context

CTN is an **institutional credential verification** network. Credentials (diplomas, certificates, licenses) are issued by known institutions and verified by trusted parties. This domain differs fundamentally from public cryptocurrency:

- Participants are known and must answer to each other.
- The parties must be able to exclude bad actors.
- Consensus should be deterministic and fast — not leave miners guessing.
- Personal/credential-related data must be kept private by design.

A public, permissionless blockchain would require incentive tokens, anonymous mining, and global data exposure — all undesirable (or unacceptable) for institutional credential trust.

## Consequences

### Positive
- **Authorized participation** — only known issuers/validators can write; the register of authorized identities is enforced on-chain.
- **Deterministic, fast consensus** — PoA commits blocks immediately without probabilistic finality (see [ADR-002](./ADR-002-CONSENSUS.md)).
- **Data privacy** — the network controls who may read; combined with hash-only anchoring ([ADR-004](./ADR-004-DATA-PRIVACY.md)), PII stays off-chain.
- **No tokens / no mining** — no energy waste, no currency aspects, simpler economics and governance.

### Negative / Trade-offs
- Requires trust in the operator(s) who authorize participants (single point of governance).
- Not censorship-resistant the way public blockchains are — that is acceptable and intended here.
- No public verifiability by arbitrary third parties (verification is per-authorization or via proofs).

## Alternatives Considered

- **Public/permissionless blockchain (PoW or otherwise)** — rejected: tokens, mining, public exposure, probabilistic finality, unnecessary complexity.
- **Centralized database** — rejected: no tamper-evidence, no decentralized trust among multiple institutions, weak audit trail.
- **Hybrid (permissioned public read)** — considered; on-chain data is hashes only ([ADR-004](./ADR-004-DATA-PRIVACY.md)), so restricted reading is sufficient for the trust use case.

## Decision

Accepted. The permissioned model is the foundation of CTN Blockchain's security ([SECURITY_MODEL.md](../SECURITY_MODEL.md)) and architecture ([ARCHITECTURE.md](../ARCHITECTURE.md)).