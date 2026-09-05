import tls from 'node:tls';
import crypto from 'node:crypto';
import net from 'node:net';
import { query } from '../db/client.js';
import { evaluateScopeAuthorization } from './policyEngine.js';
import { recordAuditEvent } from './audit.js';
import { classifyKeyType, PQC_CLASSIFICATION_VERSION } from '../quantum/pqcClassification.js';

const FIXED_CURVE_BITS = { ed25519: 255, x25519: 255, ed448: 448, x448: 448 };
const NAMED_CURVE_BITS = { prime256v1: 256, secp256r1: 256, secp384r1: 384, secp521r1: 521, secp256k1: 256 };

function keySizeBits(keyType, details) {
  if (details?.modulusLength) return details.modulusLength;
  if (details?.namedCurve) return NAMED_CURVE_BITS[details.namedCurve] ?? null;
  return FIXED_CURVE_BITS[keyType] ?? null;
}

// A REAL TLS handshake against the target -- never a mock parser over a
// canned response. rejectUnauthorized:false is deliberate: Crypto
// Discovery's job is to inventory whatever certificate/algorithm the
// endpoint actually presents, trusted or not; certificate trust validation
// is a different (client-side) concern this feature does not police.
export function probeTlsEndpoint(host, port = 443, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    // SNI's servername must be a hostname, not a bare IP (RFC 6066) --
    // omit it for IP targets rather than passing a value Node will only
    // warn about and then ignore.
    const connectOptions = { host, port, rejectUnauthorized: false, timeout: timeoutMs };
    if (net.isIP(host) === 0) connectOptions.servername = host;
    const socket = tls.connect(connectOptions, () => {
      if (settled) return;
      try {
        const peerCert = socket.getPeerCertificate(true);
        if (!peerCert || !peerCert.raw) {
          throw new Error('no certificate presented by endpoint');
        }
        const cipher = socket.getCipher();
        const protocol = socket.getProtocol();
        const x509 = new crypto.X509Certificate(peerCert.raw);
        const keyType = x509.publicKey?.asymmetricKeyType ?? null;
        const details = x509.publicKey?.asymmetricKeyDetails ?? {};
        settled = true;
        socket.end();
        resolve({
          protocol,
          cipherSuite: cipher?.name ?? null,
          keyType,
          keySizeBits: keySizeBits(keyType, details),
          namedCurve: details.namedCurve ?? null,
          subject: x509.subject,
          issuer: x509.issuer,
          validFrom: x509.validFrom,
          validTo: x509.validTo,
          fingerprint256: x509.fingerprint256,
        });
      } catch (err) {
        settled = true;
        socket.destroy();
        reject(err);
      }
    });
    socket.once('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    socket.once('timeout', () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error('TLS connection timed out'));
    });
  });
}

function hostnameFromTarget(targetType, target) {
  if (targetType === 'URL' || targetType === 'API') {
    try {
      return new URL(target).hostname;
    } catch {
      return target;
    }
  }
  return target;
}

// The one entry point. Crypto Discovery makes a real active network
// connection to the target, so it goes through the exact same
// evaluateScopeAuthorization gate as a scan job (M2) -- there is no
// separate, weaker authorization path for "just reading a certificate".
export async function runCryptoDiscovery({ orgId, actorUserId, target, port = 443 }) {
  const decision = await evaluateScopeAuthorization({ orgId, actorUserId, target, requestedClass: 'SAFE_ACTIVE' });
  if (decision.decision !== 'ALLOW') {
    return { accepted: false, decision };
  }

  const host = hostnameFromTarget(decision.targetType, target);
  let probe;
  try {
    probe = await probeTlsEndpoint(host, port);
  } catch (err) {
    const error = String(err.message || err);
    await recordAuditEvent({
      orgId, actorUserId, action: 'crypto.discover', targetType: 'crypto_finding', targetId: target,
      result: 'FAILED', metadata: { error },
    });
    return { accepted: true, discovered: false, error };
  }

  const classification = classifyKeyType(probe.keyType);

  const { rows } = await query(
    `INSERT INTO crypto_findings (
       org_id, source, target, protocol, cipher_suite, key_type, key_size_bits, named_curve,
       algorithm_id, quantum_vulnerable, classification_note, classification_version,
       cert_subject, cert_issuer, cert_not_before, cert_not_after, cert_fingerprint
     ) VALUES ($1,'TLS',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      orgId, target, probe.protocol, probe.cipherSuite, probe.keyType, probe.keySizeBits, probe.namedCurve,
      classification.algorithmId, classification.quantumVulnerable, classification.note, PQC_CLASSIFICATION_VERSION,
      probe.subject, probe.issuer, new Date(probe.validFrom), new Date(probe.validTo), probe.fingerprint256,
    ]
  );

  await recordAuditEvent({
    orgId, actorUserId, action: 'crypto.discover', targetType: 'crypto_finding', targetId: rows[0].id,
    result: 'SUCCESS', metadata: { target, algorithmId: classification.algorithmId, quantumVulnerable: classification.quantumVulnerable },
  });

  return { accepted: true, discovered: true, finding: rows[0] };
}

export async function listCryptoFindings(orgId) {
  const { rows } = await query('SELECT * FROM crypto_findings WHERE org_id = $1 ORDER BY discovered_at DESC', [orgId]);
  return rows;
}
