import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Types } from 'mongoose';
import fs from 'node:fs';
import path from 'node:path';
import {
  StorageCleanupWorker,
} from '../src/services/storage/storage-cleanup-worker.js';
import {
  StorageCleanupJobModel,
  StorageCleanupStatus,
  StorageCleanupTriggerReason,
} from '../src/models/storage-cleanup-job.model.js';
import type { IPrivateDocumentStorageAdapter } from '../src/services/storage/private-storage.interface.js';
import { StorageCleanupService } from '../src/services/storage/storage-cleanup.service.js';

describe('StorageCleanupWorker Execution Tests', () => {
  let mockStorageAdapter: IPrivateDocumentStorageAdapter;
  let worker: StorageCleanupWorker;
  const mockJobId = new Types.ObjectId();
  const testStorageKey = 'thehomez-private/partners/p-100/test.pdf';

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageAdapter = {
      uploadPrivateDocument: vi.fn(),
      generateExpiringSignedUrl: vi.fn(),
      deletePrivateDocument: vi.fn().mockResolvedValue(true),
      listStorageObjects: vi.fn().mockResolvedValue([]),
      updateObjectTags: vi.fn().mockResolvedValue(true),
    };

    worker = new StorageCleanupWorker({
      workerId: 'worker-unit-test-1',
      leaseTtlMs: 5000,
      heartbeatIntervalMs: 1000,
      storageAdapter: mockStorageAdapter,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Successful Deletion
  it('successfully deletes storage object and marks job COMPLETED', async () => {
    const jobDoc = {
      _id: mockJobId,
      storageKey: testStorageKey,
      status: StorageCleanupStatus.IN_PROGRESS,
      attempts: 0,
      maxAttempts: 5,
    } as any;

    vi.spyOn(mockStorageAdapter, 'deletePrivateDocument').mockResolvedValue(true);
    const updateSpy = vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue({
      ...jobDoc,
      status: StorageCleanupStatus.COMPLETED,
    } as any);

    const result = await worker.processJob(jobDoc);

    expect(result.status).toBe(StorageCleanupStatus.COMPLETED);
    expect(mockStorageAdapter.deletePrivateDocument).toHaveBeenCalledWith(testStorageKey);
    expect(updateSpy).toHaveBeenCalledWith(
      {
        _id: mockJobId,
        workerId: 'worker-unit-test-1',
        status: StorageCleanupStatus.IN_PROGRESS,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: StorageCleanupStatus.COMPLETED,
        }),
      }),
      { new: true },
    );
  });

  // 2. Already Absent Storage Object (Idempotent Deletion)
  it('treats already-absent storage object as successful idempotent deletion (COMPLETED)', async () => {
    const jobDoc = {
      _id: mockJobId,
      storageKey: testStorageKey,
      status: StorageCleanupStatus.IN_PROGRESS,
      attempts: 1,
      maxAttempts: 5,
    } as any;

    // Cloudinary adapter returns true when result is 'not found'
    vi.spyOn(mockStorageAdapter, 'deletePrivateDocument').mockResolvedValue(true);
    vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue({
      ...jobDoc,
      status: StorageCleanupStatus.COMPLETED,
    } as any);

    const result = await worker.processJob(jobDoc);

    expect(result.status).toBe(StorageCleanupStatus.COMPLETED);
    expect(result.attempts).toBe(1);
  });

  // 3. Storage Deletion Failure (Retrying State & Backoff)
  it('handles storage deletion failure by transitioning to RETRYING with incremented attempts and backoff', async () => {
    const jobDoc = {
      _id: mockJobId,
      storageKey: testStorageKey,
      status: StorageCleanupStatus.IN_PROGRESS,
      attempts: 1,
      maxAttempts: 5,
    } as any;

    vi.spyOn(mockStorageAdapter, 'deletePrivateDocument').mockResolvedValue(false);
    const updateSpy = vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue({
      ...jobDoc,
      status: StorageCleanupStatus.RETRYING,
      attempts: 2,
    } as any);

    const result = await worker.processJob(jobDoc);

    expect(result.status).toBe(StorageCleanupStatus.RETRYING);
    expect(result.attempts).toBe(2);
    expect(updateSpy).toHaveBeenCalledWith(
      {
        _id: mockJobId,
        workerId: 'worker-unit-test-1',
        status: StorageCleanupStatus.IN_PROGRESS,
      },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: StorageCleanupStatus.RETRYING,
          attempts: 2,
        }),
        $unset: {
          leaseExpiresAt: 1,
          workerId: 1,
        },
      }),
      { new: true },
    );
  });

  // 4. Exhausted Retries -> Terminal FAILED Status
  it('transitions exhausted jobs (attempts >= maxAttempts) to terminal FAILED status', async () => {
    const jobDoc = {
      _id: mockJobId,
      storageKey: testStorageKey,
      status: StorageCleanupStatus.IN_PROGRESS,
      attempts: 4,
      maxAttempts: 5,
    } as any;

    vi.spyOn(mockStorageAdapter, 'deletePrivateDocument').mockRejectedValue(
      new Error('Cloudinary 503 Provider Unavailable'),
    );
    const updateSpy = vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue({
      ...jobDoc,
      status: StorageCleanupStatus.FAILED,
      attempts: 5,
    } as any);

    const result = await worker.processJob(jobDoc);

    expect(result.status).toBe(StorageCleanupStatus.FAILED);
    expect(result.attempts).toBe(5);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: StorageCleanupStatus.FAILED,
          attempts: 5,
        }),
      }),
      { new: true },
    );
  });

  // 5. Atomic Claim Under Concurrent Workers
  it('atomically claims eligible pending job using distributed lease', async () => {
    const mockPendingJob = {
      _id: mockJobId,
      storageKey: testStorageKey,
      status: StorageCleanupStatus.PENDING,
    };

    const claimSpy = vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue(mockPendingJob as any);

    const claimed = await worker.claimNextJob();

    expect(claimed).not.toBeNull();
    expect(claimSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $in: [StorageCleanupStatus.PENDING, StorageCleanupStatus.RETRYING] },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: StorageCleanupStatus.IN_PROGRESS,
          workerId: 'worker-unit-test-1',
        }),
      }),
      expect.objectContaining({ new: true }),
    );
  });

  // 6. Expired Lease Recovery
  it('permits claiming jobs whose previous worker lease has expired', async () => {
    const pastDate = new Date(Date.now() - 60000);
    vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockImplementation((filter: any) => {
      const orClauses = filter.$or;
      // Assert lease query checks expired leases
      const hasExpiredCondition = orClauses.some((clause: any) => clause.leaseExpiresAt?.$lt !== undefined);
      expect(hasExpiredCondition).toBe(true);

      return Promise.resolve({
        _id: mockJobId,
        storageKey: testStorageKey,
        status: StorageCleanupStatus.IN_PROGRESS,
        workerId: 'worker-unit-test-1',
        leaseExpiresAt: pastDate,
      }) as any;
    });

    const claimed = await worker.claimNextJob();
    expect(claimed).not.toBeNull();
  });

  // 7. Lease Ownership Conflict During Completion
  it('handles lease ownership conflict gracefully if worker lost lease before database update', async () => {
    const jobDoc = {
      _id: mockJobId,
      storageKey: testStorageKey,
      status: StorageCleanupStatus.IN_PROGRESS,
      attempts: 0,
      maxAttempts: 5,
    } as any;

    vi.spyOn(mockStorageAdapter, 'deletePrivateDocument').mockResolvedValue(true);
    // Simulate another worker reclaimed lease, so findOneAndUpdate returns null
    vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockResolvedValue(null);

    const result = await worker.processJob(jobDoc);

    expect(result.error).toContain('Lease ownership conflict');
  });

  // 8. Sanitized Error Reporting
  it('sanitizes storage credentials, URLs, and storage keys in recorded job error', async () => {
    const jobDoc = {
      _id: mockJobId,
      storageKey: testStorageKey,
      status: StorageCleanupStatus.IN_PROGRESS,
      attempts: 0,
      maxAttempts: 5,
    } as any;

    const sensitiveMessage =
      'Storage call failed: https://api.cloudinary.com/v1_1/key with api_key=secretKey123 and bearer:tok456 for thehomez-private/partners/p-100/secret.pdf at /var/app/wal/data.jsonl';

    vi.spyOn(mockStorageAdapter, 'deletePrivateDocument').mockRejectedValue(new Error(sensitiveMessage));
    let recordedError: string | undefined;
    vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockImplementation((_filter: any, update: any) => {
      recordedError = update.$set?.lastError;
      return Promise.resolve({ ...jobDoc, status: StorageCleanupStatus.RETRYING } as any);
    });

    await worker.processJob(jobDoc);

    expect(recordedError).toBeDefined();
    expect(recordedError).not.toContain('https://api.cloudinary.com');
    expect(recordedError).not.toContain('secretKey123');
    expect(recordedError).not.toContain('tok456');
    expect(recordedError).not.toContain('thehomez-private/partners/p-100/secret.pdf');
    expect(recordedError).toContain('[REDACTED_URL]');
    expect(recordedError).toContain('[REDACTED_CREDENTIAL]');
    expect(recordedError).toContain('[REDACTED_STORAGE_KEY]');
  });

  // 9. MongoDB Outage Safe Handling
  it('fails safely and returns null without crashing when MongoDB throws connection errors during claim', async () => {
    vi.spyOn(StorageCleanupJobModel, 'findOneAndUpdate').mockRejectedValue(
      new Error('MongoNetworkTimeoutException: Could not reach primary replica'),
    );

    const claimed = await worker.claimNextJob();
    expect(claimed).toBeNull();
  });

  // 10. WAL Replay and Corrupt Line Isolation
  it('replays valid WAL records into MongoDB and quarantines corrupt lines', async () => {
    const tempDir = path.resolve(process.cwd(), 'storage', 'test-wal-worker');
    fs.mkdirSync(tempDir, { recursive: true });

    const walFile = path.join(tempDir, 'cleanup-fallback-test-instance.jsonl');
    const corruptFile = path.join(tempDir, 'cleanup-fallback.corrupt');

    const validLine1 = JSON.stringify({
      storageKey: 'thehomez-private/partners/p-1/doc-1.pdf',
      triggerReason: StorageCleanupTriggerReason.UPLOAD_COMPENSATION_FAILURE,
      timestamp: new Date().toISOString(),
    });
    const corruptLine = 'NOT_VALID_JSON_{{{';
    const validLine2 = JSON.stringify({
      storageKey: 'thehomez-private/partners/p-1/doc-2.pdf',
      triggerReason: StorageCleanupTriggerReason.DOCUMENT_DELETED,
      timestamp: new Date().toISOString(),
    });

    fs.writeFileSync(walFile, `${validLine1}\n${corruptLine}\n${validLine2}\n`, 'utf8');

    const mockCleanupService = {
      getWalFilePath: () => walFile,
    } as any;

    const testWorker = new StorageCleanupWorker({
      cleanupService: mockCleanupService,
    });

    const updateOneSpy = vi.spyOn(StorageCleanupJobModel, 'updateOne').mockResolvedValue({} as any);

    const { replayedCount, corruptCount } = await testWorker.replayWalFiles();

    expect(replayedCount).toBe(2);
    expect(corruptCount).toBe(1);
    expect(updateOneSpy).toHaveBeenCalledTimes(2);

    // Verify corrupt file quarantined bad line
    expect(fs.existsSync(corruptFile)).toBe(true);
    const corruptContent = fs.readFileSync(corruptFile, 'utf8');
    expect(corruptContent).toContain(corruptLine);

    // Cleanup test files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // 11. FIX 2: Recovery of .replaying.jsonl without original WAL file
  it('recovers existing .replaying.jsonl file on startup even when original WAL file does not exist (Fix 2)', async () => {
    const tempDir = path.resolve(process.cwd(), 'storage', 'test-wal-recovery');
    fs.mkdirSync(tempDir, { recursive: true });

    const walFile = path.join(tempDir, 'cleanup-fallback-test-instance.jsonl');
    const replayingFile = path.join(tempDir, 'cleanup-fallback-test-instance.replaying.jsonl');
    const corruptFile = path.join(tempDir, 'cleanup-fallback.corrupt');

    // Simulate interrupted replay: replayingFile exists, walFile does NOT exist
    const validLine = JSON.stringify({
      storageKey: 'thehomez-private/partners/p-rec/doc.pdf',
      triggerReason: StorageCleanupTriggerReason.DOCUMENT_DELETED,
      timestamp: new Date().toISOString(),
    });
    fs.writeFileSync(replayingFile, `${validLine}\n`, 'utf8');

    const mockCleanupService = {
      getWalFilePath: () => walFile,
    } as any;

    const testWorker = new StorageCleanupWorker({
      cleanupService: mockCleanupService,
    });

    const updateOneSpy = vi.spyOn(StorageCleanupJobModel, 'updateOne').mockResolvedValue({} as any);

    const { replayedCount } = await testWorker.replayWalFiles();

    expect(replayedCount).toBe(1);
    expect(updateOneSpy).toHaveBeenCalledWith(
      { storageKey: 'thehomez-private/partners/p-rec/doc.pdf' },
      expect.anything(),
      { upsert: true },
    );
    // Verified: replayingFile was processed and unlinked
    expect(fs.existsSync(replayingFile)).toBe(false);

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // 12. FIX 2: MongoDB Outage During WAL Replay Preserves Replaying File
  it('preserves replaying file when MongoDB outage occurs during WAL replay (Fix 2 & 3)', async () => {
    const tempDir = path.resolve(process.cwd(), 'storage', 'test-wal-outage');
    fs.mkdirSync(tempDir, { recursive: true });

    const walFile = path.join(tempDir, 'cleanup-fallback-test-instance.jsonl');
    const replayingFile = path.join(tempDir, 'cleanup-fallback-test-instance.replaying.jsonl');

    const validLine = JSON.stringify({
      storageKey: 'thehomez-private/partners/p-out/doc.pdf',
      triggerReason: StorageCleanupTriggerReason.DOCUMENT_DELETED,
      timestamp: new Date().toISOString(),
    });
    fs.writeFileSync(replayingFile, `${validLine}\n`, 'utf8');

    const mockCleanupService = {
      getWalFilePath: () => walFile,
    } as any;

    const testWorker = new StorageCleanupWorker({
      cleanupService: mockCleanupService,
    });

    // Simulate MongoDB connection failure during upsert
    vi.spyOn(StorageCleanupJobModel, 'updateOne').mockRejectedValue(
      new Error('MongoNetworkTimeoutException: Replica set primary unreachable'),
    );

    const { replayedCount } = await testWorker.replayWalFiles();

    expect(replayedCount).toBe(0);
    // Verified: replayingFile was preserved for next retry cycle, NOT unlinked!
    expect(fs.existsSync(replayingFile)).toBe(true);

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });
});
