# CTN Blockchain REST API Specification

## Overview

The REST API is the client-facing HTTP interface to a node, built on **Express**. It allows clients to submit transactions, query blocks and transactions, inspect state, and interact with the network. The API itself exposes **no private keys** and returns **no sensitive data** beyond what is already on-chain.

## Base URL

- **Configurable** per node via configuration.
- Default: **`http://localhost:3001`**

All endpoints are JSON. Requests and responses use `application/json`.

## Response Envelope

Every response uses a uniform envelope:

```json
{
  "success": true,
  "data": { "..." }
}
```

On failure, `error` is a **string error code** (backward-compatible with V2 clients), with a human-readable `message` and a structured `errorCode` for richer clients:

```json
{
  "success": false,
  "error": "UNKNOWN_CREDENTIAL",
  "message": "Credential not found",
  "errorCode": "UNKNOWN_CREDENTIAL"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether the request succeeded |
| `data` | object/array/null | Payload on success |
| `error` | string/null | Error code string on failure |
| `message` | string | Human-readable detail on failure |
| `errorCode` | string | Structured error code on failure |

## Error Codes

| Code | Meaning |
|------|---------|
| `INVALID_SIGNATURE` | Transaction or message signature failed verification |
| `UNAUTHORIZED_ISSUER` | Sender is not authorized for the referenced issuer |
| `UNKNOWN_ISSUER` | Referenced issuer does not exist |
| `UNKNOWN_CREDENTIAL` | Referenced credential does not exist |
| `INVALID_TRANSACTION` | Transaction failed validation |
| `INVALID_NONCE` | Nonce not strictly increasing |
| `INVALID_PAYLOAD` | Payload failed module validation |
| `BLOCK_NOT_FOUND` | Requested block not found |
| `TRANSACTION_NOT_FOUND` | Requested transaction not found |
| `INVALID_INPUT` | Malformed request body or parameters |
| `INVALID_REQUEST_BODY` | Request body is malformed or exceeds the configured limit |
| `UNAUTHORIZED` | Caller lacks required permission (e.g. admin-only) |
| `INTERNAL_ERROR` | Unexpected server error |

## Endpoints

### `GET /health`

Node health and identity.

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "version": "0.1.0",
    "nodeId": "<hex(publicKey)>",
    "uptimeSeconds": 4821,
    "height": 42
  }
}
```

### `GET /blocks`

List blocks (newest or oldest first, configurable). Supports pagination.

| Query | Type | Default | Description |
|-------|------|---------|-------------|
| `offset` | number | `0` | Starting index |
| `limit` | number | `10` | Max results per page |

```json
{
  "success": true,
  "data": {
    "blocks": [ { "...block..." } ],
    "offset": 0,
    "limit": 10,
    "total": 42
  }
}
```

Query: `GET /blocks?offset=0&limit=10`

### `GET /blocks/:height`

Get a single block by height.

```json
{
  "success": true,
  "data": { "...block..." }
}
```

### `GET /blocks/hash/:hash`

Get a single block by its block hash.

```json
{
  "success": true,
  "data": { "...block..." }
}
```

### `GET /transactions/:id`

Get a transaction by ID, including which block committed it.

```json
{
  "success": true,
  "data": {
    "transaction": { "...transaction..." },
    "blockHeight": 42
  }
}
```

### `POST /transactions`

Submit a signed transaction to be validated, pooled, and eventually committed.

**Request body:** the complete signed transaction envelope (see [TRANSACTION_SPEC.md](./TRANSACTION_SPEC.md)).

```json
{
  "success": true,
  "data": {
    "txId": "<uuid-v4>",
    "status": "received",
    "height": null
  }
}
```

On validation failure:

```json
{
  "success": false,
  "data": null,
  "error": { "code": "INVALID_SIGNATURE", "message": "..." }
}
```

### `GET /state/issuers`

List all registered issuers.

```json
{
  "success": true,
  "data": { "issuers": [ { "...issuer..." } ] }
}
```

### `GET /state/issuers/:id`

Get a single issuer by ID.

```json
{
  "success": true,
  "data": { "issuer": { "...issuer..." } }
}
```

### `GET /state/credentials/:id`

Get the current state of a credential.

```json
{
  "success": true,
  "data": {
    "credential": {
      "credentialId": "<uuid-v4>",
      "issuerId": "<uuid-v4>",
      "credentialHash": "<sha256-hex>",
      "status": "issued",
      "schemaVersion": "1.0",
      "committedHeight": 42
    }
  }
}
```

### `GET /state/credentials/:id/history`

Get the full lifecycle history of a credential (issue → suspend → revoke → reissue, etc.).

```json
{
  "success": true,
  "data": {
    "history": [
      { "type": "CREDENTIAL_ISSUE", "height": 10, "timestamp": "..." },
      { "type": "CREDENTIAL_SUSPEND", "height": 20, "timestamp": "..." }
    ]
  }
}
```

### `POST /state/credentials/:id/proof`

Generate a **Merkle inclusion proof** proving the credential hash is anchored in a committed block.

**Request body:** `{ "blockHeight": 42 }` (optional; defaults to the block that committed the credential).

```json
{
  "success": true,
  "data": {
    "credentialHash": "<sha256-hex>",
    "blockHeight": 42,
    "blockHash": "<sha256-hex>",
    "merkleRoot": "<sha256-hex>",
    "proof": ["<sibling hashes...>"],
    "leafHash": "<sha256-hex>"
  }
}
```

### `GET /state/validators`

List the current authorized validators.

```json
{
  "success": true,
  "data": { "validators": [ { "nodeId": "<hex(publicKey)>", "active": true } ] }
}
```

### `GET /network/peers`

List currently connected peers.

```json
{
  "success": true,
  "data": {
    "peers": [
      { "nodeId": "<hex(publicKey)>", "address": "ws://...", "state": "CONNECTED" }
    ]
  }
}
```

### `GET /network/status`

Network status: height, peer count, consensus info.

```json
{
  "success": true,
  "data": {
    "height": 42,
    "peerCount": 4,
    "consensus": "PoA",
    "proposer": "<hex(publicKey)>",
    "validators": 4
  }
}
```

### `POST /nodes/register`

Register a new node as authorized on the network.

> **Admin only.** Requires administrative authorization.

```json
{
  "success": true,
  "data": { "nodeId": "<hex(publicKey)>", "status": "registered" }
}
```

## Production-hardening endpoints

### `GET /state/keys`

List all registered signing keys.

```json
{ "success": true, "data": [ { "keyId": "...", "ownerId": "...", "status": "ACTIVE" } ] }
```

### `GET /state/keys/:id` · `GET /state/keys/owner/:ownerId`

Get a single key, or all keys owned by a given identity.

### `GET /state/issuers/:id/history`

Lifecycle/history for an issuer (registration and updates).

```json
{ "success": true, "data": [ { "type": "ISSUER_REGISTER", "blockHeight": 1, "blockHash": "..." } ] }
```

### `GET /state/credentials/:id/evidence`

Security evidence bundle for a credential: verification status, issuance transaction, containing block, Merkle proof validity, issuer identity, and lifecycle history.

```json
{
  "success": true,
  "data": {
    "credentialId": "...",
    "status": "VALID",
    "verification": { "..." },
    "transaction": { "..." },
    "block": { "..." },
    "merkleProofValid": true,
    "issuer": { "issuerId": "...", "publicKey": "..." },
    "lifecycle": [ { "..." } ],
    "anchor": { "txId": "...", "blockHeight": 3, "blockHash": "..." },
    "verifiedAt": "..."
  }
}
```

### `POST /contracts/tamper-check`

Verify a presented document hash against the on-chain `credentialHash` anchor.

**Request body:** `{ "credentialId": "...", "documentHash": "<sha256-hex>" }`

```json
{
  "success": true,
  "data": {
    "status": "EXACT" | "TAMPERED" | "UNVERIFIABLE",
    "hashMatch": true,
    "anchoredHash": "<sha256-hex>"
  }
}
```

A mismatch is recorded as a `MERKLE_VERIFICATION_FAILURE` audit event.

### `POST /contracts/fraud/anchor`

Return the on-chain anchor evidence for a credential (used for fraud investigation workflows).

### `GET /audit/events` · `GET /audit/summary`

Query recent audit events (bounded, paginated) and a summary of event counts by severity type.

```json
{ "success": true, "data": [ { "type": "CREDENTIAL_ISSUED", "severity": "info", "referenceId": "...", "timestamp": "..." } ] }
```

### `GET /openapi.json`

Serve the OpenAPI document describing the API surface (returned as the raw document body).

## Security Notes

- **No private keys** are ever exposed through the API. The node's private key is used only internally for signing, never returned.
- All inputs (query params, path params, request bodies) are validated to prevent injection and malformed-data errors (`INVALID_INPUT`).
- Responses contain only on-chain data (hashes, proofs, registry entries), never raw credential PII.
