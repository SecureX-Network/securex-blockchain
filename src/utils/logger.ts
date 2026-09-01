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

class ConsoleLogger implements Logger {
  info(message: string, ...args: any[]): void {
    console.log(formatMessage('INFO', message), ...args);
  }
  warn(message: string, ...args: any[]): void {
    console.warn(formatMessage('WARN', message), ...args);
  }
  error(message: string, ...args: any[]): void {
    console.error(formatMessage('ERROR', message), ...args);
  }
  debug(message: string, ...args: any[]): void {
    if (process.env.CTN_DEBUG === 'true') {
      console.log(formatMessage('DEBUG', message), ...args);
    }
  }
}

let globalLogger: Logger = new ConsoleLogger();

export function setLogger(logger: Logger): void {
  globalLogger = logger;
}

export function getLogger(): Logger {
  return globalLogger;
}
