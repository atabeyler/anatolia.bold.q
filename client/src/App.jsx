import React, { useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import GlobalVoiceAssistant from './components/GlobalVoiceAssistant.jsx';
import SplashScreen from './components/SplashScreen.jsx';
import { getCurrentUser } from './services/api.js';
import { useLang } from './services/langContext.jsx';

// The dashboard (and everything it pulls in -- analysis views, chat, voice,
// history, the 3D globe, etc.) made up the bulk of the single ~790KB main
// bundle; splitting it out means a first visit to /login only pays for the
// login page's own weight.
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const ButtonShowcasePage = lazy(() => import('./pages/ButtonShowcasePage.jsx'));

// True only when launched from a home-screen/desktop app icon (installed
// PWA), not a normal browser tab -- covers desktop Chrome (display-mode:
// standalone) and iOS Safari (navigator.standalone).
const isStandalonePwa = () =>
  window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;

export default function App() {
  const [user, setUser] = useState(getCurrentUser());
  const [showSplash] = useState(isStandalonePwa);
  const { lang } = useLang();

  useEffect(() => {
    const interval = setInterval(() => {
      const u = getCurrentUser();
      if (JSON.stringify(u) !== JSON.stringify(user)) setUser(u);
    }, 1000);
    return () => clearInterval(interval);
  }, [user]);

  return (
    <>
      {showSplash && <SplashScreen />}
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
