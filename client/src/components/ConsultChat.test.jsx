import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ConsultChat from './ConsultChat.jsx';
import { LangProvider } from '../services/langContext.jsx';
import { api } from '../services/api.js';

vi.mock('../services/api.js', () => ({
  api: {
    uploadForAI: vi.fn(),
    chatConsult: vi.fn(async () => ({ provider: 'test', content: 'ok' })),
  },
  getToken: () => null,
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
  // jsdom doesn't implement Element.scrollTo -- ConsultChat calls it to
  // autoscroll the message list on every update.
  Element.prototype.scrollTo = vi.fn();
});

describe('ConsultChat file-context integration', () => {
  it('builds a readable docContext from a structured (transactions) upload instead of a broken .url reference', async () => {
    // Regression test: ConsultChat used to assume every non-text/image
    // upload result had a `.url` field (only true for the generic /files
    // upload path), which produced "undefined" in the message sent to the
    // AI for the newer structured upload types (transactions/scenarios/
    // optimization) added for BDDK/BTK real-data support.
    api.uploadForAI.mockResolvedValue({
      type: 'transactions',
      filename: 'islemler.csv',
      transactions: [{ id: 'TXN-1', amount: 100, hour: 5, frequency: 1, newCounterparty: 1, crossBorder: 0 }],
      warnings: [],
    });

    renderConsult();

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const file = new File(['irrelevant'], 'islemler.csv', { type: 'text/csv' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(api.uploadForAI).toHaveBeenCalled());

    const sendButton = screen.getByLabelText('Gönder');
    fireEvent.click(sendButton);

    await waitFor(() => expect(api.chatConsult).toHaveBeenCalled());
    const [, , docContext] = api.chatConsult.mock.calls[0];
    expect(docContext).toContain('islemler.csv');
    expect(docContext).toContain('TXN-1');
    expect(docContext).not.toContain('undefined');
  });
});
