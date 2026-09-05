import { query } from '../db/client.js';
import { computeSecurityScore } from '../services/securityScore.js';
import { computeCoverageScore } from '../services/coverageScore.js';

const OPEN_STATUSES = ['NEW', 'CONFIRMED', 'ASSIGNED', 'IN_REMEDIATION', 'READY_FOR_VERIFICATION', 'DEFERRED'];

// `targets`, when given (routes/reports.js resolves it from an assetId's
// real asset_identifiers), scopes a report to one asset's findings using
// the exact same target-string-match convention as risk.js/coverageScore.js
// elsewhere. securityScore/coverageScore themselves stay ORG-WIDE always --
// computeSecurityScore()/computeCoverageScore() have no per-target mode,
// and faking one by filtering their inputs client-side here would silently
// misrepresent what those two numbers actually mean. scopedToTargets in the
// output says plainly what was and wasn't narrowed.
function targetFilterClause(targets, paramIndex) {
  if (!targets?.length) return { clause: '', param: null };
  return { clause: ` AND target = ANY($${paramIndex})`, param: targets };
}

// Executive Report (spec section 45): the numbers a CISO/leadership reads,
// never raw engine output or per-finding technical detail.
export async function buildExecutiveReport(orgId, { targets } = {}) {
  const [security, coverage] = await Promise.all([computeSecurityScore(orgId), computeCoverageScore(orgId)]);

  const findingsFilter = targetFilterClause(targets, 3);
  const { rows: openFindings } = await query(
    `SELECT priority, risk_score FROM findings WHERE org_id = $1 AND status = ANY($2)${findingsFilter.clause}`,
    findingsFilter.param ? [orgId, OPEN_STATUSES, findingsFilter.param] : [orgId, OPEN_STATUSES]
  );
  const criticalCount = openFindings.filter((f) => f.priority === 'IMMEDIATE').length;
  const highCount = openFindings.filter((f) => f.priority === '24_HOURS').length;

  const topRisksFilter = targetFilterClause(targets, 3);
  const { rows: topRisks } = await query(
    `SELECT id, title, target, risk_score, priority FROM findings
      WHERE org_id = $1 AND status = ANY($2) AND risk_score IS NOT NULL${topRisksFilter.clause}
      ORDER BY risk_score DESC LIMIT 5`,
    topRisksFilter.param ? [orgId, OPEN_STATUSES, topRisksFilter.param] : [orgId, OPEN_STATUSES]
  );

  const kevFilter = targetFilterClause(targets, 3);
  const { rows: kevExposure } = await query(
    `SELECT count(DISTINCT f.id)::int AS n
       FROM findings f, unnest(f.cve_ids) AS finding_cve_id
       JOIN vulnerabilities v ON v.cve_id = finding_cve_id AND v.kev = true
      WHERE f.org_id = $1 AND f.status = ANY($2)${kevFilter.clause.replace('target', 'f.target')}`,
    kevFilter.param ? [orgId, OPEN_STATUSES, kevFilter.param] : [orgId, OPEN_STATUSES]
  );

  return {
    scopedToTargets: targets ?? null,
    securityScore: security.score,
    coverageScore: coverage.score,
    securityCoverageScoreScope: 'ORG_WIDE',
    openFindingCount: openFindings.length,
    criticalFindingCount: criticalCount,
    highFindingCount: highCount,
    kevExposureCount: kevExposure[0].n,
    topRisks,
  };
}

// Technical Report (spec section 45): full detail for security/IT --
// every open finding plus which engines corroborated it.
export async function buildTechnicalReport(orgId, { targets } = {}) {
  const filter = targetFilterClause(targets, 2);
  const { rows: findings } = await query(
    `SELECT * FROM findings WHERE org_id = $1${filter.clause} ORDER BY risk_score DESC NULLS LAST`,
    filter.param ? [orgId, filter.param] : [orgId]
  );

  for (const finding of findings) {
    const { rows: sources } = await query(
      `SELECT fs.engine_id, no.rule_id, no.location, no.engine_severity
         FROM finding_sources fs JOIN normalized_observations no ON no.id = fs.normalized_observation_id
        WHERE fs.finding_id = $1`,
      [finding.id]
    );
    finding.sources = sources;
  }

  return { scopedToTargets: targets ?? null, findingCount: findings.length, findings };
}

// Remediation Report (spec section 45): for developers/DevOps -- what to
// fix, grouped by where it stands in the remediation lifecycle.
export async function buildRemediationReport(orgId, { targets } = {}) {
  const filter = targetFilterClause(targets, 2);
  const { rows } = await query(
    `SELECT f.id AS finding_id, f.title, f.status, f.priority, f.target,
            r.id AS remediation_id, r.recommendation, r.status AS remediation_status, r.assignee_user_id
       FROM findings f
       LEFT JOIN remediations r ON r.finding_id = f.id
      WHERE f.org_id = $1 AND f.status <> 'FALSE_POSITIVE'${filter.clause.replace('target', 'f.target')}
      ORDER BY f.priority NULLS LAST, f.risk_score DESC NULLS LAST`,
    filter.param ? [orgId, filter.param] : [orgId]
  );
  return { scopedToTargets: targets ?? null, items: rows };
}

// Audit/Compliance Evidence Report (spec section 45): the audit ledger
// itself, for a fixed window -- this report IS the compliance evidence,
// not a summary of it. Deliberately never asset-scoped: audit events cover
// logins, admin actions, and other org-level activity that isn't tied to
// any single asset, so filtering by target would silently drop evidence
// rather than narrow it meaningfully.
export async function buildAuditReport(orgId, { from, to } = {}) {
  const params = [orgId];
  let where = 'org_id = $1';
  if (from) {
    params.push(from);
    where += ` AND created_at >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    where += ` AND created_at <= $${params.length}`;
  }

  const { rows } = await query(
    `SELECT id, actor_user_id, action, target_type, target_id, result, metadata, created_at
       FROM audit_events WHERE ${where} ORDER BY created_at ASC`,
    params
  );
  return { eventCount: rows.length, events: rows, window: { from: from ?? null, to: to ?? null } };
}

// FULL BCI Report: bundles the other four builders' output into one
// artifact, additive only -- generating one never removes or changes the
// independent EXECUTIVE/TECHNICAL/REMEDIATION/AUDIT report types, which
// keep working exactly as before.
export async function buildFullReport(orgId, options = {}) {
  const [executive, technical, remediation, audit] = await Promise.all([
    buildExecutiveReport(orgId, options),
    buildTechnicalReport(orgId, options),
    buildRemediationReport(orgId, options),
    buildAuditReport(orgId, options),
  ]);
  return { scopedToTargets: options.targets ?? null, executive, technical, remediation, audit };
}
