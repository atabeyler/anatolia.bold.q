import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

afterEach(() => {
  delete window.anatoliaDesktop;
  vi.resetModules();
});

describe('DesktopSyncBadge', () => {
  it('renders nothing on the web build (no window.anatoliaDesktop)', async () => {
    const { default: DesktopSyncBadge } = await import('./DesktopSyncBadge.jsx');
    const { container } = render(<DesktopSyncBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Q CLOUD when the desktop bridge reports cloud state', async () => {
    window.anatoliaDesktop = {
      isDesktop: true,
      sync: { status: async () => ({ state: 'cloud' }) },
      connectivity: { onChange: () => () => {} },
    };
    vi.resetModules();
    const { default: DesktopSyncBadge } = await import('./DesktopSyncBadge.jsx');
    render(<DesktopSyncBadge />);
    await waitFor(() => expect(screen.getByText('Q CLOUD')).toBeInTheDocument());
  });

  it('shows Q LOCAL when offline', async () => {
    window.anatoliaDesktop = {
      isDesktop: true,
      sync: { status: async () => ({ state: 'local' }) },
      connectivity: { onChange: () => () => {} },
    };
    vi.resetModules();
    const { default: DesktopSyncBadge } = await import('./DesktopSyncBadge.jsx');
    render(<DesktopSyncBadge />);
    await waitFor(() => expect(screen.getByText('Q LOCAL')).toBeInTheDocument());
  });
});
