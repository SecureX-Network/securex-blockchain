# CTN Blockchain Security Model

## Overview

CTN Blockchain is a permissioned, private blockchain for institutional credential trust. Its security model centers on **cryptographic identity, authorization, deterministic consensus, and data-privacy separation**. It is a prototype, so limitations are documented honestly at the end of this document.

## Threat Categories and Mitigations

### Transaction Forgery

An attacker crafts a fake transaction (e.g. issue a credential as a legitimate issuer).

- **Mitigations:** every transaction is signed with Ed25519 by its `sender`. The signature is verified by the core before anything else. Modules additionally enforce that only the authorized issuer can issue/reissue/revoke its credentials.

### Signature Forgery

An attacker forges a signature to impersonate a legitimate actor.

- **Mitigations:** Ed25519 (tweetnacl-equivalent security) is a well-established signature scheme. Keys are generated securely and private keys are never logged or exposed. No custom signature code exists.

### Replay Attacks

An attacker re-submits a previously committed transaction to double-process it.

- **Mitigations:** each transaction carries a **monotonic per-sender nonce**. A transaction is accepted only if its nonce is strictly greater than the sender's last observed nonce. Committed signatures and transaction IDs are also used to deduplicate and reject repeats.

### Unauthorized Issuers

An unregistered or revoked issuer attempts to issue credentials.

- **Mitigations:** issuer authorization is checked in module validation — `issuerId` must exist, be active, and match the authorized sender for that issuer.

### Unauthorized Validators

A non-validator attempts to propose or endorse blocks.

- **Mitigations:** block production requires the proposer to be the designated round-robin leader for the height. `validatorSignatures` must include the proposer's valid Ed25519 signature over the block; any validator signatures present are verified against the authorized validator set maintained in state. Only signatures from authorized validators are accepted.

### Block Forgery

An attacker produces or alters a block.

- **Mitigations:** blocks are chained by `previousHash` (SHA-256 of the parent). Merkle roots commit to the exact transaction set. Proposer and validator Ed25519 signatures bind the header. Any alteration invalidates the hash chain and signatures.

### State Corruption

An attacker tampers with committed state.

- **Mitigations:** state is derived deterministically from the ordered transaction log. Because blocks are anchored by hash and replayed identically by all validators, tampering with stored state is detectable by comparing with the deterministic replay. Verified block-hash linkage prevents insertion of bogus state.

### Node Impersonation

An attacker pretends to be an authorized node/peer.

- **Mitigations:** network handshake requires an Ed25519 signature over a session nonce, verified against the authorized node's public key. A peer that fails authentication is disconnected.

### Network Abuse

An attacker floods the network or peers with garbage.

- **Mitigations:** authenticated peers only; message signatures verified; transaction deduplication by ID; connection and peer-count limits (`maxPeers`); rate limiting on ingress; heartbeat-based stale-peer eviction.

### Data Leakage

Sensitive credential/PII data leaks through the system.

- **Mitigations:** **PII/data separation** — only SHA-256 hashes and Merkle proofs are stored on-chain. Raw credential data lives off-chain with the issuer. The API returns only on-chain data and never private keys.

## Data Privacy

The foundational privacy property of CTN Blockchain:

- **On-chain:** only `credentialHash` (SHA-256) and Merkle inclusion proofs.
- **Off-chain:** the actual credential data (PII), held by the issuer.
- A verifier confirms a credential's authenticity by (a) hashing the presented data, (b) matching the hash to the on-chain anchor, and (c) checking the Merkle inclusion proof against the committed block root.

This design avoids PII exposure, keeps the chain small, and supports GDPR-style compliance (data can be removed off-chain without breaking the tamper-evident anchor).

## Key Management

- **Ed25519 keys are never hardcoded.**
- Keys are stored in the **config/secrets directory** (PEM format), git-ignored.
- A node retains a stable identity across restarts via its persisted key pair.
- **Key rotation** is supported through `KEY_REGISTER` / `KEY_ROTATE` transactions and administrative tooling.
- Private keys are used only inside signing routines and are never returned by the API or logged.

## Network Security

- Only **authenticated peers** participate (mandatory Ed25519 handshake).
- Every protocol message carries a verifiable sender signature.
- Unauthenticated or un-authorized messages are dropped before any processing.

## API Security

- **Input validation** on all params and bodies (rejects malformed/injected input).
- **No sensitive data in responses** — only on-chain hashes, proofs, and registry metadata.
- **Admin-only** endpoints (e.g. `POST /nodes/register`) require authorization.
- Rate limiting guards against abuse.

## Limitations (Prototype)

The following are deliberate, documented limitations of the current implementation:

- **Not audited** — the codebase has not undergone a formal security audit. It is intended for demonstration/hackathon and pilot use, not production deployment of high-value trust.
- **Single-machine assumption** — the default deployment assumes nodes run on trusted infrastructure; networking assumes a reasonably trusted environment (no TLS-wrapped transport WSS by default; WebSocket plaintext between trusted peers).
- **File storage not encrypted** — the default `FileStore` persists JSON in plaintext. On-chain data is hashes by design, but filesystem compromise would reveal those hashes; raw PII is never stored on-chain regardless.
- **Prototype proposer-trust model** — as implemented, consensus commits on a **single proposer signature** (`minSignatures = 1`) rather than a multi-signature quorum; stronger Byzantine guarantees require raising it (see [CONSENSUS_SPEC.md](./CONSENSUS_SPEC.md#commit) and [THREAT_MODEL.md](./THREAT_MODEL.md)).

## Related

See [THREAT_MODEL.md](./THREAT_MODEL.md) for the STRIDE-based analysis and honest residual-risk documentation.

---

# SecureX Blockchain V2 Hardening Addendum

The V2 protocol (`protocolVersion '2.0'`, `transactionVersion 2`, `block.header.version >= 2`) adds a strict validation path on top of the V1 security model. V1 transactions/blocks keep the original permissive path for backward compatibility.

## Signature verification (mandatory)

Every V2 transaction's Ed25519 signature is verified against the **sender's resolved public key** before any state logic runs:

- `resolveSenderKey` maps the `sender` to either an authorized validator key or an ACTIVE issuer's key.
- A transaction whose `sender` is not a known validator/issuer is rejected (`UNAUTHORIZED_SENDER`).
- A transaction whose signature does not match that key is rejected (`INVALID_SIGNATURE`).
- `computeTransactionHash` provides a canonical, integrity-bound transaction digest.

This closes the V1 gap where a transaction with a valid shape but arbitrary/absent sender identity could be accepted by permissive module checks.

## Replay protection (mandatory)

- Each V2 sender maintains a **monotonic nonce** in state.
- `nonce <= storedNonce` → `REPLAYED_TRANSACTION` (1-based: a fresh sender starts at 1).
- `setNonce` only advances forward, so a lower/equal nonce can never be replayed, even offline, since the signature still binds the nonce in the signing data.

## Issuer authorization & lifecycle state machine (V2-only)

- Issuer/credential/revocation modules enforce that only the ACTIVE, authorized issuer may mutate its own credentials.
- Lifecycle transitions must follow the shared `canTransition` table via `validateTransition` (`src/core/state/state.ts`):
  - `ISSUED -> ACTIVE`, `ACTIVE -> SUSPENDED/REVOKED`, `SUSPENDED -> ACTIVE/REVOKED`, etc.
  - An illegal/unknown transition (e.g. suspend a REVOKED credential) → `INVALID_STATE_TRANSITION`.
  - Duplicate issuance → `CREDENTIAL_ALREADY_EXISTS`.

## Block integrity (V2-only)

For blocks with `header.version >= 2`, the block validator additionally enforces:

- `expectedBlockHash === block.hash` (`INVALID_BLOCK`) — the hash binds header + canonical transaction set.
- Duplicate transaction IDs within a block are rejected (`DUPLICATE_TRANSACTION`).
- Merkle root is computed from canonical serialization of each transaction (`version >= 2`), so tampering with any transaction changes the root.

## Chain recovery / evidence (V2)

- `ChainRecovery` re-validates every stored block's hash, previous-link, and Merkle root at startup; storage tampering is detected and `recovered=false` is reported.
- `BlockchainEvidenceProvider` and `CredentialVerificationService` let a verifier confirm a credential's on-chain anchor (containing block + Merkle inclusion proof) and issuer recognition, without relying on an untrusted third party.

## Demonstration

`npx ts-node scripts/attack-simulation.ts` runs a self-contained SIH (Simulate · Test · Block · Evidence) loop and shows all eight attack vectors being rejected with concrete error strings. `tests/security/v2-attacks.test.ts` codifies the same checks as automated tests.

## Versioned enforcement summary

| Control | V1 | V2 |
| --- | --- | --- |
| Signature/sender resolution | permissive | mandatory (`INVALID_SIGNATURE` / `UNAUTHORIZED_SENDER`) |
| Nonce replay | original behavior | `REPLAYED_TRANSACTION` |
| Issuer lifecycle transitions | permissive | `INVALID_STATE_TRANSITION` |
| Block hash integrity | — | `INVALID_BLOCK` when `version >= 2` |
| Duplicate tx in block | — | `DUPLICATE_TRANSACTION` |
