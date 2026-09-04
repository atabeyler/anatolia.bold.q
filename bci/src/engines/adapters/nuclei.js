import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBinary } from '../execFileAsync.js';
import { config } from '../../config.js';

const BIN = config.engineBins.nuclei;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Bundled BCI-native templates -- see templates/nuclei/README for why this
// doesn't rely on `nuclei -update-templates` (blocked in air-gapped/
// Sovereign deployments, and in this sandbox's network policy alike).
const BUNDLED_TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'nuclei');

// Nuclei (ProjectDiscovery, MIT). Template-based HTTP/network probing --
// this one actually talks to the target, so it requires at least
// SAFE_ACTIVE authorization (never run it PASSIVE-only). Explicitly
// excludes dos/fuzz/intrusive-tagged templates and rate-limits requests:
// "detect", never "break" (spec section 11, Safe Mode).
export const nucleiAdapter = {
  id: 'nuclei',
  name: 'Nuclei',
  license: 'MIT',
  intrusiveness: 'SAFE_ACTIVE',
  supportedTargetTypes: ['WEB_APP', 'API', 'HOST'],
  supportedAnalysisTypes: ['WEB', 'API'],

  async healthCheck() {
    try {
      const { stdout, stderr } = await runBinary(BIN, ['-version'], { timeoutMs: 15_000 });
      const version = (stdout + stderr).match(/Nuclei Engine Version:\s*(\S+)/)?.[1] || 'unknown';
      return { status: 'HEALTHY', version };
    } catch (err) {
      return { status: 'OFFLINE', detail: String(err.message || err) };
    }
  },

  // target: a URL (http/https). Caller is responsible for confirming this
  // exact target is covered by an APPROVED authorized_scope with
  // SAFE_ACTIVE (or higher) before ever calling execute() -- the adapter
  // itself has no scope awareness, by design (that decision lives only in
  // the policy engine, see services/policyEngine.js).
  // templateId: for a targeted re-check (spec section 35's "BCI Verify" --
  // re-probe just the one rule that originally fired, not the whole
  // template set) rather than a full re-scan.
  async execute({ target, timeoutMs = 120_000, rateLimit = 10, templatesDir = BUNDLED_TEMPLATES_DIR, templateId }) {
    const args = [
      '-target', target,
      '-templates', templatesDir,
      '-jsonl',
      '-silent',
      '-etags', 'dos,fuzz,intrusive',
      '-rate-limit', String(rateLimit),
      '-no-interactsh',
      '-disable-update-check',
    ];
    if (templateId) args.push('-template-id', templateId);

    const { stdout } = await runBinary(BIN, args, { timeoutMs, allowedExitCodes: [0] });
    const raw = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { raw };
  },
};
