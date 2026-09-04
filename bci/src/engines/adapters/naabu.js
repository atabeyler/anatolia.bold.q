import { runBinary } from '../execFileAsync.js';
import { config } from '../../config.js';

const BIN = config.engineBins.naabu;

// naabu (ProjectDiscovery, MIT) -- used instead of Nmap for port discovery.
// Nmap's license (the "Nmap Public Source License") restricts bundling it
// into a commercial/redistributed product without a separate license from
// Insecure.Com LLC (spec section 68: verify licensing before embedding any
// third-party tool). naabu is MIT-licensed with no such restriction and
// covers the same "is this port open" need via a plain TCP connect scan
// (no raw sockets / root requirement, unlike Nmap's SYN scan).
export const naabuAdapter = {
  id: 'naabu',
  name: 'naabu',
  license: 'MIT',
  intrusiveness: 'SAFE_ACTIVE',
  supportedTargetTypes: ['HOST'],
  supportedAnalysisTypes: ['NETWORK_DISCOVERY'],

  async healthCheck() {
    try {
      const { stdout, stderr } = await runBinary(BIN, ['-version'], { timeoutMs: 10_000 });
      const version = (stdout + stderr).match(/[Vv]ersion\s+v?(\S+)/)?.[1] || 'unknown';
      return { status: 'HEALTHY', version };
    } catch (err) {
      return { status: 'OFFLINE', detail: String(err.message || err) };
    }
  },

  // target: a host/IP. Same caller-responsibility note as nuclei.js above
  // -- scope authorization is checked before execute() is ever called.
  async execute({ target, ports = '1-1000', timeoutMs = 60_000, rateLimit = 100 }) {
    const { stdout } = await runBinary(
      BIN,
      ['-host', target, '-p', ports, '-scan-type', 'connect', '-rate', String(rateLimit), '-json', '-silent'],
      { timeoutMs, allowedExitCodes: [0] }
    );
    const raw = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { raw };
  },
};
