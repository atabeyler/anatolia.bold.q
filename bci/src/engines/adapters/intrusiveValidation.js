import { runBinary } from '../execFileAsync.js';
import { CURL_DISCARD_PATH, assertHttpTarget, curlHealthCheck, parseHttpStatus } from './nativeHttp.js';

// Advanced active validation: bounded protocol/method behavior checks.
// It validates observable behavior and does not attempt exploitation.
export const intrusiveValidationAdapter = {
  id: 'intrusive-validation',
  name: 'BCI Advanced Active Validation',
  license: 'BCI-NATIVE',
  intrusiveness: 'RESTRICTED',
  capabilities: ['INTRUSIVE'],
  supportedTargetTypes: ['DOMAIN', 'SUBDOMAIN', 'URL', 'API'],
  supportedAnalysisTypes: ['INTRUSIVE'],
  async healthCheck() { return curlHealthCheck(); },
  async execute({ target, timeoutMs = 30_000 }) {
    const validatedTarget = assertHttpTarget(target);
    const methods = ['OPTIONS', 'TRACE'];
    const raw = [];
    let failures = 0;
    for (const method of methods) {
      try {
        const { stdout } = await runBinary('curl', [
          '--silent', '--show-error', '--output', CURL_DISCARD_PATH, '--write-out', '%{http_code}',
          '--max-time', '5', '--request', method, validatedTarget,
        ], { timeoutMs: Math.min(timeoutMs, 7_000), allowedExitCodes: [0] });
        const status = parseHttpStatus(stdout);
        raw.push({ type: 'ACTIVE_METHOD_VALIDATION', method, status, anomalous: method === 'TRACE' && status >= 200 && status < 400 });
      } catch (err) {
        failures += 1;
        raw.push({ type: 'ACTIVE_METHOD_VALIDATION', method, status: null, anomalous: false, error: String(err.message || err) });
      }
    }
    if (failures === methods.length) throw new Error('all active validation probes failed');
    return { raw };
  },
};
