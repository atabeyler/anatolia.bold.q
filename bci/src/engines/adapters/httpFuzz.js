import { runBinary } from '../execFileAsync.js';
import { CURL_DISCARD_PATH, assertHttpTarget, curlHealthCheck, parseHttpStatus } from './nativeHttp.js';

// BCI-native bounded HTTP input-robustness checks. This capability is
// intentionally separate from availability/load testing: it sends a small,
// deterministic set of malformed/boundary query values and records server
// errors as observations for the existing finding pipeline.
export const httpFuzzAdapter = {
  id: 'http-fuzz',
  name: 'BCI HTTP Fuzz',
  license: 'BCI-NATIVE',
  intrusiveness: 'SAFE_ACTIVE',
  capabilities: ['FUZZ'],
  supportedTargetTypes: ['DOMAIN', 'SUBDOMAIN', 'URL', 'API'],
  supportedAnalysisTypes: ['FUZZ'],

  async healthCheck() {
    return curlHealthCheck();
  },

  async execute({ target, timeoutMs = 30_000 }) {
    const validatedTarget = assertHttpTarget(target);
    const cases = ['BCI_BOUNDARY_EMPTY', '0', '-1', '2147483648', 'BCI_%25_TEST'];
    const raw = [];
    let failures = 0;
    for (const value of cases) {
      const url = new URL(validatedTarget);
      url.searchParams.set('bci_probe', value);
      try {
        const { stdout } = await runBinary('curl', [
          '--silent', '--show-error', '--output', CURL_DISCARD_PATH, '--write-out', '%{http_code}',
          '--max-time', '5', '--request', 'GET', url.toString(),
        ], { timeoutMs: Math.min(timeoutMs, 7_000), allowedExitCodes: [0] });
        const status = parseHttpStatus(stdout);
        raw.push({ type: 'HTTP_FUZZ_PROBE', parameter: 'bci_probe', case: value, status, anomalous: status >= 500 });
      } catch (err) {
        failures += 1;
        raw.push({ type: 'HTTP_FUZZ_PROBE', parameter: 'bci_probe', case: value, status: null, anomalous: false, error: String(err.message || err) });
      }
    }
    if (failures === cases.length) throw new Error('all HTTP fuzz probes failed');
    return { raw };
  },
};
