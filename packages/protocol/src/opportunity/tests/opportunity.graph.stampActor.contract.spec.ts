import { describe, test, expect } from 'bun:test';
import type { OpportunityGraphDatabase } from '../../shared/interfaces/database.interface.js';

describe('OpportunityGraphDatabase contract', () => {
  test('declares stampOpportunityActorAction', () => {
    // Compile-time check via a typed reference. If the method is missing,
    // TypeScript fails the build before this test even runs.
    type Method = OpportunityGraphDatabase['stampOpportunityActorAction'];
    const _typecheck: Method extends (...args: never[]) => unknown ? true : false = true;
    expect(_typecheck).toBe(true);
  });
});
