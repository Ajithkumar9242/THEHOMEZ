import fs from 'node:fs';
import path from 'node:path';
import { Types } from 'mongoose';
import {
  StorageCleanupJobModel,
  StorageCleanupStatus,
  StorageCleanupTriggerReason,
} from '../../models/storage-cleanup-job.model.js';
import { PartnerAuditLogModel } from '../../models/partner-audit-log.model.js';
import type {
  IStorageCleanupJobDto,
  IStorageCleanupJobRetryResponseDto,
} from '@thehomez/shared-types';
import { logger } from '../../logger/logger.js';

export interface ICompensationRecordParams {
  storageKey: string;
  partnerId?: Types.ObjectId | string;
  documentId?: Types.ObjectId | string;
  triggerReason: StorageCleanupTriggerReason;
  error?: string;
}

export class StorageCleanupService {
  private readonly walDir: string;
  private readonly instanceId: string;

  constructor() {
    this.walDir = process.env.STORAGE_WAL_DIR || path.resolve(process.cwd(), 'storage', 'wal');
    this.instanceId = process.env.INSTANCE_ID || 'default';
  }

  public getWalFilePath(): string {
    return path.join(this.walDir, `cleanup-fallback-${this.instanceId}.jsonl`);
  }

  public getLockFilePath(): string {
    return path.join(this.walDir, `cleanup-fallback-${this.instanceId}.lock`);
  }

  /**
   * Acquires a cooperative advisory file lock to serialize WAL appends
   * if multiple processes share an INSTANCE_ID.
   */
  private acquireLock(lockFile: string, maxWaitMs = 3000): number {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const fd = fs.openSync(lockFile, 'wx');
        try {
          fs.writeSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
        } catch {
          // Best effort metadata recording
        }
        return fd;
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'EEXIST') {
          // Inspect lockfile: stale lock recovery must never remove a lock belonging to an active process
          try {
            const stat = fs.statSync(lockFile);
            if (Date.now() - stat.mtimeMs > 10000) {
              let isProcessAlive = false;
              try {
                const content = fs.readFileSync(lockFile, 'utf8');
                const lockData = JSON.parse(content);
                if (lockData && typeof lockData.pid === 'number') {
                  try {
                    // Signal 0 tests for process existence without sending a signal
                    process.kill(lockData.pid, 0);
                    isProcessAlive = true;
                  } catch (killErr: unknown) {
                    const kErr = killErr as NodeJS.ErrnoException;
                    if (kErr.code === 'EPERM') {
                      // Process exists but belongs to different user permissions
                      isProcessAlive = true;
                    }
                  }
                }
              } catch {
                // If lockfile is unparseable or being written, do not assume dead
              }

              if (!isProcessAlive) {
                fs.unlinkSync(lockFile);
                continue;
              }
            }
          } catch {
            // Stat or unlink failed; another process handled it
          }

          // Brief synchronous pause before retrying lock acquisition
          const until = Date.now() + 20;
          while (Date.now() < until) {}
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Timeout acquiring WAL lockfile: ${lockFile}`);
  }

  private releaseLock(lockFd: number, lockFile: string): void {
    try {
      fs.closeSync(lockFd);
    } catch {}
    try {
      fs.unlinkSync(lockFile);
    } catch {}
  }

  /**
   * Records a cleanup failure or pending compensation job.
   * Dual-layer durability strategy:
   * 1. Attempts to persist or upsert into MongoDB StorageCleanupJobModel.
   * 2. If MongoDB is unavailable or fails, appends directive to an instance WAL file.
   *    - Handles partial writes via a dedicated write loop.
   *    - Fsyncs file data to disk.
   *    - Syncs parent directory metadata on new file creation (POSIX-safe).
   *    - Uses advisory file locking to prevent interleaving if INSTANCE_ID is shared.
   * 3. If both MongoDB and WAL persistence fail, raises a catastrophic fatal log for ops alerting.
   */
  public async recordCompensationFailure(params: ICompensationRecordParams): Promise<void> {
    const { storageKey, partnerId, documentId, triggerReason, error } = params;

    // Layer 1: MongoDB persistent queue
    try {
      await StorageCleanupJobModel.findOneAndUpdate(
        { storageKey },
        {
          $set: {
            ...(partnerId ? { partnerId: new Types.ObjectId(partnerId) } : {}),
            ...(documentId ? { documentId: new Types.ObjectId(documentId) } : {}),
            triggerReason,
            status: StorageCleanupStatus.PENDING,
            lastError: error,
            nextRetryAt: new Date(),
          },
          $setOnInsert: {
            attempts: 0,
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      logger.info(
        { storageKey, triggerReason },
        'StorageCleanupService: Recorded cleanup compensation job in MongoDB queue',
      );
      return;
    } catch (mongoErr) {
      logger.warn(
        {
          err: mongoErr,
          storageKey,
          triggerReason,
        },
        'StorageCleanupService: MongoDB persistence failed. Falling back to durable local WAL.',
      );
    }

    // Layer 2: Instance-isolated durable local WAL append
    try {
      const walFile = this.getWalFilePath();
      const parentDir = path.dirname(walFile);

      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const lockFile = this.getLockFilePath();
      const lockFd = this.acquireLock(lockFile);

      try {
        const isNewFile = !fs.existsSync(walFile);

        const walEntry = JSON.stringify({
          storageKey,
          partnerId: partnerId ? String(partnerId) : undefined,
          documentId: documentId ? String(documentId) : undefined,
          triggerReason,
          error,
          timestamp: new Date().toISOString(),
        }) + '\n';

        const buffer = Buffer.from(walEntry, 'utf8');
        const fd = fs.openSync(walFile, 'a', 0o600);

        try {
          // Write loop guaranteeing complete buffer transfer regardless of partial write returns
          let bytesWritten = 0;
          while (bytesWritten < buffer.length) {
            const written = fs.writeSync(fd, buffer, bytesWritten, buffer.length - bytesWritten);
            bytesWritten += written;
          }
          // Explicit physical fsync to prevent loss on system or OS crash
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }

        // On POSIX filesystems, sync directory entry when a new file is created
        if (isNewFile) {
          try {
            const dirFd = fs.openSync(parentDir, 'r');
            try {
              fs.fsyncSync(dirFd);
            } finally {
              fs.closeSync(dirFd);
            }
          } catch {
            // Directory fsync is not supported on Windows/certain virtual filesystems; ignored safely
          }
        }
      } finally {
        this.releaseLock(lockFd, lockFile);
      }

      logger.warn(
        { storageKey, walFile },
        'StorageCleanupService: Successfully appended cleanup job to fallback WAL',
      );
      return;
    } catch (walErr) {
      // Layer 3: Catastrophic double failure alert
      logger.fatal(
        {
          storageKey,
          partnerId: partnerId ? String(partnerId) : undefined,
          walError: walErr,
        },
        'CATASTROPHIC_CLEANUP_FAILURE: Failed MongoDB queueing and local WAL persistence',
      );
    }
  }

  /**
   * API: Admin Storage Cleanup Job Retry
   * POST /api/v1/admin/storage/cleanup-jobs/:jobId/retry
   *
   * Resets attempts to 0, sets status to PENDING, sets nextRetryAt to now,
   * unsets active worker leasing, emits STORAGE_CLEANUP_JOB_RETRY_TRIGGERED audit event,
   * and returns sanitized job DTO excluding storage keys and secrets.
   */
  public async retryCleanupJob(
    jobId: string,
    staffUser: { id: string; email?: string },
    auditMetadata?: { correlationId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<IStorageCleanupJobRetryResponseDto> {
    if (!Types.ObjectId.isValid(jobId)) {
      throw new StorageCleanupError('Invalid cleanup job ID format', 'INVALID_JOB_ID', 400);
    }
    const jobObjectId = new Types.ObjectId(jobId);
    const staffObjectId = new Types.ObjectId(staffUser.id);

    // 1. Fetch current job record
    const existingJob = await StorageCleanupJobModel.findById(jobObjectId);
    if (!existingJob) {
      throw new StorageCleanupError('Cleanup job not found', 'CLEANUP_JOB_NOT_FOUND', 404);
    }

    // 2. Reject terminal states (already COMPLETED or RESOLVED)
    if (
      existingJob.status === StorageCleanupStatus.COMPLETED ||
      existingJob.status === StorageCleanupStatus.RESOLVED
    ) {
      throw new StorageCleanupError(
        'Cleanup job is already resolved and cannot be retried',
        'CLEANUP_JOB_ALREADY_RESOLVED',
        400,
      );
    }

    const now = new Date();

    // 3. Reject active worker leases (IN_PROGRESS with unexpired lease)
    if (
      existingJob.status === StorageCleanupStatus.IN_PROGRESS &&
      existingJob.leaseExpiresAt &&
      existingJob.leaseExpiresAt > now
    ) {
      throw new StorageCleanupError(
        'Cannot retry cleanup job while active worker lease is held',
        'CLEANUP_JOB_LEASE_ACTIVE',
        409,
      );
    }

    // 4. Atomic state reset to PENDING with attempts = 0 and nextRetryAt = now
    const updatedJob = await StorageCleanupJobModel.findOneAndUpdate(
      {
        _id: jobObjectId,
        status: { $nin: [StorageCleanupStatus.COMPLETED, StorageCleanupStatus.RESOLVED] },
        $or: [
          { status: { $ne: StorageCleanupStatus.IN_PROGRESS } },
          { leaseExpiresAt: { $lte: now } },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { $exists: false } },
        ],
      },
      {
        $set: {
          status: StorageCleanupStatus.PENDING,
          attempts: 0,
          nextRetryAt: now,
        },
        $unset: {
          workerId: 1,
          leaseExpiresAt: 1,
        },
      },
      { new: true },
    );

    if (!updatedJob) {
      // Re-query to determine exact conflict cause
      const freshJob = await StorageCleanupJobModel.findById(jobObjectId);
      if (!freshJob) {
        throw new StorageCleanupError('Cleanup job not found', 'CLEANUP_JOB_NOT_FOUND', 404);
      }
      if (
        freshJob.status === StorageCleanupStatus.COMPLETED ||
        freshJob.status === StorageCleanupStatus.RESOLVED
      ) {
        throw new StorageCleanupError(
          'Cleanup job is already resolved and cannot be retried',
          'CLEANUP_JOB_ALREADY_RESOLVED',
          400,
        );
      }
      if (
        freshJob.status === StorageCleanupStatus.IN_PROGRESS &&
        freshJob.leaseExpiresAt &&
        freshJob.leaseExpiresAt > now
      ) {
        throw new StorageCleanupError(
          'Cannot retry cleanup job while active worker lease is held',
          'CLEANUP_JOB_LEASE_ACTIVE',
          409,
        );
      }
      throw new StorageCleanupError(
        'Cleanup job could not be retried due to a concurrent conflict',
        'CLEANUP_JOB_CONFLICT',
        409,
      );
    }

    // 5. Emit mandatory STORAGE_CLEANUP_JOB_RETRY_TRIGGERED audit event
    try {
      await PartnerAuditLogModel.create({
        partnerId: updatedJob.partnerId,
        staffUserId: staffObjectId,
        action: 'STORAGE_CLEANUP_JOB_RETRY_TRIGGERED',
        previousState: {
          jobId: existingJob._id.toString(),
          status: existingJob.status,
          attempts: existingJob.attempts,
          triggerReason: existingJob.triggerReason,
          nextRetryAt: existingJob.nextRetryAt ? existingJob.nextRetryAt.toISOString() : undefined,
          lastError: existingJob.lastError,
          workerId: existingJob.workerId,
          leaseExpiresAt: existingJob.leaseExpiresAt
            ? existingJob.leaseExpiresAt.toISOString()
            : undefined,
        },
        newState: {
          jobId: updatedJob._id.toString(),
          status: updatedJob.status,
          attempts: updatedJob.attempts,
          triggerReason: updatedJob.triggerReason,
          nextRetryAt: updatedJob.nextRetryAt.toISOString(),
          lastError: updatedJob.lastError,
        },
        reason: 'Administrative manual retry of pending/failed storage cleanup job',
        metadata: {
          staffEmail: staffUser.email,
          ipAddress: auditMetadata?.ipAddress,
          userAgent: auditMetadata?.userAgent,
          correlationId: auditMetadata?.correlationId,
        },
      });
    } catch (auditErr) {
      logger.error(
        { err: auditErr, jobId },
        'StorageCleanupService: Mandatory STORAGE_CLEANUP_JOB_RETRY_TRIGGERED audit log creation failed. Rolling back retry state.',
      );

      // Rollback cleanup job state to preserve audit immutability invariant
      try {
        const rollbackFilter: Record<string, unknown> = {
          _id: jobObjectId,
          status: StorageCleanupStatus.PENDING,
          nextRetryAt: now,
        };

        const rollbackSet: Record<string, unknown> = {
          status: existingJob.status,
          attempts: existingJob.attempts,
          nextRetryAt: existingJob.nextRetryAt,
        };
        const rollbackUnset: Record<string, unknown> = {};

        if (existingJob.lastError !== undefined) {
          rollbackSet.lastError = existingJob.lastError;
        }
        if (existingJob.workerId !== undefined) {
          rollbackSet.workerId = existingJob.workerId;
        } else {
          rollbackUnset.workerId = 1;
        }
        if (existingJob.leaseExpiresAt !== undefined) {
          rollbackSet.leaseExpiresAt = existingJob.leaseExpiresAt;
        } else {
          rollbackUnset.leaseExpiresAt = 1;
        }

        const rollbackUpdate: Record<string, unknown> = {
          $set: rollbackSet,
        };
        if (Object.keys(rollbackUnset).length > 0) {
          rollbackUpdate.$unset = rollbackUnset;
        }

        await StorageCleanupJobModel.updateOne(rollbackFilter, rollbackUpdate);
      } catch (rollbackErr) {
        logger.error(
          { err: rollbackErr, jobId },
          'StorageCleanupService: Failed to rollback cleanup job state after audit log failure',
        );
      }

      throw new StorageCleanupError(
        'Failed to record cleanup job retry audit trail',
        'AUDIT_LOG_FAILED',
        500,
      );
    }

    // 6. Return sanitized updated job DTO (storageKey, private paths, URLs and secrets strictly excluded)
    const jobDto: IStorageCleanupJobDto = {
      id: updatedJob._id.toString(),
      partnerId: updatedJob.partnerId ? updatedJob.partnerId.toString() : null,
      documentId: updatedJob.documentId ? updatedJob.documentId.toString() : null,
      triggerReason: updatedJob.triggerReason,
      status: updatedJob.status,
      attempts: updatedJob.attempts,
      maxAttempts: updatedJob.maxAttempts,
      lastError: sanitizeCleanupJobError(updatedJob.lastError),
      nextRetryAt: updatedJob.nextRetryAt.toISOString(),
      leaseExpiresAt: updatedJob.leaseExpiresAt ? updatedJob.leaseExpiresAt.toISOString() : null,
      workerId: updatedJob.workerId ?? null,
      resolvedAt: updatedJob.resolvedAt ? updatedJob.resolvedAt.toISOString() : null,
      createdAt: updatedJob.createdAt.toISOString(),
      updatedAt: updatedJob.updatedAt.toISOString(),
    };

    return {
      job: jobDto,
    };
  }
}

/**
 * Sanitizes cleanup job error strings for public administrative responses.
 * Redacts signed URLs, authentication credentials/tokens, storage keys, and filesystem paths
 * while preserving useful operational diagnostic context.
 */
export function sanitizeCleanupJobError(error?: string | null): string | null {
  if (!error || typeof error !== 'string') {
    return null;
  }

  let sanitized = error.trim();
  if (!sanitized) {
    return null;
  }

  // 1. Redact URLs with potential query params / signatures
  sanitized = sanitized.replace(/https?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]');

  // 2. Redact sensitive auth tokens, credentials, or keys
  sanitized = sanitized.replace(/(?:api_key|apiKey|secret|token|signature|sig|password|pass|bearer)\s*[:=]\s*[^\s,;"']+/gi, '[REDACTED_CREDENTIAL]');

  // 3. Redact private storage keys (e.g. thehomez-private/...)
  sanitized = sanitized.replace(/thehomez-private\/[^\s"',]+/gi, '[REDACTED_STORAGE_KEY]');

  // 4. Redact Windows or Unix absolute filesystem paths
  sanitized = sanitized.replace(/[a-zA-Z]:\\[^\s"',]+/g, '[REDACTED_PATH]');
  sanitized = sanitized.replace(/\/(?:[a-zA-Z0-9._-]+\/)+[a-zA-Z0-9._-]+/g, '[REDACTED_PATH]');

  // Ceiling to 250 characters to prevent verbose stack trace or payload leakage
  if (sanitized.length > 250) {
    sanitized = sanitized.substring(0, 247) + '...';
  }

  return sanitized;
}

export class StorageCleanupError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'StorageCleanupError';
  }
}

export const storageCleanupService = new StorageCleanupService();

