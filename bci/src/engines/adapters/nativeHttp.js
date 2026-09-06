import os from 'node:os';
import { runBinary } from '../execFileAsync.js';

export const CURL_DISCARD_PATH = os.devNull;

export async function curlHealthCheck() {
  try {
    const { stdout } = await runBinary('curl', ['--version'], { timeoutMs: 10_000 });
    const version = stdout.match(/^curl\s+(\S+)/)?.[1];
    if (!version) return { status: 'DEGRADED', detail: 'curl returned an unexpected version response' };
    return { status: 'HEALTHY', version };
  } catch (err) {
    return { status: 'OFFLINE', detail: String(err.message || err) };
  }
}

export function parseHttpStatus(value) {
  const status = Number(String(value).trim());
  if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error(`unexpected HTTP status output: ${value}`);
  return status;
}

export function assertHttpTarget(target) {
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`unsupported URL protocol: ${url.protocol}`);
  return url.toString();
}
