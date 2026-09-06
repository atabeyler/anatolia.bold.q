import { runBinary } from '../execFileAsync.js';
import { config } from '../../config.js';
const BIN = config.engineBins.naabu;
export const naabuAdapter = {
  id: 'naabu', name: 'naabu', license: 'MIT', intrusiveness: 'SAFE_ACTIVE', capabilities: ['SAFE_ACTIVE'],
  supportedTargetTypes: ['HOST'], supportedAnalysisTypes: ['NETWORK_DISCOVERY'],
  async healthCheck() { try { const { stdout, stderr } = await runBinary(BIN, ['-version'], { timeoutMs: 10_000 }); const version = (stdout + stderr).match(/[Vv]ersion\s+v?(\S+)/)?.[1] || 'unknown'; return { status: 'HEALTHY', version }; } catch (err) { return { status: 'OFFLINE', detail: String(err.message || err) }; } },
  async execute({ target, ports = '1-1000', timeoutMs = 60_000, rateLimit = 100 }) { const { stdout } = await runBinary(BIN, ['-host', target, '-p', ports, '-scan-type', 'connect', '-rate', String(rateLimit), '-json', '-silent'], { timeoutMs, allowedExitCodes: [0] }); const raw = stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)); return { raw }; },
};
