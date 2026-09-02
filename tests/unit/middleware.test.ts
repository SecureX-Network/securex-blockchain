import {
  corsMiddleware,
  requestIdMiddleware,
  okResponse,
  failResponse,
  structuredError,
  paginate,
  bodyParserErrorHandler,
  finalErrorHandler,
} from '../../src/api/middleware';

function mockRes() {
  const res: any = {};
  res.setHeader = jest.fn();
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn();
  res.sendStatus = jest.fn();
  res.on = jest.fn();
  res.statusCode = 200;
  return res;
}

describe('API middleware', () => {
  describe('corsMiddleware', () => {
    it('skips when disabled', () => {
      const next = jest.fn();
      corsMiddleware({ enabled: false, allowedOrigins: ['*'] })({} as any, {} as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('allows a wildcard origin', () => {
      const next = jest.fn();
      const res = mockRes();
      corsMiddleware({ enabled: true, allowedOrigins: ['*'] })(
        { headers: { origin: 'http://app.example' } } as any,
        res,
        next,
      );
      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
      expect(next).toHaveBeenCalled();
    });

    it('rejects a disallowed origin (no CORS header)', () => {
      const next = jest.fn();
      const res = mockRes();
      corsMiddleware({ enabled: true, allowedOrigins: ['http://trusted.example'] })(
        { headers: { origin: 'http://evil.example' } } as any,
        res,
        next,
      );
      const setCalls = res.setHeader.mock.calls.map((c: string[]) => c[0]);
      expect(setCalls).not.toContain('Access-Control-Allow-Origin');
      expect(next).toHaveBeenCalled();
    });

    it('short-circuits OPTIONS preflight with 204', () => {
      const next = jest.fn();
      const res = mockRes();
      corsMiddleware({ enabled: true, allowedOrigins: ['*'] })(
        { headers: { origin: 'http://app.example' }, method: 'OPTIONS' } as any,
        res,
        next,
      );
      expect(res.sendStatus).toHaveBeenCalledWith(204);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requestIdMiddleware', () => {
    it('assigns an X-Request-Id when absent', () => {
      const req: any = { headers: {} };
      const res = mockRes();
      requestIdMiddleware(req, res, jest.fn());
      expect(req.headers['x-request-id']).toBeTruthy();
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.headers['x-request-id']);
    });

    it('preserves an existing X-Request-Id', () => {
      const req: any = { headers: { 'x-request-id': 'abc' } };
      const res = mockRes();
      requestIdMiddleware(req, res, jest.fn());
      expect(req.headers['x-request-id']).toBe('abc');
    });
  });

  describe('response envelopes', () => {
    it('okResponse returns { success:true, data }', () => {
      const res = mockRes();
      okResponse(res, { foo: 1 });
      expect(res.json).toHaveBeenCalledWith({ success: true, data: { foo: 1 } });
    });

    it('failResponse keeps error as a string code with message and errorCode', () => {
      const res = mockRes();
      failResponse(res, 'UNKNOWN_ISSUER', 422);
      expect(res.status).toHaveBeenCalledWith(422);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).toBe('UNKNOWN_ISSUER');
      expect(body.errorCode).toBe('UNKNOWN_ISSUER');
      expect(typeof body.message).toBe('string');
    });

    it('structuredError converts a string to an ApiError', () => {
      expect(structuredError('FOO')).toEqual({ code: 'FOO', message: 'FOO' });
      expect(structuredError({ code: 'A', message: 'B' })).toEqual({ code: 'A', message: 'B' });
    });
  });

  describe('bodyParserErrorHandler / finalErrorHandler', () => {
    it('handles oversized request bodies', () => {
      const res = mockRes();
      bodyParserErrorHandler({ type: 'entity.too.large' }, {} as any, res, jest.fn());
      const body = res.json.mock.calls[0][0];
      expect(body.error).toBe('INVALID_REQUEST_BODY');
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('forwards unrelated errors', () => {
      const next = jest.fn();
      bodyParserErrorHandler({ type: 'other' }, {} as any, {} as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('finalErrorHandler returns a 500 INTERNAL_ERROR without leaking details', () => {
      const res = mockRes();
      finalErrorHandler({ message: 'secret internals' } as any, { method: 'GET', path: '/x' } as any, res, jest.fn());
      expect(res.status).toHaveBeenCalledWith(500);
      const body = res.json.mock.calls[0][0];
      expect(body.error).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(body)).not.toContain('secret internals');
    });
  });

  describe('paginate', () => {
    it('bounds limit to maxLimit', () => {
      expect(paginate({ limit: 100000 }, { offset: 0, limit: 20, maxLimit: 100 })).toEqual({ offset: 0, limit: 100 });
    });
    it('clamps negative offset to 0', () => {
      expect(paginate({ offset: -5 }, { offset: 0, limit: 20, maxLimit: 100 })).toEqual({ offset: 0, limit: 20 });
    });
    it('uses defaults for missing values', () => {
      expect(paginate({}, { offset: 3, limit: 15, maxLimit: 100 })).toEqual({ offset: 3, limit: 15 });
    });
  });
});
