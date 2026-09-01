# CTN Blockchain Extensibility Design

## Overview

CTN Blockchain is architected so the **blockchain core is domain-agnostic** and domain logic lives in pluggable **application modules**. Adding a new domain (e.g. employment credentials) requires no changes to consensus, networking, storage, or the generic transaction pipeline.

## Module Registry

The core maintains a **module registry**: a map from transaction type → module.

```ts
interface TransactionModule {
  /** The transaction type this module handles, e.g. "CREDENTIAL_ISSUE". */
  readonly type: string;

  /** Validate a typed payload. Returns errors or null. */
  validate(tx: Transaction): ValidationResult;

  /** Apply the state transition for a committed transaction. */
  apply(tx: Transaction, state: State): void;
}
```

### How the Core Uses Modules

1. A transaction arrives (API or peer).
2. The core generically validates the envelope: signature, sender, nonce, timestamp, type-registry membership.
3. The core looks up `type` in the module registry and calls `module.validate(tx)` for domain-specific checks.
4. On commit, the core calls `module.apply(tx, state)`, mutating the relevant state namespaces deterministically.

Because the core only invokes these callbacks, **core code never references credentials, issuers, or revocation logic**.

## Adding a New Module

To add a new credential domain (e.g. **Employment**):

1. **Define the transaction type(s)** — e.g. `EMPLOYMENT_ISSUE`, with its payload schema.
2. **Implement** a class satisfying `TransactionModule` (`type`, `validate`, `apply`).
3. **Register** it with the chain's module registry at startup.
4. Add the type to the transaction-type enum/documentation if appropriate.

No changes to `core/`, `consensus/`, `network/`, `storage/`, or `api/` are required.

```ts
const chain = new Chain({ validators });
chain.registerModule(new EmploymentModule());
```

## Existing Modules

| Modules | Transaction types | Responsibility |
|--------|-------------------|----------------|
| Issuers | `ISSUER_REGISTER`, `ISSUER_UPDATE` | Issuer registry lifecycle |
| Credentials | `CREDENTIAL_ISSUE`, `CREDENTIAL_REISSUE` | Credential hashes and reissue lineage |
| Revocation | `CREDENTIAL_REVOKE`, `CREDENTIAL_SUSPEND`, `CREDENTIAL_REINSTATE` | Credential status transitions |
| Keys | `KEY_REGISTER`, `KEY_ROTATE` | Key registration and rotation |

> `BATCH_ANCHOR` is a generic core transaction type (Merkle-root batch anchoring) and may graduate into its own module in a future release.

## Future Modules

The registry pattern makes these domains straightforward to add:

- **Employment** — employment verification records.
- **Licensing** — professional/operator licenses.
- **Accreditation** — institutional/program accreditation.
- **Government Attestation** — state-issued documents and attestations.

Each becomes a new module registered against the same core; on-chain footprint remains hashes/proofs only.

## Evolutionary Compatibility

### Protocol Versioning

- All messages, transactions, and blocks carry explicit versions (`"1.0"`, `transactionVersion: 1`, block `version: 1`).
- New transaction types can be introduced without breaking existing ones, as long as new types are registered and the core's type registry is updated.
- Backward-compatible upgrades preserve old envelope/hash semantics; incompatible changes bump the major protocol version.

### Storage Abstraction

- The core talks only to `BlockStore` / `TransactionStore` / `StateStore` / `PeerStore` interfaces.
- Swapping the file backend for a database (Postgres, SQLite, LevelDB) is a drop-in replacement that implements the same interfaces — no core or network changes.

### API Versioning

- The REST API is versioned to support future endpoint changes without breaking existing clients (e.g. `/api/v1/blocks`).
- New endpoints added for new modules reuse the standard response envelope, so clients can be extended incrementally.

## Design Principles

- **Open/closed** — the module registry is open for extension but the core pipeline is closed for modification.
- **Separation of concerns** — blockchain mechanics vs. domain semantics.
- **Deterministic dispatch** — module dispatch depends only on the transaction, so every honest node runs identical module logic in identical order.