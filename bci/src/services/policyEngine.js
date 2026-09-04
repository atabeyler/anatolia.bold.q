import { query } from '../db/client.js';
import { recordAuditEvent } from './audit.js';

// Core rule (spec section 10): "Belirsiz durumda DENY uygulanmalıdır. AI bu
// kararı değiştiremez." -- every path through this function that isn't an
// explicit, matched, still-valid, approved scope returns DENY. There is no
// default-allow branch anywhere below.
function targetMatches(scopeTarget, requestedTarget) {
  const a = scopeTarget.toLowerCase();
  const b = requestedTarget.toLowerCase();
  return a === b || b.endsWith(`.${a}`);
}

export async function evaluateScopeAuthorization({ orgId, actorUserId, target, requestedClass }) {
  const decision = await computeDecision({ orgId, target, requestedClass });

  await recordAuditEvent({
    orgId,
    actorUserId,
    action: 'policy.evaluate',
    targetType: 'scope',
    targetId: target,
    result: decision.decision,
    metadata: { requestedClass, reason: decision.reason, scopeId: decision.scopeId ?? null },
  });

  return decision;
}

async function computeDecision({ orgId, target, requestedClass }) {
  const { rows: scopes } = await query(
    `SELECT id, target, allowed_scan_classes, valid_from, valid_until
       FROM authorized_scopes
      WHERE org_id = $1
        AND status = 'APPROVED'
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())`,
    [orgId]
  );

  const matching = scopes.find((s) => targetMatches(s.target, target));
  if (!matching) {
    return { decision: 'DENY', reason: 'no_matching_authorized_scope' };
  }

  const { rows: exclusions } = await query(
    'SELECT pattern FROM scope_exclusions WHERE scope_id = $1',
    [matching.id]
  );
  const excluded = exclusions.some((e) => target.toLowerCase().includes(e.pattern.toLowerCase()));
  if (excluded) {
    return { decision: 'DENY', reason: 'target_excluded', scopeId: matching.id };
  }

  if (!matching.allowed_scan_classes.includes(requestedClass)) {
    return { decision: 'DENY', reason: 'scan_class_not_allowed', scopeId: matching.id };
  }

  return { decision: 'ALLOW', reason: 'matched_authorized_scope', scopeId: matching.id };
}
