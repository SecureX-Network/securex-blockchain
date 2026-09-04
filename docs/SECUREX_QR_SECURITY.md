# SecureX QR Security & Privacy

## Scope

This document describes the protected SecureX QR verification reference used by
the public verification flow, the separation between internal and public
credential identifiers, and the security/privacy properties (and limits) of the
design.

## Identifiers: internal vs public

Every SecureX credential has two distinct identifiers that are never conflated:

| | Internal credential ID | Public credential ID |
|---|---|---|
| Example | `sxu-btech-2026-0001` | `SX-2F9C-A41B-8D7E` |
| Format | issuer-prefixed, sequential | `SX-XXXX-XXXX-XXXX` (uppercase hex) |
| Used by | ledger, issuer, holder/admin tooling | verification, printed credentials, QRs |
| Publicly exposed? | No | Yes |
| Generated | at issuance | at issuance (CSPRNG) |

The public ID is:

- **cryptographically random** (`crypto.randomBytes`, never `Math.random()`,
  timestamps, or sequence),
- **non-sequential** and **not derived** from the internal ID, holder, or metadata,
- **globally unique** in practice (12 hex chars = 48 bits) and additionally
  **enforced unique** at the persistence layer (collision → regenerate),
- **immutable** after issuance,
- **safe to expose publicly**.

### Mapping

```
publicCredentialId  ->  internalCredentialId
  "SX-2F9C-A41B-8D7E"     "sxu-btech-2026-0001"
```

The mapping is persisted and reverse-indexed. Public APIs resolve through this
mapping and **never return the internal credential ID across the public
boundary** (this includes success responses, NOT_FOUND responses, error
responses, and tamper-check results).

## QR protocol payload

A SecureX QR encodes a **versioned, authenticated, opaque payload**:

```
SXQR1.<opaqueToken>.<issuedAt>.<vVersion>.<signature>
```

Example (illustrative):

```
SXQR1.x7FgH2kLmN9pQrS4tUvW8yZaB3cDeF6...1780000000000.v1.<64-byte Ed25519 hex signature>
```

`qrContent` (the value rendered inside the QR image) is this opaque string. It
intentionally contains **none** of: the **public** credential ID, the internal
credential ID, holder name/email/phone/DOB/address, institution private data,
database IDs, private keys, secrets, authentication tokens, raw credential data,
or a directly usable verification URL.

The fields are:

- `SXQR1` — protocol marker (lets the SecureX scanner distinguish a SecureX QR
  from an ordinary URL or unrelated QR).
- `opaqueToken` — a 32-byte **HMAC-SHA256** binding of the public credential ID
  derived with a server-held key. It is opaque and reveals no readable credential
  identifier.
- `issuedAt` — epoch timestamp (ms) used for the **bounded lifetime** / expiry.
- `v<version>` — payload format version.
- `signature` — **Ed25519** signature (the repo's established primitive, see
  `CryptoManager`) by a server-held QR signing key over
  `sha256(canonicalJSON({ opaqueToken, issuedAt, version }))`. This authenticates
  that the payload was issued by this server.

The informational `verificationUrl` field returned by the QR reference API is
for participants/UI only and is **not** the value placed inside the QR image.

## Cryptographic / authentication construction

The full credential evidence (issuance, anchoring, hashes, status) lives on the
SecureX blockchain and is authenticated by node/issuer signatures as described
in `CRYPTO_SPEC.md` and `PROTOCOL.md`. The QR does **not** attempt to duplicate
that cryptographically-signed evidence, nor does it embed secrets.

The protected QR is **authenticated and online**:

- The QR carries an **opaque, server-authenticated reference** (an HMAC-derived
  token + an Ed25519 signature), NOT signed credential data and NOT the public ID.
- The **backend remains the ultimate trust boundary.** A scanner forwards the
  opaque payload to `POST /verify/qr`, which:
  1. parses and structurally validates the payload (marker/version/format),
  2. verifies the **Ed25519 signature** with the server QR public key,
  3. enforces the **bounded lifetime** (default 7 days),
  4. resolves the **opaque token → public ID** via a binding index derived from
     on-chain credentials,
  5. loads the on-chain credential and performs real verification,
  6. checks signatures/key status/protocol compatibility,
  7. returns a public-safe result (internal credential ID never returned).

### Why this construction

- **Established cryptography only.** The QR uses the repo's existing primitives:
  Ed25519 (`CryptoManager`) + SHA-256 (`canonicalJSON` digest) + HMAC-SHA256 +
  CSPRNG. No invented algorithms.
- **Opaque by design.** The public credential ID, internal ID, and PII are never
  placed inside the QR image — the payload carries only an opaque token the
  backend can resolve. A holder's printed QR cannot be used to read the
  credential's public ID or any private data.
- **Authenticated against forgery.** Only the server (which holds the QR signing
  key) can mint a payload that passes signature verification. A forged or
  modified QR is rejected (`invalid-signature`), and an expired one is rejected
  (`expired`).
- **No secrets in frontends.** A web-based scanner is inspectable and cannot be
  an unextractable security boundary, so we do not embed keys in frontends or
  expect client-side crypto to provide security. The signature is verified and
  resolution performed only on the backend.
- **Replay / secrecy:** the payload is still an online reference (it must be
  presented to the backend for verification). Verification security comes from
  the ledger and the backend, and the bounded lifetime limits reference reuse.

## Realistic capability statement

SecureX QRs are designed for verification through the SecureX Scanner. Third-party
QR readers may detect and decode the QR image, but the payload is an opaque,
server-authenticated token — not a public credential ID, URL, or readable
credential data — and by itself cannot be used to complete SecureX verification
outside the SecureX protocol. We do **not** claim that generic QR readers are
either physically unable to decode the image or that the raw bytes are secret
(they are not key material; security rests on the backend signature check and
token binding).

## Scanner flow

1. Acquire camera (or image) and decode QR with jsQR.
2. Check the `SXQR1.` protocol marker/version.
3. **Reject** ordinary `http`/`https`/`javascript:`/`file:` URLs, foreign
   formats, malformed payloads, and unsupported versions.
4. The SecureX payload is **opaque** — the scanner does not extract a readable
   credential ID from it and never navigates to a URL in the QR.
5. Forward the opaque payload to the SecureX backend (`POST /verify/qr`), the
   trust boundary, which authenticates and resolves it.
6. Render the public-safe verification result (which contains only the public ID).

The scanner **never** navigates to an arbitrary URL contained in a QR.

## Backend security

The backend trusts nothing from the client. It validates the opaque QR payload,
verifies the server signature, enforces expiry, resolves the opaque token to the
public ID, loads and verifies the on-chain credential, and scrubs the internal
credential ID from all public outputs. See `src/api/server.ts`
(`verifyQrReference`, `verifyCredential`, `buildVerifyResponse`,
`scrubTamperResult`) and `src/services/qr.ts` (`verifyQrPayload`).

## Key management

All key material is server/issuer side (see `CRYPTO_SPEC.md`,
`src/services/issuer-keystore.ts`, `src/services/qr-keystore.ts`). The QR signing
keypair is a server-held Ed25519 key loaded from a backend keystore directory
(`.../issuers/qr-key`, mode-0600 private key) and stable across restarts; the
private key **never** leaves the server and **never** enters frontends or QR
payloads. Private keys and secrets are never placed in frontend code or
`VITE_*` variables.

## Trust boundaries

- Frontend/scanner: inspectable; performs **format validation only** — it cannot
  authenticate or resolve the opaque payload.
- Backend verification API (`/verify/qr`): authoritative; **authenticates the
  signature, enforces the lifetime, resolves the opaque token, and verifies
  on-ledger**.
- QR content: opaque server-authenticated reference only; no secrets, PII, URLs,
  readable public IDs, or internal IDs.

## Attack scenarios & mitigations

| Attack | Mitigation |
|---|---|
| Internal ID exfiltration | Public responses scrub internal IDs at every field |
| PII or credential data in QR | QR payload is opaque and carries no PII/credential data |
| Reading the public ID / credential from the QR | Public ID is NOT in the QR; only an opaque token |
| Generic scanner sees QR | OK — payload is opaque and unusable outside SecureX |
| Arbitrary URL navigation from QR | Scanner rejects URLs/foreign protocols |
| QR forgery / replaying a fake payload | Ed25519 signature check (`invalid-signature`) |
| Tampering with the payload (issuesAt/version/etc.) | Signature covers all fields; tampering fails verification |
| Expired-stale reference reuse | `issuedAt` + TTL (default 7 days) enforced on the backend (`expired`) |
| Swapping a token from another credential | Token binding is signed; mismatches fail verification / resolution |
| Unknown/fake token | Backend resolves only known tokens (`unknown-reference`); no data leaked |
| ID guessing / enumeration | Public IDs are 48-bit CSPRNG; backend NOT_FOUND is uniform |
| Fake public ID | Backend returns NOT_FOUND; no internal data leaked |
| QR for unknown credential | `exists:false`; opaque payload; no internal identifier returned |
| Client-side tampering | Backend re-validates everything; frontend never trusted |

## What SecureX does NOT claim

- That third-party QR readers cannot detect/decode a SecureX QR image.
- That the QR alone provides tamper-evidence (source of truth is the ledger).
- That a web scanner is an unextractable security boundary.
