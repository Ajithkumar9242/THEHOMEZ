import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import * as databaseModule from '../src/database/database.js';
import { gracefulShutdown, _resetShutdownStateForTesting } from '../src/server.js';

describe('Graceful Shutdown Manager', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    _resetShutdownStateForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('stops accepting new connections, closes idle connections, and disconnects database', async () => {
    let serverCloseCalled = false;
    let closeIdleConnectionsCalled = false;

    const mockServer = {
      close: vi.fn((callback?: (err?: Error) => void) => {
        serverCloseCalled = true;
        if (callback) callback();
        return mockServer as unknown as Server;
      }),
      closeIdleConnections: vi.fn(() => {
        closeIdleConnectionsCalled = true;
      }),
    } as unknown as Server;

    const disconnectDbSpy = vi.spyOn(databaseModule, 'disconnectDatabase').mockResolvedValueOnce();

    await gracefulShutdown(mockServer, 'SIGTERM', 5000);

    expect(closeIdleConnectionsCalled).toBe(true);
    expect(serverCloseCalled).toBe(true);
    expect(disconnectDbSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores duplicate shutdown invocations idempotently', async () => {
    const mockServer = {
      close: vi.fn((callback?: (err?: Error) => void) => {
        if (callback) callback();
        return mockServer as unknown as Server;
      }),
      closeIdleConnections: vi.fn(),
    } as unknown as Server;

    const disconnectDbSpy = vi.spyOn(databaseModule, 'disconnectDatabase').mockResolvedValue();

    // First invocation initiates shutdown
    await gracefulShutdown(mockServer, 'SIGTERM', 5000);
    expect(mockServer.close).toHaveBeenCalledTimes(1);
    expect(disconnectDbSpy).toHaveBeenCalledTimes(1);

    // Second invocation with SIGINT while shutdown is in progress is ignored
    await gracefulShutdown(mockServer, 'SIGINT', 5000);
    expect(mockServer.close).toHaveBeenCalledTimes(1);
    expect(disconnectDbSpy).toHaveBeenCalledTimes(1);
  });

  it('enforces hard shutdown timeout and forces exit if draining hangs', async () => {
    vi.useFakeTimers();

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    // Simulate hanging server.close that never invokes its callback
    const hangingServer = {
      close: vi.fn(() => hangingServer as unknown as Server),
      closeIdleConnections: vi.fn(),
    } as unknown as Server;

    // Launch shutdown without awaiting because it will hang
    const shutdownPromise = gracefulShutdown(hangingServer, 'SIGTERM', 3000);

    // Advance clock past the hard timeout
    vi.advanceTimersByTime(3100);

    expect(exitSpy).toHaveBeenCalledWith(1);

    vi.useRealTimers();
    // Allow hanging promise to settle
    try {
      await Promise.race([shutdownPromise, new Promise((resolve) => setTimeout(resolve, 50))]);
    } catch {
      // Expected
    }
  });
});
