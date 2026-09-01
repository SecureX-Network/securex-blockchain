# CTN Blockchain Network Specification

## Overview

CTN Blockchain nodes form a private, authenticated peer-to-peer network over **WebSockets**. The network layer is responsible for discovery, authentication, message exchange, transaction/block propagation, and state synchronization.

## Transport

- **Protocol:** WebSocket via the `ws` (Node.js) library.
- Every node runs a WebSocket server on a **configurable port** and also connects out to known peers as a client.
- Messages are JSON-encoded and wrapped in the signed protocol envelope (see [PROTOCOL.md](./PROTOCOL.md#message-envelope)).

## Peer Discovery

Discovery combines two strategies:

1. **Static configuration** — known seed/bootstrap peers are listed in node configuration. A node always attempts to connect to its configured peers on startup.
2. **Gossip-based peer exchange** — connected peers share their own known peer addresses via `PEER_DISCOVERY` messages, letting the network discover peers beyond the static seed set over time.

## Authentication (Handshake)

No unauthenticated peer can participate. On connecting:

1. Peer state → `CONNECTING`.
2. Both parties exchange `HANDSHAKE` messages with their node ID and an Ed25519 signature over a session nonce.
3. Each side verifies the other's signature against the published/authorized public key.
4. On mutual verification, the peer state → `CONNECTED`.
5. A peer that fails authentication is disconnected and not accepted.

Only **authorized nodes** (those with valid, known keys) are permitted onto the network.

## Peer States

| State | Description |
|-------|-------------|
| `CONNECTING` | TCP/WebSocket connection being established |
| `AUTHENTICATING` | Handshake in progress; no other messages processed |
| `CONNECTED` | Authenticated and exchanging messages |
| `DISCONNECTED` | Connection closed or peer failed authentication |

## Transaction Broadcast

When a node receives a valid transaction (from the API or from a peer), it:

1. Validates the transaction (envelope + module rules).
2. Adds it to its local pending pool.
3. **Floods** a `TX_BROADCAST` to all connected peers.
4. **Deduplicates by transaction ID** — a transaction already seen (in the pool, pending, or committed) is not re-forwarded, preventing infinite loops.

## Block Broadcast

When a block is proposed or committed:

1. The proposer broadcasts `BLOCK_BROADCAST` carrying the **full block** and the proposer's Ed25519 signature over the header.
2. Recipients verify the block signature and validate/commit it locally (single-proposer commit); they then re-flood the block to their peers.
3. A `BLOCK_REQUEST` (by `height` or `hash`) can fetch a specific block from a peer, answered with `BLOCK_RESPONSE` — used for catch-up and targeted retrieval.
4. Committed blocks are propagated so all honest nodes converge on the same tip.

Broadcast is keyed by **block hash** to avoid duplicate handling.

## Synchronization

New or lagging nodes synchronize their ledger (see [PROTOCOL.md](./PROTOCOL.md#sync-protocol)):

1. Authenticate with a peer.
2. Send `SYNC_REQUEST` with the highest height already held (default `0`).
3. Receive `SYNC_RESPONSE` containing ordered blocks from that height to the tip.
4. Verify each block (previous-hash, signatures, merkle roots) and append.
5. Repeat until caught up.

A new node requests the chain from height `0` (or its last-known height), building the identical canonical chain from genesis.

## Heartbeat

- Periodic `HEARTBEAT` ping/pong messages keep connections alive and detect dead peers.
- Default interval: **30 seconds**.
- A peer that misses heartbeats is marked `DISCONNECTED` and removed from the active set (retained for reconnection).

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxPeers` | `50` | Maximum concurrent connected peers |
| `heartbeatIntervalMs` | `30000` | Heartbeat ping interval |
| `proposalTimeoutMs` | configurable | Consensus proposal timeout |
| `listenPort` | configurable | WebSocket server port (per node) |
| `p2pPort` | configurable | P2P listen port |
| `apiPort` | configurable | REST API port (default `3001`) |

All ports are **configurable per node**, allowing multiple nodes to run on one machine (e.g. local hackathon demos) and across distributed deployments.

## Peer Store

- The node maintains a **peer store** that persists known peer addresses (see [STORAGE_SPEC.md](./STORAGE_SPEC.md#peer-store)).
- Known peers are retained across restarts so the node can reconnect without depending solely on static config.
- The peer list is bounded to `maxPeers` and pruned of stale/unresponsive peers.

## Message Handling Flow

```
inbound message
  → check authenticated (else drop)
  → parse envelope, verify sender signature
  → dispatch by type:
      TX_BROADCAST       → validate, pool, re-flood
      BLOCK_BROADCAST    → hash-known check, fetch/verify, store
      BLOCK_REQUEST      → respond with stored block
      SYNC_REQUEST       → respond with blocks from height
      SYNC_RESPONSE      → verify + append blocks
      PEER_DISCOVERY     → merge known peers, gossip
      HEARTBEAT          → respond pong / update liveness
      HANDSHAKE          → perform authentication
```
