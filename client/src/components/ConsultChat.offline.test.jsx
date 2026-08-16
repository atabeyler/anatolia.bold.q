import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ConsultChat from './ConsultChat.jsx';
import { LangProvider } from '../services/langContext.jsx';
import { api } from '../services/api.js';
import { nativeAI, nativeConnectivity } from '../services/nativeBridge.js';

vi.mock('../services/api.js', () => ({
  api: {
    uploadForAI: vi.fn(),
    chatConsult: vi.fn(async () => ({ provider: 'Claude (Anthropic)', content: 'cloud answer' })),
  },
  getToken: () => null,
}));

vi.mock('../services/nativeBridge.js', () => ({
  isNativeApp: true,
  nativeAI: { query: vi.fn() },
  nativeConnectivity: { getState: vi.fn(async () => 'local'), onChange: vi.fn(() => () => {}) },
}));

function renderConsult() {
  return render(
    <LangProvider>
      <ConsultChat />
    </LangProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Element.prototype.scrollTo = vi.fn();
  nativeConnectivity.getState.mockResolvedValue('local');
});

afterEach(() => {
  cleanup();
});

describe('ConsultChat offline/local AI routing', () => {
  it('routes the message to nativeAI.query instead of the cloud API when offline', async () => {
    nativeAI.query.mockResolvedValue({
      ok: true,
      type: 'find',
      result: [{ id: 1, title: 'Ekonomi Raporu', category: 'ekonomi', createdAt: new Date().toISOString(), preview: 'özet metni' }],
    });

    renderConsult();
    await waitFor(() => expect(screen.getByText(/Çevrimdışısınız|offline/i)).toBeTruthy());

    const textarea = document.querySelector('textarea');
    fireEvent.change(textarea, { target: { value: 'ekonomi raporlarım' } });
    fireEvent.click(screen.getByLabelText('Gönder'));

    await waitFor(() => expect(nativeAI.query).toHaveBeenCalledWith({ text: 'ekonomi raporlarım' }));
    expect(api.chatConsult).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/Ekonomi Raporu/)).toBeTruthy());
    expect(screen.getByText('Yerel AI (Offline)')).toBeTruthy();
  });

  it('shows a no-results message when the local search finds nothing', async () => {
    nativeAI.query.mockResolvedValue({ ok: true, type: 'find', result: [] });

    renderConsult();
    await waitFor(() => expect(screen.getByText(/Çevrimdışısınız|offline/i)).toBeTruthy());
    const textarea = document.querySelector('textarea');
    fireEvent.change(textarea, { target: { value: 'bulunamayacak bir konu' } });
    fireEvent.click(screen.getByLabelText('Gönder'));

    await waitFor(() => expect(screen.getByText(/Eşleşen rapor bulunamadı/)).toBeTruthy());
  });

  it('falls back to the cloud API once connectivity is back online', async () => {
    nativeConnectivity.getState.mockResolvedValue('cloud');

    renderConsult();
    const textarea = document.querySelector('textarea');
    fireEvent.change(textarea, { target: { value: 'merhaba' } });
    fireEvent.click(screen.getByLabelText('Gönder'));

    await waitFor(() => expect(api.chatConsult).toHaveBeenCalled());
    expect(nativeAI.query).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('cloud answer')).toBeTruthy());
    expect(screen.getByText('Claude (Anthropic)')).toBeTruthy();
  });
});
