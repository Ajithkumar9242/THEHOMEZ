import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose, { type ClientSession } from 'mongoose';
import { withTransaction } from '../src/database/transaction.js';

describe('MongoDB Multi-Document Transaction Management', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts transaction and commits atomically upon successful execution', async () => {
    let transactionStarted = false;
    let transactionCommitted = false;
    let sessionEnded = false;
    let inTx = true;

    const mockSession = {
      startTransaction: vi.fn(() => {
        transactionStarted = true;
      }),
      commitTransaction: vi.fn(async () => {
        transactionCommitted = true;
        inTx = false;
      }),
      abortTransaction: vi.fn(async () => {
        inTx = false;
      }),
      endSession: vi.fn(async () => {
        sessionEnded = true;
      }),
      inTransaction: vi.fn(() => inTx),
    } as unknown as ClientSession;

    vi.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession);

    // Mock operations writing to two temporary test collections
    const executionOrder: string[] = [];

    const result = await withTransaction(async (session) => {
      expect(session).toBe(mockSession);
      executionOrder.push('write-doc-1');
      executionOrder.push('write-doc-2');
      return { insertedCount: 2 };
    });

    expect(transactionStarted).toBe(true);
    expect(transactionCommitted).toBe(true);
    expect(sessionEnded).toBe(true);
    expect(executionOrder).toEqual(['write-doc-1', 'write-doc-2']);
    expect(result).toEqual({ insertedCount: 2 });
  });

  it('rolls back completely and aborts transaction on error without leaving partial writes', async () => {
    let transactionAborted = false;
    let sessionEnded = false;
    let inTx = true;

    const mockSession = {
      startTransaction: vi.fn(),
      commitTransaction: vi.fn(async () => {
        inTx = false;
      }),
      abortTransaction: vi.fn(async () => {
        transactionAborted = true;
        inTx = false;
      }),
      endSession: vi.fn(async () => {
        sessionEnded = true;
      }),
      inTransaction: vi.fn(() => inTx),
    } as unknown as ClientSession;

    vi.spyOn(mongoose, 'startSession').mockResolvedValue(mockSession);

    const executedSteps: string[] = [];

    await expect(
      withTransaction(async () => {
        executedSteps.push('first-doc-written');
        // Intentionally simulate unexpected error during second write
        throw new Error('Database constraint violation on second document');
      }),
    ).rejects.toThrow('Database constraint violation on second document');

    expect(transactionAborted).toBe(true);
    expect(sessionEnded).toBe(true);
    expect(executedSteps).toEqual(['first-doc-written']);
  });
});
