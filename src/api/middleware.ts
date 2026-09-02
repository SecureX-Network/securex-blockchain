import { NextFunction, Request, Response } from 'express';
import { getLogger } from '../utils/logger';
import { randomBytes } from 'crypto';

/**
 * HTTP middleware for the SecureX blockchain API.
 * Provides CORS, request IDs, structured error envelopes, JSON body limits,
 * and safe request logging (never logs private keys, signatures, or full payload secrets).
 */

export interface CorsOptions {
  enabled: boolean;
  allowedOrigins: string[];
}

export function corsMiddleware(options: CorsOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!options.enabled) return next();

    const origin = req.headers.origin;
    const allowed = options.allowedOrigins;

    if (origin) {
      const ok =
        allowed.includes('*') ||
        allowed.includes(origin) ||
        allowed.some(a => origin.startsWith(a));
      if (ok) {
        res.setHeader(
          'Access-Control-Allow-Origin',
          allowed.includes('*') ? '*' : origin,
        );
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type,Authorization,X-Request-Id',
        );
      }
    }

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    next();
  };
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existing = req.headers['x-request-id'];
  const requestId = typeof existing === 'string' && existing ? existing : randomBytes(8).toString('hex');
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}

export interface ApiError {
  code: string;
  message: string;
}

export function structuredError(error: string | ApiError): ApiError {
  if (typeof error === 'string') {
    return { code: error, message: error };
  }
  return error;
}

/**
 * Success envelope: { success: true, data }
 */
export function okResponse(res: Response, data: any): void {
  res.json({ success: true, data });
}

/**
 * Failure envelope: { success: false, error: <code string>, message: <detail> }
 *
 * `error` is kept as a STRING error code for backward compatibility with the V2
 * API contract (existing clients read result.error as a string). A human-readable
 * `message` and a structured `errorCode` are provided alongside for richer clients.
 */
export function failResponse(res: Response, error: string | ApiError, status = 400): void {
  const err = structuredError(error);
  const body: any = {
    success: false,
    error: err.code,
    message: err.message,
    errorCode: err.code,
  };
  res.status(status).json(body);
}

/**
 * Safe JSON body parser error handler: rejects malformed/oversized JSON without
 * leaking internals.
 */
export function bodyParserErrorHandler(err: any, _req: Request, res: Response, next: NextFunction): void {
  if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed')) {
    failResponse(res, { code: 'INVALID_REQUEST_BODY', message: 'Request body is invalid or exceeds the configured limit' }, 400);
    return;
  }
  next(err);
}

/**
 * Final error handler converting uncaught errors into structured 500 responses.
 * Never exposes internal error details or secrets.
 */
export function finalErrorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  getLogger().error(`Unhandled error on ${req.method} ${req.path}: ${err?.message || 'unknown'}`);
  failResponse(
    res,
    { code: 'INTERNAL_ERROR', message: 'An internal error occurred' },
    500,
  );
}

/**
 * Structured access log middleware. Logs method, path, request id, status, and
 * latency. Never logs request bodies (which may contain signatures or payload
 * metadata).
 */
export function accessLogMiddleware(logBodyPath: boolean = false) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();
    const requestId = req.headers['x-request-id'] || '';
    res.on('finish', () => {
      const ms = Date.now() - start;
      getLogger().info(
        `[${requestId}] ${req.method} ${req.path} -> ${res.statusCode} (${ms}ms)`,
      );
    });
    next();
  };
}

/**
 * Normalizes an input value to a bounded page (offset/limit) with deterministic
 * ordering. Protects against unbounded queries.
 */
export function paginate(query: any, defaults: { offset: number; limit: number; maxLimit: number }): { offset: number; limit: number } {
  const offset = Number.isFinite(Number(query?.offset)) ? Math.max(0, Number(query.offset)) : defaults.offset;
  const rawLimit = Number.isFinite(Number(query?.limit)) ? Number(query.limit) : defaults.limit;
  const limit = Math.max(1, Math.min(rawLimit, defaults.maxLimit));
  return { offset: Math.floor(offset), limit: Math.floor(limit) };
}
