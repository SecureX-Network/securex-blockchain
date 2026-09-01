# Consensus Specification

CTN Blockchain uses a **lightweight Proof-of-Authority (PoA)** consensus with
deterministic round-robin block production. This is a private, permissioned
consensus designed for a known set of authorized validator nodes — **not**
Proof-of-Work, mining, or a public anonymous validator set.

## Why PoA

| Requirement              | PoA  | PBFT | PoW  |
|--------------------------|------|------|-----|
| Correctness              | ✓    | ✓    | ✓    |
| Determinism              | ✓    | ✓      | probabilistic |
| Fault handling           | ✓    | ✓    | ✓ (high energy) |
| Simplicity               | ✓    | ✗    | ✗    |
| Demonstrability          | ✓    | ✗    | ✗    |
| Testability              | ✓    | ✗    | ✗    |
| No energy waste (private)| ✓    | ✓    | ✗    |

PoA is the right fit for a hackathon prototype: it is deterministic, simple
enough to verify by judges, requires no crypto-mining, and works with a small
trusted validator set.

## Validator Set

The validator set is **fixed at genesis** and maintained in on-chain state
(`ValidatorRecord`). A block is valid only if its proposer is an **ACTIVE**
validator in this set. Unknown or inactive validators cannot propose.

Because the validator set is defined by node IDs at genesis and nodes exchange
their public keys via the authenticated network handshake, every validator can
independently verify the block signature of every other validator.

## Round-Robin Proposer Rotation

Block production is driven by a deterministic schedule:

```
proposerIndex = chainHeight % validatorCount
proposer = validators[proposerIndex]
```

For the next height (`chainHeight + 1`), the designated proposer is the
validator at index `(chainHeight + 1) % validatorCount`. Since all honest
nodes derive the same proposer from the current chain height, there is a
**single expected proposer per height** — this prevents forks by construction.

## Block Lifecycle

1. **Transaction collection** — A transaction submitted to any node is
   validated locally, added to the node's pending pool, and flooded to peers
   via authenticated `TX_BROADCAST`. Honest nodes converge on the same
   pending transaction set.

2. **Proposal** — When it is the node's turn to propose and it has pending
   transactions, the proposer:
   - Builds a block (header + transactions + merkle root + previous hash)
   - Computes the block hash from the header
   - Signs the header with its private key (`validatorSignatures`)

3. **Local commit** — The proposer validates and commits the block locally.

4. **Broadcast & replication** — The proposer floods the signed block via
   authenticated `BLOCK_BROADCAST`. Every receiving node:
   - Verifies the block signature (proposer public key from state, or the
     authenticated peer public key if not yet in state)
   - Independently validates the block: version, height, previous hash,
     merkle root, proposer authorization, and **every transaction**
   - Applies the block to its own state deterministically

5. **Convergence** — Because block validation is deterministic and every
   honest node applies the same transaction set in the same order, all honest
   nodes converge on identical chain state and height. A background sync
   protocol (`SYNC_REQUEST`/`SYNC_RESPONSE`) heals any node that missed a
   broadcast (e.g., was offline or disconnected during handshake).

## Fault Model

The prototype makes **no claim of Byzantine fault tolerance**. What it
supports:

- **Crash/liveness recovery**: If a node misses a block broadcast (was
  starting up, reconnecting, or temporarily partitioned), the periodic sync
  protocol re-synchronizes it to the current chain tip. No state is lost.
- **Byzantine-fault rejection**: A single malicious validator that proposes
  an invalid block is rejected by all honest nodes (invalid previous hash,
  invalid merkle root, invalid signature, or invalid transactions are all
  caught by independent validation). However, if an ACTIVE proposer is
  malicious and never proposes during its own turn, new blocks stall until
  the malicious proposer's slot passes or is removed. **Automatic view-change
  / proposer skip is not implemented** in the prototype.
- **Honest-note convergence**: With all honest nodes connected, N honest
  validators produce and replicate the same chain definitively.

## Duplicate & Fork Prevention

- **Replay protection**: Each valid transaction may only be applied once
  (nonce strictly increases per sender; transactions are also deduplicated by
  transaction ID in the block store).
- **Deterministic proposer**: Only one validator is expected to propose a
  given height, preventing concurrent-block forks.
- **Duplicate block rejection**: A node rejects a block whose height + hash
  it already stores.

## Compatibility

Not implemented in v1.0 (future work, documented in `EXTENSIBILITY.md`):

- Multi-signature quorum voting (collect >2/3 validator signatures per block)
- Automatic proposer skip / view-change on proposer failure
- Formal BFT/fault-tolerance proofs and simulation harnesses