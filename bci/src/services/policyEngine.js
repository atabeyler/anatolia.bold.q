import { query } from '../db/client.js';
import { recordAuditEvent } from './audit.js';
import { targetMatchesTyped } from '../lib/targetMatcher.js';

// Core rule (spec section 10): "Belirsiz durumda DENY uygulanmalıdır. AI bu
// kararı değiştiremez." -- every path through this function that isn't an
// explicit, matched, still-valid, approved scope returns DENY. There is no
// default-allow branch anywhere below.
//
// Matching is typed (spec section 4): each scope carries its own
// target_type, and matching dispatches to that type's canonical
// parser/matcher (src/lib/targetMatcher.js) -- a CIDR is never matched by
// string suffix, a URL's path is never confused with a bare domain.

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
    `SELECT id, target, target_type, allowed_scan_classes, valid_from, valid_until
       FROM authorized_scopes
      WHERE org_id = $1
        AND status = 'APPROVED'
        AND valid_from <= now()
        AND (valid_until IS NULL OR valid_until > now())`,
    [orgId]
  );

  const matching = scopes.find((s) => targetMatchesTyped(s.target_type, s.target, target));
  if (!matching) {
    return { decision: 'DENY', reason: 'no_matching_authorized_scope' };
  }

  const { rows: exclusions } = await query(
    'SELECT pattern FROM scope_exclusions WHERE scope_id = $1',
    [matching.id]
  );
  // An exclusion is a narrower target of the SAME type as the scope it
  // belongs to (e.g. a CIDR scope excluding one /32, a DOMAIN scope
  // excluding one subdomain) -- it uses the identical typed matcher, not a
  // separate substring check.
  const excluded = exclusions.some((e) => targetMatchesTyped(matching.target_type, e.pattern, target));
  if (excluded) {
    return { decision: 'DENY', reason: 'target_excluded', scopeId: matching.id };
  }

  if (!matching.allowed_scan_classes.includes(requestedClass)) {
    return { decision: 'DENY', reason: 'scan_class_not_allowed', scopeId: matching.id };
  }

  // targetType comes from the scope that actually authorized the request --
  // never independently supplied by the caller, so a job's later engine
  // selection can never disagree with what was actually authorized.
  return { decision: 'ALLOW', reason: 'matched_authorized_scope', scopeId: matching.id, targetType: matching.target_type };
}
