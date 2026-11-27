#!/usr/bin/env tsx
import { connectDatabase, disconnectDatabase } from '../database/database.js';
import { logger } from '../logger/logger.js';
import { PartnerModel } from '../models/partner.model.js';
import { cloudinaryPrivateStorageAdapter } from '../services/storage/cloudinary-private-storage.service.js';
import type {
  IPrivateDocumentStorageAdapter,
  IStorageObjectMeta,
} from '../services/storage/private-storage.interface.js';

export interface IReconciliationOptions {
  destructive?: boolean;
  confirm?: boolean;
  graceHours?: number;
  batchSize?: number;
  prefix?: string;
  storageAdapter?: IPrivateDocumentStorageAdapter;
}

export interface IReconciliationSummary {
  dryRun: boolean;
  totalStorageObjectsFound: number;
  skippedWithinGracePeriod: number;
  preservedMatchingActive: number;
  tagsHealedToCommitted: number;
  softDeletedWithinRetention: number;
  softDeletedExpiredCandidates: number;
  softDeletedPurged: number;
  genuineOrphansIdentified: number;
  orphansDeleted: number;
  quarantinedOrAmbiguous: number;
  abortedDueToDbFailure: boolean;
}

/**
 * Core engine for reconciling storage objects with PartnerDocument records.
 * Can be run standalone or imported for automated testing.
 */
export async function reconcileStorageOrphans(
  options: IReconciliationOptions = {},
): Promise<IReconciliationSummary> {
  const isDestructive = Boolean(options.destructive && options.confirm);
  const graceHours = options.graceHours ?? 2;
  const gracePeriodMs = graceHours * 60 * 60 * 1000;
  const batchSize = options.batchSize ?? 100;
  const prefix = options.prefix ?? 'thehomez-private/partners/';
  const storageAdapter = options.storageAdapter ?? cloudinaryPrivateStorageAdapter;

  const now = new Date();
  const graceThreshold = new Date(now.getTime() - gracePeriodMs);
  const softDeleteRetentionMs = 24 * 60 * 60 * 1000; // 24 hours soft-delete retention
  const softDeleteThreshold = new Date(now.getTime() - softDeleteRetentionMs);

  const summary: IReconciliationSummary = {
    dryRun: !isDestructive,
    totalStorageObjectsFound: 0,
    skippedWithinGracePeriod: 0,
    preservedMatchingActive: 0,
    tagsHealedToCommitted: 0,
    softDeletedWithinRetention: 0,
    softDeletedExpiredCandidates: 0,
    softDeletedPurged: 0,
    genuineOrphansIdentified: 0,
    orphansDeleted: 0,
    quarantinedOrAmbiguous: 0,
    abortedDueToDbFailure: false,
  };

  logger.info(
    {
      mode: isDestructive ? 'DESTRUCTIVE' : 'DRY-RUN',
      graceHours,
      prefix,
      batchSize,
    },
    'ReconcileStorageOrphans: Starting storage orphan reconciliation scan',
  );

  // 1. Fetch storage objects via storage adapter
  let storageObjects: IStorageObjectMeta[] = [];
  try {
    storageObjects = await storageAdapter.listStorageObjects(prefix);
  } catch (err) {
    logger.error({ err, prefix }, 'ReconcileStorageOrphans: Failed to list storage objects. Aborting immediately.');
    throw err;
  }

  summary.totalStorageObjectsFound = storageObjects.length;
  logger.info(
    { count: storageObjects.length },
    'ReconcileStorageOrphans: Retrieved storage object inventory',
  );

  if (storageObjects.length === 0) {
    return summary;
  }

  // 2. Filter out objects within the upload grace period (Rule: avoid race conditions with in-flight uploads)
  const candidateObjects: IStorageObjectMeta[] = [];
  for (const obj of storageObjects) {
    if (obj.lastModified > graceThreshold) {
      summary.skippedWithinGracePeriod++;
    } else {
      candidateObjects.push(obj);
    }
  }

  // 3. Process candidate storage objects in bounded batches
  for (let i = 0; i < candidateObjects.length; i += batchSize) {
    const batch = candidateObjects.slice(i, i + batchSize);
    const storageKeys = batch.map((b) => b.key);

    // Rule 4: MongoDB Connectivity & Querying
    // Query MongoDB with majority read concern
    let matchingPartners: any[] = [];
    try {
      matchingPartners = await PartnerModel.find(
        { 'documents.storageKey': { $in: storageKeys } },
        { 'documents.storageKey': 1, 'documents.isDeleted': 1, 'documents.deletedAt': 1 },
      )
        .readConcern('majority')
        .lean()
        .exec();
    } catch (dbErr) {
      summary.abortedDueToDbFailure = true;
      logger.fatal(
        { err: dbErr },
        'ReconcileStorageOrphans: MongoDB query failure during reconciliation. FAILING CLOSED IMMEDIATELY.',
      );
      throw new Error('Reconciliation aborted: MongoDB connectivity or query failure');
    }

    // Map matching documents by storageKey
    const docMap = new Map<string, { isDeleted: boolean; deletedAt?: Date }>();
    for (const partner of matchingPartners) {
      if (Array.isArray(partner.documents)) {
        for (const doc of partner.documents) {
          if (doc && doc.storageKey) {
            docMap.set(doc.storageKey, {
              isDeleted: Boolean(doc.isDeleted),
              deletedAt: doc.deletedAt ? new Date(doc.deletedAt) : undefined,
            });
          }
        }
      }
    }

    // Evaluate each object in current batch against Rules 1-5
    for (const obj of batch) {
      const doc = docMap.get(obj.key);

      if (doc) {
        if (!doc.isDeleted) {
          // Rule 1: Matching active document exists. PRESERVE OBJECT.
          summary.preservedMatchingActive++;

          // Self-healing: if storage tag is PENDING_COMMIT, repair to COMMITTED
          if (obj.tags?.status === 'PENDING_COMMIT') {
            try {
              await storageAdapter.updateObjectTags(obj.key, { status: 'COMMITTED' });
              summary.tagsHealedToCommitted++;
              logger.info('STORAGE_TAG_HEALED: Tag updated to COMMITTED');
            } catch (tagErr) {
              logger.warn({ tagErr }, 'Failed to update object tag during self-healing');
            }
          }
        } else {
          // Rule 2: Matching soft-deleted document exists.
          const isWithinRetention = doc.deletedAt && doc.deletedAt > softDeleteThreshold;
          if (isWithinRetention) {
            summary.softDeletedWithinRetention++;
          } else {
            summary.softDeletedExpiredCandidates++;
            if (isDestructive) {
              try {
                const deleted = await storageAdapter.deletePrivateDocument(obj.key);
                if (deleted) {
                  summary.softDeletedPurged++;
                }
              } catch (delErr) {
                logger.error({ delErr }, 'Failed to purge expired soft-deleted storage object');
              }
            }
          }
        }
      } else {
        // Rule 3: No matching MongoDB document exists across any partner. Genuinely orphaned!
        // Ambiguity check: Validate key format starts with expected root
        if (!obj.key.startsWith(prefix)) {
          // Rule 5: Ambiguous ownership / path structure - do not delete
          summary.quarantinedOrAmbiguous++;
          logger.warn('Ambiguous object key structure outside target prefix; quarantined');
          continue;
        }

        summary.genuineOrphansIdentified++;

        if (isDestructive) {
          try {
            const deleted = await storageAdapter.deletePrivateDocument(obj.key);
            if (deleted) {
              summary.orphansDeleted++;
            }
          } catch (delErr) {
            logger.error({ delErr }, 'Failed to physically delete orphaned storage object');
          }
        }
      }
    }
  }

  return summary;
}

/**
 * Prints sanitized, aggregated human-readable summary table.
 * Strictly guarantees no signed URLs, tokens, keys or secrets are logged.
 */
export function formatReconciliationReport(summary: IReconciliationSummary): string {
  const mode = summary.dryRun ? 'DRY-RUN (Safe, zero physical deletions performed)' : 'DESTRUCTIVE EXECUTION';
  return `
================================================================================
           STORAGE ORPHAN RECONCILIATION SUMMARY REPORT
================================================================================
Execution Mode:                   ${mode}
Total Storage Objects Scanned:    ${summary.totalStorageObjectsFound}
Skipped (< Grace Period):         ${summary.skippedWithinGracePeriod}
Preserved (Matching Active Docs): ${summary.preservedMatchingActive}
Self-Healed Storage Tags:         ${summary.tagsHealedToCommitted}
Soft-Deleted (Within Retention):  ${summary.softDeletedWithinRetention}
Soft-Deleted Expired Candidates:  ${summary.softDeletedExpiredCandidates}
Soft-Deleted Purged:              ${summary.softDeletedPurged}
Genuine Orphans Identified:       ${summary.genuineOrphansIdentified}
Orphans Physically Deleted:       ${summary.orphansDeleted}
Quarantined / Ambiguous:          ${summary.quarantinedOrAmbiguous}
Database Failure Abort:           ${summary.abortedDueToDbFailure ? 'YES (FAILED CLOSED)' : 'NO (CLEAN)'}
================================================================================
`;
}

async function cliMain() {
  const args = process.argv.slice(2);
  const destructive = args.includes('--destructive') || args.includes('--delete');
  const confirm = args.includes('--confirm');

  let graceHours = 2;
  const graceIdx = args.findIndex((arg) => arg === '--grace-hours');
  if (graceIdx !== -1) {
    const rawGrace = args[graceIdx + 1];
    if (rawGrace) {
      const parsed = parseFloat(rawGrace);
      if (!isNaN(parsed) && parsed >= 0) {
        graceHours = parsed;
      }
    }
  }

  let batchSize = 100;
  const batchIdx = args.findIndex((arg) => arg === '--batch-size');
  if (batchIdx !== -1) {
    const rawBatch = args[batchIdx + 1];
    if (rawBatch) {
      const parsed = parseInt(rawBatch, 10);
      if (!isNaN(parsed) && parsed > 0) {
        batchSize = parsed;
      }
    }
  }

  if (destructive && !confirm) {
    console.error(
      'SAFETY WARNING: --destructive requires explicit --confirm flag to execute physical deletions. Running in DRY-RUN mode instead.',
    );
  }

  try {
    await connectDatabase();
    logger.info('Connected to MongoDB database');
  } catch (dbErr) {
    logger.fatal({ err: dbErr }, 'Failed to connect to MongoDB. Reconciliation aborted (failed closed).');
    process.exit(1);
  }

  try {
    const summary = await reconcileStorageOrphans({
      destructive,
      confirm,
      graceHours,
      batchSize,
    });

    console.log(formatReconciliationReport(summary));
  } catch (err) {
    logger.fatal({ err }, 'Fatal error during orphan reconciliation. Failsafe activated.');
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

// Auto-run if executed directly via CLI
if (process.argv[1] && process.argv[1].endsWith('reconcile-storage-orphans.ts')) {
  cliMain().catch((err) => {
    console.error('Fatal CLI execution error:', err);
    process.exit(1);
  });
}
