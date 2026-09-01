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
npm test          # 10 suites / 68 tests
npm run demo      # 3-validator demo
npm run benchmark # 2-validator throughput benchmark
npm run dev       # run a node via ts-node
```
</content>