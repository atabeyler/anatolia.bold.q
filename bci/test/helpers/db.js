import { query } from '../../src/db/client.js';

// Truncate every tenant-data table between tests -- CASCADE handles FK
// order so tests never need to know the dependency graph. schema_migrations
// and the RBAC catalog (roles/permissions/role_permissions) are seed/system
// data, not per-test data, so they're left alone.
export async function resetDatabase() {
  await query(`
    TRUNCATE TABLE
      audit_events,
      scope_exclusions,
      authorized_scopes,
      scan_policies,
      asset_relationships,
      asset_technologies,
      asset_identifiers,
      assets,
      user_roles,
      users,
      organizations
    RESTART IDENTITY CASCADE
  `);
}

export async function createOrg(name = 'Test Org', slug = 'test-org') {
  const { rows } = await query(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [name, slug]
  );
  return rows[0].id;
}

export async function createUser(orgId, { email = 'user@example.com', passwordHash, roleId = 'viewer' } = {}) {
  const { hashPassword } = await import('../../src/lib/password.js');
  const hash = passwordHash || (await hashPassword('correct horse battery staple'));
  const { rows } = await query(
    'INSERT INTO users (org_id, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [orgId, email, hash]
  );
  const userId = rows[0].id;
  if (roleId) {
    await query('INSERT INTO user_roles (user_id, org_id, role_id) VALUES ($1, $2, $3)', [userId, orgId, roleId]);
  }
  return userId;
}
