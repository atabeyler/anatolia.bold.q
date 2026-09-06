// Minimal quantum params service. Adapt the `db` import to your project's DB client (knex/pg/sequelize/etc.).
const db = require('../db'); // <-- replace with your DB client

async function getAll() {
  return db('quantum_params').select('*');
}

async function get(feature) {
  return db('quantum_params').where({ feature }).first();
}

async function upsert(feature, { enabled, expires_at, updated_by, reason }) {
  const now = new Date();
  const existing = await get(feature);
  if (existing) {
    await db.transaction(async trx => {
      await trx('quantum_param_audit').insert({
        feature,
        old_enabled: existing.enabled,
        new_enabled: enabled,
        changed_by: updated_by,
        expires_at,
        reason
      });
      await trx('quantum_params').where({ feature }).update({
        enabled,
        expires_at,
        updated_by,
        updated_at: now,
        reason
      });
    });
  } else {
    await db.transaction(async trx => {
      await trx('quantum_params').insert({
        feature,
        enabled,
        expires_at,
        updated_by,
        updated_at: now,
        reason
      });
      await trx('quantum_param_audit').insert({
        feature,
        old_enabled: false,
        new_enabled: enabled,
        changed_by: updated_by,
        expires_at,
        reason
      });
    });
  }
  return get(feature);
}

module.exports = { getAll, get, upsert };
