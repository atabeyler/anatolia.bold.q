import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDatabase, createOrg } from './helpers/db.js';

// BCI_DISABLE_SCOPE_ENFORCEMENT is read once at module load (see
// policyEngine.js's SCOPE_ENFORCEMENT_DISABLED constant), so this file sets
// it before a fresh dynamic import rather than mutating process.env after
// the normal test suite has already imported the module with it unset --
// keeping this in its own file also makes it impossible to accidentally
// leave the bypass active for any other test.
describe('policy engine -- explicit, audited scope-enforcement bypass (temporary, off by default)', () => {
  beforeEach(async () => {
    resetDatabase && await resetDatabase();
    vi.resetModules();
    process.env.BCI_DISABLE_SCOPE_ENFORCEMENT = 'true';
  });

  afterEach(() => {
    delete process.env.BCI_DISABLE_SCOPE_ENFORCEMENT;
    vi.resetModules();
  });

  it('ALLOWs a target with no authorized scope at all when the bypass env var is set', async () => {
    const { evaluateScopeAuthorization } = await import('../src/services/policyEngine.js');
    const orgId = await createOrg();
    const decision = await evaluateScopeAuthorization({
      orgId,
      target: 'never-authorized.example.com',
      requestedClass: 'RESTRICTED',
    });
    expect(decision.decision).toBe('ALLOW');
    expect(decision.reason).toBe('scope_enforcement_temporarily_disabled');
  });
});
