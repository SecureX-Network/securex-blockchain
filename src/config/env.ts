import * as fs from 'fs';
import * as path from 'path';

/**
 * Minimal .env loader. No external dependency.
 * Supports lines formatted as KEY=VALUE with optional # comments.
 * Does NOT support variable expansion or quoted multi-line values.
 * Never logs or exposes secrets loaded through this mechanism.
 */
export function loadEnvFile(rootDir: string = process.cwd()): void {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return;

  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (/^(['"]).*\1$/.test(value)) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env parse errors are non-fatal; config falls back to defaults.
  }
}
