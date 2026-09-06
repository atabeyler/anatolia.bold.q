import { runBinary } from '../execFileAsync.js';

// Advanced active validation: bounded protocol/method behavior checks.
// It validates observable behavior and does not attempt exploitation.
export const intrusiveValidationAdapter = {
  id: 'intrusive-validation',
  name: 'BCI Advanced Active Validation',
  license: 'BCI-NATIVE',
  intrusiveness: 'RESTRICTED',
  capabilities: ['INTRUSIVE'],
  supportedTargetTypes: ['WEB_APP', 'API'],
  supportedAnalysisTypes: ['WEB', 'API', 'INTRUSIVE'],
  async healthCheck() { return { status: 'HEALTHY', version: '1' }; },
  async execute({ target, timeoutMs = 30_000 }) {
    const methods = ['OPTIONS', 'TRACE'];
    const raw = [];
    for (const method of methods) {
      try {
        const { stdout } = await runBinary('curl', [
          '--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}',
          '--max-time', '5', '--request', method, target,
        ], { timeoutMs: Math.min(timeoutMs, 7_000), allowedExitCodes: [0] });
        const status = Number(stdout.trim());
        raw.push({ type: 'ACTIVE_METHOD_VALIDATION', method, status, anomalous: method === 'TRACE' && status >= 200 && status < 400 });
      } catch (err) {
        raw.push({ type: 'ACTIVE_METHOD_VALIDATION', method, status: null, anomalous: false, error: String(err.message || err) });
      }
    }
    return { raw };
  },
};
