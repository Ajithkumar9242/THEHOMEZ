import mongoose, { type ClientSession } from 'mongoose';
import { logger } from '../logger/logger.js';

export interface TransactionOptions {
  maxCommitTimeMS?: number;
}

/**
 * Executes a callback within a managed MongoDB multi-document transaction session.
 * Guarantees that:
 * 1. A new session is started.
 * 2. Transaction begins.
 * 3. Successful execution commits the transaction atomically.
 * 4. Any failure/rejection aborts the transaction cleanly without partial writes.
 * 5. Session is always ended in a finally block to prevent resource leaks.
 */
export async function withTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  const session = await mongoose.startSession();

  try {
    let attempts = 0;
    const maxRetries = 5;

    while (true) {
      attempts++;
      session.startTransaction({
        maxCommitTimeMS: options?.maxCommitTimeMS,
      });

      try {
        const result = await work(session);
        await session.commitTransaction();
        return result;
      } catch (error) {
        if (session.inTransaction()) {
          try {
            await session.abortTransaction();
          } catch (abortErr) {
            logger.error(
              { err: abortErr instanceof Error ? abortErr.message : String(abortErr) },
              'Failed to abort transaction cleanly',
            );
          }
        }

        const mongoErr = error as {
          hasErrorLabel?: (l: string) => boolean;
          code?: number;
          errorLabels?: string[];
        };
        const isTransient =
          (typeof mongoErr?.hasErrorLabel === 'function' &&
            mongoErr.hasErrorLabel('TransientTransactionError')) ||
          mongoErr?.code === 112 ||
          mongoErr?.errorLabels?.includes?.('TransientTransactionError');

        if (isTransient && attempts < maxRetries) {
          const delay = Math.min(200, 20 * Math.pow(2, attempts)) + Math.random() * 20;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }
  } finally {
    await session.endSession();
  }
}
