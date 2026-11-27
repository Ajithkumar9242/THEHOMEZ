import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  reconcileStorageOrphans,
  formatReconciliationReport,
  type IReconciliationSummary,
} from '../src/scripts/reconcile-storage-orphans.js';
import { PartnerModel } from '../src/models/partner.model.js';
import type {
  IPrivateDocumentStorageAdapter,
  IStorageObjectMeta,
} from '../src/services/storage/private-storage.interface.js';

describe('Storage Orphan Reconciliation Script Tests (P1A-04)', () => {
  let mockStorageAdapter: IPrivateDocumentStorageAdapter;

  const now = new Date();
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000); // within 2-hour grace period
  const fortyHoursAgo = new Date(now.getTime() - 40 * 60 * 60 * 1000); // beyond 24h soft-delete retention

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorageAdapter = {
      uploadPrivateDocument: vi.fn(),
      generateExpiringSignedUrl: vi.fn(),
      deletePrivateDocument: vi.fn().mockResolvedValue(true),
      listStorageObjects: vi.fn().mockResolvedValue([]),
      updateObjectTags: vi.fn().mockResolvedValue(true),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Genuine Orphan Detection
  it('identifies genuine orphans not found in MongoDB Partner documents', async () => {
    const orphanKey = 'thehomez-private/partners/p-orph/orphan_1.pdf';
    const mockObjects: IStorageObjectMeta[] = [
      {
        key: orphanKey,
        sizeBytes: 1024,
        lastModified: threeHoursAgo,
      },
    ];

    vi.spyOn(mockStorageAdapter, 'listStorageObjects').mockResolvedValue(mockObjects);

    // MongoDB query returns no matching partner documents
    const mockQuery = {
      readConcern: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(PartnerModel, 'find').mockReturnValue(mockQuery as any);

    const summary = await reconcileStorageOrphans({
      storageAdapter: mockStorageAdapter,
      destructive: false, // Default dry-run
    });

    expect(summary.dryRun).toBe(true);
    expect(summary.totalStorageObjectsFound).toBe(1);
    expect(summary.genuineOrphansIdentified).toBe(1);
    expect(summary.orphansDeleted).toBe(0); // Zero deleted in dry-run
    expect(mockStorageAdapter.deletePrivateDocument).not.toHaveBeenCalled();
  });

  // 2. Matching Active Document Preservation & Tag Self-Healing
  it('preserves matching active documents and heals PENDING_COMMIT tag to COMMITTED', async () => {
    const activeDocKey = 'thehomez-private/partners/p-1/reg.pdf';
    const mockObjects: IStorageObjectMeta[] = [
      {
        key: activeDocKey,
        sizeBytes: 2048,
        lastModified: threeHoursAgo,
        tags: { status: 'PENDING_COMMIT' },
      },
    ];

    vi.spyOn(mockStorageAdapter, 'listStorageObjects').mockResolvedValue(mockObjects);

    const mockPartner = {
      _id: 'partner-1',
      documents: [
        {
          storageKey: activeDocKey,
          isDeleted: false,
        },
      ],
    };

    const mockQuery = {
      readConcern: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([mockPartner]),
    };
    vi.spyOn(PartnerModel, 'find').mockReturnValue(mockQuery as any);

    const summary = await reconcileStorageOrphans({
      storageAdapter: mockStorageAdapter,
      destructive: false,
    });

    expect(summary.preservedMatchingActive).toBe(1);
    expect(summary.genuineOrphansIdentified).toBe(0);
    expect(summary.tagsHealedToCommitted).toBe(1);
    expect(mockStorageAdapter.updateObjectTags).toHaveBeenCalledWith(activeDocKey, {
      status: 'COMMITTED',
    });
    expect(mockStorageAdapter.deletePrivateDocument).not.toHaveBeenCalled();
  });

  // 2b. Multiple Documents Belonging to the Same Partner in One Batch (FIX 1 Regression)
  it('preserves multiple matching active documents belonging to the same partner in one batch (Fix 1 Regression)', async () => {
    const docKey1 = 'thehomez-private/partners/p-1/pan_card.jpg';
    const docKey2 = 'thehomez-private/partners/p-1/gst_certificate.pdf';
    const mockObjects: IStorageObjectMeta[] = [
      {
        key: docKey1,
        sizeBytes: 1024,
        lastModified: threeHoursAgo,
      },
      {
        key: docKey2,
        sizeBytes: 2048,
        lastModified: threeHoursAgo,
      },
    ];

    vi.spyOn(mockStorageAdapter, 'listStorageObjects').mockResolvedValue(mockObjects);

    const mockPartner = {
      _id: 'partner-1',
      documents: [
        {
          storageKey: docKey1,
          isDeleted: false,
        },
        {
          storageKey: docKey2,
          isDeleted: false,
        },
      ],
    };

    const mockQuery = {
      readConcern: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([mockPartner]),
    };
    vi.spyOn(PartnerModel, 'find').mockReturnValue(mockQuery as any);

    const summary = await reconcileStorageOrphans({
      storageAdapter: mockStorageAdapter,
      destructive: true,
      confirm: true,
    });

    // Both documents must be preserved; neither can be mistaken for an orphan
    expect(summary.preservedMatchingActive).toBe(2);
    expect(summary.genuineOrphansIdentified).toBe(0);
    expect(summary.orphansDeleted).toBe(0);
    expect(mockStorageAdapter.deletePrivateDocument).not.toHaveBeenCalled();
  });

  // 3. Matching Soft-Deleted Document Preservation within Retention
  it('preserves soft-deleted documents within the 24-hour retention grace period', async () => {
    const softDeletedKey = 'thehomez-private/partners/p-2/doc.pdf';
    const mockObjects: IStorageObjectMeta[] = [
      {
        key: softDeletedKey,
        sizeBytes: 2048,
        lastModified: threeHoursAgo,
      },
    ];

    vi.spyOn(mockStorageAdapter, 'listStorageObjects').mockResolvedValue(mockObjects);

    const mockPartner = {
      _id: 'partner-2',
      documents: [
        {
          storageKey: softDeletedKey,
          isDeleted: true,
          deletedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000), // Deleted 2 hours ago (< 24h retention)
        },
      ],
    };

    const mockQuery = {
      readConcern: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([mockPartner]),
    };
    vi.spyOn(PartnerModel, 'find').mockReturnValue(mockQuery as any);

    const summary = await reconcileStorageOrphans({
      storageAdapter: mockStorageAdapter,
      destructive: true,
      confirm: true,
    });

    expect(summary.softDeletedWithinRetention).toBe(1);
    expect(summary.softDeletedPurged).toBe(0);
    expect(mockStorageAdapter.deletePrivateDocument).not.toHaveBeenCalled();
  });

  // 4. Default Dry-Run Mode vs Explicit Destructive Mode
  it('deletes orphans only when both destructive and confirm flags are true', async () => {
    const orphanKey = 'thehomez-private/partners/p-orph/del.pdf';
    const mockObjects: IStorageObjectMeta[] = [
      {
        key: orphanKey,
        sizeBytes: 1024,
        lastModified: threeHoursAgo,
      },
    ];

    vi.spyOn(mockStorageAdapter, 'listStorageObjects').mockResolvedValue(mockObjects);
    const mockQuery = {
      readConcern: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(PartnerModel, 'find').mockReturnValue(mockQuery as any);

    // Destructive without confirm -> Treated as dry-run
    const summaryNoConfirm = await reconcileStorageOrphans({
      storageAdapter: mockStorageAdapter,
      destructive: true,
      confirm: false,
    });
    expect(summaryNoConfirm.dryRun).toBe(true);
    expect(summaryNoConfirm.orphansDeleted).toBe(0);
    expect(mockStorageAdapter.deletePrivateDocument).not.toHaveBeenCalled();

    // Destructive WITH confirm -> Executes deletion
    const summaryWithConfirm = await reconcileStorageOrphans({
      storageAdapter: mockStorageAdapter,
      destructive: true,
      confirm: true,
    });
    expect(summaryWithConfirm.dryRun).toBe(false);
    expect(summaryWithConfirm.genuineOrphansIdentified).toBe(1);
    expect(summaryWithConfirm.orphansDeleted).toBe(1);
    expect(mockStorageAdapter.deletePrivateDocument).toHaveBeenCalledWith(orphanKey);
  });

  // 5. Upload Grace Period Enforcement
  it('skips objects newer than grace period threshold to prevent race conditions with in-flight uploads', async () => {
    const recentUploadKey = 'thehomez-private/partners/p-1/in-flight.pdf';
    const mockObjects: IStorageObjectMeta[] = [
      {
        key: recentUploadKey,
        sizeBytes: 1024,
        lastModified: thirtyMinutesAgo, // 30 mins old (< 2 hours grace period)
      },
    ];

    vi.spyOn(mockStorageAdapter, 'listStorageObjects').mockResolvedValue(mockObjects);
    const findSpy = vi.spyOn(PartnerModel, 'find');

    const summary = await reconcileStorageOrphans({
      storageAdapter: mockStorageAdapter,
      graceHours: 2,
    });

    expect(summary.totalStorageObjectsFound).toBe(1);
    expect(summary.skippedWithinGracePeriod).toBe(1);
    expect(summary.genuineOrphansIdentified).toBe(0);
    // MongoDB should not even be queried for skipped recent items
    expect(findSpy).not.toHaveBeenCalled();
  });

  // 6. Fail-Closed on MongoDB Connectivity Failure
  it('fails closed immediately when MongoDB query fails without deleting any storage objects', async () => {
    const orphanKey = 'thehomez-private/partners/p-orph/orphan_danger.pdf';
    const mockObjects: IStorageObjectMeta[] = [
      {
        key: orphanKey,
        sizeBytes: 1024,
        lastModified: threeHoursAgo,
      },
    ];

    vi.spyOn(mockStorageAdapter, 'listStorageObjects').mockResolvedValue(mockObjects);

    const mockQuery = {
      readConcern: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockRejectedValue(new Error('MongoNetworkError: connection closed')),
    };
    vi.spyOn(PartnerModel, 'find').mockReturnValue(mockQuery as any);

    await expect(
      reconcileStorageOrphans({
        storageAdapter: mockStorageAdapter,
        destructive: true,
        confirm: true,
      }),
    ).rejects.toThrow('Reconciliation aborted: MongoDB connectivity or query failure');

    // Strict invariant: NEVER delete when MongoDB is unreachable
    expect(mockStorageAdapter.deletePrivateDocument).not.toHaveBeenCalled();
  });

  // 7. Fail-Closed on Storage Listing Failure
  it('fails closed immediately when storage object listing fails', async () => {
    vi.spyOn(mockStorageAdapter, 'listStorageObjects').mockRejectedValue(
      new Error('Cloudinary 401 Unauthorized API Key'),
    );

    await expect(
      reconcileStorageOrphans({
        storageAdapter: mockStorageAdapter,
      }),
    ).rejects.toThrow('Cloudinary 401 Unauthorized API Key');

    expect(mockStorageAdapter.deletePrivateDocument).not.toHaveBeenCalled();
  });

  // 8. Ambiguous Ownership / Key Quarantine
  it('quarantines objects with ambiguous prefix structure and refuses to delete them', async () => {
    const maliciousOrAmbiguousKey = 'external-bucket/arbitrary-path/malicious.pdf';
    const mockObjects: IStorageObjectMeta[] = [
      {
        key: maliciousOrAmbiguousKey,
        sizeBytes: 1024,
        lastModified: threeHoursAgo,
      },
    ];

    vi.spyOn(mockStorageAdapter, 'listStorageObjects').mockResolvedValue(mockObjects);
    const mockQuery = {
      readConcern: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(PartnerModel, 'find').mockReturnValue(mockQuery as any);

    const summary = await reconcileStorageOrphans({
      storageAdapter: mockStorageAdapter,
      prefix: 'thehomez-private/partners/',
      destructive: true,
      confirm: true,
    });

    expect(summary.quarantinedOrAmbiguous).toBe(1);
    expect(summary.genuineOrphansIdentified).toBe(0);
    expect(summary.orphansDeleted).toBe(0);
    expect(mockStorageAdapter.deletePrivateDocument).not.toHaveBeenCalled();
  });

  // 9. Batching and Pagination
  it('correctly chunks large object lists into specified batch sizes', async () => {
    const mockObjects: IStorageObjectMeta[] = Array.from({ length: 5 }, (_, idx) => ({
      key: `thehomez-private/partners/p-${idx}/doc.pdf`,
      sizeBytes: 1024,
      lastModified: threeHoursAgo,
    }));

    vi.spyOn(mockStorageAdapter, 'listStorageObjects').mockResolvedValue(mockObjects);
    const mockQuery = {
      readConcern: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    const findSpy = vi.spyOn(PartnerModel, 'find').mockReturnValue(mockQuery as any);

    const summary = await reconcileStorageOrphans({
      storageAdapter: mockStorageAdapter,
      batchSize: 2, // 5 items with batchSize 2 -> 3 batches (2, 2, 1)
    });

    expect(findSpy).toHaveBeenCalledTimes(3);
    expect(summary.genuineOrphansIdentified).toBe(5);
  });

  // 10. Sanitized Report Formatting
  it('generates clear aggregated summary report without exposing secrets or private URLs', () => {
    const sampleSummary: IReconciliationSummary = {
      dryRun: true,
      totalStorageObjectsFound: 150,
      skippedWithinGracePeriod: 12,
      preservedMatchingActive: 120,
      tagsHealedToCommitted: 5,
      softDeletedWithinRetention: 10,
      softDeletedExpiredCandidates: 3,
      softDeletedPurged: 0,
      genuineOrphansIdentified: 5,
      orphansDeleted: 0,
      quarantinedOrAmbiguous: 0,
      abortedDueToDbFailure: false,
    };

    const report = formatReconciliationReport(sampleSummary);

    expect(report).toContain('STORAGE ORPHAN RECONCILIATION SUMMARY REPORT');
    expect(report).toContain('Execution Mode:                   DRY-RUN');
    expect(report).toContain('Total Storage Objects Scanned:    150');
    expect(report).toContain('Preserved (Matching Active Docs): 120');
    expect(report).toContain('Genuine Orphans Identified:       5');
    expect(report).not.toContain('http');
    expect(report).not.toContain('secret');
    expect(report).not.toContain('api_key');
  });
});
