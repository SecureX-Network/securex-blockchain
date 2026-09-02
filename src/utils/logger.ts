export interface Logger {
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: string, msg: string): string {
  return `[${timestamp()}] [${level}] ${msg}`;
}

function resolveLevel(): string {
  const env = (process.env.CTN_LOG_LEVEL || 'info').toLowerCase();
  const configured = (globalConfiguredLevel || '').toLowerCase();
  const raw = configured || env;
  if (['debug', 'info', 'warn', 'error'].includes(raw)) return raw;
  return 'info';
}

let globalConfiguredLevel = '';

function setLogLevel(level: string): void {
  globalConfiguredLevel = level;
}

export function configureLogging(level?: string): void {
  if (level) setLogLevel(level);
}

class ConsoleLogger implements Logger {
  private enabled(level: string): boolean {
    const order: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    return order[level] >= order[resolveLevel()];
  }
  info(message: string, ...args: any[]): void {
    if (this.enabled('info')) console.log(formatMessage('INFO', message), ...args);
  }
  warn(message: string, ...args: any[]): void {
    if (this.enabled('warn')) console.warn(formatMessage('WARN', message), ...args);
  }
  error(message: string, ...args: any[]): void {
    if (this.enabled('error')) console.error(formatMessage('ERROR', message), ...args);
  }
  debug(message: string, ...args: any[]): void {
    if (this.enabled('debug')) console.log(formatMessage('DEBUG', message), ...args);
  }
}

let globalLogger: Logger = new ConsoleLogger();

export function setLogger(logger: Logger): void {
  globalLogger = logger;
}

export function getLogger(): Logger {
  return globalLogger;
}
