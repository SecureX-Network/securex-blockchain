# CTN Blockchain Storage Specification

## Overview

Storage is defined through **abstract interfaces** and a default **file-based implementation**. The interface layer decouples the core from any particular storage backend, allowing a future swap to a database without touching consensus, networking, or the API.

## Storage Interfaces

### `BlockStore`

Persists and retrieves blocks.

| Operation | Signature | Description |
|-----------|-----------|-------------|
| `get` | `get(height): Promise<Block | null>` | Get block by height |
| `put` | `put(block): Promise<void>` | Store a block |
| `delete` | `delete(height): Promise<void>` | Remove a block |
| `has` | `has(height): Promise<boolean>` | Check existence by height |
| `list` | `list(from, to): Promise<Block[]>` | List a range of blocks |
| `count` | `count(): Promise<number>` | Total blocks stored |

### `TransactionStore`

Indexes transactions to their containing block.

| Operation | Signature | Description |
|-----------|-----------|-------------|
| `get` | `get(txId): Promise<TxLocation \| null>` | Get transaction → block height mapping |
| `put` | `put(txId, height): Promise<void>` | Record which block contains a tx |
| `delete` | `delete(txId): Promise<void>` | Remove mapping |
| `has` | `has(txId): Promise<boolean>` | Check a tx is stored |
| `list` | `list(): Promise<TxLocation[]>` | List all mappings |
| `count` | `count(): Promise<number>` | Total transactions indexed |

### `StateStore`

Persists serialized state snapshots.

| Operation | Signature | Description |
|-----------|-----------|-------------|
| `get` | `get(key): Promise<unknown \| null>` | Get a state value by key/namespace |
| `put` | `put(key, value): Promise<void>` | Store state value |
| `delete` | `delete(key): Promise<void>` | Remove a state value |
| `has` | `has(key): Promise<boolean>` | Check a key exists |
| `list` | `list(): Promise<Record<string, unknown>>` | Enumerate state |
| `count` | `count(): Promise<number>` | Number of state entries |

### `PeerStore`

Persists known peers for reconnection.

| Operation | Signature | Description |
|-----------|-----------|-------------|
| `get` | `get(peerId): Promise<Peer \| null>` | Get peer by ID |
| `put` | `put(peer): Promise<void>` | Store/update a peer |
| `delete` | `delete(peerId): Promise<void>` | Remove a peer |
| `has` | `has(peerId): Promise<boolean>` | Check peer known |
| `list` | `list(): Promise<Peer[]>` | List known peers |
| `count` | `count(): Promise<number>` | Number of known peers |

All interfaces share the same operation set — `get`, `put`, `delete`, `has`, `list`, `count` — for a consistent, predictable API.

## Default Implementation: `FileStore`

The default backend persists data as **JSON files** on the local filesystem.

### Block Store (FileStore)

- **One file per block**, named by height, e.g. `blocks/<height>.json`.
- An **index file** (`blocks/index.json`) maps heights to file names and tracks the chain height/tip.
- Reading a block reads its JSON file; listing reads the index.

```
data/
└── blocks/
    ├── index.json
    ├── 0.json        # genesis
    ├── 1.json
    └── ...
```

### Transaction Store (FileStore)

- An **index mapping transaction ID → block height**.
- Stored as `transactions/index.json` (a map of `txId → height`).

```
data/
└── transactions/
    └── index.json
```

### State Store (FileStore)

- Serialized **state snapshots** as JSON.
- One file per state namespace (e.g. `issuers`, `credentials`, `validators`, `keys`).
- On commit, affected namespaces are rewritten atomically.

```
data/
└── state/
    ├── issuers.json
    ├── credentials.json
    ├── keys.json
    └── validators.json
```

### Peer Store (FileStore)

- The **known peers list** as JSON.

```
data/
└── peers/
    └── peers.json
```

## Pluggability

- The core depends only on the interfaces (`BlockStore`, `TransactionStore`, `StateStore`, `PeerStore`).
- `FileStore` is a concrete implementation chosen at startup based on configuration.
- A future `SqliteStore` / `PostgresStore` / `LevelDB` implementation can be dropped in by implementing the same interfaces — no core changes required.

## Atomicity & Durability

- State writes are performed as **write-then-rename** where possible to avoid corrupting partial writes on crash.
- Block files are appended only in order; the index is updated last to mark a fully-written block as available.
- Data lives under a configurable `data/` directory (ignored by git via `.gitignore`).

## Security Note

The default file storage is **not encrypted at rest** (see [SECURITY_MODEL.md](./SECURITY_MODEL.md#limitations)). Only hashes and proofs are typically stored on-chain by design, minimizing the sensitivity of what a filesystem compromise would reveal.
