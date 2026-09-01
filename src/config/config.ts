import * as fs from 'fs';
import * as path from 'path';

export interface NodeConfig {
  nodeId: string;
  port: number;
  dataDir: string;
  peers: string[];
  validators: string[];
  apiPort: number;
  blockInterval: number;
  maxPeers: number;
  heartbeatInterval: number;
  genesisTimestamp: string;
}

function defaultConfigDir(): string {
  return path.join(process.cwd(), '.ctn');
}

export function loadConfig(configPath?: string): NodeConfig {
  const configDir = defaultConfigDir();
  const filePath = configPath || path.join(configDir, 'config.json');

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as NodeConfig;
  }

  return defaultNodeConfig();
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

export function defaultNodeConfig(): NodeConfig {
  const port = parseInt(process.env.CTN_PORT || '3001', 10);
  const apiPort = parseInt(process.env.CTN_API_PORT || '4001', 10);

  return {
    nodeId: '',
    port,
    dataDir: process.env.CTN_DATA_DIR || path.join(process.cwd(), '.ctn', 'data'),
    peers: (process.env.CTN_PEERS || '').split(',').filter(Boolean),
    validators: (process.env.CTN_VALIDATORS || '').split(',').filter(Boolean),
    apiPort,
    blockInterval: parseInt(process.env.CTN_BLOCK_INTERVAL || '5000', 10),
    maxPeers: parseInt(process.env.CTN_MAX_PEERS || '50', 10),
    heartbeatInterval: parseInt(process.env.CTN_HEARTBEAT || '30000', 10),
    genesisTimestamp: process.env.CTN_GENESIS_TIME || DEFAULT_GENESIS_TIMESTAMP,
  };
}
