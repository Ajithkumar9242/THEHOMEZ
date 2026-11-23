import mongoose from 'mongoose';
import {
  registerTestDeletionSafetyHooks,
  TestFixtureRegistry,
  registerTestFixture,
} from '../src/database/test-guard.js';

export { TestFixtureRegistry, registerTestFixture };

/**
 * Vitest Global Setup File
 *
 * Guarantees that deletion safety hooks and test database isolation guards
 * are registered unconditionally on process startup before any test executes,
 * preventing any suite from bypassing hooks or running destructive commands.
 */
registerTestDeletionSafetyHooks(mongoose);
