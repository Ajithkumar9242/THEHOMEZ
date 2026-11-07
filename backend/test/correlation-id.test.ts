import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('Correlation ID Middleware & Header Propagation', () => {
  const app = createApp();

  it('generates a new UUID correlation ID when no header is supplied', async () => {
    const res = await request(app).get('/api/v1/health/live');

    expect(res.status).toBe(200);
    const correlationId = res.headers['x-correlation-id'];
    expect(correlationId).toBeDefined();
    expect(typeof correlationId).toBe('string');
    // UUID v4 format regex
    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('propagates client-supplied X-Correlation-Id header', async () => {
    const customId = 'client-custom-corr-12345';
    const res = await request(app).get('/api/v1/health/live').set('X-Correlation-Id', customId);

    expect(res.status).toBe(200);
    expect(res.headers['x-correlation-id']).toBe(customId);
  });

  it('propagates client-supplied X-Request-Id when X-Correlation-Id is not present', async () => {
    const reqId = 'upstream-request-id-9876';
    const res = await request(app).get('/api/v1/health/live').set('X-Request-Id', reqId);

    expect(res.status).toBe(200);
    expect(res.headers['x-correlation-id']).toBe(reqId);
  });
});
