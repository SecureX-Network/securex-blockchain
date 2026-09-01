# CTN Blockchain Transaction Specification

## Overview

A transaction is the fundamental unit of state change on the CTN Blockchain. Every transaction is cryptographically signed by its sender and validated both generically (by the core) and domain-specifically (by an application module).

## Transaction Envelope

```json
{
  "protocolVersion": "1.0",
  "transactionVersion": 1,
  "id": "<uuid-v4>",
  "type": "CREDENTIAL_ISSUE",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "sender": "<hex(publicKey)>",
  "nonce": 7,
  "payload": { "...": "type-specific..." },
  "signature": "<hex(Ed25519 signature)>"
}
```

### Envelope Fields

| Field | Type | Description |
|-------|------|-------------|
| `protocolVersion` | string | Protocol version, fixed `"1.0"` |
| `transactionVersion` | number | Transaction format version, currently `1` |
| `id` | string | UUID v4 (stored/compared as hex) |
| `type` | string | Transaction type enum (see below) |
| `timestamp` | string | ISO 8601 timestamp in UTC |
| `sender` | string | Sender's node public key as hex |
| `nonce` | number | Monotonic per-sender integer counter |
| `payload` | object | Type-specific payload |
| `signature` | string | Ed25519 signature over canonical bytes of all fields **except** `signature` |

## Transaction Types and Payloads

### `ISSUER_REGISTER`

Registers a new issuer with the network.

```json
{
  "issuerId": "<uuid-v4>",
  "name": "Acme University",
  "publicKey": "<hex(Ed25519 public key)>",
  "metadata": { "country": "US", "type": "university" }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issuerId` | string (uuid) | yes | Unique issuer identifier |
| `name` | string | yes | Human-readable issuer name |
| `publicKey` | string (hex) | yes | Issuer's Ed25519 verification key |
| `metadata` | object | no | Optional metadata (JSON) |

### `ISSUER_UPDATE`

Updates an existing issuer's details.

```json
{
  "issuerId": "<uuid-v4>",
  "changes": { "name": "Acme University (renamed)" }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issuerId` | string (uuid) | yes | Issuer being updated |
| `changes` | object | yes | Partial update to name/publicKey/metadata |

### `CREDENTIAL_ISSUE`

Anchors a credential hash on-chain. This is the core of credential verification — only the hash is stored, never the data.

```json
{
  "credentialId": "<uuid-v4>",
  "issuerId": "<uuid-v4>",
  "credentialHash": "<sha256-hex>",
  "schemaVersion": "1.0",
  "metadata": { "title": "Bachelor of Science", "issuedAt": "2024-01-01" }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentialId` | string (uuid) | yes | Unique credential identifier |
| `issuerId` | string (uuid) | yes | Issuing entity |
| `credentialHash` | string (hex) | yes | SHA-256 of canonical credential data |
| `schemaVersion` | string | yes | Credential schema version |
| `metadata` | object | no | Optional non-sensitive metadata |

### `CREDENTIAL_REVOKE`

Revokes a previously issued credential.

```json
{
  "credentialId": "<uuid-v4>",
  "reason": "Issued in error",
  "timestamp": "2024-01-02T00:00:00.000Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentialId` | string (uuid) | yes | Credential to revoke |
| `reason` | string | yes | Human-readable reason |
| `timestamp` | string (ISO 8601) | yes | When the revocation takes effect |

### `CREDENTIAL_SUSPEND`

Temporarily suspends a credential (reversible).

```json
{
  "credentialId": "<uuid-v4>",
  "reason": "Under investigation"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentialId` | string (uuid) | yes | Credential to suspend |
| `reason` | string | yes | Reason for suspension |

### `CREDENTIAL_REINSTATE`

Lifts a suspension.

```json
{
  "credentialId": "<uuid-v4>",
  "reason": "Investigation resolved"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentialId` | string (uuid) | yes | Credential to reinstate |
| `reason` | string | yes | Reason for reinstatement |

### `CREDENTIAL_REISSUE`

Reissues a credential, linking a new credential to the revoked old one.

```json
{
  "credentialId": "<uuid-v4>",
  "newCredentialId": "<uuid-v4>",
  "newCredentialHash": "<sha256-hex>",
  "reason": "Metadata corrected"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `credentialId` | string (uuid) | yes | Original credential being replaced |
| `newCredentialId` | string (uuid) | yes | New credential identifier |
| `newCredentialHash` | string (hex) | yes | SHA-256 of the reissued credential |
| `reason` | string | yes | Reason for reissue |

### `KEY_REGISTER`

Registers a new cryptographic key (used by issuers or nodes).

```json
{
  "keyId": "<uuid-v4>",
  "algorithm": "Ed25519",
  "publicKey": "<hex(publicKey)>",
  "purpose": "signing"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `keyId` | string (uuid) | yes | Key identifier |
| `algorithm` | string | yes | Key algorithm (e.g. `"Ed25519"`) |
| `publicKey` | string (hex) | yes | The public key value |
| `purpose` | string | yes | Purpose (e.g. `"signing"`) |

### `KEY_ROTATE`

Rotates a key from an old key to a new one.

```json
{
  "oldKeyId": "<uuid-v4>",
  "newKeyId": "<uuid-v4>",
  "newPublicKey": "<hex(publicKey)>"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `oldKeyId` | string (uuid) | yes | Key being replaced |
| `newKeyId` | string (uuid) | yes | Replacement key identifier |
| `newPublicKey` | string (hex) | yes | Replacement public key |

### `BATCH_ANCHOR`

Anchors a batch of multiple credentials via a Merkle root, allowing efficient bulk anchoring.

```json
{
  "batchId": "<uuid-v4>",
  "merkleRoot": "<sha256-hex>",
  "credentialCount": 1000,
  "schemaVersion": "1.0"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `batchId` | string (uuid) | yes | Batch identifier |
| `merkleRoot` | string (hex) | yes | SHA-256 Merkle root of all credential hashes in the batch |
| `credentialCount` | number | yes | Number of credentials in the batch |
| `schemaVersion` | string | yes | Credential schema version |

## Type Enum

| Value | Description |
|-------|-------------|
| `ISSUER_REGISTER` | Register an issuer |
| `ISSUER_UPDATE` | Update an issuer |
| `CREDENTIAL_ISSUE` | Anchor a credential hash |
| `CREDENTIAL_REVOKE` | Revoke a credential |
| `CREDENTIAL_SUSPEND` | Suspend a credential |
| `CREDENTIAL_REINSTATE` | Reinstate a credential |
| `CREDENTIAL_REISSUE` | Reissue a credential |
| `KEY_REGISTER` | Register a key |
| `KEY_ROTATE` | Rotate a key |
| `BATCH_ANCHOR` | Anchor a batch of hashes |

## Canonical Serialization for Signing

The signature is computed over a **canonical serialization** of the transaction to guarantee that any two implementations reproduce identical bytes:

- **Sorted keys** — object keys are sorted lexicographically (recursively for nested objects).
- **No whitespace** — deterministic, compact JSON (no spaces, delimiters per JSON spec).
- Arrays preserve their order.

The canonical form includes all envelope fields **except `signature`**. This ensures the signature binds to every field that matters and avoids self-referential hashing.

```
canonicalBytes = canonicalJson({
  protocolVersion, transactionVersion, id, type,
  timestamp, sender, nonce, payload
})
signature = ed25519.sign(secretKey, canonicalBytes)
```

## Transaction ID

The transaction `id` is a **UUID v4**, stored and compared as **hex** (i.e. the canonical 32-hex-char form without hyphens, or the standard hyphenated form, consistently normalized by the core).

## Validation Rules by Type

Every transaction is first validated generically by the core, then domain-validated by its module.

### Generic validation (all types)

- `protocolVersion === "1.0"` and `transactionVersion === 1`.
- `id` is a valid UUID v4.
- `type` is a known, registered transaction type.
- `timestamp` is a valid ISO 8601 UTC timestamp, not in the future beyond a tolerance.
- `sender` is a well-formed hex public key.
- `nonce` is an integer, strictly greater than the sender's last observed nonce (replay protection).
- `signature` verifies with Ed25519 against `sender` over the canonical bytes.

### Type-specific validation

| Type | Specific rules |
|------|----------------|
| `ISSUER_REGISTER` | `issuerId` unique; `name` non-empty; `publicKey` valid Ed25519 hex; caller authorized to register issuers |
| `ISSUER_UPDATE` | `issuerId` exists; `changes` contains at least one valid field; caller authorized for that issuer |
| `CREDENTIAL_ISSUE` | `issuerId` exists and is active; `credentialHash` is 64 hex chars (SHA-256); `credentialId` unique; caller is the authorized issuer |
| `CREDENTIAL_REVOKE` | `credentialId` exists and is currently issued; caller authorized for the originating issuer |
| `CREDENTIAL_SUSPEND` | `credentialId` exists and is not already suspended/revoked; caller authorized |
| `CREDENTIAL_REINSTATE` | `credentialId` exists and is currently suspended; caller authorized |
| `CREDENTIAL_REISSUE` | `credentialId` exists and is revoked/suspended; `newCredentialHash` valid; caller authorized |
| `KEY_REGISTER` | `algorithm` supported; `publicKey` valid; `keyId` unique; `keyId` not already known |
| `KEY_ROTATE` | `oldKeyId` exists; `newKeyId` new; `newPublicKey` valid; caller authorized for `oldKeyId` |
| `BATCH_ANCHOR` | `merkleRoot` is 64 hex chars; `credentialCount` positive; caller authorized to anchor batches |

## State Effects (Apply)

On commit, each module's `apply()` mutates the relevant state registries:

- **Issuers module** — adds/updates entries in the issuer registry.
- **Credentials module** — tracks credential lifecycle state per `credentialId`.
- **Revocation module** — transitions credential status (issued → revoked / suspended / reinstated).
- **Keys module** — records registered keys and rotation lineage.

These transitions are deterministic and replayed identically by every validator for a given ordered block.
