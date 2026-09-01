# CTN Blockchain Block Specification

## Overview

A block is the unit of committed transaction history. Blocks are linked into a chain by hashing, produced by a PoA-designated proposer, and verified by validators before commit.

## Block Structure

```json
{
  "header": {
    "version": 1,
    "height": 42,
    "timestamp": "2024-01-01T00:00:00.000Z",
    "previousHash": "<sha256-hex>",
    "merkleRoot": "<sha256-hex>",
    "proposerId": "<hex(publicKey)>",
    "validatorSignatures": [
      { "validatorId": "<hex(publicKey)>", "signature": "<hex(Ed25519)>" }
    ],
    "nonce": 0
  },
  "transactions": [ "...signed transactions..." ]
}
```

## Block Header

| Field | Type | Description |
|-------|------|-------------|
| `version` | number | Block format version, currently `1` |
| `height` | integer (uint64) | Zero-indexed block number; genesis is `0` |
| `timestamp` | string (ISO 8601) | Block creation time in UTC |
| `previousHash` | string (hex) | SHA-256 hash of the parent block |
| `merkleRoot` | string (hex) | SHA-256 root of the transaction Merkle tree |
| `proposerId` | string (hex) | Public key of the block proposer for this round |
| `validatorSignatures` | array | Validator endorsements; each `{ validatorId, signature }` |
| `nonce` | number | Round/adjustment nonce (used for PoA round bookkeeping, **not** mining) |

## Block Body

| Field | Type | Description |
|-------|------|-------------|
| `transactions` | array | The ordered, signed transactions included in this block |

The Merkle root commits to the ordered set of transactions. Any change to any transaction, or to the ordering, produces a different `merkleRoot` and thus a different block hash.

## Block Hash

The block hash is computed in two steps so that validator signatures can be added without invalidating the proposal hash:

1. **Canonical header without signatures** — serialize the header (all fields **except** `validatorSignatures`) into canonical JSON (sorted keys, no whitespace).
2. **Hash** — compute `blockHash = SHA-256(canonicalHeaderWithoutSignatures)`.

Validator signatures are then appended as part of the block body/header but are **not** included in the block-hash computation. This means:

- The proposer can broadcast the block with an agreed hash before any further signatures are gathered.
- Each validator can verify the exact same block hash against the proposer's signature.
- The committed block's identity (block hash) is stable regardless of which validators signed.

## Genesis Block

The genesis block has a fixed, well-defined form:

| Field | Value |
|-------|-------|
| `height` | `0` |
| `previousHash` | `0000...0` (64 zero hex characters) |
| `transactions` | empty array |
| `timestamp` | the network start time (configured) |
| `merkleRoot` | SHA-256 of an empty Merkle tree (hash of nothing / configured constant) |
| `proposerId` | the bootstrap proposer/validator |
| `validatorSignatures` | may be empty at genesis |

Because `previousHash` is all zeros and there are no parent transactions, the genesis block is the immutable trust anchor from which all other blocks chain.

## Chain Integrity Rules

Every non-genesis block MUST satisfy:

- **Monotonic timestamps** — `block.timestamp` must be greater than or equal to the parent's timestamp (within a configurable tolerance to account for clock skew). This prevents time-based reordering attacks.
- **Previous hash match** — `block.header.previousHash` must equal `SHA-256(parent.header)` (the parent's block hash). This binds the chain and makes any tampering evident.
- **Height continuity** — `block.header.height === parent.height + 1`.
- **Merkle consistency** — the computed transaction Merkle root must equal `header.merkleRoot`.
- **Proposer authorization** — `header.proposerId` must be the designated round-robin proposer for `height`.
- **Proposer signature** — `validatorSignatures` must contain the proposer's valid Ed25519 signature over the block; any validator signatures present are verified against the authorized validator set. The prototype commits with a single proposer signature (`minSignatures = 1`).

## Block Size Limits

Block size limits are **configurable** per node and enforced during validation:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxBlockBytes` | configurable | Maximum serialized block size in bytes |
| `maxTransactionsPerBlock` | configurable | Maximum number of transactions per block |
| `maxTransactionBytes` | configurable | Maximum serialized transaction size in bytes |

Proposing nodes build blocks within these limits; validating nodes reject blocks exceeding them.

## Committed vs. Proposed

- **Proposed** — a candidate block built and signed by the proposer.
- **Committed** — a block that has been validated and applied to state (single-proposer commit in the prototype).

Only committed blocks are returned by chain queries and replicated during sync. Pending/proposed blocks are tracked separately during consensus.
