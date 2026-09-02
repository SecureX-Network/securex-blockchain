# Changelog

All notable changes to the CTN Blockchain are documented in this file.

## [0.2.0] - 2026-09-02

### Added — SecureX Blockchain V2 (hardening, backward compatible)

- **Protocol versioning** (`src/core/version.ts`, `src/core/errors.ts`): `protocolVersion '2.0'`, `transactionVersion 2`, `block.header.version 2`; supported-version helpers; structured `BlockchainError` enum + `BlockchainResult`/`ok`/`fail`.
- **Transaction hardening** (`src/core/transaction/transaction.ts`, `src/core/validation/tx-validator.ts`): `buildV2Transaction`, `computeTransactionHash`, mandatory signature verification against resolved sender key (`INVALID_SIGNATURE` / `UNAUTHORIZED_SENDER`), monotonic nonce replay protection (`REPLAYED_TRANSACTION`).
- **Issuer/credential authorization (V2-only)** (`src/modules/{issuers,credentials,revocation}`): only ACTIVE authorized issuers may mutate their own credentials; lifecycle transitions enforced via the shared `canTransition` state machine in `src/core/state/state.ts` (`INVALID_STATE_TRANSITION`).
- **Block hardening (V2-only)** (`src/core/validation/block-validator.ts`, `src/core/chain.ts`): block hash integrity (`INVALID_BLOCK`), duplicate transaction rejection (`DUPLICATE_TRANSACTION`), version-aware Merkle root, `createBlockV2`, `getBlockByHeight`, `getBlocks`.
- **Merkle proofs** (`src/merkle/proofs.ts`): `MerkleProofService` for transaction inclusion proofs and anchor-hash lists.
- **Services** (`src/services/`): `CredentialVerificationService`, `BlockchainEvidenceProvider`/`ChainEvidenceProvider`, `ChainRecovery` (startup tamper detection), `ObservabilityService`.
- **API + client** (`src/api/server.ts`, `src/api/client.ts`): `/ready`, `/status`, `/metrics`, `/verify/:id`, `/evidence/:id` endpoints and client methods.
- **Determinism tests** (`tests/unit/determinism.test.ts`): two independent nodes converge on identical block hashes, Merkle roots, heights, and state.
- **Attack simulation** (`scripts/attack-simulation.ts`): SIH loop demonstrating eight attack vectors being blocked with concrete errors.
- **Tests**: `tests/unit/{merkle-proofs,credential-lifecycle,v2-verification,determinism}` and `tests/security/v2-attacks`.
- Docs: V2 addenda in `docs/SECURITY_MODEL.md` and `docs/ENGINEERING_SUMMARY.md`.

### Notes

- V1 (`protocolVersion '1.0'`, `transactionVersion 1`, `block.header.version 1`) remains fully supported; V1 tests continue to pass. The new strict validation applies only to V2.

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