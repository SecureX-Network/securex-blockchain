# ADR-004: Off-Chain Credential Data, On-Chain Hash/Proof Only

- **Status:** Accepted
- **Date:** 2024-01-01 (project inception)
- **Decision makers:** CTN Blockchain team

## Decision

CTN Blockchain will store **only the SHA-256 hash** of a credential's data (and the Merkle proofs that tie it to committed blocks) **on-chain**. The raw credential data — including any personal information — lives **off-chain**, held by the issuer and shared directly with the holder/verifier.

## Context

Credentials represent real-world claims about people (degrees, licenses, work history). This is sensitive personal information (PII) subject to privacy expectations and regulation (e.g. GDPR-style rules on institutional data). Meanwhile, the value of a blockchain here is **tamper evidence**: an immutable, verifiable anchor that a specific credential existed at a specific time.

Storing raw data on-chain would:
- Expose PII to every node that replicates the ledger.
- Grow the chain with each credential payload.
- Make compliance (right to erase/alter) effectively impossible.

## Alternatives Considered

- **Store full credential JSON on-chain** — rejected: PII leaks to the whole network; unbounded chain growth; GDPR-hostile.
- **Encrypted data on-chain** — rejected: encryption keys become a management problem, and metadata still leaks; encryption alone does not solve `right to be forgotten`.
- **Hash-only anchoring (chosen)** — the hash is one-way, so the raw data cannot be reconstructed from the chain, while still enabling tamper-evident verification.

## Consequences

### Positive
- **Prevents PII leakage** — chain content is opaque hashes, not readable data.
- **Reduces chain size** — fixed-size anchors, independent of credential size.
- **Allows GDPR-style compliance** — raw data can be managed/removed off-chain without altering the immutable anchor.
- **Keeps the blockchain as a trust anchor, not a data store** — roles are cleanly separated.

### Negative / Trade-offs
- On-chain hashes prove **existence and integrity** of a credential but cannot prove its content to a party who doesn't possess the data — third parties must obtain the data off-chain (through the holder/issuer) before verifying the hash.
- Requires an off-chain channel between issuer and holder/verifier.
- Collision/second-preimage resistance depends on the security of SHA-256 — an accepted, standard assumption.

## Decision

Accepted. Hash/proof-only anchoring is a core privacy property. See [ARCHITECTURE.md](../ARCHITECTURE.md#privacy-boundary) and [SECURITY_MODEL.md](../SECURITY_MODEL.md#data-privacy).