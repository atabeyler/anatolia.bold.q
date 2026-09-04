import { runBinary } from '../execFileAsync.js';
import { config } from '../../config.js';

const BIN = config.engineBins.osvScanner;

// OSV-Scanner (Google, Apache-2.0). Matches lockfiles/SBOMs against the
// OSV.dev vulnerability database. Passive: reads manifest/lockfiles only.
export const osvScannerAdapter = {
  id: 'osv-scanner',
  name: 'OSV-Scanner',
  license: 'Apache-2.0',
  intrusiveness: 'PASSIVE',
  supportedTargetTypes: ['REPOSITORY'],
  supportedAnalysisTypes: ['SCA', 'SUPPLY_CHAIN'],

  async healthCheck() {
    try {
      const { stdout } = await runBinary(BIN, ['--version'], { timeoutMs: 10_000 });
      const version = stdout.match(/osv-scanner version:\s*(\S+)/)?.[1] || 'unknown';
      return { status: 'HEALTHY', version };
    } catch (err) {
      return { status: 'OFFLINE', detail: String(err.message || err) };
    }
  },

  // target: a local directory to scan recursively for known lockfile formats.
  async execute({ target, timeoutMs = 120_000 }) {
    const { stdout } = await runBinary(BIN, ['scan', '--format', 'json', '--recursive', target], {
      timeoutMs,
      allowedExitCodes: [0, 1], // 1 == vulnerabilities found, not a tool failure
    });
    return { raw: JSON.parse(stdout) };
  },
};
