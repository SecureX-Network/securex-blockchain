# CTN Blockchain Architecture

## Overview

**CTN Blockchain** (Credential Trust Network) is a **permissioned, private, modular blockchain** designed specifically for digital credential trust and verification. It is built for institutional use cases — issuing, revoking, and verifying digital credentials (diplomas, certificates, licenses) without exposing sensitive personal data.

Unlike public blockchain networks, CTN Blockchain does not rely on anonymous miners or token incentives. Access is restricted to a known, authorized set of participants (nodes and validators), consensus is deterministic, and only cryptographic hashes and proofs of credentials are stored on-chain.

The system is written in **TypeScript** running on **Node.js**.

## Design Goals

| Goal | Description |
|------|-------------|
| **Privacy** | Only hashes and proofs live on-chain; sensitive credential data stays off-chain |
| **Permissioned access** | Only authorized nodes, issuers, and validators can participate |
| **Determinism** | All honest validators converge on the same block order |
| **Simplicity** | Enjoyable to build, test, and audit within a short timeframe without sacrificing correctness |
| **Extensibility** | Modular design allows new credential types and application modules |
| **Security** | Standard, well-established cryptographic primitives only |

## Module Architecture

The codebase is organized into cleanly separated modules under `src/`:

```
src/
├── api/             REST API (Express) — HTTP interface for clients
├── cli/             Command-line interface — node controls and admin commands
├── consensus/       Proof-of-Authority consensus engine (round-robin proposal)
├── core/            Domain-agnostic blockchain core
│   ├── block/       Block and block header types, block hashing
│   ├── ledger/      Ledger and chain management
│   ├── state/       Global state (validator set, registries)
│   ├── transaction/ Transaction types and envelopes
│   └── validation/  General transaction and block validation
├── crypto/          Cryptography
│   ├── hashing/     SHA-256 hashing helpers
│   ├── identity/    Node identity and key generation
│   └── signatures/  Ed25519 signing and verification
├── merkle/          Merkle tree construction and inclusion proofs
├── modules/         Application modules (domain-specific)
│   ├── credentials/ Credential lifecycle transactions
│   ├── issuers/     Issuer registration and updates
│   ├── keys/        Key registration and rotation
│   └── revocation/  Credential revocation/suspension/reinstatement
├── network/         P2P networking over WebSockets
│   ├── discovery/   Peer discovery (static + gossip)
│   ├── peer/        Peer state and connection management
│   ├── protocol/    Wire protocol message types and envelope
│   └── transport/   WebSocket transport layer
└── storage/         Pluggable storage abstraction (FileStore default)
```

### The Core Is Domain-Agnostic

The `core/` package is deliberately written with **no knowledge of credentials**. It understands only:

- **Blocks** — headers, hashes, and bodies
- **Transactions** — envelopes carrying typed payloads
- **State** — a key/value and registry-based data model
- **Validators** — the authorized set that proposes and signs blocks
- **Peers** — network participants it can talk to
- **Signatures** — Ed25519 signatures over hashes and transactions
- **Hashes** — SHA-256 hashing for integrity and chain linking

The core treats each transaction payload as an opaque, typed object. It validates the envelope (signature, nonce, sender) generically, then delegates domain-specific payload validation and application to registered **application modules** (see [EXTENSIBILITY.md](./EXTENSIBILITY.md)).

### Application Modules Are Separate

Domain logic lives outside the core in `src/modules/`:

- **Issuers** — register issuers and update their metadata
- **Credentials** — issue, reissue, and manage credential lifecycle
- **Revocation** — revoke, suspend, and reinstate credentials
- **Keys** — register and rotate cryptographic keys

Each module implements a common `TransactionModule` interface so new credential types can be added without touching the core.

## Technology Stack

| Concern | Technology |
|---------|------------|
| Language | TypeScript (strict mode) on Node.js (ES2022) |
| Consensus | Proof-of-Authority (PoA), round-robin proposer |
| Signatures | Ed25519 (Node.js `crypto` module) |
| Hashing | SHA-256 (Node.js `crypto` module) |
| P2P transport | WebSocket (`ws` library) |
| HTTP API | Express |
| Storage | File-based with interface abstraction |
| CLI | Commander |
| Logging | Winston |
| IDs | UUID v4 (`uuid` library) |
| Tests | Jest with `ts-jest` |

## Key Design Decisions

### Proof-of-Authority Consensus

The network uses **Proof-of-Authority** with round-robin block proposal. A designated proposer for each round collects valid pending transactions, builds and signs a block, commits it locally (single-proposer commit), and broadcasts it. Other validators independently verify and commit the same block. See [CONSENSUS_SPEC.md](./CONSENSUS_SPEC.md).

### Ed25519 Signatures

All identities and message authentication use **Ed25519** signatures. Keys are generated with Node.js's built-in `crypto.generateKeyPairSync`. Public keys are hex-encoded and serve as node/issuer/validator identifiers. See [CRYPTO_SPEC.md](./CRYPTO_SPEC.md).

### SHA-256 Hashing

All hashing — block hashes, transaction integrity, Merkle trees, and credential anchors — uses **SHA-256** from the Node.js `crypto` module. See [CRYPTO_SPEC.md](./CRYPTO_SPEC.md).

### WebSocket P2P

Nodes communicate peer-to-peer over **WebSocket** connections (`ws`). Messages are JSON-encoded within a signed envelope. See [NETWORK_SPEC.md](./NETWORK_SPEC.md) and [PROTOCOL.md](./PROTOCOL.md).

### File-Based Storage with Abstraction

Storage is defined through clean interfaces (`BlockStore`, `TransactionStore`, `StateStore`, `PeerStore`). The default implementation is file-based (`FileStore`), with the interface designed to allow future database backends. See [STORAGE_SPEC.md](./STORAGE_SPEC.md).

## Data Flow

A typical credential verification flows through the network as follows:

```
┌─────────────┐   ┌────────────────┐   ┌──────────────┐   ┌──────────────────┐
│  Credential │ → │ Canonical JSON │ → │  SHA-256     │ → │ Blockchain Anchor │
│  (data)     │   │ (deterministic)│   │  Hash        │   │ (anchor + proof)  │
└─────────────┘   └────────────────┘   └──────┬───────┘   └──────────────────┘
                    off-chain                 │                 on-chain
                                              ▼
                                        Anchored via
                                        CREDENTIAL_ISSUE
                                        transaction
```

1. **Credential** — an issuer creates a credential containing the claims/attributes.
2. **Canonical JSON** — the credential is serialized deterministically (sorted keys, no whitespace) so the hash is stable and reproducible.
3. **SHA-256 Hash** — a `credentialHash` is computed over the canonical bytes.
4. **Blockchain Anchor** — the issuer submits a `CREDENTIAL_ISSUE` transaction carrying the `credentialHash`. Once the transaction is committed in a block, the hash is permanently, tamper-evidently anchored on-chain.

### Privacy Boundary

Only **hashes and proofs** are stored on-chain. The actual credential data (PII) stays off-chain, held by the issuer and shared directly with the credential holder. The on-chain hash serves as a tamper-evident anchor; the Merkle proof ties the hash to a committed block. See [SECURITY_MODEL.md](./SECURITY_MODEL.md) and [THREAT_MODEL.md](./THREAT_MODEL.md).

## Extensibility

The **module registry pattern** is the primary extension point:

1. A module implements the `TransactionModule` interface (`{ type, validate(), apply() }`).
2. The core dispatches transactions to the matching module by type.
3. New credential domains (employment, licensing, accreditation, government attestation) can be added by registering new modules.

See [EXTENSIBILITY.md](./EXTENSIBILITY.md) for the full design.

## Related Documentation

- [PROTOCOL.md](./PROTOCOL.md) — wire protocol specification
- [TRANSACTION_SPEC.md](./TRANSACTION_SPEC.md) — transaction envelope and types
- [BLOCK_SPEC.md](./BLOCK_SPEC.md) — block structure and hashing
- [CONSENSUS_SPEC.md](./CONSENSUS_SPEC.md) — PoA consensus
- [NETWORK_SPEC.md](./NETWORK_SPEC.md) — P2P networking
- [CRYPTO_SPEC.md](./CRYPTO_SPEC.md) — cryptography
- [STORAGE_SPEC.md](./STORAGE_SPEC.md) — storage
- [API_SPEC.md](./API_SPEC.md) — REST API
- [SECURITY_MODEL.md](./SECURITY_MODEL.md) — security model
- [EXTENSIBILITY.md](./EXTENSIBILITY.md) — extensibility design
- [TESTING.md](./TESTING.md) — testing strategy
- [THREAT_MODEL.md](./THREAT_MODEL.md) — threat model
