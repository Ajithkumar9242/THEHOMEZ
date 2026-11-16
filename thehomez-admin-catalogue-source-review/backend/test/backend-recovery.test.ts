import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { isDatabaseReady } from '../src/database/database.js';

describe('Backend Database Connection Lifecycle & Recovery', () => {
  const app = createApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('completes the recovery lifecycle: connected (200) -> disconnected (503) -> reconnected (200)', async () => {
    // 1 & 2 & 3. Connected state -> HTTP 200
    let mockState: mongoose.ConnectionStates = 1 as mongoose.ConnectionStates;
    const readyStateSpy = vi
      .spyOn(mongoose.connection, 'readyState', 'get')
      .mockImplementation(() => mockState);

    expect(isDatabaseReady()).toBe(true);

    const initialRes = await request(app).get('/api/v1/health/ready');
    expect(initialRes.status).toBe(200);
    expect(initialRes.body.status).toBe('ready');
    expect(initialRes.body.services.database.status).toBe('connected');

    // 4 & 5. Temporarily stop MongoDB -> HTTP 503
    mockState = 0 as mongoose.ConnectionStates;
    mongoose.connection.emit('disconnected');

    expect(isDatabaseReady()).toBe(false);

    const disconnectedRes = await request(app).get('/api/v1/health/ready');
    expect(disconnectedRes.status).toBe(503);
    expect(disconnectedRes.body.status).toBe('unavailable');
    expect(disconnectedRes.body.services.database.status).toBe('disconnected');

    // 6 & 7. Restart MongoDB and recover -> HTTP 200
    mockState = 1 as mongoose.ConnectionStates;
    mongoose.connection.emit('reconnected');

    expect(isDatabaseReady()).toBe(true);

    const recoveredRes = await request(app).get('/api/v1/health/ready');
    expect(recoveredRes.status).toBe(200);
    expect(recoveredRes.body.status).toBe('ready');
    expect(recoveredRes.body.services.database.status).toBe('connected');

    expect(readyStateSpy).toHaveBeenCalled();
  });
});
