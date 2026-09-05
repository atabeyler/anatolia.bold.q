import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import tls from 'node:tls';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { query } from '../src/db/client.js';
import { resetDatabase, createOrg, createUser } from './helpers/db.js';
import { runCryptoDiscovery, probeTlsEndpoint } from '../src/services/cryptoDiscovery.js';

const execFileAsync = promisify(execFile);

beforeEach(resetDatabase);

async function approveScope(orgId, userId, target, targetType, classes = ['PASSIVE', 'SAFE_ACTIVE']) {
  await query(
    `INSERT INTO authorized_scopes (org_id, name, target, target_type, allowed_scan_classes, status, created_by, approved_by, approved_at)
     VALUES ($1,'scope',$2,$3,$4,'APPROVED',$5,$5,now())`,
    [orgId, target, targetType, classes, userId]
  );
}

// Real TLS servers with real, freshly generated certificates -- an RSA one
// and an EC one -- so Crypto Discovery is proven against actual handshakes,
// not a canned fixture standing in for one.
let workDir;
let rsaServer;
let ecServer;
let rsaPort;
let ecPort;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), 'bci-pqc-fixture-'));

  await execFileAsync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', path.join(workDir, 'rsa.key'), '-out', path.join(workDir, 'rsa.crt'),
    '-days', '1', '-nodes', '-subj', '/CN=localhost',
  ]);
  await execFileAsync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-keyout', path.join(workDir, 'ec.key'), '-out', path.join(workDir, 'ec.crt'),
    '-days', '1', '-nodes', '-subj', '/CN=localhost',
  ]);

  const [rsaKey, rsaCert, ecKey, ecCert] = await Promise.all([
    readFile(path.join(workDir, 'rsa.key')),
    readFile(path.join(workDir, 'rsa.crt')),
    readFile(path.join(workDir, 'ec.key')),
    readFile(path.join(workDir, 'ec.crt')),
  ]);

  rsaServer = tls.createServer({ key: rsaKey, cert: rsaCert }, (socket) => socket.end());
  ecServer = tls.createServer({ key: ecKey, cert: ecCert }, (socket) => socket.end());

  await new Promise((resolve) => rsaServer.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => ecServer.listen(0, '127.0.0.1', resolve));
  rsaPort = rsaServer.address().port;
  ecPort = ecServer.address().port;
}, 30_000);

afterAll(async () => {
  await new Promise((resolve) => rsaServer.close(resolve));
  await new Promise((resolve) => ecServer.close(resolve));
  await rm(workDir, { recursive: true, force: true });
});

describe('probeTlsEndpoint (real TLS handshake)', () => {
  it('identifies an RSA certificate as RSA with a real modulus length', async () => {
    const result = await probeTlsEndpoint('127.0.0.1', rsaPort);
    expect(result.keyType).toBe('rsa');
    expect(result.keySizeBits).toBe(2048);
    expect(result.subject).toMatch(/CN=localhost/);
  });

  it('identifies an EC certificate as ec with its named curve', async () => {
    const result = await probeTlsEndpoint('127.0.0.1', ecPort);
    expect(result.keyType).toBe('ec');
    expect(result.namedCurve).toBe('prime256v1');
  });

  it('rejects when nothing is listening on the port', async () => {
    await expect(probeTlsEndpoint('127.0.0.1', 1)).rejects.toThrow();
  });
});

describe('runCryptoDiscovery (integration, real DB + real TLS)', () => {
  it('denies discovery with no matching authorized scope (fail-closed, same as scan authorization)', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });

    const result = await runCryptoDiscovery({ orgId, actorUserId: userId, target: '127.0.0.1', port: rsaPort });
    expect(result.accepted).toBe(false);
    expect(result.decision.decision).toBe('DENY');
  });

  it('discovers and classifies an RSA endpoint as quantum-vulnerable, and stores it in crypto_findings', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, '127.0.0.1', 'IP');

    const result = await runCryptoDiscovery({ orgId, actorUserId: userId, target: '127.0.0.1', port: rsaPort });
    expect(result.accepted).toBe(true);
    expect(result.discovered).toBe(true);
    expect(result.finding.algorithm_id).toBe('RSA');
    expect(result.finding.quantum_vulnerable).toBe(true);
    expect(result.finding.key_size_bits).toBe(2048);

    const { rows } = await query('SELECT * FROM crypto_findings WHERE org_id = $1', [orgId]);
    expect(rows).toHaveLength(1);
  });

  it('reports discovery failure honestly (accepted, not discovered) when nothing answers on the port', async () => {
    const orgId = await createOrg();
    const userId = await createUser(orgId, { roleId: 'operator' });
    await approveScope(orgId, userId, '127.0.0.1', 'IP');

    const result = await runCryptoDiscovery({ orgId, actorUserId: userId, target: '127.0.0.1', port: 1 });
    expect(result.accepted).toBe(true);
    expect(result.discovered).toBe(false);
    expect(result.error).toBeDefined();
  });
});
