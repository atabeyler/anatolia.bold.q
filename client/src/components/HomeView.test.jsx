import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HomeView from './HomeView.jsx';
import { LangProvider } from '../services/langContext.jsx';
import { api, getCurrentUser } from '../services/api.js';

vi.mock('./TurkeyMap.jsx', () => ({ default: () => <div>TurkeyMap stub</div> }));

vi.mock('../services/api.js', () => ({
  api: {
    activityFeed: vi.fn(async () => []),
    morningBriefToday: vi.fn(async () => ({ exists: false })),
    morningBriefRefresh: vi.fn(async () => ({ success: true })),
    morningBriefList: vi.fn(async () => []),
    morningBriefByDate: vi.fn(async () => ({ exists: false })),
  },
  getCurrentUser: vi.fn(() => ({ userCode: 'BOLD-001', isAdmin: false })),
}));

function renderHome(props = {}) {
  return render(<LangProvider><HomeView {...props} /></LangProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.activityFeed.mockResolvedValue([]);
  api.morningBriefToday.mockResolvedValue({ exists: false });
  getCurrentUser.mockReturnValue({ userCode: 'BOLD-001', isAdmin: false });
  vi.stubGlobal('fetch', vi.fn(async () => ({
    json: async () => ({
      ready: true,
      database: { configured: true, ok: true },
      ai: { configured: true },
      quantum: { ibmConfigured: true },
      storage: { persistentObjectStorageConfigured: true },
      redis: { configured: true },
    }),
  })));
});

describe('HomeView', () => {
  it('renders the live map area and real platform status panel', async () => {
    renderHome();
    expect(await screen.findByText('TurkeyMap stub')).toBeInTheDocument();
    expect((await screen.findAllByText('PLATFORM')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('AI')).length).toBeGreaterThan(0);
    expect(screen.queryByText('CPU')).not.toBeInTheDocument();
  });

  it('shows the personnel radar button only when isAdmin is true', () => {
    const onOpenRadar = vi.fn();
    renderHome({ isAdmin: true, onOpenRadar });
    const radarBtn = screen.getByText('Personel Radarı').closest('button');
    fireEvent.click(radarBtn);
    expect(onOpenRadar).toHaveBeenCalled();
  });

  it('hides the personnel radar button for non-admins', () => {
    renderHome({ isAdmin: false });
    expect(screen.queryByText('Personel Radarı')).not.toBeInTheDocument();
  });

  it('shows an empty-activity message when the feed has no items', async () => {
    api.activityFeed.mockResolvedValue([]);
    renderHome();
    expect(await screen.findByText('Henüz kayıt yok')).toBeInTheDocument();
  });

  it('renders activity feed items once loaded', async () => {
    api.activityFeed.mockResolvedValue([
      { id: 1, type: 'analysis', title: 'Ekonomi Raporu', created_at: new Date().toISOString(), category: 'ekonomi' },
    ]);
    renderHome();
    expect(await screen.findByText('Ekonomi Raporu')).toBeInTheDocument();
  });

  it('shows the refresh button in the briefing card only for admins', async () => {
    getCurrentUser.mockReturnValue({ userCode: 'ADMIN-1', isAdmin: true });
    renderHome({ isAdmin: true });
    expect(await screen.findAllByText('Yenile')).not.toHaveLength(0);
  });

  it('hides the briefing refresh button for non-admins', async () => {
    renderHome({ isAdmin: false });
    await screen.findByText('TurkeyMap stub');
    expect(screen.queryByText('Yenile')).not.toBeInTheDocument();
  });

  it('refreshes the morning brief and shows the briefing button once it exists', async () => {
    getCurrentUser.mockReturnValue({ userCode: 'ADMIN-1', isAdmin: true });
    api.morningBriefRefresh.mockResolvedValue({ success: true });
    api.morningBriefToday
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValue({ exists: true, date: '2026-01-05', items: [{ title: 'Haber 1', link: 'https://example.com' }] });

    renderHome({ isAdmin: true });
    const refreshBtns = await screen.findAllByText('Yenile');
    fireEvent.click(refreshBtns[0]);

    await waitFor(() => expect(api.morningBriefRefresh).toHaveBeenCalled());
    expect((await screen.findAllByText('Brifing')).length).toBeGreaterThan(0);
  });

  it('shows a failure message when the brief refresh does not produce a brief', async () => {
    getCurrentUser.mockReturnValue({ userCode: 'ADMIN-1', isAdmin: true });
    api.morningBriefToday.mockResolvedValue({ exists: false });
    renderHome({ isAdmin: true });
    const refreshBtns = await screen.findAllByText('Yenile');
    fireEvent.click(refreshBtns[0]);
    expect((await screen.findAllByText('Briefing üretilemedi.')).length).toBeGreaterThan(0);
  });

  it('opens the full briefing modal and lists items', async () => {
    api.morningBriefToday.mockResolvedValue({
      exists: true,
      date: '2026-01-05',
      items: [{ title: 'Haber Başlığı', description: 'Detay metni' }],
    });
    renderHome();
    const briefingBtns = await screen.findAllByText('Brifing');
    fireEvent.click(briefingBtns[0]);
    expect(screen.getByText(/1\. Haber Başlığı/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/1\. Haber Başlığı/));
    expect(screen.getByText('Detay metni')).toBeInTheDocument();
  });

  it('filters briefing items by search query', async () => {
    api.morningBriefToday.mockResolvedValue({
      exists: true,
      date: '2026-01-05',
      items: [{ title: 'Ekonomi Haberi' }, { title: 'Savunma Haberi' }],
    });
    renderHome();
    const briefingBtns = await screen.findAllByText('Brifing');
    fireEvent.click(briefingBtns[0]);
    fireEvent.change(screen.getByPlaceholderText('Başlık veya kaynakta ara…'), { target: { value: 'savunma' } });
    expect(screen.queryByText(/Ekonomi Haberi/)).not.toBeInTheDocument();
    expect(screen.getByText(/Savunma Haberi/)).toBeInTheDocument();
  });
});
