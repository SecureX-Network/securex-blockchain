# CTN Blockchain Cryptography Specification

## Overview

CTN Blockchain uses only **standard, well-established cryptographic primitives**, sourced from Node.js's built-in `crypto` module. There are **no custom cryptographic primitives** anywhere in the codebase. This reduces risk and eases audit.

| Use | Primitive | Source |
|-----|-----------|--------|
| Hashing | SHA-256 | Node.js `crypto` |
| Signatures | Ed25519 | Node.js `crypto.generateKeyPairSync` / `sign` / `verify` |
| Key generation | Ed25519, 32-byte seed | Node.js `crypto` |
| IDs | UUID v4 | `uuid` library |

## Hashing (SHA-256)

- All hashing uses **SHA-256** via Node.js `crypto.createHash('sha256')`.
- Output is always a **64-character lowercase hex string**.
- Used for: transaction canonical bytes, block hashes, Merkle tree nodes, and credential anchors.

```
sha256Hex(input: Buffer | string) -> string   // 64 lowercase hex chars
```

## Signatures (Ed25519)

- All signatures use **Ed25519**.
- Node.js `crypto.sign(null, data, privateKey)` produces an Ed25519 signature; `crypto.verify(null, data, publicKey, signature)` verifies it.
- Signature output is hex-encoded (128 hex chars).

## Key Format

| Context | Format |
|---------|--------|
| **Internal storage** | PEM-encoded (`crypto.generateKeyPairSync('ed25519')` returns PEM key objects) |
| **Identifiers / on-chain** | Public key as **hex** (derived from the PEM public key's raw bytes) |

Private keys are stored as PEM on disk in the config/secrets directory, never hardcoded and never exposed (see [SECURITY_MODEL.md](./SECURITY_MODEL.md#key-management)).

## Node Identity

- Every node owns an **Ed25519 key pair**.
- **Node ID = `hex(publicKey)`**.
- This ID is used in the protocol envelope (`nodeId`), peer identification, and authorization checks.

## Node Key Generation

- Keys are generated with `crypto.generateKeyPairSync('ed25519')`.
- Ed25519 uses a **32-byte seed** internally; Node.js manages this transparently.
- Generated key pairs are persisted (PEM) so a node retains a stable identity across restarts.

## Transaction Signing

- The sender signs the **canonical JSON** of all transaction fields **except `signature`** (see [TRANSACTION_SPEC.md](./TRANSACTION_SPEC.md#canonical-serialization-for-signing)).

```
canonicalBytes = canonicalJson({ protocolVersion, transactionVersion, id, type,
                                 timestamp, sender, nonce, payload })
signature = ed25519.sign(privateKey, canonicalBytes)
```

## Block Signing

- The proposer and validators sign the **canonical header**:
  `height + timestamp + previousHash + merkleRoot + proposerId`
- The signature is computed over the canonical JSON of the header **excluding** `validatorSignatures` (see [BLOCK_SPEC.md](./BLOCK_SPEC.md#block-hash)).

```
headerBytes = canonicalJson({ version, height, timestamp, previousHash,
                              merkleRoot, proposerId, nonce })
signature = ed25519.sign(privateKey, headerBytes)
```

## Merkle Tree

- Built from **SHA-256** hashes.
- **Leaf nodes** — the transaction hashes (SHA-256 of each transaction's canonical bytes), or credential hashes for batch anchors.
- **Internal nodes** — `sha256(leftHash + rightHash)` (concatenated bytes).
- **Odd element handling** — when a level has an odd count, the last element is **promoted** (duplicated) to the next level rather than re-hashed invalidly.
- **Root** — the single hash at the top is the Merkle root, a 64-char hex string committed in the block header.

Standard rule:

```
hash(node) = len == 1 ? node
           : len == 2 ? sha256(a + b)
           : sha256(hash(first half as tree) + hash(second half as tree))
```

(Or the simpler iterative pairing with promotion — the exact strategy is validated by tests to produce stable roots.)

## Inclusion Proofs

- A **Merkle inclusion proof** is the sibling hashes along the path from a leaf to the root, plus the root itself.
- It lets a verifier confirm a leaf is part of the committed tree **without** downloading every transaction.
- Used by `POST /state/credentials/:id/proof` (see [API_SPEC.md](./API_SPEC.md)).

## No Custom Crypto

The project explicitly forbids hand-rolled cryptography. Only Node.js built-ins and widely-audited libraries are permitted. Any use of `createHash`/`sign`/`verify` beyond the standard helpers must be justified.
