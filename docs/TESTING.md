# CTN Blockchain Testing Strategy

## Overview

Testing uses **Jest** with the **ts-jest** preset. Tests are organized by purpose under `tests/` and runnable via dedicated npm scripts.

```
tests/
├── unit/          # Unit tests (pure functions, primitives)
├── integration/   # Integration tests (node + chain behavior)
├── security/      # Security/attack tests
└── network/       # Multi-node network tests
```

## Test Commands

| Command | Scope |
|---------|-------|
| `npm test` | Run the full suite (`--forceExit`, detects open handles) |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests only |
| `npm run test:security` | Security tests only |
| `npm run test:network` | Network tests only |
| `npm run lint` | Typecheck (`tsc --noEmit`) |

Configuration lives in `jest.config.js` (`preset: 'ts-jest'`, `testEnvironment: 'node'`, roots under `tests/`, 30s timeout).

## Unit Tests

Pure-function correctness of primitives:

- **Hashing** — SHA-256 returns 64-char hex; known-vector checks.
- **Canonicalization** — deterministic JSON: sorted keys, no whitespace, stable across serialization order.
- **Signatures** — Ed25519 sign/verify roundtrip; wrong-key and tampered-data verification fails.
- **Transaction validation** — per-type validation rules (required fields, authz, uniqueness).
- **Block hashing** — header hash independent of `validatorSignatures`; matches spec formula.
- **Merkle tree** — roots stable for a given leaf set; odd-leaf promotion; inclusion proofs verify.
- **State transitions** — each module's `apply()` mutates state correctly and deterministically.
- **Nonces** — nonce enforcement (strictly increasing per sender; replay rejected).

## Integration Tests

End-to-end behavior of a composed node:

- **Node startup** — keys load/generate, stores initialize, API and P2P servers bind.
- **Transaction submission** — submit via API → validated → pooled → committed to a block.
- **Block creation** — proposer builds blocks from pending txs within size limits.
- **Consensus** — the proposer commits a block; all validators validate and commit the same block, so block order is deterministic.
- **Node sync** — a fresh node syncs the full chain from a peer and matches the canonical tip.
- **Credential lifecycle** — issue → verify hash → suspend → reinstate → revoke → reissue.
- **Key rotation** — register a key, rotate it, confirm old key superseded.
- **Auth boundary & new endpoints** (`tests/integration/api.test.ts`) — public vs. privileged endpoint classification, `/state/keys`, `/audit/events`, `/contracts/tamper-check`, `/openapi.json`, and **state persistence across a node restart** (same dataDir).
- **Demo-data pipeline** (`tests/integration/demo.test.ts`) — seeds fictional `demo:true` institutions/credentials and asserts their lifecycle states via the real verification endpoint.

## Production-hardening tests (unit)

New primitives added alongside the 0.3.0 hardening:

- **Config** — `.env` loading, env-override parsing, `normalizeConfig` default-filling, and CORS request limits.
- **Middleware** — CORS allow/deny, request-id preservation, `okResponse`/`failResponse` envelopes, body-parser/final error handlers, and bounded `paginate`.
- **Audit** — event recording, capped buffer, severity mapping, and tamper/state-validation event emission.
- **History** — credential/issuer history, bounded query limits, lifecycle summaries.
- **Tamper-check** — EXACT/TAMPERED/UNVERIFIABLE document-hash comparisons and audit-event emission.
- **Expanded verification** — `EXPIRED` status by expiry metadata, `keyStatus`, `protocolCompatible`, `verifiedAt`, inactive-issuer INVALID.
- **V2 authorization** — only the issuer-derived (or issuerId-bound) sender may suspend/revoke/reinstate its credentials; unauthorized V2 actors are rejected.
- **Security** — malformed payloads rejected, `onRejected` notifications, unknown-proposer block rejection.

These build chains through the real transaction pipeline using the shared builders in `tests/helpers-v2.ts`. No state is ever fabricated directly.

## Security Tests

Attack-oriented tests proving mitigations:

- **Forged signature** — a transaction with an invalid signature is rejected.
- **Modified payload** — altering any payload field after signing breaks verification.
- **Replay attack** — re-submitting an already-committed transaction (or duplicate nonce) is rejected.
- **Unauthorized issuer** — a non-issuer (or wrong issuer) cannot issue credentials.
- **Unauthorized validator** — a non-validator's block proposal/endorsement is rejected.
- **Invalid block** — malformed header, wrong merkle root, oversize block rejected.
- **Invalid previous hash** — block whose `previousHash` doesn't match the parent is rejected.
- **Merkle proof failure** — a proof from the wrong tree/root fails verification.
- **Non-monotonic timestamps** — blocks with timestamps older than the parent are rejected.

## Network Tests

Multi-node behavior with real WebSocket connections:

- **Multi-node messaging** — several nodes exchange transactions and blocks.
- **Disconnect/reconnect** — peer removal on disconnect; reconnection via peer store.
- **Ledger sync** — late-joining node catches up to the tip with identical blocks.
- **Duplicate propagation** — duplicate transactions/blocks are not reprocessed.
- **Authentication** — unauthenticated/un-authorized peers are refused.
- **Heartbeat/liveness** — stale peers are detected and evicted.

## Coverage

Coverage is collected from `src/**/*.ts` into `coverage/`. The goal is strong coverage on the cryptographic, validation, consensus, and state-transition paths (the parts where bugs are security-relevant).

## Continuous Verification

- Run `npm run lint` (`tsc --noEmit`) before and after changes to guarantee no type regressions.
- Run the relevant test tier (`npm run test:unit` / `:security`, etc.) alongside changes.
- Full `npm test` before release.