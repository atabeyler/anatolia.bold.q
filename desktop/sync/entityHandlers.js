import { getEncryptionKey } from '../db/index.js';
import { encryptField, decryptField } from '../db/fieldCrypto.js';

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

    // sync_queue's payload carries AES-256-GCM ciphertext (AQ-002, see
    // analysesRepo.js's createAnalysis/updateAnalysis) -- the server side
    // has no concept of it and expects plaintext, so this is the one place
    // it's decrypted back, immediately before the network push.
    preparePushPayload(payload) {
      if (!payload) return payload;
      const key = getEncryptionKey();
      return {
        ...payload,
        title: decryptField(payload.title ?? null, key),
        content: decryptField(payload.content ?? null, key),
      };
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

      // The server stores/returns plaintext title/content (it never sees
      // ciphertext -- see preparePushPayload above) -- encrypt it with this
      // device's key before it ever touches local disk, same as
      // analysesRepo.js's createAnalysis/updateAnalysis do for locally
      // authored writes.
      const key = getEncryptionKey();
      const encryptedTitle = encryptField(record.payload.title, key);
      const encryptedContent = encryptField(record.payload.content, key);

      if (existing) {
        db.prepare(`
          UPDATE analyses SET title = @title, content = @content, category = @category, ai_provider = @aiProvider,
            fraud_transaction_count = @fraudTx, fraud_flagged_count = @fraudFlag,
            version = @version, updated_at = @ts, deleted_at = NULL, sync_status = 'synced', device_id = @deviceId
          WHERE id = @id
        `).run({
          id: record.entityId, ts, version: record.version, deviceId: record.deviceId,
          title: encryptedTitle, content: encryptedContent, category: record.payload.category,
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
          category: record.payload.category, title: encryptedTitle, content: encryptedContent,
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
