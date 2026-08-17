import React, { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import GlobalVoiceAssistant from './components/GlobalVoiceAssistant.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import { getCurrentUser, AUTH_CHANGED_EVENT } from './services/api.js';
import { useLang } from './services/langContext.jsx';

// The dashboard (and everything it pulls in -- analysis views, chat, voice,
// history, the 3D globe, etc.) made up the bulk of the single ~790KB main
// bundle; splitting it out means a first visit to /login only pays for the
// login page's own weight.
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ButtonShowcasePage = lazy(() => import('./pages/ButtonShowcasePage.jsx'));

// The branded launch screen belongs to installed/native app shells, not a
// normal browser tab. ANATOLIA-Q ships in three such forms:
//   - Electron desktop: preload exposes window.anatoliaDesktop.
//   - Capacitor Android: the native bridge exposes window.Capacitor.
//   - Installed browser PWA: display-mode is standalone (plus iOS legacy).
// Do not rely on display-mode alone: Capacitor and Electron are not PWAs and
// therefore legitimately report it as false.
const isInstalledApp = () => {
  const isDesktop = window.anatoliaDesktop?.isDesktop === true;
  const isCapacitor = Boolean(
    window.Capacitor?.isNativePlatform?.() ||
    (window.Capacitor?.getPlatform?.() && window.Capacitor.getPlatform() !== 'web')
  );
  const isStandalonePwa =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true;

  return isDesktop || isCapacitor || isStandalonePwa;
};

export default function App() {
  const [user, setUser] = useState(getCurrentUser());
  const [showSplash] = useState(isInstalledApp);
  const { lang } = useLang();

  // Event-driven instead of polling: setJWT() fires AUTH_CHANGED_EVENT on
  // login/logout in this tab, the browser fires 'storage' for other tabs,
  // and a one-shot timeout re-checks exactly at token expiry -- no need to
  // re-parse/base64-decode the JWT every second just to detect a change.
  useEffect(() => {
    const sync = () => setUser(getCurrentUser());
    const onStorage = (e) => { if (!e.key || e.key === 'anatolia_jwt') sync(); };

    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    window.addEventListener('storage', onStorage);

    let expiryTimer;
    if (user?.exp) {
      const msUntilExpiry = user.exp * 1000 - Date.now();
      // setTimeout delays beyond ~24.8 days overflow to fire immediately in
      // some engines; JWTs here expire in hours, but clamp defensively.
      if (msUntilExpiry > 0 && msUntilExpiry < 2 ** 31) {
        expiryTimer = setTimeout(sync, msUntilExpiry);
      }
    }

    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, [user]);

  return (
    <>
      {showSplash && <SplashScreen />}
      <UpdateBanner />
      <Suspense fallback={<div className="fixed inset-0 bg-[#0a0e1a]" />}>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" /> : <LoginPage onLogin={setUser} />} />
          <Route path="/ui-buttons" element={user ? <ButtonShowcasePage /> : <Navigate to="/login" />} />
          <Route path="/*" element={user ? <DashboardPage user={user} onLogout={() => setUser(null)} /> : <Navigate to="/login" />} />
        </Routes>
      </Suspense>
      <GlobalVoiceAssistant lang={lang} user={user} />
    </>
  );
}
