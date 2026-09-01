# ADR-003: Ed25519 Signatures + SHA-256 Hashing via Node.js Built-in Crypto

- **Status:** Accepted
- **Date:** 2024-01-01 (project inception)
- **Decision makers:** CTN Blockchain team

## Decision

CTN Blockchain will use **Ed25519** for all signatures and **SHA-256** for all hashing, implemented exclusively with **Node.js's built-in `crypto` module** (`crypto.generateKeyPairSync`, `crypto.sign`, `crypto.verify`, `crypto.createHash`). **No custom cryptographic primitives** will be written.

## Context

Every layer of the system relies on cryptography: node/peer identity, transaction and block signatures, hash chaining, Merkle trees, and credential anchors.

- Correctness and security of cryptography is paramount and extremely hard to get right when hand-implemented.
- The project values auditability and minimal dependencies.
- Node.js ships fast, audited, native implementations of both primitives.

## Alternatives Considered

- **Custom implementations** — rejected: unacceptable audit and correctness risk.
- **Third-party crypto libraries (e.g. `nacl`, `elliptic`)** — viable but unneeded; Node's built-in Ed25519 and SHA-256 are mature, native, and freely available.
- **ECDSA (e.g. P-256)** — functional but Ed25519 is simpler, faster, and has stronger built-in side-channel resistance; its deterministic signatures also make verification and testing easier.

## Consequences

### Positive
- **Fast** — Ed25519 and SHA-256 are both highly performant.
- **Secure** — well-established, widely audited algorithms.
- **Standard** — SHA-256 is the ubiquitous integrity hash.
- **Zero extra dependency** — Node's native `crypto` is already in the runtime.
- **Deterministic signatures** — Ed25519 signatures are deterministic (RFC 8032), simplifying reproduction in tests.

### Negative / Trade-offs
- Requires Node.js runtime versions that expose Ed25519 from `crypto` (Node 12+/modern LTS) — an accepted constraint.
- No hardware (HSM) key storage — accepted for the prototype (see [SECURITY_MODEL.md](../SECURITY_MODEL.md#key-management)).

## Decision

Accepted. Ed25519 + SHA-256 on Node.js built-in crypto, no custom primitives. See [CRYPTO_SPEC.md](../CRYPTO_SPEC.md).