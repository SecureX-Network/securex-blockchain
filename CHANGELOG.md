# Changelog

All notable changes to the CTN Blockchain are documented in this file.

## [0.1.0] - 2026-09-01

### Added

- **Architecture & specifications** (`docs/`): ARCHITECTURE, PROTOCOL,
  TRANSACTION_SPEC, BLOCK_SPEC, CONSENSUS_SPEC, NETWORK_SPEC, CRYPTO_SPEC,
  SECURITY_MODEL, STORAGE_SPEC, API_SPEC, EXTENSIBILITY, TESTING,
  THREAT_MODEL, plus five ADRs covering permissioned-chain, consensus,
  cryptography, data privacy, and modular architecture decisions.

- **Core domain-agnostic blockchain** (`src/core/`): Block, Transaction,
  Chain, StateManager, TransactionValidator, BlockValidator. Core has no
  dependency on credential-specific logic.

- **Cryptography** (`src/crypto/`): Ed25519 key generation/signing/verify
  (Node.js `crypto` module), SHA-256 hashing, canonical JSON serialization,
  node identity derived from public key.

- **Storage** (`src/storage/`): Abstract block/transaction/state/peer store
  interfaces with a file-backed JSON implementation (pluggable).

- **Merkle tree** (`src/merkle/`): SHA-256 based tree, deterministic root,
  position-tagged inclusion proofs, proof verification.

- **Consensus** (`src/consensus/`): Permissioned Proof-of-Authority with
  deterministic round-robin proposer rotation. No mining or PoW.

- **Networking** (`src/network/`): WebSocket P2P transport, authenticated
  Ed25519 handshake (including validator public-key exchange), peer
  discovery, transaction/block broadcast, block request, ledger
  synchronization, reconnect handling, heartbeat.

- **Application modules** (`src/modules/`): Issuer module, Credential
  module, Revocation lifecycle module (suspend/reinstate/revoke/reissue),
  Key lifecycle module (register/rotate), Batch-anchor module. Registered
  via a `TransactionModule` registry so the core stays application-agnostic.

- **Transaction types**: `ISSUER_REGISTER`, `ISSUER_UPDATE`,
  `CREDENTIAL_ISSUE`, `CREDENTIAL_REVOKE`, `CREDENTIAL_SUSPEND`,
  `CREDENTIAL_REINSTATE`, `CREDENTIAL_REISSUE`, `KEY_REGISTER`,
  `KEY_ROTATE`, `BATCH_ANCHOR`.

- **REST API + client SDK** (`src/api/`): Health, blocks, transactions,
  issuer registry, credential state/history, Merkle inclusion proofs,
  validator registry, network status. Server never exposes private keys.

- **CLI** (`src/cli/`): `init`, `start`, `status`, `peers`, `blocks`,
  `tx`, `verify`, `validators`.

- **Single-node node orchestrator** (`src/node.ts`): wires core, consensus,
  network, and API together.

### Security

- Transaction replay protection (per-sender monotonic nonce).
- Signature verification for transactions and blocks.
- Permissioned validator set; unknown/inactive validators rejected.
- Block validation: version, height, previous hash, merkle root, proposer
  authorization, proposer signature, and every transaction independently.
- PII is never stored on-chain; only hashes and lifecycle proofs are.
- Credential revocation/suspension/reissue is a state transition, history is
  never deleted.

### Tests

- **Unit** (49): hashing, canonicalization, crypto, Merkle, state
  transitions, transaction validation, block validation.
- **Integration** (`tests/integration/`): single-node credential lifecycle
  (issue/suspend/reinstate/revoke/reissue, merkle proof, tamper detection);
  4-validator multi-node consensus with ledger convergence.
- **Security** (`tests/security/`): forged signature, modified payload,
  replayed transaction, duplicate credential ID, unauthorized issuer,
  unknown sender.
- **Network** (`tests/network/`): multi-node peer discovery, duplicate
  propagation rejection, ledger convergence.