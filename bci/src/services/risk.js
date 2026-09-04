import { query } from '../db/client.js';

// BCI Risk Score v1 (spec section 26). CVSS remains the technical
// reference; this is BCI's own number built on top of it. Deterministic,
// versioned (RISK_MODEL_VERSION), and every input is kept in the returned
// breakdown so "why this score" is always answerable later, even after the
// live score has since moved on (risk_history keeps a snapshot per compute).
export const RISK_MODEL_VERSION = 1;

const CRITICALITY_MULTIPLIER = { LOW: 0.7, MEDIUM: 0.85, HIGH: 1.0, CRITICAL: 1.15 };
const DEFAULT_BASE_WITHOUT_CVSS = 50; // e.g. a SAST/secrets finding with no CVE at all

export function computeRiskScore({ cvssScore, epssScore, kev, assetCriticality = 'MEDIUM', confidenceScore = 0 }) {
  const base = cvssScore != null ? cvssScore * 10 : DEFAULT_BASE_WITHOUT_CVSS;
  const epssBoost = epssScore != null ? epssScore * 20 : 0;
  const kevBoost = kev ? 25 : 0;
  const criticalityMultiplier = CRITICALITY_MULTIPLIER[assetCriticality] ?? CRITICALITY_MULTIPLIER.MEDIUM;

  // A finding nobody has confirmed can still be shown, but it must never
  // read as equally risky as a confirmed one -- confidence 0 halves the
  // score, confidence 100 leaves it untouched. This is what keeps a
  // "CRITICAL severity, 20% confidence" finding from looking like an
  // immediate fire (spec section 24's worked example).
  const confidenceFactor = 0.5 + confidenceScore / 200;

  const preConfidence = (base + epssBoost + kevBoost) * criticalityMultiplier;
  const score = Math.round(Math.max(0, Math.min(100, preConfidence * confidenceFactor)));

  return {
    score,
    breakdown: { base, epssBoost, kevBoost, criticalityMultiplier, confidenceFactor, assetCriticality, cvssScore, epssScore, kev, confidenceScore },
  };
}

// Action priority is not the same axis as the numeric score (spec section
// 27): a KEV-listed vulnerability is IMMEDIATE regardless of exactly how
// the 0-100 number landed, because active exploitation in the wild is a
// categorical fact, not a matter of degree.
export function computePriority(riskScore, kev) {
  if (kev || riskScore >= 90) return 'IMMEDIATE';
  if (riskScore >= 75) return '24_HOURS';
  if (riskScore >= 50) return 'HIGH_PRIORITY';
  if (riskScore >= 25) return 'PLANNED';
  return 'MONITOR';
}

async function findBestCveForFinding(finding) {
  if (!finding.cve_ids?.length) return null;
  const { rows } = await query(
    `SELECT * FROM vulnerabilities WHERE cve_id = ANY($1) ORDER BY cvss_score DESC NULLS LAST LIMIT 1`,
    [finding.cve_ids]
  );
  return rows[0] || null;
}

async function findAssetCriticality(orgId, target) {
  const { rows } = await query(
    `SELECT a.criticality FROM assets a
       JOIN asset_identifiers ai ON ai.asset_id = a.id
      WHERE a.org_id = $1 AND ai.value = $2
      LIMIT 1`,
    [orgId, target]
  );
  return rows[0]?.criticality ?? 'MEDIUM';
}

export async function recomputeFindingRisk(findingId) {
  const { rows } = await query('SELECT * FROM findings WHERE id = $1', [findingId]);
  const finding = rows[0];
  if (!finding) throw new Error(`finding not found: ${findingId}`);

  const [vulnerability, assetCriticality] = await Promise.all([
    findBestCveForFinding(finding),
    findAssetCriticality(finding.org_id, finding.target),
  ]);

  const { score, breakdown } = computeRiskScore({
    cvssScore: vulnerability?.cvss_score != null ? Number(vulnerability.cvss_score) : null,
    epssScore: vulnerability?.epss_score != null ? Number(vulnerability.epss_score) : null,
    kev: vulnerability?.kev ?? false,
    assetCriticality,
    confidenceScore: finding.confidence_score,
  });
  const priority = computePriority(score, vulnerability?.kev ?? false);

  await query(
    `UPDATE findings SET risk_score = $1, priority = $2, risk_breakdown = $3, risk_model_version = $4, updated_at = now()
      WHERE id = $5`,
    [score, priority, JSON.stringify(breakdown), RISK_MODEL_VERSION, findingId]
  );
  await query(
    `INSERT INTO risk_history (finding_id, risk_score, priority, breakdown, risk_model_version)
     VALUES ($1, $2, $3, $4, $5)`,
    [findingId, score, priority, JSON.stringify(breakdown), RISK_MODEL_VERSION]
  );

  return { score, priority, breakdown };
}
