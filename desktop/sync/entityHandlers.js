// Registry of per-entity-type local persistence for sync/engine.js's
// pushQueue/pullChanges. Those two functions (queueing, backoff, conflict
// detection, cursor paging) are already entity-agnostic; only "how does
// a pushed/pulled record for THIS entity type get written to the local
// SQLite schema" is entity-specific. Today only 'analysis' is wired up
// end-to-end (matching the server, which only accepts 'analysis' in
// routes/sync.js's SUPPORTED_ENTITY_TYPES) -- adding a future entity
// (memory, files metadata, preferences, saved scenarios, conversation/
// workspace state, ...) means adding one handler here plus its own local
// table/migration, not touching pushQueue/pullChanges again.
const handlers = {
  analysis: {
    applyApplied(db, op, result) {
      const ts = new Date().toISOString();
      db.prepare(`UPDATE analyses SET version = @version, sync_status = 'synced', updated_at = @ts WHERE id = @id`)
        .run({ id: op.entity_id, version: result.serverVersion, ts });
    },

    applyPulled(db, userId, record) {
      const ts = new Date().toISOString();
      const existing = db.prepare(`SELECT id FROM analyses WHERE id = ?`).get(record.entityId);

      if (record.deleted) {
        if (existing) {
          db.prepare(`UPDATE analyses SET deleted_at = @ts, version = @version, updated_at = @ts, sync_status = 'synced' WHERE id = @id`)
            .run({ id: record.entityId, ts, version: record.version });
        }
        return;
      }

      if (existing) {
        db.prepare(`
          UPDATE analyses SET title = @title, content = @content, category = @category, ai_provider = @aiProvider,
            fraud_transaction_count = @fraudTx, fraud_flagged_count = @fraudFlag,
            version = @version, updated_at = @ts, deleted_at = NULL, sync_status = 'synced', device_id = @deviceId
          WHERE id = @id
        `).run({
          id: record.entityId, ts, version: record.version, deviceId: record.deviceId,
          title: record.payload.title, content: record.payload.content, category: record.payload.category,
          aiProvider: record.payload.aiProvider ?? null,
          fraudTx: record.payload.fraudTransactionCount ?? null, fraudFlag: record.payload.fraudFlaggedCount ?? null,
        });
      } else {
        db.prepare(`
          INSERT INTO analyses (id, user_id, organization_id, device_id, type, version, created_at, updated_at, sync_status, category, title, content, ai_provider, fraud_transaction_count, fraud_flagged_count)
          VALUES (@id, @userId, NULL, @deviceId, 'analysis', @version, @createdAt, @updatedAt, 'synced', @category, @title, @content, @aiProvider, @fraudTx, @fraudFlag)
        `).run({
          id: record.entityId, userId, deviceId: record.deviceId, version: record.version,
          createdAt: record.createdAt, updatedAt: record.updatedAt,
          category: record.payload.category, title: record.payload.title, content: record.payload.content,
          aiProvider: record.payload.aiProvider ?? null,
          fraudTx: record.payload.fraudTransactionCount ?? null, fraudFlag: record.payload.fraudFlaggedCount ?? null,
        });
      }
    },
  },
};

export function getEntityHandler(entityType) {
  const handler = handlers[entityType];
  if (!handler) throw new Error(`No sync handler registered for entity type: ${entityType}`);
  return handler;
}
