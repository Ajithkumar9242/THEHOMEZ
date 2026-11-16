import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { connectDatabase, disconnectDatabase } from '../src/database/database.js';
import { UnitModel } from '../src/models/unit.model.js';
import { seedApprovedUnits, APPROVED_UNITS } from '../src/seeds/units.seed.js';

describe('Substep 4.2: Unit Master Model & Idempotent Seeding', () => {
  let isDbConnected = false;

  beforeAll(async () => {
    try {
      await connectDatabase();
      isDbConnected = true;
      if (isDbConnected) {
        await UnitModel.deleteMany({});
        await UnitModel.syncIndexes();
      }
    } catch (err) {
      console.warn('MongoDB connection unavailable:', err);
    }
  });

  afterAll(async () => {
    if (isDbConnected) {
      await disconnectDatabase();
    }
  });

  it('idempotently seeds the 9 approved construction units', async () => {
    if (!isDbConnected) return;

    await UnitModel.deleteMany({});

    // First seed run
    const firstResult = await seedApprovedUnits();
    expect(firstResult.upsertedCount).toBe(9);

    const count = await UnitModel.countDocuments();
    expect(count).toBe(9);

    // Verify all 9 approved units exist with correct classification and allowedMaxPrecision
    for (const approved of APPROVED_UNITS) {
      const doc = await UnitModel.findOne({ code: approved.code });
      expect(doc).not.toBeNull();
      expect(doc?.name).toBe(approved.name);
      expect(doc?.classification).toBe(approved.classification);
      expect(doc?.isDiscrete).toBe(approved.isDiscrete);
      expect(doc?.allowedMaxPrecision).toBe(approved.allowedMaxPrecision);
      expect(doc?.isActive).toBe(true);
      expect(doc?.isSystem).toBe(true);
    }

    // Re-run seed (must be strictly idempotent with 0 new upserts)
    const secondResult = await seedApprovedUnits();
    expect(secondResult.upsertedCount).toBe(0);
    expect(secondResult.matchedCount).toBe(9);

    const secondCount = await UnitModel.countDocuments();
    expect(secondCount).toBe(9);
  });

  it('enforces discrete unit invariants on pre-validate hook', async () => {
    if (!isDbConnected) return;

    // COUNT forces isDiscrete to true
    const discreteUnit = new UnitModel({
      code: 'TEST_DISCRETE',
      name: 'Test Discrete',
      symbol: 'td',
      singularLabel: 'Test',
      pluralLabel: 'Tests',
      classification: 'COUNT',
      isDiscrete: false, // will be enforced to true by pre-validate hook
      allowedMaxPrecision: 0,
    });

    await discreteUnit.validate();
    expect(discreteUnit.isDiscrete).toBe(true);
    expect(discreteUnit.allowedMaxPrecision).toBe(0);

    // Discrete unit with positive allowedMaxPrecision must reject strictly (no silent overwrite)
    const invalidDiscrete = new UnitModel({
      code: 'TEST_DISCRETE_BAD',
      name: 'Bad Discrete',
      symbol: 'tdb',
      singularLabel: 'Bad',
      pluralLabel: 'Bads',
      classification: 'COUNT',
      allowedMaxPrecision: 2,
    });

    await expect(invalidDiscrete.validate()).rejects.toThrow(
      'Discrete units cannot have decimal precision',
    );
  });

  it('verifies unique index on unit code', async () => {
    if (!isDbConnected) return;

    const unit1 = new UnitModel({
      code: 'TEST_UNIQUE',
      name: 'Test Unique 1',
      symbol: 'tu1',
      singularLabel: 'Unique',
      pluralLabel: 'Uniques',
      classification: 'MASS',
      isDiscrete: false,
      allowedMaxPrecision: 3,
    });
    await unit1.save();

    const unit2 = new UnitModel({
      code: 'TEST_UNIQUE',
      name: 'Test Unique 2',
      symbol: 'tu2',
      singularLabel: 'Unique',
      pluralLabel: 'Uniques',
      classification: 'MASS',
      isDiscrete: false,
      allowedMaxPrecision: 3,
    });

    await expect(unit2.save()).rejects.toThrow();

    await UnitModel.deleteOne({ code: 'TEST_UNIQUE' });
  });
});
