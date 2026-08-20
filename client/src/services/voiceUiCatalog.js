// Central catalog of ANATOLIA-Q's real navigable screens and the semantic
// voice actions available on each. This is what lets the voice engine
// resolve navigation commands ("panele git", "ayarlara git", "geçmiş")
// deterministically against the app's actual page/panel model instead of
// falling back to ui_activate's fuzzy DOM label search. Adding a new
// page/panel/button means adding an entry here -- not new matching code.
//
// SCREENS mirrors the `page` values the app actually broadcasts on the
// `aq:context` window event (see DashboardPage.jsx/AnalysisView.jsx
// dispatching it, and GlobalVoiceAssistant.jsx consuming it) -- there is no
// separate invented navigation model here, just the real one, named.
import { foldText } from './voiceIntentSchema.js';

export const SCREENS = {
  LOGIN: 'login',
  DASHBOARD_HOME: 'dashboard-home',
  DASHBOARD_ANALYSIS: 'dashboard-analysis',
};

const ALL_DASHBOARD = [SCREENS.DASHBOARD_HOME, SCREENS.DASHBOARD_ANALYSIS];

// Each entry ties a spoken navigation/action target to the exact registry
// action name it resolves to (see dashboardVoiceActions.js), the screen(s)
// it is valid to invoke from, and its TR/EN/DE/FR/AR synonym phrases.
// `requiresConfirmation` flags destructive actions the engine must ask a
// yes/no question about before executing (see voiceAssistantEngine.js).
export const UI_CATALOG = [
  {
    id: 'nav_home', action: 'navigate_home', validOn: ALL_DASHBOARD,
    synonyms: {
      tr: ['ana ekran', 'anasayfa', 'ana sayfa', 'harita', 'eve git', 'geri don', 'geri dön'],
      en: ['home', 'main screen', 'go home', 'map view', 'go back'],
      de: ['startseite', 'hauptbildschirm', 'nach hause', 'zuruck', 'zurück'],
      fr: ['accueil', 'ecran principal', 'écran principal', 'retour'],
      ar: ['الشاشة الرئيسية', 'الرئيسية', 'رجوع'],
    },
  },
  {
    id: 'nav_analysis', action: 'navigate_analysis', validOn: ALL_DASHBOARD,
    synonyms: {
      tr: ['analiz paneline git', 'analiz ekranina git', 'analiz ekranına git', 'analiz paneli', 'panele git'],
      en: ['go to analysis', 'analysis panel', 'open analysis panel', 'go to the panel'],
      de: ['zur analyse', 'analysebereich', 'zum panel'],
      fr: ["aller a l'analyse", "aller à l'analyse", "panneau d'analyse"],
      ar: ['اذهب إلى التحليل', 'لوحة التحليل'],
    },
  },
  {
    id: 'nav_history', action: 'navigate_history', validOn: ALL_DASHBOARD,
    synonyms: {
      tr: ['gecmis', 'geçmiş', 'arsiv', 'arşiv', 'gecmise git', 'geçmişe git'],
      en: ['history', 'archive', 'go to history'],
      de: ['verlauf', 'archiv'],
      fr: ['historique', 'archives'],
      ar: ['السجل', 'الأرشيف'],
    },
  },
  {
    id: 'open_voice_chat', action: 'open_voice_chat', validOn: ALL_DASHBOARD,
    synonyms: {
      tr: ['sohbet', 'sesli danisma', 'sesli danışma', 'danismayi ac', 'danışmayı aç'],
      en: ['chat', 'voice chat', 'open chat'],
      de: ['chat offnen', 'chat öffnen', 'sprachberatung'],
      fr: ['ouvrir le chat', 'consultation vocale'],
      ar: ['فتح الدردشة', 'استشارة صوتية'],
    },
  },
  {
    id: 'open_guide', action: 'open_guide', validOn: ALL_DASHBOARD,
    synonyms: {
      tr: ['rehberi ac', 'rehberi aç', 'kilavuzu ac', 'kılavuzu aç', 'yardim', 'yardım'],
      en: ['open guide', 'help', 'open help'],
      de: ['anleitung offnen', 'anleitung öffnen', 'hilfe'],
      fr: ['ouvrir le guide', 'aide'],
      ar: ['فتح الدليل', 'مساعدة'],
    },
  },
  {
    id: 'open_settings', action: 'open_settings', validOn: ALL_DASHBOARD,
    synonyms: {
      tr: ['ayarlara git', 'ayarlari ac', 'ayarları aç', 'ayarlar'],
      en: ['go to settings', 'open settings', 'settings'],
      de: ['einstellungen offnen', 'einstellungen öffnen', 'zu den einstellungen'],
      fr: ['ouvrir les parametres', 'ouvrir les paramètres', 'aller aux parametres'],
      ar: ['اذهب إلى الإعدادات', 'فتح الإعدادات'],
    },
  },
  {
    id: 'open_emergency', action: 'open_emergency', validOn: ALL_DASHBOARD,
    synonyms: {
      tr: ['acil durum paneli', 'acil durumu ac', 'acil durumu aç'],
      en: ['emergency panel', 'open emergency'],
      de: ['notfallzentrum', 'notfall offnen', 'notfall öffnen'],
      fr: ["centre d'urgence", "ouvrir l'urgence"],
      ar: ['مركز الطوارئ', 'فتح الطوارئ'],
    },
  },
  {
    id: 'logout', action: 'logout', validOn: ALL_DASHBOARD, requiresConfirmation: true,
    synonyms: {
      tr: ['cikis yap', 'çıkış yap', 'oturumu kapat'],
      en: ['log out', 'logout', 'sign out'],
      de: ['abmelden', 'ausloggen'],
      fr: ['deconnexion', 'déconnexion', 'se deconnecter', 'se déconnecter'],
      ar: ['تسجيل الخروج'],
    },
  },
];

/**
 * Finds the first UI_CATALOG entry whose synonyms appear in `text` and
 * whose validOn list includes the current screen (or any screen, when the
 * current screen is unknown/not yet reported). Returns the whole catalog
 * entry (so callers can read requiresConfirmation etc.), or null.
 */
export function matchUiCatalogAction(text, currentScreen) {
  const t = foldText(text);
  const screenKnown = currentScreen && currentScreen !== 'unknown';
  for (const entry of UI_CATALOG) {
    if (screenKnown && entry.validOn && !entry.validOn.includes(currentScreen)) continue;
    const bag = entry.synonyms || {};
    for (const words of Object.values(bag)) {
      for (const w of words) {
        if (t.includes(foldText(w))) return entry;
      }
    }
  }
  return null;
}
