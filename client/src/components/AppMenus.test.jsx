import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MenuPanel, SettingsPanel, InfoModal, GuideModal } from './AppMenus.jsx';

const t = (key) => key;

describe('MenuPanel', () => {
  it('renders each menu item and triggers its handler', () => {
    const onOpenGuide = vi.fn();
    const onOpenInfo = vi.fn();
    const onClose = vi.fn();
    render(<MenuPanel t={t} onClose={onClose} onOpenGuide={onOpenGuide} onOpenInfo={onOpenInfo} />);

    fireEvent.click(screen.getByText('usageGuideTitle'));
    expect(onOpenGuide).toHaveBeenCalled();

    fireEvent.click(screen.getByText('menuAboutUs'));
    expect(onOpenInfo).toHaveBeenCalledWith('about');

    fireEvent.click(screen.getByText('menuMissionVision'));
    expect(onOpenInfo).toHaveBeenCalledWith('mission');

    fireEvent.click(screen.getByText('menuContact'));
    expect(onOpenInfo).toHaveBeenCalledWith('contact');
  });

  it('closes via the close button and the background overlay', () => {
    const onClose = vi.fn();
    render(<MenuPanel t={t} onClose={onClose} onOpenGuide={vi.fn()} onOpenInfo={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('menuTooltip'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('SettingsPanel', () => {
  function renderSettings(overrides = {}) {
    const props = {
      t, lang: 'tr', setLang: vi.fn(), onClose: vi.fn(),
      soundEnabled: true, setSoundEnabled: vi.fn(),
      soundVolume: 0.1, setSoundVolume: vi.fn(),
      sidebarCollapsed: false, setSidebarCollapsed: vi.fn(),
      onOpenGuide: vi.fn(),
      ...overrides,
    };
    render(<SettingsPanel {...props} />);
    return props;
  }

  it('defaults to the language tab and selects a language', () => {
    const props = renderSettings();
    fireEvent.click(screen.getByText('Deutsch'));
    expect(props.setLang).toHaveBeenCalledWith('de');
  });

  it('shows a checkmark next to the active language', () => {
    renderSettings({ lang: 'fr' });
    const frenchRow = screen.getByText('Français').closest('button');
    expect(frenchRow.querySelector('svg.lucide-check')).toBeTruthy();
  });

  it('toggles sound on the sound tab', () => {
    const props = renderSettings();
    fireEvent.click(screen.getByText('settingsSound'));
    fireEvent.click(screen.getByText('settingsSoundEnable'));
    expect(props.setSoundEnabled).toHaveBeenCalled();
  });

  it('adjusts the sound volume slider', () => {
    const props = renderSettings();
    fireEvent.click(screen.getByText('settingsSound'));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.15' } });
    expect(props.setSoundVolume).toHaveBeenCalledWith(0.15);
  });

  it('toggles sidebar collapse on the appearance tab (shown when showAppearance=true)', () => {
    const props = renderSettings({ showAppearance: true });
    fireEvent.click(screen.getByText('settingsAppearance'));
    fireEvent.click(screen.getByText('settingsCollapseSidebar'));
    expect(props.setSidebarCollapsed).toHaveBeenCalled();
  });

  it('hides the appearance tab when showAppearance=false', () => {
    renderSettings({ showAppearance: false });
    expect(screen.queryByText('settingsAppearance')).not.toBeInTheDocument();
  });

  it('opens the usage guide from the about tab', () => {
    const props = renderSettings();
    fireEvent.click(screen.getByText('settingsAbout'));
    fireEvent.click(screen.getByText('settingsOpenGuide'));
    expect(props.onOpenGuide).toHaveBeenCalled();
  });
});

describe('InfoModal', () => {
  it('renders the "about" panel content', () => {
    render(<InfoModal panel="about" t={t} onClose={vi.fn()} />);
    expect(screen.getByText('aboutUsTitle')).toBeInTheDocument();
  });

  it('renders the "mission" panel with both mission and vision sections', () => {
    render(<InfoModal panel="mission" t={t} onClose={vi.fn()} />);
    expect(screen.getByText('missionLabel')).toBeInTheDocument();
    expect(screen.getByText('visionLabel')).toBeInTheDocument();
  });

  it('renders the "contact" panel with the contact email', () => {
    render(<InfoModal panel="contact" t={t} onClose={vi.fn()} />);
    expect(screen.getByText(/info@boldkimya\.com\.tr/)).toBeInTheDocument();
  });

  it('renders nothing for an unrecognized panel', () => {
    const { container } = render(<InfoModal panel="bogus" t={t} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('closes via the close button', () => {
    const onClose = vi.fn();
    render(<InfoModal panel="about" t={t} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('GuideModal', () => {
  it('renders Turkish guide modules by default', () => {
    render(<GuideModal onClose={vi.fn()} t={t} lang="tr" />);
    expect(screen.getByText('1) Üst Çubuk')).toBeInTheDocument();
  });

  it('renders English guide modules when lang="en"', () => {
    render(<GuideModal onClose={vi.fn()} t={t} lang="en" />);
    expect(screen.getByText('1) Top Bar')).toBeInTheDocument();
  });

  it('falls back to Turkish for an unsupported language', () => {
    render(<GuideModal onClose={vi.fn()} t={t} lang="xx" />);
    expect(screen.getByText('1) Üst Çubuk')).toBeInTheDocument();
  });

  it('closes via the close button', () => {
    const onClose = vi.fn();
    render(<GuideModal onClose={onClose} t={t} lang="tr" />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
