# CTN Blockchain Threat Model

## Overview

This document applies the **STRIDE** methodology to every component of CTN Blockchain and maps each threat to its mitigation. It concludes with an honest assessment of **residual risks**.

STRIDE categories: **S**poofing, **T**ampering, **R**epudiation, **I**nformation disclosure, **D**enial of service, **E**levation of privilege.

## STRIDE Summary by Component

| Component | Spoofing | Tampering | Repudiation | Information disclosure | DoS | Elevation |
|-----------|----------|-----------|-------------|------------------------|-----|-----------|
| Crypto layer | Low | N/A | N/A | Low | Low | N/A |
| Transaction pipeline | Medium | Medium | Low | Low | Medium | Medium |
| Consensus | Medium | High | Low | Low | High | High |
| Blockchain core (blocks/state) | Medium | High | Low | Low | Medium | Medium |
| Network/P2P | High | Medium | Medium | Low | High | Medium |
| REST API | Medium | Low | Low | Medium | Medium | Medium |
| Storage | Low | High | Low | Medium | Low | High |
| Application modules | High | Medium | Low | Medium | Low | High |

## Blockchain Core Threats

| Threat | STRIDE | Description | Mitigation |
|--------|--------|-------------|------------|
| **Invalid blocks** | Tampering | A node proposes a malformed or semantically invalid block | Structure, size, difficulty-free (PoA) header validation; merkle root re-computation; transaction re-validation; module-specific apply |
| **State corruption** | Tampering | Committed state is altered or computed incorrectly | State is a deterministic function of the ordered, hash-anchored transaction log; all validators replay identically |
| **Fork creation** | Tampering | An adversary splits the chain or presents two histories when a peer syncs | Single canonical chain via PoA with single-proposer commit; `previousHash` linkage; validators reject non-canonical extensions; sync verifies from genesis/highest known |
| **Block replay / reorder** | Spoofing / Tampering | Old or reordered valid blocks accepted | Height continuity, monotonically increasing timestamps, previous-hash binding, proposer signature |

## Network Threats

| Threat | STRIDE | Description | Mitigation |
|--------|--------|-------------|------------|
| **Man-in-the-middle (MITM)** | Spoofing | Eavesdrop or alter traffic between nodes | Ed25519 signed envelopes (integrity + authenticity); handshake verification; hostile messages dropped |
| **DDoS / flooding** | DoS | Saturate a node's connections or memory with messages | `maxPeers` cap, rate limiting, transaction/block dedup by ID/hash, discarding unauthorized messages, heartbeat-based stale peer eviction |
| **Sybil attack** | Spoofing | Create many fake identities to gain influence | Permissioned network: an identity only counts if its key is authorized by the validator set / peer store; handshake requires authorized keys |
| **Eclipse attack** | DoS / Spoofing | Surround a node with adversary-controlled peers | Static/seed peer config, authenticated connections only, bounded peer set, gossip from trusted peers |

## API Threats

| Threat | STRIDE | Description | Mitigation |
|--------|--------|-------------|------------|
| **Injection** | Tampering | Malformed or malicious inputs (JSON, params) | Strict input/param validation; JSON-parsing with schema checks; `INVALID_INPUT` errors |
| **Unauthorized access** | Elevation | Callers invoke admin or privileged endpoints | Authorization checks on admin-only endpoints (e.g. `POST /nodes/register`); issuer authz enforced in module validation |
| **Data leakage** | Information disclosure | API returns private data | Only on-chain hashes/proofs/registry metadata returned; private keys never exposed; PII never stored on-chain |
| **Request abuse** | DoS | Overwhelming the HTTP endpoint | Rate limiting on the API layer |

## Application Threats (Credential Modules)

| Threat | STRIDE | Description | Mitigation |
|--------|--------|-------------|------------|
| **Credential forgery** | Tampering | Fake credentials anchored or presented | Ed25519 sender signatures; issuer-id + authorization checks; `credentialHash` must reference the real credential data |
| **Credential replay** | Spoofing | Recycling an old/revoked credential as valid | Lifecycle status tracked on-chain (`issued`, `suspended`, `revoked`); verifiers MUST check status + proof + issuer authz |
| **Key compromise / theft** | Information disclosure | Private keys stolen or misused | Keys never hardcoded, stored PEM in config, never logged or API-exposed; rotation supported (`KEY_REGISTER`/`KEY_ROTATE`); compromise invalidates affected keys |
| **Issuer impersonation** | Spoofing / Tampering | Attacker registers/uses an issuer that isn't theirs | `ISSUER_REGISTER` authorization (admin), unique `issuerId`, per-issuer sender authorization on all credential txs |

## Residual Risks (Honest Assessment)

These risks remain accepted/known in the prototype:

- **No formal security audit** — the implementation is un-audited; correctness of crypto integration, consensus edge cases, and module logic depends on testing, not a professional audit.
- **Trusted-deployment assumption** — with PoA and file storage, an attacker who compromises the majority of trusted validator hosts, or the compromised host of a single validator's keys, can affect consensus/state. Network assumes a reasonably trusted environment (plaintext WebSocket by default; WSS/TLS recommended for untrusted networks).
- **Prototype proposer-trust model** — as implemented, blocks commit with a **single proposer signature** (`minSignatures = 1`); there is no multi-signature quorum. An adversary controlling the designated proposer's host/key (or a malicious proposer) could insert a valid-but-self-serving block that honest validators would still validate and commit. This offers weaker Byzantine guarantees than a strict `> 2/3` multi-signature quorum and is the prototype's primary accepted trade-off (see [CONSENSUS_SPEC.md](./CONSENSUS_SPEC.md#commit) and [ADR-002](./adr/ADR-002-CONSENSUS.md)).
- **File storage at rest** — default `FileStore` is un-encrypted JSON. On-chain data is hashes/proofs only (low sensitivity), but a filesystem compromise still exposes those anchors and the peer/key metadata.
- **Key management is manual** — operators are responsible for securing the PEM secret directory; there is no HSM or hardware-backed key store.
- **API exposure** — if the API is bound to a public interface without rate limiting/auth, it becomes an attack surface; deployment should keep the API private or proxied behind auth.

## Threat-to-Mitigation Matrix

| Threat | Mitigation |
|--------|------------|
| Transaction forgery | Ed25519 envelope signature + issuer authorization |
| Signature forgery | Well-established Ed25519, secure key gen, no custom crypto |
| Replay | Monotonic per-sender nonce + dedup by tx ID |
| Unauthorized issuer | Module-level issuer authorization in `validate()` |
| Unauthorized validator | Authorized validator set in state + round-robin proposer check |
| Block forgery | Hash chain (`previousHash`), Merkle root, proposer/validator signatures |
| State corruption | Deterministic replay from anchored transaction log |
| Node impersonation | Ed25519 handshake over authorized keys |
| Network abuse | Auth-only peers, rate limits, dedup, peer caps, heartbeats |
| Data leakage | Hash/proof-only on-chain; PII off-chain; no keys in API |
| Fork / reorder | PoA proposer-signature commit + hash linkage + monotonic timestamps |
| MITM | Signed envelopes + handshake verification |
| DDoS | Rate limiting, caps, dedup, eviction |
| Sybil | Permissioned identities (authorized keys only) |
| Eclipse | Seed/static config + restricted peer set |
| Injection | Input validation everywhere |
| Unauthorized access | Admin/issuer authorization checks |
| Credential forgery/replay | On-chain status + proof + issuer checks |
| Key compromise | Secure storage, no exposure, rotation support |
| State/flask splits | Deterministic PoA + sync verification |

## Related

- [SECURITY_MODEL.md](./SECURITY_MODEL.md) — mitigations overview + prototype limitations.
- [CRYPTO_SPEC.md](./CRYPTO_SPEC.md) — cryptographic primitives.
- [NETWORK_SPEC.md](./NETWORK_SPEC.md) — network authentication and protections.
- [TESTING.md](./TESTING.md) — security tests exercising these mitigations.