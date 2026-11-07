import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import {
  isDatabaseReady,
  getDatabaseDiagnostics,
  connectDatabase,
  disconnectDatabase,
  sanitizeMongoUri,
} from '../src/database/database.js';

describe('Database Connection Management & Recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Readiness & Diagnostics', () => {
    it('accurately reports readiness based on readyState', () => {
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        0 as mongoose.ConnectionStates,
      );
      expect(isDatabaseReady()).toBe(false);

      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        1 as mongoose.ConnectionStates,
      );
      expect(isDatabaseReady()).toBe(true);

      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        2 as mongoose.ConnectionStates,
      );
      expect(isDatabaseReady()).toBe(false);

      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        3 as mongoose.ConnectionStates,
      );
      expect(isDatabaseReady()).toBe(false);
    });

    it('returns diagnostic metadata without credentials', () => {
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        1 as mongoose.ConnectionStates,
      );
      Object.defineProperty(mongoose.connection, 'host', {
        value: '127.0.0.1',
        configurable: true,
      });
      Object.defineProperty(mongoose.connection, 'name', { value: 'thehomez', configurable: true });

      const diagnostics = getDatabaseDiagnostics();
      expect(diagnostics.readyState).toBe(1);
      expect(diagnostics.status).toBe('connected');
      expect(diagnostics.host).toBe('127.0.0.1');
      expect(diagnostics.name).toBe('thehomez');
    });
  });

  describe('URI Sanitization', () => {
    it('strips credentials and leaves replicaSet query parameters intact', () => {
      const uri = 'mongodb://app_admin:secret_pass_123@mongo:27017/thehomez?replicaSet=rs0';
      const sanitized = sanitizeMongoUri(uri);

      expect(sanitized).toBe('mongodb://***:***@mongo:27017/thehomez?replicaSet=rs0');
      expect(sanitized).not.toContain('secret_pass_123');
      expect(sanitized).not.toContain('app_admin');
    });

    it('handles URIs without credentials safely', () => {
      const uri = 'mongodb://127.0.0.1:27017/thehomez?replicaSet=rs0';
      const sanitized = sanitizeMongoUri(uri);
      expect(sanitized).toBe(uri);
    });
  });

  describe('Connection Lifecycle & Disconnection', () => {
    it('handles initial connection failure gracefully without crashing process', async () => {
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        0 as mongoose.ConnectionStates,
      );
      vi.spyOn(mongoose, 'connect').mockRejectedValueOnce(
        new Error('Could not connect to any servers in your MongoDB Atlas cluster'),
      );

      await expect(connectDatabase('mongodb://invalid-host:27017/thehomez')).rejects.toThrow(
        'Could not connect to any servers in your MongoDB Atlas cluster',
      );
    });

    it('bypasses connect call if already connected', async () => {
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        1 as mongoose.ConnectionStates,
      );
      const connectSpy = vi.spyOn(mongoose, 'connect');

      const result = await connectDatabase();
      expect(result).toBe(mongoose);
      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('disconnects cleanly when connection is active', async () => {
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        1 as mongoose.ConnectionStates,
      );
      const disconnectSpy = vi.spyOn(mongoose, 'disconnect').mockResolvedValueOnce();

      await disconnectDatabase();
      expect(disconnectSpy).toHaveBeenCalledTimes(1);
    });

    it('no-ops when disconnect is called on already disconnected database', async () => {
      vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(
        0 as mongoose.ConnectionStates,
      );
      const disconnectSpy = vi.spyOn(mongoose, 'disconnect');

      await disconnectDatabase();
      expect(disconnectSpy).not.toHaveBeenCalled();
    });
  });
});
