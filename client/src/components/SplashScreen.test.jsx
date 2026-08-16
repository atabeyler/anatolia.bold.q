import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import SplashScreen from './SplashScreen.jsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('SplashScreen', () => {
  it('renders the ANATOLIA-Q brand text and the Bold Technologies attribution', () => {
    render(<SplashScreen />);
    expect(screen.getByText('ANATOLIA-Q')).toBeInTheDocument();
    expect(screen.getByText('BOLD TECHNOLOGIES')).toBeInTheDocument();
  });

  it('hides itself after the display duration elapses', async () => {
    vi.useFakeTimers();
    render(<SplashScreen />);
    expect(screen.getByText('ANATOLIA-Q')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2500); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByText('ANATOLIA-Q')).not.toBeInTheDocument());
  });
});
