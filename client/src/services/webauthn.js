/**
 * Thin wrapper around @simplewebauthn/browser -- keeps the rest of the app
 * (LoginPage.jsx, AppMenus.jsx's Security tab) from touching the raw
 * navigator.credentials API or WebAuthn error types directly, and gives a
 * single place to feature-detect support across iPhone/iPad (Face ID/Touch
 * ID), Android (device biometrics), Windows (Hello) and Mac (Touch ID).
 *
 * The browser prompts the OS-level platform authenticator for a biometric/
 * PIN check itself; the result of that check never passes through this
 * code or the network -- only the signed challenge response does, which
 * the server verifies cryptographically (see server/src/routes/webauthn.js).
 */
import { startRegistration, startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { api } from './api.js';

export function isPasskeySupported() {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

// Runs the full registration ceremony against the caller's own,
// already-authenticated account: fetch options -> prompt the platform
// authenticator -> send the signed attestation back for verification.
export async function registerPasskey(deviceName) {
  const options = await api.webauthn.registerOptions();
  const response = await startRegistration({ optionsJSON: options });
  return api.webauthn.registerVerify(response, deviceName);
}

// Runs the full login ceremony for a given user code, returning the same
// { status: 'approved', jwt, userCode, nickname, isAdmin, role } shape
// api.loginRequest()'s admin path returns, so LoginPage.jsx can share its
// existing "log the user in" handling.
export async function loginWithPasskey(userCode) {
  const options = await api.webauthn.loginOptions(userCode);
  const response = await startAuthentication({ optionsJSON: options });
  return api.webauthn.loginVerify(userCode, response);
}
