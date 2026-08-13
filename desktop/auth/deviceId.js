import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Generated once per install and persisted alongside the local database —
// AQ-WIN-XXXXXXXX, per spec. Deliberately just an identifier (no secret
// material) so it's fine to log/display and to send to the server on every
// sync call.
export function getOrCreateDeviceId(userDataDir) {
  const file = path.join(userDataDir, 'device.json');
  fs.mkdirSync(userDataDir, { recursive: true });

  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data.deviceId) return data.deviceId;
    } catch {
      // Corrupt device.json -- fall through and mint a new id rather than
      // crash the app over a file that only ever holds a non-secret label.
    }
  }

  const suffix = randomBytes(4).toString('hex').toUpperCase();
  const deviceId = `AQ-WIN-${suffix}`;
  fs.writeFileSync(file, JSON.stringify({ deviceId, createdAt: new Date().toISOString() }, null, 2));
  return deviceId;
}
