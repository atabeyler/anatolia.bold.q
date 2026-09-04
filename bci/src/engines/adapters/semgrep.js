import { runBinary } from '../execFileAsync.js';
import { config } from '../../config.js';

const BIN = config.engineBins.semgrep;

// Semgrep OSS CLI (LGPL-2.1). Static analysis over source code using its
// bundled `auto`/registry rulesets. Passive: reads source files only, never
// executes the target code or talks to it over the network.
export const semgrepAdapter = {
  id: 'semgrep',
  name: 'Semgrep',
  license: 'LGPL-2.1',
  intrusiveness: 'PASSIVE',
  supportedTargetTypes: ['REPOSITORY'],
  supportedAnalysisTypes: ['SAST'],

  async healthCheck() {
    try {
      const { stdout } = await runBinary(BIN, ['--version'], { timeoutMs: 10_000 });
      return { status: 'HEALTHY', version: stdout.trim() };
    } catch (err) {
      return { status: 'OFFLINE', detail: String(err.message || err) };
    }
  },

  async execute({ target, timeoutMs = 180_000 }) {
    const { stdout } = await runBinary(
      BIN,
      ['--config', 'auto', '--json', '--quiet', target],
      { timeoutMs, allowedExitCodes: [0, 1] } // 1 == findings present
    );
    return { raw: JSON.parse(stdout) };
  },
};
