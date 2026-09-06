import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { listAdapters } from '../src/engines/registry.js';

// Nuclei and naabu are SAFE_ACTIVE engines -- they send real requests/TCP
// connections. The only target they touch here is a throwaway HTTP server
// this test process itself starts and owns on 127.0.0.1, so there is no
// question of scope authorization: it's self-testing against localhost, not
// scanning anything outside this process's own control.
let server;
let port;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

async function ifHealthy(id) {
  const adapter = listAdapters().find((a) => a.id === id);
  const health = await adapter.healthCheck();
  return { adapter, healthy: health.status === 'HEALTHY' };
}

describe('active engines against a self-owned localhost target', () => {
  it('naabu detects the open loopback port', async () => {
    const { adapter, healthy } = await ifHealthy('naabu');
    if (!healthy) return;
    const { raw } = await adapter.execute({ target: '127.0.0.1', ports: `${port}`, timeoutMs: 30_000 });
    expect(Array.isArray(raw)).toBe(true);
    expect(raw.some((r) => r.port === port)).toBe(true);
  }, 30_000);

  it('nuclei runs against the local server without error', async () => {
    const { adapter, healthy } = await ifHealthy('nuclei');
    if (!healthy) return;
    const { raw } = await adapter.execute({ target: `http://127.0.0.1:${port}`, timeoutMs: 60_000 });
    expect(Array.isArray(raw)).toBe(true);
  }, 60_000);

  it.each([
    ['http-fuzz', 5],
    ['intrusive-validation', 2],
    ['availability-probe', 3],
  ])('%s performs only its bounded probe set against localhost', async (engineId, expectedSamples) => {
    const { adapter, healthy } = await ifHealthy(engineId);
    if (!healthy) return;
    const { raw } = await adapter.execute({ target: `http://127.0.0.1:${port}`, timeoutMs: 30_000 });
    expect(raw).toHaveLength(expectedSamples);
    expect(raw.every((observation) => observation && typeof observation === 'object')).toBe(true);
  }, 45_000);

  it.each(['http-fuzz', 'intrusive-validation', 'availability-probe'])('%s rejects a non-HTTP target before spawning probes', async (engineId) => {
    const adapter = listAdapters().find((candidate) => candidate.id === engineId);
    await expect(adapter.execute({ target: 'file:///etc/passwd' })).rejects.toThrow(/unsupported URL protocol/);
  });
});
