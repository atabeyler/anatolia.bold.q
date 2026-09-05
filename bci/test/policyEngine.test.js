import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../src/db/client.js';
import { resetDatabase, createOrg } from './helpers/db.js';
import { evaluateScopeAuthorization } from '../src/services/policyEngine.js';

beforeEach(resetDatabase);

async function insertScope(orgId, overrides = {}) {
  const {
    target = 'example.com',
    allowedScanClasses = ['PASSIVE'],
    status = 'APPROVED',
    validUntil = null,
    createdBy,
  } = overrides;

  const { rows: userRows } = await query(
    'INSERT INTO users (org_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [orgId, `creator-${Math.random()}@test.local`, 'irrelevant']
  );
  const userId = createdBy || userRows[0].id;

  const { rows } = await query(
    `INSERT INTO authorized_scopes (org_id, name, target, allowed_scan_classes, status, valid_until, created_by)
     VALUES ($1, 'test scope', $2, $3, $4, $5, $6) RETURNING id`,
    [orgId, target, allowedScanClasses, status, validUntil, userId]
  );
  return rows[0].id;
}

describe('policy engine (deny-by-default)', () => {
  it('denies when there is no authorized scope at all for the org', async () => {
    const orgId = await createOrg();
    const decision = await evaluateScopeAuthorization({
      orgId,
      target: 'example.com',
      requestedClass: 'PASSIVE',
    });
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toBe('no_matching_authorized_scope');
  });

  it('denies a scope that is still PENDING approval', async () => {
    const orgId = await createOrg();
    await insertScope(orgId, { status: 'PENDING' });
    const decision = await evaluateScopeAuthorization({ orgId, target: 'example.com', requestedClass: 'PASSIVE' });
    expect(decision.decision).toBe('DENY');
  });

  it('denies a scope for a different organization (no cross-tenant leakage)', async () => {
    const orgA = await createOrg('A', 'org-a');
    const orgB = await createOrg('B', 'org-b');
    await insertScope(orgA, { target: 'example.com' });

    const decision = await evaluateScopeAuthorization({ orgId: orgB, target: 'example.com', requestedClass: 'PASSIVE' });
    expect(decision.decision).toBe('DENY');
  });

  it('denies when the requested scan class is not in the approved list', async () => {
    const orgId = await createOrg();
    await insertScope(orgId, { allowedScanClasses: ['PASSIVE'] });
    const decision = await evaluateScopeAuthorization({ orgId, target: 'example.com', requestedClass: 'RESTRICTED' });
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toBe('scan_class_not_allowed');
  });

  it('denies an expired scope', async () => {
    const orgId = await createOrg();
    await insertScope(orgId, { validUntil: new Date(Date.now() - 60_000).toISOString() });
    const decision = await evaluateScopeAuthorization({ orgId, target: 'example.com', requestedClass: 'PASSIVE' });
    expect(decision.decision).toBe('DENY');
  });

  it('allows when an approved, current, class-matching scope covers the target', async () => {
    const orgId = await createOrg();
    await insertScope(orgId, { target: 'example.com', allowedScanClasses: ['PASSIVE', 'SAFE_ACTIVE'] });
    const decision = await evaluateScopeAuthorization({ orgId, target: 'example.com', requestedClass: 'SAFE_ACTIVE' });
    expect(decision.decision).toBe('ALLOW');
    expect(decision.scopeId).toBeDefined();
  });

  it('allows a subdomain of an approved domain scope', async () => {
    const orgId = await createOrg();
    await insertScope(orgId, { target: 'example.com' });
    const decision = await evaluateScopeAuthorization({ orgId, target: 'api.example.com', requestedClass: 'PASSIVE' });
    expect(decision.decision).toBe('ALLOW');
  });

  it('denies a target excluded within an otherwise-approved scope', async () => {
    const orgId = await createOrg();
    const scopeId = await insertScope(orgId, { target: 'example.com' });
    await query('INSERT INTO scope_exclusions (scope_id, pattern) VALUES ($1, $2)', [scopeId, 'admin.example.com']);

    const decision = await evaluateScopeAuthorization({ orgId, target: 'admin.example.com', requestedClass: 'PASSIVE' });
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toBe('target_excluded');
  });

  it('an exclusion bypass attempt via a deeper sub-subdomain is still caught (exclusion inherits DOMAIN subdomain semantics)', async () => {
    const orgId = await createOrg();
    const scopeId = await insertScope(orgId, { target: 'example.com' });
    await query('INSERT INTO scope_exclusions (scope_id, pattern) VALUES ($1, $2)', [scopeId, 'admin.example.com']);

    const decision = await evaluateScopeAuthorization({ orgId, target: 'internal.admin.example.com', requestedClass: 'PASSIVE' });
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toBe('target_excluded');
  });

  it('an exclusion is not defeated by case differences', async () => {
    const orgId = await createOrg();
    const scopeId = await insertScope(orgId, { target: 'example.com' });
    await query('INSERT INTO scope_exclusions (scope_id, pattern) VALUES ($1, $2)', [scopeId, 'admin.example.com']);

    const decision = await evaluateScopeAuthorization({ orgId, target: 'ADMIN.example.com', requestedClass: 'PASSIVE' });
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toBe('target_excluded');
  });

  it('denies a scope that has not started yet (validFrom in the future)', async () => {
    const orgId = await createOrg();
    const { rows: userRows } = await query(
      'INSERT INTO users (org_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [orgId, `future-${Math.random()}@test.local`, 'irrelevant']
    );
    await query(
      `INSERT INTO authorized_scopes (org_id, name, target, allowed_scan_classes, status, valid_from, created_by)
       VALUES ($1, 'future scope', 'example.com', $2, 'APPROVED', $3, $4)`,
      [orgId, ['PASSIVE'], new Date(Date.now() + 60_000).toISOString(), userRows[0].id]
    );

    const decision = await evaluateScopeAuthorization({ orgId, target: 'example.com', requestedClass: 'PASSIVE' });
    expect(decision.decision).toBe('DENY');
  });

  it('denies an empty or whitespace-only target rather than matching anything', async () => {
    const orgId = await createOrg();
    await insertScope(orgId, { target: 'example.com' });

    const decision = await evaluateScopeAuthorization({ orgId, target: '   ', requestedClass: 'PASSIVE' });
    expect(decision.decision).toBe('DENY');
  });

  it('records an audit event for every evaluation, allow or deny', async () => {
    const orgId = await createOrg();
    await evaluateScopeAuthorization({ orgId, target: 'example.com', requestedClass: 'PASSIVE' });
    const { rows } = await query('SELECT * FROM audit_events WHERE org_id = $1', [orgId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('policy.evaluate');
    expect(rows[0].result).toBe('DENY');
  });
});
