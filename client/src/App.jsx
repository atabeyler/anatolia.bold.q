import React, { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import GlobalVoiceAssistant from './components/GlobalVoiceAssistant.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import QuantumLogo from './components/QuantumLogo.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import { resolveCurrentUser, AUTH_CHANGED_EVENT, hydrateNativeSession } from './services/api.js';
import { nativeAuth } from './services/nativeBridge.js';
import { useLang } from './services/langContext.jsx';

// Shared by both loading gaps below (initial auth resolution, and the lazy
// route chunk boundary) -- a bare background color there used to render as
// an unexplained blank dark screen on a slow connection, easy to mistake
// for the app failing to load.
function LoadingFallback() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0a0e1a]">
      <QuantumLogo size="sm" />
    </div>
  );
}

// The dashboard (and everything it pulls in -- analysis views, chat, voice,
// history, the 3D globe, etc.) made up the bulk of the single ~790KB main
// bundle; splitting it out means a first visit to /login only pays for the
// login page's own weight.
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ButtonShowcasePage = lazy(() => import('./pages/ButtonShowcasePage.jsx'));

// The branded launch screen belongs to installed/native app shells, not a
// normal browser tab. ANATOLIA-Q ships in three such forms:
//   - Electron desktop: uses a native splash window in desktop/main.js.
//   - Capacitor Android: the native bridge exposes window.Capacitor.
//   - Installed browser PWA: display-mode is standalone (plus iOS legacy).
// Do not rely on display-mode alone: Capacitor and Electron are not PWAs and
// therefore legitimately report it as false.
const isInstalledApp = () => {
  const isCapacitor = Boolean(
    window.Capacitor?.isNativePlatform?.() ||
    (window.Capacitor?.getPlatform?.() && window.Capacitor.getPlatform() !== 'web')
  );
  const isStandalonePwa =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true;

  return isCapacitor || isStandalonePwa;
};

export default function App() {
  // undefined = still resolving who's logged in (web asks the server, since
  // the session lives in an httpOnly cookie no client JS can read; native
  // resolves this synchronously from its own stored JWT -- see
  // resolveCurrentUser()); null = confirmed logged out.
  const [user, setUser] = useState(undefined);
  const [showSplash] = useState(isInstalledApp);
  const { lang } = useLang();

  useEffect(() => {
    let alive = true;
    // Native's JWT now lives only in api.js's in-memory store (see its
    // setJWT/hydrateNativeSession comments) -- restore it from the platform's
    // secure session store before the first resolveCurrentUser() call, or
    // every launch would otherwise look logged-out until the next login.
    hydrateNativeSession(nativeAuth.getSession).then(() =>
      resolveCurrentUser().then((u) => { if (alive) setUser(u); })
    );
    return () => { alive = false; };
  }, []);

  // Event-driven instead of polling: setJWT() fires AUTH_CHANGED_EVENT on
  // login/logout in this tab, the browser fires 'storage' for other tabs
  // (native only -- web no longer writes anatolia_jwt to localStorage), and
  // a one-shot timeout re-checks exactly at token expiry.
  useEffect(() => {
    if (user === undefined) return; // initial resolution above still in flight
    let alive = true;
    const sync = () => resolveCurrentUser().then((u) => { if (alive) setUser(u); });
    const onStorage = (e) => { if (!e.key || e.key === 'anatolia_jwt') sync(); };
    // 'storage' only covers native (anatolia_jwt in localStorage); the web
    // build's httpOnly-cookie session never writes that key, so other web
    // tabs need the BroadcastChannel api.js's setJWT() posts to instead.
    const authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('anatoliaq-auth') : null;

    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    window.addEventListener('storage', onStorage);
    authChannel?.addEventListener('message', sync);

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
      alive = false;
      window.removeEventListener(AUTH_CHANGED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
      authChannel?.close();
      if (expiryTimer) clearTimeout(expiryTimer);
    };
  }, [user]);

  // Still resolving on first load -- render nothing routable yet rather
  // than flashing /login for an already-logged-in web session.
  if (user === undefined) {
    return (
      <>
        {showSplash && <SplashScreen />}
        <LoadingFallback />
      </>
    );
  }

  return (
    <>
      {showSplash && <SplashScreen />}
      <UpdateBanner />
      <Suspense fallback={<LoadingFallback />}>
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
