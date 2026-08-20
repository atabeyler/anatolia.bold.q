import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './LoginPage.jsx';
import { LangProvider } from '../services/langContext.jsx';

vi.mock('./LoginPageDecor.jsx', () => ({
  Corner: () => null,
  GridBackground: () => null,
  OrbitalLogo: () => null,
  BootSequence: ({ onDone }) => { onDone(); return null; },
  StatusBar: () => null,
}));
vi.mock('../components/HologramSphere.jsx', () => ({ default: () => null }));
vi.mock('../components/EmergencyButton.jsx', () => ({ default: () => null }));
vi.mock('../components/AppFooter.jsx', () => ({ default: () => null }));
vi.mock('../components/AppMenus.jsx', () => ({ MenuPanel: () => null, SettingsPanel: () => null, InfoModal: () => null, GuideModal: () => null }));
vi.mock('../services/voiceActionRegistry.js', () => ({ registerActions: () => {}, unregisterActions: () => {} }));

const isNativeAppMock = { value: false };
vi.mock('../services/nativeBridge.js', () => ({
  get isNativeApp() { return isNativeAppMock.value; },
  nativeAuth: { establishOnlineSession: vi.fn(() => Promise.resolve({})), verifyOfflineLogin: vi.fn() },
}));

const loginRequestMock = vi.fn();
const setJWTMock = vi.fn();
vi.mock('../services/api.js', () => ({
  api: { loginRequest: (...args) => loginRequestMock(...args), checkApproval: vi.fn() },
  setJWT: (...args) => setJWTMock(...args),
}));

const isPasskeySupportedMock = vi.fn(() => true);
const loginWithPasskeyMock = vi.fn();
vi.mock('../services/webauthn.js', () => ({
  isPasskeySupported: (...args) => isPasskeySupportedMock(...args),
  loginWithPasskey: (...args) => loginWithPasskeyMock(...args),
}));

function renderLogin(onLogin = vi.fn()) {
  render(<LangProvider><LoginPage onLogin={onLogin} /></LangProvider>);
  return onLogin;
}

beforeEach(() => {
  vi.clearAllMocks();
  isNativeAppMock.value = false;
  isPasskeySupportedMock.mockReturnValue(true);
  localStorage.clear();
  // LoginPage renders via the real i18n system (no `t` prop to stub, unlike
  // AppMenus.jsx) -- pin the language to English so assertions can match
  // stable, readable strings instead of the Turkish default.
  localStorage.setItem('anatolia_lang', 'en');
});

describe('LoginPage passkey mode', () => {
  it('shows the password form by default and no passkey toggle when unsupported', async () => {
    isPasskeySupportedMock.mockReturnValue(false);
    renderLogin();
    expect(await screen.findByText('Password')).toBeInTheDocument();
    expect(screen.queryByText('Sign in with Face ID / Fingerprint / Passkey')).not.toBeInTheDocument();
  });

  it('switches to the passkey form and back via the toggle links', async () => {
    renderLogin();
    fireEvent.click(await screen.findByText('Sign in with Face ID / Fingerprint / Passkey'));
    expect(screen.getByRole('button', { name: 'Sign in with Face ID / Fingerprint / Passkey' })).toBeInTheDocument();
    expect(screen.queryByText('Password')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('User Code + Password'));
    expect(await screen.findByText('Password')).toBeInTheDocument();
  });

  it('logs the user in directly on a successful passkey ceremony (no mail-approval wait)', async () => {
    loginWithPasskeyMock.mockResolvedValue({ status: 'approved', jwt: 'jwt-1', userCode: 'U1', nickname: 'BOLD-001', role: 'analyst', isAdmin: false });
    const onLogin = renderLogin();

    fireEvent.click(await screen.findByText('Sign in with Face ID / Fingerprint / Passkey'));
    fireEvent.change(screen.getByPlaceholderText('· · · · · · ·'), { target: { value: 'U1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Face ID / Fingerprint / Passkey' }));

    await waitFor(() => expect(loginWithPasskeyMock).toHaveBeenCalledWith('U1'));
    await waitFor(() => expect(setJWTMock).toHaveBeenCalledWith('jwt-1'));
    expect(onLogin).toHaveBeenCalledWith({ userCode: 'U1', nickname: 'BOLD-001', role: 'analyst', isAdmin: false });
  });

  it('shows an error and never logs in when the passkey ceremony fails (e.g. the user cancels the biometric prompt)', async () => {
    loginWithPasskeyMock.mockRejectedValue(new Error('User cancelled the operation'));
    const onLogin = renderLogin();

    fireEvent.click(await screen.findByText('Sign in with Face ID / Fingerprint / Passkey'));
    fireEvent.change(screen.getByPlaceholderText('· · · · · · ·'), { target: { value: 'U1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Face ID / Fingerprint / Passkey' }));

    await waitFor(() => expect(screen.getByText(/User cancelled the operation/)).toBeInTheDocument());
    expect(onLogin).not.toHaveBeenCalled();
    expect(setJWTMock).not.toHaveBeenCalled();
  });

  it('password login is unaffected: submits userCode/password and awaits mail approval as before', async () => {
    loginRequestMock.mockResolvedValue({ token: 'approval-token' });
    renderLogin();

    fireEvent.change(await screen.findByPlaceholderText('· · · · · · ·'), { target: { value: 'U1' } });
    const passwordInput = document.querySelector('input[type="password"]');
    fireEvent.change(passwordInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByText('REQUEST LOGIN APPROVAL'));

    await waitFor(() => expect(loginRequestMock).toHaveBeenCalledWith('U1', 'secret'));
    expect(await screen.findByText('Login approval requested')).toBeInTheDocument();
  });
});
