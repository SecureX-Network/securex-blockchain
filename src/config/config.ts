import * as fs from 'fs';
import * as path from 'path';
import { loadEnvFile } from './env';

export interface CorsConfig {
  allowedOrigins: string[];
  enabled: boolean;
}

export interface ConsensusConfig {
  blockInterval: number;
  minSignatures: number;
  proposerTimeoutMs: number;
}

export interface NodeConfig {
  nodeId: string;
  host: string;
  port: number;
  dataDir: string;
  peers: string[];
  validators: string[];
  apiHost: string;
  apiPort: number;
  blockInterval: number;
  maxPeers: number;
  heartbeatInterval: number;
  genesisTimestamp: string;
  protocolVersion: string;
  consensus: ConsensusConfig;
  cors: CorsConfig;
  requestLimitBytes: number;
  logLevel: string;
}

function defaultConfigDir(): string {
  return path.join(process.cwd(), '.ctn');
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

function parseIntSafe(value: string | undefined, fallback: number): number {
  const n = parseInt(value || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseList(value: string | undefined): string[] {
  return (value || '').split(',').map(s => s.trim()).filter(Boolean);
}

export function loadConfig(configPath?: string): NodeConfig {
  loadEnvFile();
  const configDir = defaultConfigDir();
  const filePath = configPath || path.join(configDir, 'config.json');

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<NodeConfig>;
    return normalizeConfig(parsed);
  }

  return defaultNodeConfig();
}

export function normalizeConfig(parsed: Partial<NodeConfig>): NodeConfig {
  const defaults = defaultNodeConfig();
  return {
    nodeId: parsed.nodeId ?? defaults.nodeId,
    host: parsed.host ?? defaults.host,
    port: parsed.port ?? defaults.port,
    dataDir: parsed.dataDir ?? defaults.dataDir,
    peers: parsed.peers ?? defaults.peers,
    validators: parsed.validators ?? defaults.validators,
    apiHost: parsed.apiHost ?? defaults.apiHost,
    apiPort: parsed.apiPort ?? defaults.apiPort,
    blockInterval: parsed.blockInterval ?? defaults.blockInterval,
    maxPeers: parsed.maxPeers ?? defaults.maxPeers,
    heartbeatInterval: parsed.heartbeatInterval ?? defaults.heartbeatInterval,
    genesisTimestamp: parsed.genesisTimestamp ?? defaults.genesisTimestamp,
    protocolVersion: parsed.protocolVersion ?? defaults.protocolVersion,
    consensus: {
      blockInterval: parsed.consensus?.blockInterval ?? parsed.blockInterval ?? defaults.blockInterval,
      minSignatures: parsed.consensus?.minSignatures ?? defaults.consensus.minSignatures,
      proposerTimeoutMs: parsed.consensus?.proposerTimeoutMs ?? defaults.consensus.proposerTimeoutMs,
    },
    cors: {
      enabled: parsed.cors?.enabled ?? defaults.cors.enabled,
      allowedOrigins: parsed.cors?.allowedOrigins ?? defaults.cors.allowedOrigins,
    },
    requestLimitBytes: parsed.requestLimitBytes ?? defaults.requestLimitBytes,
    logLevel: parsed.logLevel ?? defaults.logLevel,
  };
}

export function saveConfig(config: NodeConfig, configPath?: string): void {
  const configDir = configPath
    ? path.dirname(configPath)
    : defaultConfigDir();

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const filePath = configPath || path.join(configDir, 'config.json');
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

export const DEFAULT_GENESIS_TIMESTAMP = '2026-01-01T00:00:00.000Z';
export const DEFAULT_PROTOCOL_VERSION = '2.0';

export function defaultNodeConfig(): NodeConfig {
  loadEnvFile();
  const apiHost = process.env.CTN_API_HOST || '0.0.0.0';
  const host = process.env.CTN_HOST || '0.0.0.0';
  const port = parseIntSafe(process.env.CTN_P2P_PORT || process.env.CTN_PORT, 3001);
  const apiPort = parseIntSafe(process.env.CTN_API_PORT, 4001);

  const configuredOrigins = parseList(process.env.CTN_ALLOWED_ORIGINS);
  const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : ['*'];

  return {
    nodeId: process.env.CTN_NODE_ID || '',
    host,
    port,
    dataDir: process.env.CTN_DATA_DIR || path.join(process.cwd(), '.ctn', 'data'),
    peers: parseList(process.env.CTN_BOOTSTRAP_NODES || process.env.CTN_PEERS),
    validators: parseList(process.env.CTN_VALIDATORS),
    apiHost,
    apiPort,
    blockInterval: parseIntSafe(process.env.CTN_BLOCK_INTERVAL, 5000),
    maxPeers: parseIntSafe(process.env.CTN_MAX_PEERS, 50),
    heartbeatInterval: parseIntSafe(process.env.CTN_HEARTBEAT || process.env.CTN_HEARTBEAT_MS, 30000),
    genesisTimestamp: process.env.CTN_GENESIS_TIME || DEFAULT_GENESIS_TIMESTAMP,
    protocolVersion: process.env.CTN_PROTOCOL_VERSION || DEFAULT_PROTOCOL_VERSION,
    consensus: {
      blockInterval: parseIntSafe(process.env.CTN_BLOCK_INTERVAL, 5000),
      minSignatures: 1,
      proposerTimeoutMs: parseIntSafe(process.env.CTN_PROPOSER_TIMEOUT_MS, 5000),
    },
    cors: {
      enabled: parseBool(process.env.CTN_CORS_ENABLED, true),
      allowedOrigins,
    },
    requestLimitBytes: parseIntSafe(process.env.CTN_REQUEST_LIMIT_BYTES, 2 * 1024 * 1024),
    logLevel: process.env.CTN_LOG_LEVEL || 'info',
  };
}
