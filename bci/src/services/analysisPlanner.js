// BCI Analysis Planner (spec section 9). Decides which engines run for a
// job from two facts only: the target's TYPE (from the authorized_scopes
// row that granted it -- see policyEngine.js/jobQueue.js) and the
// authorized scan CLASS. Never from a target's raw string shape -- that's
// exactly the ambiguity typed scopes (src/lib/targetMatcher.js) exist to
// remove.
const INTRUSIVENESS_ORDER = ['PASSIVE', 'SAFE_ACTIVE', 'AUTHENTICATED', 'RESTRICTED'];

function allowedUpTo(requestedClass) {
  const idx = INTRUSIVENESS_ORDER.indexOf(requestedClass);
  return new Set(INTRUSIVENESS_ORDER.slice(0, idx + 1));
}

// { engineId, intrusiveness, mode } -- `mode` distinguishes how the same
// engine binary is invoked for this target type (e.g. Trivy `fs` vs `image`).
const ENGINE_PLAN_BY_TARGET_TYPE = {
  REPOSITORY: [
    { engineId: 'semgrep', intrusiveness: 'PASSIVE', mode: 'fs' },
    { engineId: 'osv-scanner', intrusiveness: 'PASSIVE', mode: 'fs' },
    { engineId: 'trivy', intrusiveness: 'PASSIVE', mode: 'fs' },
  ],
  CONTAINER: [{ engineId: 'trivy', intrusiveness: 'PASSIVE', mode: 'image' }],
  DOMAIN: [{ engineId: 'nuclei', intrusiveness: 'SAFE_ACTIVE', mode: 'url' }],
  SUBDOMAIN: [{ engineId: 'nuclei', intrusiveness: 'SAFE_ACTIVE', mode: 'url' }],
  URL: [{ engineId: 'nuclei', intrusiveness: 'SAFE_ACTIVE', mode: 'url' }],
  API: [{ engineId: 'nuclei', intrusiveness: 'SAFE_ACTIVE', mode: 'url' }],
  IP: [{ engineId: 'naabu', intrusiveness: 'SAFE_ACTIVE', mode: 'host' }],
  CIDR: [{ engineId: 'naabu', intrusiveness: 'SAFE_ACTIVE', mode: 'host' }],
  // No engine adapter covers these target types yet -- an empty plan is the
  // honest answer, not a guess (it shows up as zero Coverage Score
  // contribution for these assets, spec section 29, rather than pretending
  // analysis happened).
  CLOUD_ACCOUNT: [],
  KUBERNETES_CLUSTER: [],
};

export function planEngines(targetType, requestedClass) {
  const candidates = ENGINE_PLAN_BY_TARGET_TYPE[targetType] || [];
  const allowed = allowedUpTo(requestedClass);
  return candidates.filter((c) => allowed.has(c.intrusiveness));
}

// All engines that could ever run against this target type, at ANY scan
// class -- i.e. planEngines() before the requestedClass filter. This is
// "compatibility" (would this engine ever be considered for this target
// type), a separate fact from "recommended" (would it actually be selected
// for the class the user picked). Note this is a different vocabulary from
// an engine adapter's own `supportedTargetTypes` (WEB_APP/API/HOST/
// REPOSITORY/CONTAINER -- the asset-type taxonomy coverageScore.js uses):
// this planner keys on the scan target-type taxonomy (DOMAIN/SUBDOMAIN/URL/
// IP/CIDR/REPOSITORY/API/CLOUD_ACCOUNT/CONTAINER/KUBERNETES_CLUSTER, from
// authorized_scopes' typed scope), which is what a scan job actually carries
// (scan_jobs.target_type). Engine-selection compatibility must be judged
// against that, not the asset-type field.
export function candidateEnginesForTargetType(targetType) {
  return ENGINE_PLAN_BY_TARGET_TYPE[targetType] || [];
}
