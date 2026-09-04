import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from '../db/client.js';
import { hashContent } from '../reports/integrity.js';
import { buildExecutiveReport, buildTechnicalReport, buildRemediationReport, buildAuditReport } from '../reports/builders.js';
import { VERIFICATION_MODEL_VERSION } from './verification.js';
import { CONFIDENCE_MODEL_VERSION } from './confidence.js';
import { RISK_MODEL_VERSION } from './risk.js';
import { SECURITY_SCORE_MODEL_VERSION } from './securityScore.js';
import { COVERAGE_SCORE_MODEL_VERSION } from './coverageScore.js';
import { recordAuditEvent } from './audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BCI_VERSION = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version;

const MODEL_VERSIONS = {
  verification: VERIFICATION_MODEL_VERSION,
  confidence: CONFIDENCE_MODEL_VERSION,
  risk: RISK_MODEL_VERSION,
  securityScore: SECURITY_SCORE_MODEL_VERSION,
  coverageScore: COVERAGE_SCORE_MODEL_VERSION,
};

const BUILDERS = {
  EXECUTIVE: buildExecutiveReport,
  TECHNICAL: buildTechnicalReport,
  REMEDIATION: buildRemediationReport,
  AUDIT: buildAuditReport,
};

// Wraps a report builder's output with the integrity metadata spec section
// 46 requires: unique id, generation timestamp, BCI version, and the
// versions of every scoring model that could have shaped the content --
// so a report generated today stays reproducible/explainable even after
// those models have since moved to a new version.
export async function generateReport(orgId, actorUserId, reportType, options = {}) {
  const builder = BUILDERS[reportType];
  if (!builder) throw new Error(`Unknown report type: ${reportType}`);

  const content = await builder(orgId, options);
  const contentHash = hashContent(content);

  const { rows } = await query(
    `INSERT INTO reports (org_id, report_type, generated_by, content, content_hash, bci_version, model_versions)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, report_type, content_hash, bci_version, model_versions, created_at`,
    [orgId, reportType, actorUserId, JSON.stringify(content), contentHash, BCI_VERSION, JSON.stringify(MODEL_VERSIONS)]
  );

  await recordAuditEvent({
    orgId, actorUserId, action: 'report.generate', targetType: 'report', targetId: rows[0].id, result: 'SUCCESS', metadata: { reportType },
  });

  return { ...rows[0], content };
}

export async function getReport(orgId, reportId) {
  const { rows } = await query('SELECT * FROM reports WHERE id = $1 AND org_id = $2', [reportId, orgId]);
  const report = rows[0];
  if (!report) return null;

  // Verify on read, not just trust the stored hash -- if content and hash
  // ever diverge (a bug, or someone editing the row directly), that's
  // visible to the caller instead of silently served as if it matched.
  const recomputed = hashContent(report.content);
  return { ...report, integrityValid: recomputed === report.content_hash };
}

export async function listReports(orgId) {
  const { rows } = await query(
    'SELECT id, report_type, generated_by, content_hash, bci_version, created_at FROM reports WHERE org_id = $1 ORDER BY created_at DESC',
    [orgId]
  );
  return rows;
}
