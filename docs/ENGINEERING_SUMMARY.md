# CTN Blockchain — Engineering Summary (V1.0)

Status: **Complete and verified.** Kernel consensus, networking, storage, crypto, REST API, demo, and benchmark all pass their tests.

## Goal

CTN Blockchain (Credential Trust Network) is a permissioned, private, modular blockchain for institutional **digital credential verification** (diplomas, certificates, licenses). Only SHA-256 hashes and Merkle proofs go on-chain; sensitive data stays off-chain with the issuer.

## What was built

A TypeScript/Node.js (Node 26.7.0, npm 11.19.0) blockchain from an empty repository. Non-goals honored: **no cryptocurrency tokens, no mining/PoW, private (permissioned) network**.

```
src/
├── api/             REST API (Express)
├── cli/             Commander-based CLI
├── consensus/       Permissioned Proof-of-Authority (round-robin)
├── core/            Domain-agnostic core (blocks, txs, state, validators)
├── crypto/          Ed25519 + SHA-256 (Node.js crypto)
├── merkle/          Merkle trees + position-tagged inclusion proofs
├── modules/         Issuers, credentials, revocation, keys
├── network/         WebSocket P2P (transport, protocol, discovery, peers)
└── storage/         Pluggable storage (FileStore default)
```

## Design decisions

- **PoA, single-proposer commit** (`src/consensus/permissioned/consensus.ts`): the current proposer (height mod validatorCount) builds, signs, and commits a block locally, then broadcasts the full block + proposer signature. Peers independently validate and commit. `minSignatures = 1`; no quorum voting.
- **Crypto** (`src/crypto/`): Node crypto Ed25519 signing, SHA-256 hashing, canonical JSON. Node ID = hex(publicKey).
- **Merkle proofs are position-tagged** (`{hash, position: left|right|self}`); an odd-leaf promotes `hash(current,current)` to balance the tree.
- **1-based nonce** per sender (`src/core/transaction/transaction.ts`); `nonce <= stored` → REPLAYED_TRANSACTION. A fresh sender must start at 1.
- **Block batching**: multiple queued transactions form one block. Demo and tests wait for a heights delta (+1), not a fixed target height.
- **Privacy**: PII never enters a block; transactions and proofs carry only hashes.

## Key bug found and fixed

A real network defect surfaced during demo runs: `BLOCK_BROADCAST signature verification FAILED` warnings.

- **Root cause** (`src/network/peer/node.ts`): `broadcastBlock` re-signed the broadcast with the *local relaying* node's private key, but `handleBlockBroadcast` verified the signature against the **proposer's** public key. The verifier also used `canonicalJSON` (which omits `version`) — inconsistent with the proposer signing `getBlockSigningData` (which includes `version`).
- **Fix**: `broadcastBlock` now forwards the proposer's committed signature from `block.validatorSignatures`; `handleBlockBroadcast` falls back to `message.signature` then the proposer's committed signature, and verifies via `getBlockSigningData` — identical to the signing data the proposer used. The multinode test passes with **no verification warnings**.

## Verification

- **Full suite**: `npx jest --forceExit` → **10 suites / 68 tests passed**.
- **Demo** (`npm run demo`, 3 validators): issuer registered, 5 credentials issued and batched into one block, Merkle inclusion proof verified, credential revoked on-chain, all nodes converge at the same height, no signature-verification warnings.
- **Benchmark** (`npm run benchmark`, 2 validators × 150 issues): **300 submitted**, batched to height 9, both nodes converged equal, **throughput 469 submit/s / 82 commit/s**.

## Documentation

Aligned to the actual single-proposer-commit implementation: `docs/PROTOCOL.md`, `docs/BLOCK_SPEC.md`, `docs/NETWORK_SPEC.md`, `docs/SECURITY_MODEL.md`, `docs/THREAT_MODEL.md`, `docs/adr/ADR-002-CONSENSUS.md`, plus `docs/ARCHITECTURE.md` and `docs/TESTING.md`. The README now documents usage, demo, and benchmark.

## Known trade-offs (prototype)

- **Proposer-trust model**: consensus relies on the rotator being honest; a malicious proposer can propose an invalid block (the others reject it, but liveness depends on honest rotation). Documented as a residual risk in `docs/THREAT_MODEL.md`.
- **Single-machine network tests** run on fixed port ranges; concurrent clusters interfere (run demo/benchmark one at a time).
- In production, nodes should run on separate hosts behind WSS/TLS.

## How to use

```bash
npm install
npm test          # 20+ suites / 182 tests (V2 hardening + production hardening)
npm run demo      # 3-validator demo
npm run demo:data # seed deterministic demo institutions/credentials
npm run benchmark # 2-validator throughput benchmark
npm run dev       # run a node via ts-node
```

---

# SecureX Blockchain V2 — Hardening Summary

Status: **Complete and verified.** Built on the V1.0 foundation without rewriting it. V1 backward compatibility is preserved and all V1 tests remain green.

## Goal

Harden the V1 credential-trust blockchain into a credential-native _SecureX Blockchain V2_ that stays private/permissioned/lightweight (no crypto, no PoW/Ethereum/Web3/gas), while keeping V1 transaction and block formats fully supported.

## Backward-compatibility strategy

A single codebase serves both generations, keyed off explicit version fields:

| Concern | V1 (legacy) | V2 (hardened) |
| --- | --- | --- |
| `protocolVersion` | `'1.0'` | `'2.0'` |
| `transactionVersion` | `1` | `2` |
| `block.header.version` | `1` | `2` |
| Validation strictness | original permissive path | strict path below |

`src/core/version.ts` centralizes supported versions and helper predicates. The original permissive validation runs only for version-1 transactions/blocks, so existing V1 tests and integrations are untouched. Expected error strings (`REPLAYED_TRANSACTION`, `CREDENTIAL_ALREADY_EXISTS`, `INVALID_STATE_TRANSITION`, etc.) are preserved exactly.

## What was added / hardened

- **Versioning & structured errors** (`src/core/version.ts`, `src/core/errors.ts`): `BlockchainError` enum plus `BlockchainResult`/`ok`/`fail` helpers.
- **Transaction hardening** (`src/core/transaction/transaction.ts`, `src/core/validation/tx-validator.ts`):
  - `buildV2Transaction`, `computeTransactionHash`, canonical signing data.
  - **Signature verification** — every tx is verified against the sender's resolved public key (`INVALID_SIGNATURE` on mismatch).
  - **Sender-key resolution** — a tx may only be sent by a known validator or an ACTIVE issuer (`UNAUTHORIZED_SENDER` otherwise).
  - **Nonce replay protection** — `nonce <= stored` → `REPLAYED_TRANSACTION` (1-based nonces).
  - Module-level authorization enforced only when `transactionVersion >= 2`.
- **Issuer/credential authorization (V2-only)** by the issuers, credentials, and revocation modules — an issuer may only mutate its own credentials, and lifecycle transitions must follow the allowed `canTransition` state machine (`src/core/state/state.ts`).
- **Merkle proofs** (`src/merkle/proofs.ts`): `MerkleProofService` for creation/verification of inclusion proofs and anchor-hash lists against a block's root.
- **Services** (`src/services/`):
  - `verification.ts` — `CredentialVerificationService` (status VALID / REVOKED / NOT_FOUND + proof/block evidence).
  - `evidence.ts` — `BlockchainEvidenceProvider` / `ChainEvidenceProvider` anchor & issuer-recognition evidence.
  - `recovery.ts` — `ChainRecovery` re-validates stored blocks, links, and Merkle roots on startup and detects storage tampering.
  - `observability.ts` — `ObservabilityService` exposing `/ready`, `/status`, `/metrics`, `/verify/:id`, `/evidence/:id`.
- **Block hardening (V2-only)** in `src/core/validation/block-validator.ts` and `src/core/chain.ts`: block hash integrity check for `block.header.version >= 2`, duplicate tx-ID detection, version-aware Merkle root, `createBlockV2`, `getBlockByHeight`, `getBlocks`, and `computeMerkleRoot`.
- **CLI/SDK surface**: `src/index.ts`, `src/api/server.ts`, and `src/api/client.ts` export the new V2 modules and endpoints.

## Determinism

`tests/unit/determinism.test.ts` drives two independent nodes through identical transaction streams and proves they converge on identical block hashes, Merkle roots, heights, transaction IDs, and full state JSON — given a shared validator/issuer trust anchor and a canonical (key-order-independent) serialization. This is the foundation for confident multi-node consensus.

## SIH (Simulate · Test · Block · Evidence) demo

`npm run demo` runs the standard 3-validator demo. `npx ts-node scripts/attack-simulation.ts` runs a self-contained SIH loop that simulates eight attack vectors (forged signature, on-chain hash tamper, replay, block tamper, unauthorized proposer, invalid Merkle proof, corrupt stored block, invalid lifecycle transition) and demonstrates each being **blocked** with the concrete error string, backed by the verification/evidence chain.

## Verification

- **Full suite**: `npm test` → **15 suites / 118 tests passed** (49 V1 unit + 10 V1 integration + 6 V1 security + 3 V1 network + V2 hardening suites).
- **Lint/typecheck**: `npm run lint` (`tsc --noEmit`) clean.

## Residual / documented

- V2 keeps the V1 proposer-trust model; a malicious proposer's invalid block is rejected by peers (see `docs/THREAT_MODEL.md`).
- V2 nonce replay protection and issuer authorization apply only to version-2 transactions; version-1 transactions retain the original permissive path by design for backward compatibility.

---

# SecureX Blockchain — Production & Demo Hardening Summary (0.3.0)

Status: **Complete and verified.** Adds a real config/env layer, API middleware, audit/history/tamper-check services, an auth boundary, and deterministic demo-data generation on top of the V2 hardened foundation. Backward compatible — all V2 and V1 tests remain green.

## What was added

- **Config & environment** (`src/config/config.ts`, `src/config/env.ts`): a minimal, dependency-free `.env` loader and an expanded `NodeConfig` (`host`, `apiHost`, `protocolVersion`, `consensus`, `cors`, `requestLimitBytes`, `logLevel`) with `normalizeConfig()` for partial configs. `.env.example` documents the supported variables.
- **API middleware** (`src/api/middleware.ts`): CORS, request-id, `okResponse`/`failResponse` envelopes, `paginate` (bounded), safe access logging, and `INVALID_REQUEST_BODY`/`INTERNAL_ERROR` handlers. `failResponse` keeps `error` as a string code (V2-compatible) and adds `message`/`errorCode`.
- **Audit service** (`src/services/audit.ts`): 17 event types, capped in-memory buffer (10000), severity mapping; lifecycle/tamper events recorded and queryable at `/audit/events` and `/audit/summary`.
- **History service** (`src/services/history.ts`): bounded credential/issuer history over committed blocks (`/state/.../history`).
- **Tamper-check service** (`src/services/tamper-check.ts`): EXACT/TAMPERED/UNVERIFIABLE document-hash checks against the on-chain anchor, recording `MERKLE_VERIFICATION_FAILURE` audit events (`/contracts/tamper-check`).
- **Expanded verification** (`src/services/verification.ts`): `EXPIRED` status plus `keyStatus`, `protocolCompatible`, `issuerSignatureValid`, and `verifiedAt` evidence fields.
- **Auth boundary** (`src/api/auth.ts`): `Principal`/`Authenticator`/`AuthorizationPolicy` and `classifyEndpoint` for 0/1 pre-auth policy; no-op `AnonymousAuthenticator` for the demo deployment. Privileged writes remain constrained by cryptographic module-level validation.
- **Integration contracts** (`src/contracts/fraud.ts`, `src/contracts/platform.ts`).
- **Demo data** (`scripts/demo-data.ts`, `npm run demo:data`): deterministic, `demo:true`-flagged fictional institutions seeded through the **real transaction pipeline** (never by direct state writes).

## Verification

- **Full suite**: `npm test` → **25 suites / 182 tests passed**.
- **Build/lint**: `npm run build` and `npm run lint` (`tsc --noEmit`) clean.
- **New coverage** (`tests/`): `config`, `audit`, `history`, `middleware`, `tamper-check`, `verification-expanded`, `v2-authorization`, `security` (unit); `api` and `demo` (integration — auth boundary, new endpoints, persistence across restart, demo pipeline). Shared V2 chain builders in `tests/helpers-v2.ts`.
- **Demo data validated** end-to-end in `tests/integration/demo.test.ts` (SUSPENDED / REVOKED / VALID states verified through the real verification endpoint).

## Residual / documented

- Audit history is an in-memory, capped buffer (bounded by design); long-term persistence of audit trails is out of scope for the prototype.
- The auth layer ships a no-op authenticator; operators must supply their own `Authenticator` to enforce real pre-auth policy in production.
- Demo data is clearly flagged `demo:true` and must never be presented as real-world institutional data.

</content>