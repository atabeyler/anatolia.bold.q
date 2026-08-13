// Unifies desktopBridge.js (Electron) and mobileBridge.js (Capacitor/
// Android) behind one API, since both export the exact same shape
// (auth/analyses/sync/ai/connectivity). The UI layer (LoginPage,
// HistoryView, DashboardPage, ...) only ever needs to know "is this a
// native app or the plain web build", not which native platform.
import { isDesktop, desktopAuth, desktopAnalyses, desktopSync, desktopAI, desktopConnectivity } from './desktopBridge.js';
import { isMobileApp, mobileAuth, mobileAnalyses, mobileSync, mobileAI, mobileConnectivity } from './mobileBridge.js';

export const isNativeApp = isDesktop || isMobileApp;

export const nativeAuth = isDesktop ? desktopAuth : mobileAuth;
export const nativeAnalyses = isDesktop ? desktopAnalyses : mobileAnalyses;
export const nativeSync = isDesktop ? desktopSync : mobileSync;
export const nativeAI = isDesktop ? desktopAI : mobileAI;
export const nativeConnectivity = isDesktop ? desktopConnectivity : mobileConnectivity;
