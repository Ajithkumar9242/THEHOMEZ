import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Types } from 'mongoose';
import {
  StorageCleanupJobModel,
  StorageCleanupStatus,
  type IStorageCleanupJobDocument,
} from '../../models/storage-cleanup-job.model.js';
import type { IPrivateDocumentStorageAdapter } from './private-storage.interface.js';
import { cloudinaryPrivateStorageAdapter } from './cloudinary-private-storage.service.js';
import { sanitizeCleanupJobError, StorageCleanupService } from './storage-cleanup.service.js';
import { logger } from '../../logger/logger.js';

export interface IStorageCleanupWorkerOptions {
  workerId?: string;
  leaseTtlMs?: number;
  heartbeatIntervalMs?: number;
  batchSize?: number;
  pollIntervalMs?: number;
  storageAdapter?: IPrivateDocumentStorageAdapter;
  cleanupService?: StorageCleanupService;
}

export interface IJobProcessingResult {
  jobId: string;
  storageKey: string;
  status: StorageCleanupStatus;
  attempts: number;
  error?: string;
}

export class StorageCleanupWorker {
  public readonly workerId: string;
  private readonly leaseTtlMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly storageAdapter: IPrivateDocumentStorageAdapter;
  private readonly cleanupService: StorageCleanupService;

  private isRunning: boolean = false;
  private isProcessing: boolean = false;
  private isReplayingWal: boolean = false;
  private loopTimer: NodeJS.Timeout | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private shutdownResolver: (() => void) | null = null;

  constructor(options: IStorageCleanupWorkerOptions = {}) {
    const randomSuffix = randomBytes(4).toString('hex');
    this.workerId = options.workerId || `worker-${process.pid}-${randomSuffix}`;
    this.leaseTtlMs = options.leaseTtlMs ?? 300_000; // 5 minutes default lease
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 120_000; // 2 minutes heartbeat
    this.batchSize = options.batchSize ?? 10;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000; // 5 seconds poll
    this.storageAdapter = options.storageAdapter ?? cloudinaryPrivateStorageAdapter;
    this.cleanupService = options.cleanupService ?? new StorageCleanupService();
  }

  /**
   * Replays WAL records into MongoDB before processing jobs.
   * Performs atomic file rotation (.replaying.jsonl), line-by-line parsing with
   * corrupt line isolation (.corrupt), and upserts into StorageCleanupJobModel.
   */
  /**
   * Helper to parse, upsert, and clean up a single .replaying.jsonl file.
   */
  private async processReplayingFile(
    replayingFile: string,
    corruptFile: string,
  ): Promise<{ replayedCount: number; corruptCount: number }> {
    let replayedCount = 0;
    let corruptCount = 0;

    const content = fs.readFileSync(replayingFile, 'utf8');
    const lines = content.split('\n').filter((line) => line.trim().length > 0);

    for (const line of lines) {
      let entry: any;
      try {
        entry = JSON.parse(line);
        if (!entry.storageKey || !entry.triggerReason) {
          throw new Error('Missing mandatory fields in WAL entry');
        }
      } catch {
        corruptCount++;
        try {
          fs.appendFileSync(corruptFile, line + '\n', { flag: 'a', mode: 0o600 });
        } catch {}
        logger.warn({ line }, 'CORRUPT_WAL_RECORD_DETECTED: Quarantined to cleanup-fallback.corrupt');
        continue;
      }

      // Upsert into MongoDB
      try {
        await StorageCleanupJobModel.updateOne(
          { storageKey: entry.storageKey },
          {
            $setOnInsert: {
              storageKey: entry.storageKey,
              partnerId: entry.partnerId ? new Types.ObjectId(entry.partnerId) : undefined,
              documentId: entry.documentId ? new Types.ObjectId(entry.documentId) : undefined,
              triggerReason: entry.triggerReason,
              status: StorageCleanupStatus.PENDING,
              attempts: 0,
              maxAttempts: 5,
              lastError: entry.error,
              nextRetryAt: new Date(),
              createdAt: entry.timestamp ? new Date(entry.timestamp) : new Date(),
            },
          },
          { upsert: true },
        );
        replayedCount++;
      } catch (dbErr) {
        logger.error({ dbErr, storageKey: entry.storageKey }, 'StorageCleanupWorker: Failed to upsert WAL entry to MongoDB');
        throw dbErr; // Halt and preserve replaying file if MongoDB is unreachable
      }
    }

    // Unlink replaying file upon complete successful replay
    try {
      fs.unlinkSync(replayingFile);
    } catch {}

    return { replayedCount, corruptCount };
  }

  /**
   * Replays WAL records into MongoDB before processing jobs.
   * Performs atomic file rotation (.replaying.jsonl), line-by-line parsing with
   * corrupt line isolation (.corrupt), and upserts into StorageCleanupJobModel.
   * Discovers and recovers any existing interrupted .replaying.jsonl files first.
   */
  public async replayWalFiles(): Promise<{ replayedCount: number; corruptCount: number }> {
    const walFile = this.cleanupService.getWalFilePath();
    const parentDir = path.dirname(walFile);
    const replayingFile = walFile.endsWith('.jsonl')
      ? walFile.slice(0, -6) + '.replaying.jsonl'
      : `${walFile}.replaying.jsonl`;
    const corruptFile = path.join(parentDir, 'cleanup-fallback.corrupt');

    let totalReplayed = 0;
    let totalCorrupt = 0;

    // 1. Recover any existing interrupted replaying file first (FIX 2)
    if (fs.existsSync(replayingFile)) {
      logger.info({ replayingFile }, 'StorageCleanupWorker: Discovered existing interrupted WAL replaying file, resuming recovery...');
      try {
        const { replayedCount, corruptCount } = await this.processReplayingFile(replayingFile, corruptFile);
        totalReplayed += replayedCount;
        totalCorrupt += corruptCount;
      } catch (replayErr) {
        logger.error({ replayErr, replayingFile }, 'StorageCleanupWorker: Replay of existing replaying file halted due to MongoDB error');
        return { replayedCount: totalReplayed, corruptCount: totalCorrupt };
      }
    }

    // 2. Rotate and process active walFile if it exists
    if (fs.existsSync(walFile)) {
      try {
        fs.renameSync(walFile, replayingFile);
      } catch (err) {
        logger.warn({ err, walFile }, 'StorageCleanupWorker: Could not rotate WAL file for replay');
        return { replayedCount: totalReplayed, corruptCount: totalCorrupt };
      }

      try {
        const { replayedCount, corruptCount } = await this.processReplayingFile(replayingFile, corruptFile);
        totalReplayed += replayedCount;
        totalCorrupt += corruptCount;
      } catch (replayErr) {
        logger.error({ replayErr, replayingFile }, 'StorageCleanupWorker: Replay halted due to MongoDB error; replaying file preserved for next cycle');
        return { replayedCount: totalReplayed, corruptCount: totalCorrupt };
      }
    }

    if (totalReplayed > 0 || totalCorrupt > 0) {
      logger.info(
        { replayedCount: totalReplayed, corruptCount: totalCorrupt },
        'StorageCleanupWorker: Completed WAL file replay into MongoDB',
      );
    }

    return { replayedCount: totalReplayed, corruptCount: totalCorrupt };
  }

  /**
   * Atomically claims a single pending or expired job using a distributed lease.
   */
  public async claimNextJob(): Promise<IStorageCleanupJobDocument | null> {
    const now = new Date();
    const leaseExpires = new Date(now.getTime() + this.leaseTtlMs);

    try {
      const job = await StorageCleanupJobModel.findOneAndUpdate(
        {
          status: { $in: [StorageCleanupStatus.PENDING, StorageCleanupStatus.RETRYING] },
          nextRetryAt: { $lte: now },
          $or: [
            { leaseExpiresAt: { $exists: false } },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { $lt: now } },
          ],
        },
        {
          $set: {
            status: StorageCleanupStatus.IN_PROGRESS,
            workerId: this.workerId,
            leaseExpiresAt: leaseExpires,
          },
        },
        {
          new: true,
          sort: { nextRetryAt: 1 },
        },
      );

      return job;
    } catch (err) {
      logger.error({ err }, 'StorageCleanupWorker: Failed to claim next cleanup job due to database error');
      return null;
    }
  }

  /**
   * Renews the distributed lease on an active job held by this worker.
   */
  public async renewLease(jobId: Types.ObjectId): Promise<boolean> {
    const now = new Date();
    const newLeaseExpiresAt = new Date(now.getTime() + this.leaseTtlMs);

    try {
      const res = await StorageCleanupJobModel.updateOne(
        {
          _id: jobId,
          workerId: this.workerId,
          status: StorageCleanupStatus.IN_PROGRESS,
        },
        {
          $set: {
            leaseExpiresAt: newLeaseExpiresAt,
          },
        },
      );

      return res.modifiedCount === 1;
    } catch (err) {
      logger.warn({ err, jobId }, 'StorageCleanupWorker: Failed to renew heartbeat lease');
      return false;
    }
  }

  /**
   * Calculates bounded exponential backoff delay based on retry attempt.
   * Blueprint standard: 30s, 60s, 120s, 240s, 480s, max 1 hour.
   */
  public calculateBackoffMs(attempts: number): number {
    const baseDelayMs = 30_000; // 30 seconds base
    const multiplier = Math.pow(2, Math.max(0, attempts - 1));
    const delayMs = baseDelayMs * multiplier;
    return Math.min(delayMs, 3_600_000); // Max 1 hour
  }

  /**
   * Processes a single claimed job to completion or schedules backoff retry.
   * Safe against lease conflicts and MongoDB outages.
   */
  public async processJob(job: IStorageCleanupJobDocument): Promise<IJobProcessingResult> {
    const jobId = job._id.toString();
    const storageKey = job.storageKey;

    let heartbeatTimer: NodeJS.Timeout | null = null;
    try {
      // Setup heartbeat renewal timer for long-running operations
      heartbeatTimer = setInterval(async () => {
        const renewed = await this.renewLease(job._id);
        if (!renewed) {
          logger.warn(
            { jobId, workerId: this.workerId },
            'StorageCleanupWorker: Lease renewal failed or ownership lost during processing',
          );
        }
      }, this.heartbeatIntervalMs);

      // Execute physical deletion via storage adapter
      let deleteSuccess = false;
      let rawError: string | undefined;

      try {
        deleteSuccess = await this.storageAdapter.deletePrivateDocument(storageKey);
      } catch (storageErr: unknown) {
        deleteSuccess = false;
        rawError = storageErr instanceof Error ? storageErr.message : String(storageErr);
      }

      if (deleteSuccess) {
        // Confirmed physical deletion or confirmed absence
        const completedJob = await StorageCleanupJobModel.findOneAndUpdate(
          {
            _id: job._id,
            workerId: this.workerId,
            status: StorageCleanupStatus.IN_PROGRESS,
          },
          {
            $set: {
              status: StorageCleanupStatus.COMPLETED,
              resolvedAt: new Date(),
            },
            $unset: {
              leaseExpiresAt: 1,
            },
          },
          { new: true },
        );

        if (!completedJob) {
          logger.warn(
            { jobId, workerId: this.workerId },
            'StorageCleanupWorker: Job was deleted from storage, but lease ownership was lost before MongoDB completion update',
          );
          return {
            jobId,
            storageKey,
            status: StorageCleanupStatus.IN_PROGRESS,
            attempts: job.attempts,
            error: 'Lease ownership conflict during completion',
          };
        }

        logger.info({ jobId, storageKey }, 'StorageCleanupWorker: Successfully completed storage cleanup job');
        return {
          jobId,
          storageKey,
          status: StorageCleanupStatus.COMPLETED,
          attempts: job.attempts,
        };
      } else {
        // Physical deletion failed or returned unconfirmed
        const nextAttempts = job.attempts + 1;
        const isExhausted = nextAttempts >= job.maxAttempts;
        const sanitizedError = sanitizeCleanupJobError(
          rawError || 'Storage provider failed to delete physical object',
        ) || 'Storage deletion failed';

        const nextStatus = isExhausted
          ? StorageCleanupStatus.FAILED
          : StorageCleanupStatus.RETRYING;
        const backoffMs = this.calculateBackoffMs(nextAttempts);
        const nextRetryAt = isExhausted
          ? new Date()
          : new Date(Date.now() + backoffMs);

        const updatedJob = await StorageCleanupJobModel.findOneAndUpdate(
          {
            _id: job._id,
            workerId: this.workerId,
            status: StorageCleanupStatus.IN_PROGRESS,
          },
          {
            $set: {
              status: nextStatus,
              attempts: nextAttempts,
              lastError: sanitizedError,
              nextRetryAt,
            },
            $unset: {
              leaseExpiresAt: 1,
              workerId: 1,
            },
          },
          { new: true },
        );

        if (!updatedJob) {
          logger.warn(
            { jobId, workerId: this.workerId },
            'StorageCleanupWorker: Lease ownership lost before failure backoff could be recorded',
          );
        }

        logger.warn(
          {
            jobId,
            storageKey,
            attempts: nextAttempts,
            maxAttempts: job.maxAttempts,
            status: nextStatus,
          },
          'StorageCleanupWorker: Storage deletion failed; updated retry/failure state',
        );

        return {
          jobId,
          storageKey,
          status: nextStatus,
          attempts: nextAttempts,
          error: sanitizedError,
        };
      }
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    }
  }

  /**
   * Executes a single batch pass of job processing.
   * Returns total jobs processed in this pass.
   */
  public async processBatch(limit: number = this.batchSize): Promise<IJobProcessingResult[]> {
    const results: IJobProcessingResult[] = [];

    for (let i = 0; i < limit; i++) {
      if (!this.isRunning && this.shutdownPromise) {
        break; // Graceful shutdown requested
      }

      const job = await this.claimNextJob();
      if (!job) {
        break; // No eligible jobs available
      }

      const result = await this.processJob(job);
      results.push(result);
    }

    return results;
  }

  /**
   * Starts the continuous background polling loop.
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    logger.info({ workerId: this.workerId }, 'StorageCleanupWorker: Started background worker');

    // Initial WAL replay on worker startup
    try {
      await this.replayWalFiles();
    } catch (walErr) {
      logger.warn({ walErr }, 'StorageCleanupWorker: Initial WAL replay encountered an issue');
    }

    const runLoop = async () => {
      if (!this.isRunning) return;
      if (this.isProcessing) return;

      this.isProcessing = true;
      try {
        // FIX 3: Periodic WAL drainage during worker runtime
        if (!this.isReplayingWal) {
          this.isReplayingWal = true;
          try {
            await this.replayWalFiles();
          } catch (walErr) {
            logger.warn({ walErr }, 'StorageCleanupWorker: Runtime WAL replay encountered an issue');
          } finally {
            this.isReplayingWal = false;
          }
        }

        await this.processBatch(this.batchSize);
      } catch (err) {
        logger.error({ err }, 'StorageCleanupWorker: Uncaught error in processing loop');
      } finally {
        this.isProcessing = false;
        if (this.isRunning) {
          this.loopTimer = setTimeout(runLoop, this.pollIntervalMs);
        } else if (this.shutdownResolver) {
          this.shutdownResolver();
        }
      }
    };

    runLoop();
  }

  /**
   * Gracefully stops the worker, waiting for any active in-flight batch to finish.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;

    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }

    if (!this.isProcessing) {
      logger.info({ workerId: this.workerId }, 'StorageCleanupWorker: Stopped worker gracefully (idle)');
      return;
    }

    logger.info({ workerId: this.workerId }, 'StorageCleanupWorker: Waiting for in-flight job to finish before shutdown...');
    this.shutdownPromise = new Promise<void>((resolve) => {
      this.shutdownResolver = resolve;
    });

    await this.shutdownPromise;
    logger.info({ workerId: this.workerId }, 'StorageCleanupWorker: Stopped worker gracefully after completion');
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }
}
