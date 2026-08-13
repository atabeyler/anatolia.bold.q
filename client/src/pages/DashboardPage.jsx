import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { History, LogOut, Mic, X, Bell, CalendarDays, Clock3, Thermometer, Menu as MenuIcon, Settings as SettingsIcon, Users } from 'lucide-react';
import EmergencyButton from '../components/EmergencyButton.jsx';
import CategorySidebar from '../components/CategorySidebar.jsx';
import HomeView from '../components/HomeView.jsx';
import AnalysisView from '../components/AnalysisView.jsx';
import HistoryView from '../components/HistoryView.jsx';
import VoiceChat from '../components/VoiceChat.jsx';
import { localeFor } from '../services/i18n.js';
import QuantumLogo from '../components/QuantumLogo.jsx';
import { RadarModal } from '../components/PersonnelRadar.jsx';
import UserManagementModal from '../components/UserManagement.jsx';
import { MenuPanel, SettingsPanel, InfoModal, GuideModal } from '../components/AppMenus.jsx';
import AppFooter from '../components/AppFooter.jsx';
import DesktopSyncBadge from '../components/DesktopSyncBadge.jsx';
import { api, setJWT, getToken } from '../services/api.js';
import { registerActions, unregisterActions } from '../services/voiceActionRegistry.js';
import { connectSocket, disconnectSocket, getSocket } from '../services/socket.js';
import { useLang } from '../services/langContext.jsx';

const DAYS_SHORT = {
  tr: ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  fr: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'],
  ar: ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'],
};

export default function DashboardPage({ user, onLogout }) {
  const { t, lang, setLang } = useLang();
  const [view, setView] = useState('home');
  const [activeCategory, setActiveCategory] = useState(null);
  const [emergencyToast, setEmergencyToast] = useState(null);
  const [voiceChatOpen, setVoiceChatOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoPanel, setInfoPanel] = useState(null); // 'about' | 'mission' | 'contact' | null
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768
  );
  const [radarOpen, setRadarOpen] = useState(false);
  const [userMgmtOpen, setUserMgmtOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notifFilter, setNotifFilter] = useState('all');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.09);
  const [now, setNow] = useState(() => new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(null);
  const [myCoords, setMyCoords] = useState(null);
  const [liveTemp, setLiveTemp] = useState(null);
  const [tempLoading, setTempLoading] = useState(false);
  const calendarRef = useRef(null);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const normalizeText = (text) => String(text || '')
    .replaceAll('Ã§', 'ç')
    .replaceAll('Ã‡', 'Ç')
    .replaceAll('Ã¶', 'ö')
    .replaceAll('Ã–', 'Ö')
    .replaceAll('Ã¼', 'ü')
    .replaceAll('Ãœ', 'Ü')
    .replaceAll('Ä±', 'ı')
    .replaceAll('Ä°', 'İ')
    .replaceAll('ÅŸ', 'ş')
    .replaceAll('Åž', 'Ş')
    .replaceAll('ÄŸ', 'ğ')
    .replaceAll('Äž', 'Ğ')
    .replaceAll('ý', 'ı')
    .replaceAll('Ý', 'İ')
    .replaceAll('þ', 'ş')
    .replaceAll('Þ', 'Ş')
    .replaceAll('ð', 'ğ')
    .replaceAll('Ð', 'Ğ')
    .replaceAll('g�r�nt�l�', 'görüntülü')
    .replaceAll('G�r�nt�l�', 'Görüntülü')
    .replaceAll('goruntulu', 'görüntülü')
    .replaceAll('toplant�', 'toplantı')
    .replaceAll('toplanti', 'toplantı')
    .replaceAll('toplantiyi', 'toplantıyı')
    .replaceAll('toplantiyi', 'toplantıyı')
    .replaceAll('toplantiya', 'toplantıya')
    .replaceAll('toplantidan', 'toplantıdan')
    .replaceAll('ba�lat', 'başlat')
    .replaceAll('ba�lat�ld�', 'başlatıldı')
    .replaceAll('başlat�ld�', 'başlatıldı')
    .replaceAll('ba�latıldı', 'başlatıldı')
    .replaceAll('baslat', 'başlat')
    .replaceAll('kat�l', 'katıl')
    .replaceAll('katil', 'katıl')
    .replaceAll('katilabilirsiniz', 'katılabilirsiniz')
    .replaceAll('ayr�l', 'ayrıl')
    .replaceAll('ayril', 'ayrıl')
    .replaceAll('Mesajla�ma', 'Mesajlaşma')
    .replaceAll('Mesajlasma', 'Mesajlaşma')
    .replaceAll('kat�l�mc�', 'katılımcı')
    .replaceAll('Goruntulu', 'Görüntülü')
    .replaceAll('goruntulu', 'görüntülü')
    .replaceAll('görüntulü', 'görüntülü')
    .replaceAll('Baslatildi', 'Başlatıldı')
    .replaceAll('baslatildi', 'başlatıldı')
    .replaceAll('bașlatıldı', 'başlatıldı')
    .replaceAll('bașlatildi', 'başlatıldı');
  const notifyDevice = (title, body) => {
    try {
      if (typeof window === 'undefined' || !('Notification' in window)) return;
      if (Notification.permission !== 'granted') return;
      if (document.visibilityState === 'visible') return;
      const n = new Notification(title, { body, tag: 'anatolia-q-alert' });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {}
  };
  const daysShort = DAYS_SHORT[lang] || DAYS_SHORT.tr;

  const monthLabel = new Intl.DateTimeFormat(localeFor(lang), {
    month: 'long',
    year: 'numeric'
  }).format(viewMonth);
  const liveTime = new Intl.DateTimeFormat(localeFor(lang), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(now);
  const liveDate = new Intl.DateTimeFormat(localeFor(lang), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(now);

  const firstDay = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const calendarCells = Array.from({ length: firstDay }, () => null).concat(
    Array.from({ length: daysInMonth }, (_, i) => i + 1)
  );

  const formatYmd = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const year = viewMonth.getFullYear();
  const fixedEvents = {
    [`${year}-01-01`]: ['Yılbaşı'],
    [`${year}-04-23`]: ['23 Nisan Ulusal Egemenlik ve Çocuk Bayramı'],
    [`${year}-05-01`]: ['Emek ve Dayanışma Günü'],
    [`${year}-05-19`]: ['19 Mayıs Atatürk\'ü Anma, Gençlik ve Spor Bayramı'],
    [`${year}-07-15`]: ['15 Temmuz Demokrasi ve Milli Birlik Günü'],
    [`${year}-08-30`]: ['30 Ağustos Zafer Bayramı'],
    [`${year}-10-29`]: ['29 Ekim Cumhuriyet Bayramı'],
  };
  const religiousByYear = {
    2026: {
      '2026-03-19': ['Ramazan Bayramı 1. Gün'],
      '2026-03-20': ['Ramazan Bayramı 2. Gün'],
      '2026-03-21': ['Ramazan Bayramı 3. Gün'],
      '2026-05-27': ['Kurban Bayramı 1. Gün'],
      '2026-05-28': ['Kurban Bayramı 2. Gün'],
      '2026-05-29': ['Kurban Bayramı 3. Gün'],
      '2026-05-30': ['Kurban Bayramı 4. Gün'],
    },
    2027: {
      '2027-03-09': ['Ramazan Bayramı 1. Gün'],
      '2027-03-10': ['Ramazan Bayramı 2. Gün'],
      '2027-03-11': ['Ramazan Bayramı 3. Gün'],
      '2027-05-17': ['Kurban Bayramı 1. Gün'],
      '2027-05-18': ['Kurban Bayramı 2. Gün'],
      '2027-05-19': ['Kurban Bayramı 3. Gün'],
      '2027-05-20': ['Kurban Bayramı 4. Gün'],
    },
    2028: {
      '2028-02-26': ['Ramazan Bayramı 1. Gün'],
      '2028-02-27': ['Ramazan Bayramı 2. Gün'],
      '2028-02-28': ['Ramazan Bayramı 3. Gün'],
      '2028-05-05': ['Kurban Bayramı 1. Gün'],
      '2028-05-06': ['Kurban Bayramı 2. Gün'],
      '2028-05-07': ['Kurban Bayramı 3. Gün'],
      '2028-05-08': ['Kurban Bayramı 4. Gün'],
    }
  };
  const holidayMap = { ...fixedEvents, ...(religiousByYear[year] || {}) };

  const pushNotification = (n) => {
    setNotifications((prev) => [{ id: `${Date.now()}-${Math.random()}`, read: false, ts: Date.now(), ...n }, ...prev].slice(0, 60));
    try {
      if (!soundEnabled) return;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 920;
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(soundVolume, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.stop(ctx.currentTime + 0.2);
    } catch {}
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!calendarOpen) return;
    const onDocDown = (e) => {
      if (!calendarRef.current) return;
      if (!calendarRef.current.contains(e.target)) setCalendarOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [calendarOpen]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const socketIdentity = user.isAdmin ? 'BOLD' : (user.nickname || user.userCode);
    const sock = connectSocket(socketIdentity, getToken());
    const onBroadcast = (data) => {
      const me = user.nickname || user.userCode;
      if (data.from === me) return;
      if (data?.initiator && data.initiator === me) return;
      const fromText = normalizeText(data.from);
      const msgText = normalizeText(data.message);
      setEmergencyToast({ ...data, from: fromText, message: msgText });
      pushNotification({
        type: 'emergency',
        title: t('emergencyBroadcastTitle'),
        body: `${fromText}: ${msgText || ''}`,
        action: 'open-emergency-chat',
      });
      notifyDevice(t('emergencyBroadcastTitle'), `${fromText}: ${msgText || ''}`);
      setTimeout(() => setEmergencyToast(null), 8000);
    };
    const onChatReceive = (data) => {
      if (data.from === (user.nickname || user.userCode)) return;
      pushNotification({
        type: 'chat',
        title: t('newMessageTitle'),
        body: `${data.from}: ${data.message || ''}`,
        action: 'open-emergency-chat',
        targetUser: data.from,
      });
      notifyDevice(t('newMessageTitle'), `${data.from}: ${data.message || ''}`);
    };
    const onSystemNotification = (data) => {
      if (!data) return;
      const me = user.nickname || user.userCode;
      if (data.initiator && me && data.initiator === me) return;
      pushNotification({
        type: 'system',
        title: t('systemNoticeTitle'),
        body: data.body || t('newSystemEvent'),
        action: data.action || 'home',
      });
      notifyDevice(t('systemNoticeTitle'), data.body || t('newSystemEvent'));
    };
    const onBlocked = () => {
      setJWT(null);
      disconnectSocket();
      onLogout();
    };
    const onHardwareVerified = (data) => {
      if (!data) return;
      const ok = !!data.hardwareVerification;
      pushNotification({
        type: 'system',
        title: t('hardwareVerifiedTitle'),
        body: ok ? t('hardwareVerifiedBody') : t('hardwareVerifiedFailedBody'),
        action: 'history',
      });
      notifyDevice(t('hardwareVerifiedTitle'), ok ? t('hardwareVerifiedBody') : t('hardwareVerifiedFailedBody'));
    };
    sock.on('emergency:broadcast', onBroadcast);
    sock.on('chat:receive', onChatReceive);
    sock.on('notification:new', onSystemNotification);
    sock.on('auth:blocked', onBlocked);
    sock.on('analysis:hardwareVerified', onHardwareVerified);
    return () => {
      sock.off('emergency:broadcast', onBroadcast);
      sock.off('chat:receive', onChatReceive);
      sock.off('notification:new', onSystemNotification);
      sock.off('auth:blocked', onBlocked);
      sock.off('analysis:hardwareVerified', onHardwareVerified);
    };
  }, [user.userCode, lang, soundEnabled, soundVolume]);

  useEffect(() => {
    const nickname = user.nickname || user.userCode;
    if (!nickname) return;
    if (!navigator.geolocation) return;

    // Live location is shared with the personnel radar (admin view) and used
    // for the local-weather widget below — it is not required for the rest
    // of the app, so it's opt-in and asked for explicitly rather than
    // starting silently as soon as the dashboard mounts.
    const consentKey = 'anatolia_location_consent';
    let consent = localStorage.getItem(consentKey);
    if (consent === null) {
      const granted = window.confirm(t('locationConsentPrompt'));
      consent = granted ? 'granted' : 'denied';
      localStorage.setItem(consentKey, consent);
    }
    if (consent !== 'granted') return;

    const sock = getSocket();
    if (!sock) return;

    const emitLocation = (coords) => {
      const lat = Number(coords?.latitude);
      const lng = Number(coords?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setMyCoords({ lat, lng });
      sock.emit('location:update', { lat, lng });
    };

    const watchId = navigator.geolocation.watchPosition(
      (position) => emitLocation(position.coords),
      () => {},
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 30000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [user.nickname, user.userCode, lang]);

  useEffect(() => {
    if (!myCoords?.lat || !myCoords?.lng) return;
    let cancelled = false;

    const loadTemp = async () => {
      try {
        setTempLoading(true);
        // Proxied through the backend rather than calling Open-Meteo directly
        // from the browser, so user coordinates aren't sent to a third-party
        // service straight from the client on every session.
        const data = await api.weatherCurrent(myCoords.lat, myCoords.lng);
        if (!cancelled && Number.isFinite(data?.temperature)) setLiveTemp(data.temperature);
      } catch {} finally {
        if (!cancelled) setTempLoading(false);
      }
    };

    loadTemp();
    const timer = setInterval(loadTemp, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [myCoords?.lat, myCoords?.lng]);

  useEffect(() => {
    const onVoiceNav = (e) => {
      const view = e?.detail?.view;
      if (view === 'analysis') {
        setActiveCategory(e?.detail?.category || null);
        setView('analysis');
      } else if (view === 'home') {
        setView('home');
      } else if (view === 'history') {
        setHistoryOpen(true);
      } else if (view === 'chat') {
        setVoiceChatOpen(true);
      } else if (view === 'guide-open') {
        setGuideOpen(true);
      } else if (view === 'guide-close') {
        setGuideOpen(false);
      } else if (view === 'emergency-open') {
        window.dispatchEvent(new CustomEvent('aq:emergency:open'));
      }
    };
    window.addEventListener('aq:navigate', onVoiceNav);
    return () => window.removeEventListener('aq:navigate', onVoiceNav);
  }, []);

  useEffect(() => {
    const onLogoutCmd = () => logout();
    window.addEventListener('aq:logout', onLogoutCmd);
    return () => window.removeEventListener('aq:logout', onLogoutCmd);
  }, []);

  const startAnalysis = (cat) => { setActiveCategory(cat); setView('analysis'); };

  const logout = () => { setJWT(null); disconnectSocket(); onLogout(); };

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('aq:context', {
      detail: { page: `dashboard-${view}`, category: activeCategory },
    }));
  }, [view, activeCategory]);

  useEffect(() => {
    const dispatch = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));

    registerActions('dashboard', [
      { name: 'navigate_home',      description: 'Go to the home / map monitoring view',        params: {},                                                   handler: () => setView('home') },
      { name: 'navigate_analysis',  description: 'Open the analysis workspace',                  params: { category: 'optional: savunma|enerji|saldiri|ekonomi|toplumsal|danisma|saglik|cok-alanli' }, handler: (p) => { setActiveCategory(p?.category || null); setView('analysis'); } },
      { name: 'navigate_history',   description: 'Open the history / past analyses view',        params: {},                                                   handler: () => setHistoryOpen(true) },
      { name: 'new_analysis',       description: 'Start a new analysis with no preset category', params: {},                                                   handler: () => { setActiveCategory(null); setView('analysis'); } },
      { name: 'open_voice_chat',    description: 'Open the voice consultation chat modal',       params: {},                                                   handler: () => setVoiceChatOpen(true) },
      { name: 'close_voice_chat',   description: 'Close the voice consultation chat',            params: {},                                                   handler: () => setVoiceChatOpen(false) },
      { name: 'open_guide',         description: 'Open the usage guide',                         params: {},                                                   handler: () => setGuideOpen(true) },
      { name: 'close_guide',        description: 'Close the usage guide',                        params: {},                                                   handler: () => setGuideOpen(false) },
      { name: 'logout',             description: 'Log out of the system',                        params: {},                                                   handler: () => { setJWT(null); disconnectSocket(); onLogout(); } },
      { name: 'open_emergency',     description: 'Open the emergency center panel',              params: {},                                                   handler: () => dispatch('aq:emergency:open', {}) },
      { name: 'set_analysis_title',  description: 'Set the analysis report title text',          params: { value: 'string' },                                  handler: (p) => dispatch('aq:analysis:set', { field: 'title',  value: p?.value || '' }) },
      { name: 'set_analysis_prompt', description: 'Set / fill the analysis topic or brief',      params: { value: 'string' },                                  handler: (p) => dispatch('aq:analysis:set', { field: 'prompt', value: p?.value || '' }) },
      { name: 'generate_analysis',   description: 'Generate / run the analysis report',          params: {},                                                   handler: () => dispatch('aq:analysis:generate', {}) },
      { name: 'toggle_quantum',      description: 'Enable or disable quantum probability mode',  params: { mode: 'on|off' },                                   handler: (p) => dispatch('aq:analysis:quantum', { mode: p?.mode || 'on' }) },
      { name: 'download_analysis',   description: 'Download the analysis as a DOCX file',       params: {},                                                   handler: () => dispatch('aq:analysis:download', {}) },
      { name: 'reset_analysis',      description: 'Reset / clear the current analysis',         params: {},                                                   handler: () => dispatch('aq:analysis:reset', {}) },
    ]);

    return () => unregisterActions('dashboard');
  }, [onLogout]);

  return (
    <div className="quantum-bg min-h-screen flex flex-col relative">
      <header className="relative z-20 px-3 sm:px-6 py-3 bg-navy-light/80 backdrop-blur border-b border-cyan-300/30 hud-panel overflow-visible">
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:gap-4">
        <div className="flex items-center gap-3 shrink-0 min-w-0 md:justify-self-start">
          <QuantumLogo size="sm" />
          <div className="min-w-0">
            <h1 className="font-display text-gold text-base sm:text-lg tracking-[0.24em] sm:tracking-[0.3em]">{t('appName')}</h1>
            <p className="text-[8px] sm:text-[10px] text-gold/60 tracking-[0.16em] sm:tracking-widest uppercase">{t('appSubtitle')}</p>
          </div>
          <span className="text-[9px] sm:text-[10px] font-serif text-cyan-200 hidden sm:inline md:hidden max-w-[130px] lg:max-w-[170px] truncate">{user.isAdmin ? 'BOLD' : (user.nickname || user.userCode || 'BOLD')}</span>
        </div>

        <div className="flex items-center justify-end gap-1 flex-nowrap min-w-0 overflow-visible md:justify-self-end md:ml-auto">
          <DesktopSyncBadge />
          <div className="relative" ref={calendarRef}>
            <button
              onClick={() => setCalendarOpen((v) => !v)}
              className="btn-depth header-control h-[28px] sm:h-[30px] px-3 py-2 rounded text-xs tracking-widest font-display flex items-center gap-1.5 shrink-0"
              title={t('calendarTooltip')}
            >
              <Clock3 className="w-3.5 h-3.5" />
              <span className="text-[10px] font-serif hidden sm:inline">{liveDate}</span>
              <span className="text-[10px] font-serif">{liveTime}</span>
              <span className="text-[10px] font-serif inline-flex items-center gap-1 border border-cyan-300/30 rounded px-1.5 py-0.5" title={t('tempTooltip')}>
                <Thermometer className="w-3 h-3" />
                {tempLoading && liveTemp === null ? '...' : (liveTemp === null ? '' : `${liveTemp}°C`)}
              </span>
              <CalendarDays className="w-3.5 h-3.5" />
            </button>
            {calendarOpen && (
              <div className="absolute top-full right-0 mt-2 z-[85] w-72 rounded-lg border border-cyan-300/30 bg-[#061326]/95 backdrop-blur p-3 shadow-xl">
                <div className="flex items-center justify-between mb-2">
                  <button onClick={() => { const d = new Date(viewMonth); d.setMonth(d.getMonth() - 1); setViewMonth(d); setSelectedDay(null); }} className="text-cyan-300 hover:text-cyan-100 px-2" aria-label={t('prevMonth')}>‹</button>
                  <div className="text-cyan-100 text-xs tracking-widest uppercase">{monthLabel}</div>
                  <button onClick={() => { const d = new Date(viewMonth); d.setMonth(d.getMonth() + 1); setViewMonth(d); setSelectedDay(null); }} className="text-cyan-300 hover:text-cyan-100 px-2" aria-label={t('nextMonth')}>›</button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-1">{daysShort.map((d) => (<div key={d} className="text-[10px] text-cyan-300/80 text-center font-serif">{d}</div>))}</div>
                <div className="grid grid-cols-7 gap-1">{calendarCells.map((day, idx) => { const isToday = day && day === now.getDate() && viewMonth.getMonth() === now.getMonth() && viewMonth.getFullYear() === now.getFullYear(); const key = day ? formatYmd(viewMonth.getFullYear(), viewMonth.getMonth(), day) : null; const hasHoliday = !!(key && holidayMap[key]); const isSelected = day && selectedDay === day; return (<button type="button" key={`${idx}-${day || 'x'}`} onClick={() => day && setSelectedDay(day)} className={`h-7 rounded text-[11px] flex items-center justify-center font-serif relative ${day ? (isSelected ? 'bg-cyan-500/25 text-cyan-100 border border-cyan-300/50' : isToday ? 'bg-gold/30 text-gold border border-gold/40' : 'text-gold/90 bg-white/5') : 'bg-transparent'}`} disabled={!day}>{day || ''}{hasHoliday && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-red-400" />}</button>); })}</div>
              </div>
            )}
          </div>
          <button onClick={() => setVoiceChatOpen(true)} title={t('voiceConsultTooltip')}
            className="btn-depth header-control h-[28px] sm:h-[30px] px-2.5 sm:px-3 py-0 rounded text-xs tracking-widest font-display flex items-center gap-1.5 shrink-0">
            <Mic className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{t('voiceConsult')}</span>
          </button>
          <button onClick={() => setHistoryOpen(true)} title={t('historyTooltip')}
            className="btn-depth header-control h-[28px] sm:h-[30px] px-2.5 sm:px-3 py-0 rounded text-xs tracking-widest font-display flex items-center gap-1.5 shrink-0">
            <History className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{t('history')}</span>
          </button>
          <button
            onClick={() => {
              setNotifOpen((v) => !v);
              setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
            }}
            className="btn-depth header-control h-[28px] sm:h-[30px] relative px-2.5 py-2 rounded shrink-0"
            title={t('notificationsTooltip')}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] leading-4 text-center">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          <div className="border-l border-gold/30 pl-2 flex items-center gap-2 shrink-0">
            <span className="text-[10px] 2xl:text-xs font-serif text-cyan-200 hidden xl:inline max-w-[150px] 2xl:max-w-[220px] truncate">{user.isAdmin ? 'BOLD' : (user.nickname || user.userCode || 'BOLD')}</span>
            {user.isAdmin && (
              <button onClick={() => setUserMgmtOpen(true)} className="btn-depth header-control h-[28px] sm:h-[30px] px-2.5 py-2 rounded" title="Kullanıcı Yönetimi" aria-label="Kullanıcı Yönetimi">
                <Users className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => setMenuOpen((v) => !v)} className="btn-depth header-control h-[28px] sm:h-[30px] px-2.5 py-2 rounded" title={t('menuTooltip')} aria-label={t('menuTooltip')}>
              <MenuIcon className="w-4 h-4" />
            </button>
            <button onClick={() => setSettingsOpen((v) => !v)} className="btn-depth header-control h-[28px] sm:h-[30px] px-2.5 py-2 rounded" title={t('settingsTooltip')} aria-label={t('settingsTooltip')}>
              <SettingsIcon className="w-4 h-4" />
            </button>
            <button onClick={logout} className="btn-depth header-control h-[28px] sm:h-[30px] px-2.5 py-2 rounded" title={t('logout')}>
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
        </div>
      </header>

      <div className="flex-1 flex relative z-10 overflow-hidden">
        <CategorySidebar
          activeCategory={activeCategory}
          onSelect={startAnalysis}
          onHome={() => setView('home')}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />

        <main className="flex-1 overflow-auto relative" onClick={() => { if (notifOpen) setNotifOpen(false); }}>
          <AnimatePresence mode="wait">
            {view === 'home' && (
              <motion.div key="home" className="h-full" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <HomeView isAdmin={!!user.isAdmin} onOpenRadar={() => setRadarOpen(true)} />
              </motion.div>
            )}

            {view === 'analysis' && (
              <motion.div key="analysis" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-3 sm:p-6">
                <AnalysisView category={activeCategory} onCategoryChange={setActiveCategory} />
              </motion.div>
            )}

          </AnimatePresence>
        </main>
      </div>

      <AppFooter />

      <EmergencyButton authenticated={true} />

      <AnimatePresence>
        {voiceChatOpen && <VoiceChatModal onClose={() => setVoiceChatOpen(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} title={t('pastAnalyses')} />}
      </AnimatePresence>
      <AnimatePresence>
        {guideOpen && <GuideModal onClose={() => setGuideOpen(false)} t={t} lang={lang} />}
      </AnimatePresence>
      <AnimatePresence>
        {menuOpen && (
          <MenuPanel
            t={t}
            onClose={() => setMenuOpen(false)}
            onOpenGuide={() => { setGuideOpen(true); setMenuOpen(false); }}
            onOpenInfo={(panel) => { setInfoPanel(panel); setMenuOpen(false); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {settingsOpen && (
          <SettingsPanel
            t={t}
            lang={lang}
            setLang={setLang}
            onClose={() => setSettingsOpen(false)}
            soundEnabled={soundEnabled}
            setSoundEnabled={setSoundEnabled}
            soundVolume={soundVolume}
            setSoundVolume={setSoundVolume}
            sidebarCollapsed={sidebarCollapsed}
            setSidebarCollapsed={setSidebarCollapsed}
            onOpenGuide={() => { setGuideOpen(true); setSettingsOpen(false); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {infoPanel && <InfoModal panel={infoPanel} t={t} onClose={() => setInfoPanel(null)} />}
      </AnimatePresence>
      {radarOpen && <RadarModal onClose={() => setRadarOpen(false)} lang={lang} />}
      <AnimatePresence>
        {userMgmtOpen && <UserManagementModal onClose={() => setUserMgmtOpen(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {emergencyToast && (
          <motion.div initial={{ y: -20, opacity: 0, scale: 0.96 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: -20, opacity: 0, scale: 0.96 }}
            className="fixed inset-x-0 top-1/2 -translate-y-1/2 z-50 w-[92vw] sm:w-[min(92vw,560px)] mx-auto">
            <div
              className="bg-crimson/95 border border-red-400 rounded-md p-2 sm:p-4 shadow-2xl emergency-pulse cursor-pointer"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('aq:emergency:open', { detail: { forceChat: true } }));
                setEmergencyToast(null);
              }}
            >
              <div className="flex items-start gap-3">
                <span className="text-sm sm:text-2xl">!</span>
                <div className="flex-1">
                  <div className="text-[9px] sm:text-xs text-red-200 mb-0.5 sm:mb-1">{emergencyToast.from}:</div>
                  <div className="text-[10px] sm:text-base text-white font-medium whitespace-pre-wrap leading-snug">{emergencyToast.message}</div>
                </div>
                <button onClick={() => setEmergencyToast(null)} className="text-red-200 hover:text-white text-[10px] sm:text-base">X</button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {notifOpen && (
          <>
            <motion.button
              type="button"
              aria-label={t('closeNotificationsTooltip')}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setNotifOpen(false)}
              className="fixed inset-0 z-[69] bg-transparent cursor-default"
            />
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="fixed top-16 right-3 sm:right-6 z-[70] w-[92vw] sm:w-[420px] max-h-[60vh] overflow-auto border border-cyan-300/30 rounded-lg bg-[#061326]/95 backdrop-blur p-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-2 py-1">
              <div className="text-[11px] tracking-widest uppercase text-cyan-200">{t('notificationCenterTitle')}</div>
              <button onClick={() => setNotifOpen(false)} className="text-cyan-200/70 hover:text-cyan-100" title={t('closeNotificationsTooltip')}>
                <X className="w-4 h-4" />
              </button>
            </div>
            {notifications.length === 0 && (
              <p className="text-xs text-gold/60 px-2 py-3">{t('noNotificationsYet')}</p>
            )}
            <div className="flex items-center gap-2 px-2 py-1">
              <select value={notifFilter} onChange={(e) => setNotifFilter(e.target.value)} className="bg-[#0b1d34] border border-cyan-300/30 text-cyan-100 text-[11px] rounded px-2 py-1">
                <option value="all">{t('filterAll')}</option>
                <option value="chat">{t('filterChat')}</option>
                <option value="emergency">{t('filterEmergency')}</option>
                <option value="system">{t('homeSystem')}</option>
              </select>
              <button onClick={() => setSoundEnabled((v) => !v)} className="text-[11px] border border-cyan-300/30 text-cyan-100 rounded px-2 py-1" title={t('toggleSoundTooltip')}>
                {soundEnabled ? t('soundOnLabel') : t('soundOffLabel')}
              </button>
              <input type="range" min="0.02" max="0.2" step="0.01" value={soundVolume} onChange={(e) => setSoundVolume(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              {notifications.filter((n) => notifFilter === 'all' || n.type === notifFilter).map((n) => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (n.action === 'home') setView('home');
                    if (n.action === 'history') setView('history');
                    if (n.action === 'open-emergency-chat') window.dispatchEvent(new CustomEvent('aq:emergency:open', { detail: { targetUser: n.targetUser, forceChat: true } }));
                    setNotifOpen(false);
                  }}
                  className={`w-full text-left rounded border px-2.5 py-2 ${n.read ? 'border-white/10 bg-white/5' : 'border-cyan-400/40 bg-cyan-500/10'}`}
                >
                  <div className="text-xs text-cyan-100">{n.title}</div>
                  <div className="text-[11px] text-gold/80 mt-0.5 line-clamp-2">{n.body}</div>
                </button>
              ))}
            </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}


function HistoryModal({ onClose, title }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[66] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.98 }} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-5xl h-[90vh] sm:h-[85vh] overflow-auto hud-panel rounded-t-2xl sm:rounded-xl p-3 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-cyan-100 font-display tracking-widest text-sm sm:text-lg">{title}</h3>
          <button onClick={onClose} className="text-cyan-100/70 hover:text-cyan-100"><X className="w-5 h-5" /></button>
        </div>
        <HistoryView showTitle={false} />
      </motion.div>
    </motion.div>
  );
}

function VoiceChatModal({ onClose }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[67] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.98 }} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-6xl h-[92vh] sm:h-[88vh] overflow-hidden hud-panel rounded-t-2xl sm:rounded-xl">
        <VoiceChat onClose={onClose} />
      </motion.div>
    </motion.div>
  );
}

