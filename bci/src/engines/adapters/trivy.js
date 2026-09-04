import { runBinary } from '../execFileAsync.js';
import { config } from '../../config.js';

const BIN = config.engineBins.trivy;

// Trivy (Aqua Security, Apache-2.0). Filesystem/repo/container/IaC scanner
// for known-CVE dependencies, secrets, and misconfiguration. Purely passive
// -- it reads files/images, it never sends a request to the target -- so it
// requires no more than PASSIVE authorization.
export const trivyAdapter = {
  id: 'trivy',
  name: 'Trivy',
  license: 'Apache-2.0',
  intrusiveness: 'PASSIVE',
  supportedTargetTypes: ['REPOSITORY', 'CONTAINER'],
  supportedAnalysisTypes: ['SCA', 'SECRETS', 'IAC', 'CONFIG'],

  async healthCheck() {
    try {
      const { stdout } = await runBinary(BIN, ['--version'], { timeoutMs: 10_000 });
      const version = stdout.match(/Version:\s*(\S+)/)?.[1] || 'unknown';
      return { status: 'HEALTHY', version };
    } catch (err) {
      return { status: 'OFFLINE', detail: String(err.message || err) };
    }
  },

  // target: a local filesystem path (repo checkout or extracted container).
  // Fetching/checking out the target is the caller's job, not the
  // adapter's -- keeps the adapter honest about only ever touching what's
  // already on disk in workDir.
  async execute({ target, timeoutMs = 120_000 }) {
    const { stdout } = await runBinary(
      BIN,
      ['fs', '--scanners', 'vuln,secret,misconfig', '--format', 'json', '--quiet', target],
      { timeoutMs, allowedExitCodes: [0, 1] }
    );
    return { raw: JSON.parse(stdout) };
  },
};
