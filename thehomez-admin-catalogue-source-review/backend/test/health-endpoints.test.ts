import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';

describe('Express Health Endpoints & Error Handling', () => {
  const app = createApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/v1/health/live', () => {
    it('returns 200 OK even when database is disconnected', async () => {
      // Force readyState to 0 (disconnected)
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        0 as mongoose.ConnectionStates,
      );

      const res = await request(app).get('/api/v1/health/live');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.uptime).toBe('number');
      expect(typeof res.body.timestamp).toBe('string');
      // Must not leak any internal error or db info
      expect(res.body.services).toBeUndefined();
    });
  });

  describe('GET /api/v1/health/ready', () => {
    it('returns 503 Service Unavailable when MongoDB is disconnected', async () => {
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        0 as mongoose.ConnectionStates,
      );

      const res = await request(app).get('/api/v1/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('unavailable');
      expect(res.body.services?.database?.status).toBe('disconnected');
      // Must not leak connection strings or internal errors
      expect(res.body.services?.database?.uri).toBeUndefined();
      expect(res.body.services?.database?.error).toBeUndefined();
    });

    it('returns 200 OK when MongoDB is connected', async () => {
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        1 as mongoose.ConnectionStates,
      );

      const res = await request(app).get('/api/v1/health/ready');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.services?.database?.status).toBe('connected');
    });
  });

  describe('404 Route Not Found Handling', () => {
    it('returns standardized IApiErrorResponse for unknown routes', async () => {
      const res = await request(app).get('/api/v1/non-existent-route-xyz');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
      expect(res.body.error.message).toContain('Cannot GET /api/v1/non-existent-route-xyz');
      expect(typeof res.body.error.correlationId).toBe('string');
      expect(typeof res.body.error.timestamp).toBe('string');
    });
  });
});
