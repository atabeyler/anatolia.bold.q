import { runBinary } from '../execFileAsync.js';
import { config } from '../../config.js';

const BIN = config.engineBins.trivy;

export const trivyAdapter = {
  id: 'trivy',
  name: 'Trivy',
  license: 'Apache-2.0',
  intrusiveness: 'PASSIVE',
  capabilities: ['PASSIVE'],
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

  async execute({ target, mode = 'fs', timeoutMs = 120_000 }) {
    const subcommand = mode === 'image' ? 'image' : 'fs';
    const { stdout } = await runBinary(BIN, [subcommand, '--scanners', 'vuln,secret,misconfig', '--format', 'json', '--quiet', target], { timeoutMs, allowedExitCodes: [0, 1] });
    return { raw: JSON.parse(stdout) };
  },
};
