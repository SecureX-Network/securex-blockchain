# CTN Blockchain

**Credential Trust Network** — a permissioned, private, modular blockchain for digital credential verification.

CTN Blockchain is a TypeScript/Node.js blockchain purpose-built for institutional credential trust: issuing, verifying, and managing digital credentials (diplomas, certificates, licenses) among authorized institutions. Only **SHA-256 hashes and Merkle proofs** of credentials are stored on-chain — sensitive data stays off-chain with the issuer — while Proof-of-Authority consensus and Ed25519 signatures provide deterministic, tamper-evident trust.

## Features

- **Permissioned PoA consensus** — round-robin block proposal among an authorized validator set; no mining, no tokens.
- **Credential lifecycle** — issue, revoke, suspend, reinstate, and reissue credentials with full on-chain history.
- **Privacy by design** — only hashes/proofs on-chain; raw data stays off-chain.
- **Verified identities** — Ed25519-signed transactions, blocks, and peer handshakes over WebSocket P2P.
- **Extensible modules** — core is domain-agnostic; credential modules plug in via a module registry.
- **REST API** — client-facing HTTP interface for submitting transactions and querying state.
- **CLI** — node controls and admin operations.

## SecureX Blockchain V2 (Hardening)

On top of the V1 foundation, the V2 protocol (`protocolVersion "2.0"`, `transactionVersion 2`, `block.header.version >= 2`) adds a strict, credential-native hardening path while remaining fully backward compatible with V1 — all V1 tests stay green.

- **Signature & sender verification** — every V2 transaction's Ed25519 signature is verified against the sender's resolved public key (`INVALID_SIGNATURE` / `UNAUTHORIZED_SENDER`).
- **Replay protection** — monotonic per-sender nonces reject replays (`REPLAYED_TRANSACTION`).
- **Issuer authorization & lifecycle state machine** — only an ACTIVE, authorized issuer may mutate its credentials, and only via allowed transitions (`INVALID_STATE_TRANSITION`).
- **Block integrity** — V2 blocks enforce hash integrity (`INVALID_BLOCK`), duplicate-tx rejection, and version-aware Merkle roots.
- **Merkle proofs** — `src/merkle/proofs.ts` provides inclusion-proof creation/verification.
- **Services** — `CredentialVerificationService`, `BlockchainEvidenceProvider`, `ChainRecovery` (startup tamper detection), and `ObservabilityService` (with `/ready`, `/metrics`, `/verify/:id`, `/evidence/:id` endpoints).
- **Determinism** — independent nodes with identical inputs converge on identical hashes, roots, and state (`tests/unit/determinism.test.ts`).
- **Attacks demonstrably blocked** — run the SIH loop to see eight attack vectors rejected with concrete errors.

```bash
# Security/attack simulation (Simulate · Test · Block · Evidence)
npx ts-node scripts/attack-simulation.ts
```

See [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) (V2 addendum) and [docs/ENGINEERING_SUMMARY.md](docs/ENGINEERING_SUMMARY.md) for details.

### Production & demo hardening (0.3.0)

- **Real config/env** — `.env` loader, expanded `NodeConfig` (host, apiHost, protocolVersion, consensus, CORS, request limits, log level) with `normalizeConfig()`.
- **API middleware** — CORS, request IDs, structured envelopes, safe logging, bounded pagination, and strict body-error handling.
- **Audit + observability** — `AuditService` records lifecycle/tamper events; `/audit/events` and `/audit/summary` expose them.
- **History & tamper-check** — bounded credential/issuer history (`/state/.../history`) and document-hash tamper checks (`/contracts/tamper-check`).
- **Expanded verification** — `EXPIRED`, `keyStatus`, `protocolCompatible`, and `verifiedAt` in verification evidence.
- **Auth boundary** — `src/api/auth.ts` defines a clean `Authenticator`/`AuthorizationPolicy` interface so hosts can enforce a 0/1 pre-auth policy (a no-op `AnonymousAuthenticator` is used for the demo deployment).
- **Demo data** — `npm run demo:data` seeds deterministic, `demo:true`-flagged fictional institutions through the real transaction pipeline.

## Architecture Overview

```
src/
├── api/             REST API (Express) + middleware + auth boundary
├── cli/             Command-line interface
├── consensus/       Proof-of-Authority (round-robin)
├── contracts/       Integration contracts (fraud, platform)
├── core/            Domain-agnostic blockchain core (blocks, txs, state, validators)
├── crypto/          Ed25519 + SHA-256 (Node.js crypto)
├── merkle/          Merkle trees and inclusion proofs
├── modules/         Application modules (issuers, credentials, revocation, keys)
├── network/         WebSocket P2P (transport, protocol, discovery, peers)
├── services/        Audit, history, tamper-check, verification, evidence, recovery, observability
└── storage/         Pluggable storage (FileStore default)
```

Documentation:

| Doc | Purpose |
|-----|---------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture and design decisions |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | Wire protocol specification |
| [docs/TRANSACTION_SPEC.md](docs/TRANSACTION_SPEC.md) | Transaction envelope and types |
| [docs/BLOCK_SPEC.md](docs/BLOCK_SPEC.md) | Block structure and hashing |
| [docs/CONSENSUS_SPEC.md](docs/CONSENSUS_SPEC.md) | PoA consensus |
| [docs/NETWORK_SPEC.md](docs/NETWORK_SPEC.md) | P2P networking |
| [docs/CRYPTO_SPEC.md](docs/CRYPTO_SPEC.md) | Cryptography |
| [docs/STORAGE_SPEC.md](docs/STORAGE_SPEC.md) | Storage interfaces |
| [docs/API_SPEC.md](docs/API_SPEC.md) | REST API |
| [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) | Security model |
| [docs/EXTENSIBILITY.md](docs/EXTENSIBILITY.md) | Extensibility design |
| [docs/TESTING.md](docs/TESTING.md) | Testing strategy |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | Threat model |
| [docs/adr](docs/adr/) | Architecture decision records |

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **npm** 9+

## Quick Start

```bash
# Install dependencies
npm install

# Build (compile TypeScript to dist/)
npm run build

# Run a node in development mode
npm run dev

# Start an already-built node (after npm run build)
npm start

# Run tests
npm test
```

### Development

```bash
npm run dev            # run node via ts-node
npm run build          # typecheck + emit dist/
npm run lint           # typecheck only (tsc --noEmit)
```

## Demo & Benchmark

Interactive scripts that bring up real node clusters locally and drive them via the REST API.

```bash
npm run demo                     # 3-validator demo: issuers, credentials, Merkle proof, revocation, convergence
npm run demo:data                # seed deterministic DEMO institutions/credentials via real transactions
npm run benchmark                # 2-validator throughput benchmark (300 credential issues)
npm run benchmark -- 3 500       # custom: 3 validators x 500 issues
```

- `scripts/demo.ts` starts a 3-validator network, registers an issuer, issues 5 credentials (batched into one block), fetches and verifies a Merkle inclusion proof, revokes a credential, and confirms all nodes converge at the same height.
- `scripts/demo-data.ts` seeds fictional **SecureX Demo** institutions (university, technical institute, professional academy) and their credentials through the **real transaction pipeline** — every record is flagged `demo:true` and must never be presented as real institutional data. `tests/integration/demo.test.ts` validates the generated lifecycle states.
- `scripts/benchmark.ts` reports submission throughput, commit throughput, and convergence across a configurable validator set/size.

Run these one at a time — they bind to fixed port ranges, so concurrent clusters interfere.

## Configuration

Configuration is provided via a **config file** and/or **environment variables**. See the `config/` directory for templates and `.env.example` for the supported variables.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CTN_NODE_ID` | `''` | Node identity |
| `CTN_HOST` | `0.0.0.0` | P2P bind host |
| `CTN_P2P_PORT` / `CTN_PORT` | `3001` | P2P listen port |
| `CTN_API_HOST` | `0.0.0.0` | API bind host |
| `CTN_API_PORT` | `4001` | REST API port |
| `CTN_DATA_DIR` | `./.ctn/data` | Data directory (blocks, state, keys) |
| `CTN_VALIDATORS` | — | Comma-separated authorized validators |
| `CTN_BOOTSTRAP_NODES` / `CTN_PEERS` | — | Comma-separated seed peers |
| `CTN_MAX_PEERS` | `50` | Max connected peers |
| `CTN_HEARTBEAT` / `CTN_HEARTBEAT_MS` | `30000` | Heartbeat interval |
| `CTN_BLOCK_INTERVAL` | `5000` | Consensus block interval |
| `CTN_GENESIS_TIME` | `2026-01-01T00:00:00.000Z` | Genesis timestamp |
| `CTN_PROTOCOL_VERSION` | `2.0` | Default protocol version |
| `CTN_CORS_ENABLED` | `true` | Enable CORS |
| `CTN_ALLOWED_ORIGINS` | `*` | Comma-separated allowed CORS origins |
| `CTN_REQUEST_LIMIT_BYTES` | `2097152` | Max JSON request body size |
| `CTN_LOG_LEVEL` | `info` | Log level (`debug`/`info`/`warn`/`error`) |

### Config file

The node reads a JSON config that declares node identity, validators, ports, storage backend, and bootstrap peers. Custom versions are created per node so multiple nodes can run with distinct ports and names (see "Running Multiple Nodes").

## Running Multiple Nodes

Each node needs its own config, data directory, and ports:

1. Create separate config files (e.g. `config/node-a.json`, `config/node-b.json`), each with a distinct `name`, `apiPort`, and `p2pPort`, and list each other under `bootstrapNodes`.
2. Start each node with its config:

```bash
CTN_CONFIG=config/node-a.json npm run dev &
CTN_CONFIG=config/node-b.json npm run dev &
```

3. Nodes will discover each other via the bootstrap list, authenticate via handshake, and synchronize the chain from genesis.

> For a single-machine demo this is the intended deployment; in production, run nodes on separate hosts behind WSS/TLS.

## API Usage Examples

The REST API defaults to `http://localhost:3001`.

```bash
# Health check
curl http://localhost:3001/health

# Submit a signed transaction
curl -X POST http://localhost:3001/transactions \
  -H 'Content-Type: application/json' \
  -d '{"protocolVersion":"1.0","transactionVersion":1,"id":"...","type":"CREDENTIAL_ISSUE","timestamp":"...","sender":"...","nonce":1,"payload":{...},"signature":"..."}'

# List blocks (paginated)
curl 'http://localhost:3001/blocks?offset=0&limit=10'

# Get a block by height
curl http://localhost:3001/blocks/1

# Get a block by hash
curl http://localhost:3001/blocks/hash/<block-hash>

# Get a transaction
curl http://localhost:3001/transactions/<tx-id>

# List issuers / get one
curl http://localhost:3001/state/issuers
curl http://localhost:3001/state/issuers/<issuer-id>

# Credential state and history
curl http://localhost:3001/state/credentials/<credential-id>
curl http://localhost:3001/state/credentials/<credential-id>/history

# Merkle inclusion proof for a credential
curl -X POST http://localhost:3001/state/credentials/<credential-id>/proof \
  -H 'Content-Type: application/json' -d '{"blockHeight":42}'

# Validators / network status
curl http://localhost:3001/state/validators
curl http://localhost:3001/network/status

# Register a new node (admin only)
curl -X POST http://localhost:3001/nodes/register \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"<hex(publicKey)>"}'
```

Full endpoint and response-envelope documentation: [docs/API_SPEC.md](docs/API_SPEC.md).

## CLI Usage

```bash
# Start a node
node dist/cli/index.js start

# Show node status / health
node dist/cli/index.js status

# Create and manage an identity (generate keys)
node dist/cli/index.js keygen --out config/secrets

# Submit a transaction (e.g. register an issuer)
node dist/cli/index.js tx issue --issuer <id> --hash <credentialHash>

# List blocks from the CLI
node dist/cli/index.js blocks --limit 10

# Add a peer
node dist/cli/index.js peer add ws://host:port
```

Run `node dist/cli/index.js --help` for the full command list.

## Testing

```bash
npm test                   # full suite
npm run test:unit          # unit tests
npm run test:integration   # integration tests
npm run test:security      # security tests
npm run test:network       # multi-node network tests
npm run lint               # typecheck
```

Strategy and coverage details: [docs/TESTING.md](docs/TESTING.md).

## Project Structure

```
├── src/
│   ├── api/                  # REST API (Express)
│   ├── cli/                  # Commander-based CLI
│   ├── consensus/            # PoA consensus engine
│   ├── core/
│   │   ├── block/            # blocks, headers, block hashing
│   │   ├── ledger/           # chain/ledger management
│   │   ├── state/            # state + validator set
│   │   ├── transaction/      # transaction envelope
│   │   └── validation/       # generic validation
│   ├── crypto/
│   │   ├── hashing/          # SHA-256 helpers
│   │   ├── identity/         # key generation, node identity
│   │   └── signatures/       # Ed25519 sign/verify
│   ├── merkle/               # Merkle tree + inclusion proofs
│   ├── modules/
│   │   ├── credentials/      # credential lifecycle txs
│   │   ├── issuers/          # issuer registry txs
│   │   ├── keys/             # key register/rotate txs
│   │   └── revocation/       # revoke/suspend/reinstate txs
│   ├── network/
│   │   ├── discovery/        # peer discovery
│   │   ├── peer/             # peer state management
│   │   ├── protocol/         # wire protocol
│   │   └── transport/        # WebSocket transport
│   └── storage/              # store interfaces + FileStore
├── config/                   # node configuration
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── network/
├── docs/                     # this documentation set
├── jest.config.js
├── package.json
└── tsconfig.json
```

## License

[MIT](./LICENSE) — see the LICENSE file for terms.