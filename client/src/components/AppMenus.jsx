import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Check, Moon, Sun, Monitor } from 'lucide-react';
import QuantumLogo from './QuantumLogo.jsx';
import { isPushSupported, getPushSubscriptionState, subscribeToPush, unsubscribeFromPush } from '../services/push.js';
import '../theme.css';

const THEME_KEY = 'anatolia-q-theme';
const VALID_THEMES = new Set(['dark', 'light', 'system']);

function resolveTheme(mode) {
  if (mode === 'system') {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return mode === 'light' ? 'light' : 'dark';
}

function applyTheme(mode) {
  if (typeof document === 'undefined') return;
  const safeMode = VALID_THEMES.has(mode) ? mode : 'dark';
  document.documentElement.dataset.themeMode = safeMode;
  document.documentElement.dataset.theme = resolveTheme(safeMode);
  document.documentElement.style.colorScheme = resolveTheme(safeMode);
}

function getStoredTheme() {
  if (typeof window === 'undefined') return 'dark';
  const saved = window.localStorage.getItem(THEME_KEY);
  return VALID_THEMES.has(saved) ? saved : 'dark';
}

if (typeof window !== 'undefined') {
  applyTheme(getStoredTheme());
  const media = window.matchMedia?.('(prefers-color-scheme: light)');
  media?.addEventListener?.('change', () => {
    if (getStoredTheme() === 'system') applyTheme('system');
  });
}

function DropdownOverlay({ onClose, closeLabel }) {
  return <motion.button type="button" aria-label={closeLabel} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[69] bg-transparent cursor-default" />;
}

function MenuPanel({ t, onClose, onOpenGuide, onOpenInfo }) {
  const items = [
    { key: 'usageGuideTitle', onClick: onOpenGuide },
    { key: 'menuAboutUs', onClick: () => onOpenInfo('about') },
    { key: 'menuMissionVision', onClick: () => onOpenInfo('mission') },
    { key: 'menuContact', onClick: () => onOpenInfo('contact') },
  ];
  return <><DropdownOverlay onClose={onClose} closeLabel={t('menuTooltip')} /><motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="fixed top-16 right-3 sm:right-6 z-[70] w-[92vw] sm:w-[340px] border border-cyan-300/30 rounded-lg bg-[#061326]/95 backdrop-blur p-3 shadow-xl theme-surface" onClick={(e) => e.stopPropagation()}>
    <div className="flex items-center justify-between mb-3 pb-3 border-b border-gold/20"><div className="flex items-center gap-2"><QuantumLogo size="sm" /><div><div className="font-display text-gold text-sm tracking-[0.2em]">{t('appName')}</div><div className="text-[9px] text-gold/50 tracking-widest uppercase">{t('appSubtitle')}</div></div></div><button onClick={onClose} className="text-cyan-200/70 hover:text-cyan-100" title={t('menuTooltip')} aria-label="Close"><X className="w-4 h-4" /></button></div>
    <div className="space-y-1">{items.map((item) => <button key={item.key} onClick={item.onClick} className="w-full text-left rounded px-2.5 py-2 text-sm text-cyan-100 hover:bg-white/5 hover:text-cyan-50 transition">{t(item.key)}</button>)}</div>
    <div className="mt-3 pt-3 border-t border-gold/20"><p className="text-[9px] text-gold/40 tracking-widest">{t('projectCode')}: QTR-200120401018</p><p className="text-[9px] text-gold/40 mt-1 leading-relaxed"><span className="text-gold/60">{t('company')}</span>{' · '}{t('rights')}{' · '}{t('classified')}</p></div>
  </motion.div></>;
}

const SETTINGS_LANGUAGES = [
  { code: 'en', label: 'English' }, { code: 'tr', label: 'Türkçe' }, { code: 'de', label: 'Deutsch' }, { code: 'fr', label: 'Français' }, { code: 'ar', label: 'العربية' },
];

const THEME_COPY = {
  tr: { title: 'Tema', dark: 'Koyu', light: 'Açık', system: 'Sistem', hint: 'Sistem seçeneği cihazınızın görünüm ayarını otomatik takip eder.' },
  en: { title: 'Theme', dark: 'Dark', light: 'Light', system: 'System', hint: 'System follows your device appearance automatically.' },
  de: { title: 'Design', dark: 'Dunkel', light: 'Hell', system: 'System', hint: 'System folgt automatisch der Darstellung Ihres Geräts.' },
  fr: { title: 'Thème', dark: 'Sombre', light: 'Clair', system: 'Système', hint: 'Système suit automatiquement le mode de votre appareil.' },
  ar: { title: 'السمة', dark: 'داكن', light: 'فاتح', system: 'النظام', hint: 'يتبع خيار النظام إعداد مظهر جهازك تلقائياً.' },
};

function SettingsPanel({ t, lang, setLang, onClose, soundEnabled, setSoundEnabled, soundVolume, setSoundVolume, sidebarCollapsed, setSidebarCollapsed, onOpenGuide, showAppearance = true }) {
  const [tab, setTab] = useState('language');
  const [pushState, setPushState] = useState('checking');
  const [pushError, setPushError] = useState('');
  const [themeMode, setThemeMode] = useState(getStoredTheme);
  const themeCopy = THEME_COPY[lang] || THEME_COPY.en;

  useEffect(() => {
    if (!isPushSupported()) { setPushState('unsupported'); return; }
    getPushSubscriptionState().then(setPushState).catch(() => setPushState('unsupported'));
  }, []);

  const setTheme = (mode) => {
    setThemeMode(mode);
    try { window.localStorage.setItem(THEME_KEY, mode); } catch {}
    applyTheme(mode);
  };

  const togglePush = async () => {
    setPushError('');
    try {
      if (pushState === 'subscribed') {
        await unsubscribeFromPush();
        setPushState('unsubscribed');
      } else {
        setPushState('checking');
        await subscribeToPush();
        setPushState('subscribed');
      }
    } catch (e) {
      setPushError(e.message);
      setPushState(await getPushSubscriptionState().catch(() => 'unsubscribed'));
    }
  };

  const tabs = [
    { key: 'language', label: t('settingsLanguage') }, { key: 'sound', label: t('settingsSound') }, { key: 'push', label: t('settingsPush') }, ...(showAppearance ? [{ key: 'appearance', label: t('settingsAppearance') }] : []), { key: 'about', label: t('settingsAbout') },
  ];

  const themeOptions = [
    { key: 'dark', label: themeCopy.dark, Icon: Moon },
    { key: 'light', label: themeCopy.light, Icon: Sun },
    { key: 'system', label: themeCopy.system, Icon: Monitor },
  ];

  return <><DropdownOverlay onClose={onClose} closeLabel={t('settingsTooltip')} /><motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="fixed top-16 right-3 sm:right-6 z-[70] w-[92vw] sm:w-[380px] max-h-[75vh] overflow-hidden flex flex-col border border-cyan-300/30 rounded-lg bg-[#061326]/95 backdrop-blur shadow-xl theme-surface" onClick={(e) => e.stopPropagation()}>
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-gold/20 shrink-0"><div className="flex items-center gap-2"><span className="w-1 h-4 bg-cyan-400 rounded-full" /><div className="text-[11px] tracking-widest uppercase text-cyan-200">{t('settingsTitle')}</div></div><button onClick={onClose} className="text-cyan-200/70 hover:text-cyan-100" aria-label="Close"><X className="w-4 h-4" /></button></div>
    <div className="flex border-b border-gold/10 px-1 shrink-0 overflow-x-auto">{tabs.map((tb) => <button key={tb.key} onClick={() => setTab(tb.key)} className={`relative px-3 py-2 text-[11px] tracking-wide uppercase transition whitespace-nowrap ${tab === tb.key ? 'text-cyan-200' : 'text-cyan-100/40 hover:text-cyan-100/70'}`}>{tb.label}{tab === tb.key && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-cyan-400 rounded-full" />}</button>)}</div>
    <div className="p-3 overflow-auto flex-1">
      {tab === 'language' && <div className="space-y-0.5">{SETTINGS_LANGUAGES.map((l) => <button key={l.code} onClick={() => setLang(l.code)} dir={l.code === 'ar' ? 'rtl' : 'ltr'} className={`w-full flex items-center justify-between px-2.5 py-2.5 rounded text-sm transition ${lang === l.code ? 'bg-cyan-500/10 text-cyan-100' : 'text-cyan-100/70 hover:bg-white/5'}`}><span>{l.label}</span>{lang === l.code && <Check className="w-4 h-4 text-cyan-300 shrink-0" />}</button>)}</div>}
      {tab === 'sound' && <div><button onClick={() => setSoundEnabled((v) => !v)} className="w-full flex items-center justify-between text-[12px] border border-cyan-300/30 text-cyan-100 rounded px-2.5 py-2 mb-3"><span>{t('settingsSoundEnable')}</span>{soundEnabled ? <Check className="w-4 h-4 text-cyan-300" /> : <X className="w-4 h-4 text-cyan-100/40" />}</button><div className="flex items-center gap-2"><span className="text-[10px] text-gold/50 shrink-0">{t('settingsSoundVolume')}</span><input type="range" min="0.02" max="0.2" step="0.01" value={soundVolume} onChange={(e) => setSoundVolume(Number(e.target.value))} className="flex-1" /></div></div>}
      {tab === 'push' && <div><button onClick={togglePush} disabled={pushState === 'unsupported' || pushState === 'checking'} className="w-full flex items-center justify-between text-[12px] border border-cyan-300/30 text-cyan-100 rounded px-2.5 py-2 mb-2 disabled:opacity-40"><span>{t('settingsPushEnable')}</span>{pushState === 'subscribed' ? <Check className="w-4 h-4 text-cyan-300" /> : <X className="w-4 h-4 text-cyan-100/40" />}</button>{pushState === 'unsupported' && <p className="text-[11px] text-gold/50">{t('settingsPushUnsupported')}</p>}{pushError && <p className="text-[11px] text-red-300">{pushError}</p>}</div>}
      {tab === 'appearance' && <div className="space-y-4">
        <div>
          <div className="text-[10px] tracking-[0.18em] uppercase text-gold/60 mb-2">{themeCopy.title}</div>
          <div className="grid grid-cols-3 gap-2">{themeOptions.map(({ key, label, Icon }) => <button type="button" key={key} onClick={() => setTheme(key)} className={`theme-option rounded-lg border px-2 py-3 flex flex-col items-center gap-1.5 transition ${themeMode === key ? 'theme-option-active border-cyan-300/70 bg-cyan-500/15 text-cyan-100' : 'border-cyan-300/25 text-cyan-100/65 hover:bg-white/5'}`}><Icon className="w-4 h-4" /><span className="text-[11px]">{label}</span>{themeMode === key && <Check className="w-3.5 h-3.5 text-cyan-300" />}</button>)}</div>
          <p className="text-[10px] text-gold/45 mt-2 leading-relaxed">{themeCopy.hint}</p>
        </div>
        <button onClick={() => setSidebarCollapsed((v) => !v)} className="w-full flex items-center justify-between text-[12px] border border-cyan-300/30 text-cyan-100 rounded px-2.5 py-2"><span>{t('settingsCollapseSidebar')}</span>{sidebarCollapsed ? <Check className="w-4 h-4 text-cyan-300" /> : <X className="w-4 h-4 text-cyan-100/40" />}</button>
      </div>}
      {tab === 'about' && <div><p className="text-[12px] text-cyan-100/80 mb-3">{t('appName')} · {t('settingsVersion')} {__APP_VERSION__}</p><button onClick={onOpenGuide} className="text-[12px] border border-cyan-300/30 text-cyan-100 rounded px-2.5 py-2">{t('settingsOpenGuide')}</button></div>}
    </div>
  </motion.div></>;
}

function InfoModal({ panel, t, onClose }) {
  const content = {
    about: { title: t('aboutUsTitle'), body: <p className="text-sm text-cyan-100/85 leading-relaxed">{t('aboutUsBody')}</p> },
    mission: { title: t('missionVisionTitle'), body: <div className="space-y-3"><div><div className="text-[10px] text-gold/60 tracking-widest uppercase mb-1">{t('missionLabel')}</div><p className="text-sm text-cyan-100/85 leading-relaxed">{t('missionBody')}</p></div><div><div className="text-[10px] text-gold/60 tracking-widest uppercase mb-1">{t('visionLabel')}</div><p className="text-sm text-cyan-100/85 leading-relaxed">{t('visionBody')}</p></div></div> },
    contact: { title: t('contactTitle'), body: <div className="space-y-2"><p className="text-sm text-cyan-100/85 leading-relaxed">{t('contactBody')}</p><p className="text-xs text-gold/70">{t('contactEmailLabel')}: info@boldkimya.com.tr</p></div> },
  }[panel];
  if (!content) return null;
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[71] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 theme-overlay" onClick={onClose}><motion.div initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.98 }} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-lg overflow-auto hud-panel rounded-t-2xl sm:rounded-xl p-4 sm:p-6"><div className="flex items-center justify-between mb-4"><h3 className="text-cyan-100 font-display tracking-widest text-sm sm:text-lg">{content.title}</h3><button onClick={onClose} className="text-cyan-100/70 hover:text-cyan-100" aria-label="Close"><X className="w-5 h-5" /></button></div>{content.body}</motion.div></motion.div>;
}

const GUIDE_MODULES = {
  en: [
    ['1) Top Bar', 'NEW ANALYSIS opens a fresh workspace.|CHAT opens voice/text consultation.|HISTORY opens saved reports.|PERSONNEL RADAR is available to authorized admin users.|NOTIFICATIONS shows chat/emergency events.|MENU opens this guide and institutional information.|SETTINGS controls language, sound, push notifications, theme and sidebar appearance.|LOGOUT securely ends the session.'],
    ['2) Home & System Status', 'The live map, morning brief and activity feed provide the operational overview.|SYSTEM STATUS uses live backend health data.|PLATFORM READY means core services are available.|AI ONLINE means at least one AI provider is available.|DATABASE ONLINE confirms connectivity.|IBM QUANTUM READY means hardware verification is available; LIMITED/OFF does not stop the main deterministic analysis path.|STORAGE LOCAL means local storage is in use.|REDIS MEMORY/OFF means local realtime fallback is being used.'],
    ['3) Analysis Categories', 'Choose the domain before starting: Defense, Energy, Offensive, Economy, Social Events, Consultation, Health or Multi-Domain.|BDDK/BTK workflows can expose specialized functions when enabled.|Users do not need to choose internal AI or quantum engines.'],
    ['4) Create an Analysis', 'Enter a clear report title and analysis brief.|Use speech-to-text where available.|Attach relevant source files/data when offered.|GENERATE DETAILED ANALYSIS REPORT runs the standard workflow.|Provider fallback, provenance and trace metadata are managed automatically.'],
    ['5) Quantum Analysis', 'QUANTUM PROBABILITY MODE supports multi-scenario analysis.|START QUANTUM PROBABILITY ANALYSIS launches the supported workflow.|The authoritative result follows the deterministic local path.|Real IBM hardware, when configured, is an independent verification lane.|Manual classical/quantum comparison is not required.'],
    ['6) Reports & Files', 'Review reports on screen and download DOCX/PDF where available.|History may also provide sharing actions.|Use descriptive titles for archive clarity.|Hardware verification confirms that a real IBM job ran; it does not prove institutional origin of the input.'],
    ['7) History', 'HISTORY lists saved analyses and supports search/filtering.|Open a report to review content, downloads and audit metadata.|Older reports may contain less audit metadata.'],
    ['8) Analysis Audit', 'Analysis Audit can show AI provider/model, prompt version, data source, data quality, classification, duration, quantum backend/shots and creation time.|Missing fields mean that metadata was not recorded and must not be treated as verified.'],
    ['9) Consultation & Voice Assistant', 'VOICE uses microphone-driven consultation; CHAT uses text.|Auto-listen can resume after a response.|Archive/save/clear controls manage conversation history.|Keep one main subject per session for better continuity.'],
    ['10) Emergency Center & Personnel Radar', 'REPORT TO CENTER sends urgent information to the center.|NOTIFY USERS broadcasts to active users when authorized.|MESSAGING supports authenticated communication and available file/voice inputs.|Personnel Radar should only be used by authorized roles.'],
    ['11) Appearance & Troubleshooting', 'Settings > Appearance offers DARK, LIGHT and SYSTEM themes.|SYSTEM follows the device appearance automatically and the choice is remembered.|READY/ONLINE means available; LIMITED means optional capability is degraded; LOCAL/MEMORY means a fallback is active; OFF means unavailable or not configured.|If generation fails, preserve the brief, check System Status and retry once.'],
  ],
  tr: [
    ['1) Üst Çubuk', 'YENİ ANALİZ yeni çalışma alanını açar.|SOHBET sesli/yazılı danışmayı açar.|GEÇMİŞ kayıtlı raporları açar.|PERSONEL RADARI yetkili admin kullanıcıları içindir.|BİLDİRİMLER mesaj ve acil olayları gösterir.|MENÜ bu kılavuzu ve kurumsal bilgileri açar.|AYARLAR dil, ses, push bildirimleri, tema ve sol menü görünümünü yönetir.|ÇIKIŞ oturumu güvenli şekilde kapatır.'],
    ['2) Ana Ekran ve Sistem Durumu', 'Canlı harita, günlük istihbarat özeti ve aktivite akışı operasyon görünümünü oluşturur.|SİSTEM DURUMU gerçek backend health verisini kullanır.|PLATFORM READY temel servislerin hazır olduğunu gösterir.|AI ONLINE en az bir AI sağlayıcısının kullanılabilir olduğunu gösterir.|DATABASE ONLINE veritabanı bağlantısını doğrular.|IBM QUANTUM READY donanım doğrulama yolunun kullanılabilir olduğunu gösterir; LIMITED/OFF ana deterministik analiz yolunu durdurmaz.|STORAGE LOCAL yerel depolama kullanıldığını gösterir.|REDIS MEMORY/OFF yerel realtime fallback kullanıldığını ifade eder.'],
    ['3) Analiz Kategorileri', 'Başlamadan önce alanı seçin: Savunma, Enerji, Saldırı, Ekonomi, Toplumsal Olaylar, Danışma, Sağlık veya Çok Alanlı.|BDDK/BTK iş akışları etkin olduğunda uzmanlaşmış fonksiyonlar sunabilir.|Kullanıcının dahili AI veya quantum motoru seçmesi gerekmez.'],
    ['4) Analiz Oluşturma', 'Net bir rapor başlığı ve analiz briefi girin.|Mümkün olan alanlarda sesli metin girişini kullanabilirsiniz.|İlgili dosya/veriyi ekleyin.|DETAYLI ANALİZ RAPORU ÜRET standart akışı çalıştırır.|Provider fallback, provenance ve trace bilgileri sistem tarafından otomatik yönetilir.'],
    ['5) Quantum Analiz', 'KUANTUM OLASILIK MODU çoklu senaryo analizi içindir.|KUANTUM OLASILIK ANALİZİ BAŞLAT desteklenen akışı çalıştırır.|Yetkili sonuç deterministik yerel hesaplama yolundan gelir.|IBM Quantum yapılandırılmışsa gerçek donanım bağımsız doğrulama katmanı olarak kullanılabilir.|Kullanıcının klasik/quantum karşılaştırması yapması gerekmez.'],
    ['6) Raporlar ve Dosyalar', 'Raporları ekranda inceleyin; uygun olduğunda DOCX/PDF indirin.|Geçmiş kayıtları paylaşım seçenekleri de sunabilir.|Arşiv için açıklayıcı başlıklar kullanın.|Donanım doğrulaması gerçek IBM job çalıştığını gösterir; giriş verisinin kurumsal kaynaktan geldiğini tek başına kanıtlamaz.'],
    ['7) Geçmiş Analizler', 'GEÇMİŞ kayıtlı analizleri listeler ve arama/filtreleme sağlar.|Raporu açarak içerik, indirme ve audit bilgisini inceleyin.|Eski raporlarda daha az audit metadata bulunabilir.'],
    ['8) Analysis Audit', 'Analysis Audit; AI sağlayıcısı/modeli, prompt sürümü, veri kaynağı, veri kalitesi, sınıflandırma, süre, quantum backend/shots ve oluşturulma zamanını gösterebilir.|Eksik alan, o metadata kaydedilmedi anlamına gelir; doğrulanmış değer kabul edilmemelidir.'],
    ['9) Danışma ve Sesli Asistan', 'SESLİ sekme mikrofon tabanlı, SOHBET sekmesi yazılı danışma içindir.|Oto-dinle yanıt sonrası yeniden dinleyebilir.|Arşiv/kaydet/temizle kontrolleri konuşma geçmişini yönetir.|Daha iyi devamlılık için oturum başına tek ana konu önerilir.'],
    ['10) Acil Durum ve Personel Radarı', 'MERKEZE BİLDİR acil bilgiyi merkeze yollar.|KULLANICILARA BİLDİR yetki varsa aktif kullanıcılara yayın yapar.|MESAJLAŞMA kimliği doğrulanmış kullanıcı iletişimini ve mevcut dosya/ses girişlerini destekler.|Personel Radarı yalnız yetkili rollerce kullanılmalıdır.'],
    ['11) Görünüm ve Sorun Giderme', 'Ayarlar > Görünüm altında KOYU, AÇIK ve SİSTEM temaları bulunur.|SİSTEM cihazınızın açık/koyu görünümünü otomatik takip eder ve seçiminiz hatırlanır.|READY/ONLINE kullanılabilir; LIMITED ilgili opsiyonel kabiliyetin sınırlı; LOCAL/MEMORY yerel fallback; OFF ise servis kapalı veya yapılandırılmamış demektir.|Analiz üretimi başarısızsa briefi koruyun, Sistem Durumunu kontrol edin ve bir kez tekrar deneyin.'],
  ],
};

GUIDE_MODULES.de = GUIDE_MODULES.en.map(([title, body], i) => [`${i + 1}) ${['Obere Leiste','Startseite & Systemstatus','Analysekategorien','Analyse erstellen','Quantenanalyse','Berichte & Dateien','Verlauf','Analyse-Audit','Beratung & Sprachassistent','Notfallzentrum & Personalradar','Darstellung & Fehlerbehebung'][i]}`, body]);
GUIDE_MODULES.fr = GUIDE_MODULES.en.map(([title, body], i) => [`${i + 1}) ${['Barre supérieure','Accueil & état du système','Catégories d’analyse','Créer une analyse','Analyse quantique','Rapports & fichiers','Historique','Audit d’analyse','Consultation & assistant vocal','Centre d’urgence & radar du personnel','Apparence & dépannage'][i]}`, body]);
GUIDE_MODULES.ar = GUIDE_MODULES.en.map(([title, body], i) => [`${i + 1}) ${['الشريط العلوي','الرئيسية وحالة النظام','فئات التحليل','إنشاء تحليل','التحليل الكمي','التقارير والملفات','السجل','تدقيق التحليل','الاستشارة والمساعد الصوتي','مركز الطوارئ ورادار الأفراد','المظهر واستكشاف الأخطاء'][i]}`, body]);

function GuideModal({ onClose, t, lang }) {
  const modules = GUIDE_MODULES[lang] || GUIDE_MODULES.tr;
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[65] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 theme-overlay" onClick={onClose}><motion.div initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.98 }} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-2xl h-[88vh] sm:h-auto sm:max-h-[85vh] overflow-auto hud-panel rounded-t-2xl sm:rounded-xl p-4 sm:p-6"><div className="flex items-center justify-between mb-4"><h3 className="text-cyan-100 font-display tracking-widest text-sm sm:text-lg">{t('usageGuideTitle')}</h3><button onClick={onClose} className="text-cyan-100/70 hover:text-cyan-100" aria-label="Close"><X className="w-5 h-5" /></button></div><p className="text-xs sm:text-sm text-gold/70 mb-4">{t('usageGuideIntro')}</p><div className="space-y-4">{modules.map(([title, body], i) => <div key={i} className="border border-cyan-300/25 rounded-lg p-3 sm:p-4 bg-[#071225]/70 theme-card"><h4 className="text-cyan-100 text-xs sm:text-sm tracking-widest mb-2">{title}</h4><div className="space-y-1.5 text-xs sm:text-sm text-gold/90 leading-relaxed">{body.split('|').map((item, j) => <p key={j}>- {item}</p>)}</div></div>)}</div></motion.div></motion.div>;
}

export { DropdownOverlay, MenuPanel, SettingsPanel, InfoModal, GuideModal, applyTheme, getStoredTheme };
