import { runBinary } from '../execFileAsync.js';
import { config } from '../../config.js';
const BIN = config.engineBins.semgrep;
export const semgrepAdapter = {
  id: 'semgrep', name: 'Semgrep', license: 'LGPL-2.1', intrusiveness: 'PASSIVE', capabilities: ['SAST'],
  supportedTargetTypes: ['REPOSITORY'], supportedAnalysisTypes: ['SAST'],
  async healthCheck() { try { const { stdout } = await runBinary(BIN, ['--version'], { timeoutMs: 10_000 }); return { status: 'HEALTHY', version: stdout.trim() }; } catch (err) { return { status: 'OFFLINE', detail: String(err.message || err) }; } },
  async execute({ target, timeoutMs = 180_000 }) { const { stdout } = await runBinary(BIN, ['--config', 'auto', '--json', '--quiet', target], { timeoutMs, allowedExitCodes: [0, 1] }); return { raw: JSON.parse(stdout) }; },
};
