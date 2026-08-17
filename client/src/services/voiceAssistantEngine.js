import { getActionsForAI } from './voiceActionRegistry.js';
import { api } from './api.js';

// Spoken confirmations for the local fallback matcher below. Command
// *recognition* stays Turkish/English-pattern-based (see the regexes in
// localFallback) since that's the primary voice-command language pair this
// app is used in and the network-backed path (api.voiceIntent) already
// handles any spoken language via the LLM -- this is only the last-resort
// offline fallback, so only the spoken response needs all 5 languages.
const FALLBACK_TEXT = {
  tr: { loggingIn: 'Giriş yapılıyor.', formCleared: 'Form temizlendi.', passwordEntered: 'Şifre girildi.', userCodeEntered: (v) => `Kullanıcı kodu ${v} girildi.`, sayCodeOrPassword: 'Kullanıcı kodunuzu ya da şifrenizi söyleyin, ya da "giriş yap" deyin.', home: 'Ana ekrana dönüldü.', analysis: 'Analiz ekranına geçiliyor.', history: 'Geçmiş açılıyor.', voiceChat: 'Sesli danışma açılıyor.', loggingOut: 'Çıkış yapılıyor.', notUnderstood: 'Anlayamadım, tekrar söyler misiniz?' },
  en: { loggingIn: 'Logging in.', formCleared: 'Form cleared.', passwordEntered: 'Password entered.', userCodeEntered: (v) => `User code ${v} entered.`, sayCodeOrPassword: 'Say your user code, password, or say "login".', home: 'Returning home.', analysis: 'Opening analysis.', history: 'Opening history.', voiceChat: 'Opening voice chat.', loggingOut: 'Logging out.', notUnderstood: 'Could not understand, please repeat.' },
  de: { loggingIn: 'Anmeldung läuft.', formCleared: 'Formular geleert.', passwordEntered: 'Passwort eingegeben.', userCodeEntered: (v) => `Benutzercode ${v} eingegeben.`, sayCodeOrPassword: 'Nennen Sie Ihren Benutzercode oder Ihr Passwort, oder sagen Sie „anmelden".', home: 'Zurück zur Startseite.', analysis: 'Analyse wird geöffnet.', history: 'Verlauf wird geöffnet.', voiceChat: 'Sprachberatung wird geöffnet.', loggingOut: 'Abmeldung läuft.', notUnderstood: 'Ich habe das nicht verstanden, bitte wiederholen Sie es.' },
  fr: { loggingIn: 'Connexion en cours.', formCleared: 'Formulaire effacé.', passwordEntered: 'Mot de passe saisi.', userCodeEntered: (v) => `Code utilisateur ${v} saisi.`, sayCodeOrPassword: 'Dites votre code utilisateur, votre mot de passe, ou dites « connexion ».', home: 'Retour à l\'accueil.', analysis: 'Ouverture de l\'analyse.', history: 'Ouverture de l\'historique.', voiceChat: 'Ouverture de la consultation vocale.', loggingOut: 'Déconnexion en cours.', notUnderstood: 'Je n\'ai pas compris, pouvez-vous répéter ?' },
  ar: { loggingIn: 'جارٍ تسجيل الدخول.', formCleared: 'تم مسح النموذج.', passwordEntered: 'تم إدخال كلمة المرور.', userCodeEntered: (v) => `تم إدخال رمز المستخدم ${v}.`, sayCodeOrPassword: 'قل رمز المستخدم أو كلمة المرور، أو قل "تسجيل الدخول".', home: 'العودة إلى الرئيسية.', analysis: 'جارٍ فتح التحليل.', history: 'جارٍ فتح السجل.', voiceChat: 'جارٍ فتح الاستشارة الصوتية.', loggingOut: 'جارٍ تسجيل الخروج.', notUnderstood: 'لم أفهم، هل يمكنك التكرار؟' },
};

// ─── Local fallback ──────────────────────────────────────────────────────
// Kicks in when there's no authentication or the API call fails.
// Good enough for simple scenarios like the login page.
function localFallback(transcript, context) {
  const t = (transcript || '')
    .toLowerCase()
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');

  const T = FALLBACK_TEXT[context.lang] || FALLBACK_TEXT.tr;
  const say = (key, ...args) => (typeof T[key] === 'function' ? T[key](...args) : T[key]);

  if (context.page === 'login') {
    const raw = (transcript || '').trim();

    // Login / submit
    if (t.match(/giris\s*yap|login|onayla|gonder|devam|tamam|evet|confirm|submit/))
      return { actions: [{ action: 'submit_login', params: {} }], speak: say('loggingIn') };

    // Clear
    if (t.match(/temizle|sifirla|clear|sil|reset/))
      return { actions: [{ action: 'clear_login_form', params: {} }], speak: say('formCleared') };

    // Fill password — "şifre X" or "password X"
    const pwdM = t.match(/(?:sifre|parola|password)\s+(.+)/);
    if (pwdM) {
      const val = raw.replace(/^(şifre|sifre|parola|password)\s+/i, '');
      return { actions: [{ action: 'fill_password', params: { value: val } }], speak: say('passwordEntered') };
    }

    // User code — "kod X", "kullanıcı kodu X" or just a digit sequence (6 digits)
    const codeM = t.match(/(?:kullanici\s*(?:kod[u]?)?|kod[u]?|code|kimlik|id)\s*[:=]?\s*([a-z0-9]{2,20})/);
    if (codeM) {
      const val = codeM[1].toUpperCase();
      return { actions: [{ action: 'fill_username', params: { value: val } }], speak: say('userCodeEntered', val) };
    }
    // Digits only → treat as the user code
    const onlyDigits = t.match(/^\s*(\d{4,10})\s*$/);
    if (onlyDigits) {
      const val = onlyDigits[1];
      return { actions: [{ action: 'fill_username', params: { value: val } }], speak: say('userCodeEntered', val) };
    }
    // Unknown command — say what it might be
    return { actions: [], speak: say('sayCodeOrPassword') };
  }

  if (t.match(/ana ekran|anasayfa|home|harita/))
    return { actions: [{ action: 'navigate_home', params: {} }], speak: say('home') };
  if (t.match(/analiz|analysis/))
    return { actions: [{ action: 'navigate_analysis', params: {} }], speak: say('analysis') };
  if (t.match(/gecmis|history|arsiv/))
    return { actions: [{ action: 'navigate_history', params: {} }], speak: say('history') };
  if (t.match(/sohbet|chat|danisma/))
    return { actions: [{ action: 'open_voice_chat', params: {} }], speak: say('voiceChat') };
  if (t.match(/cikis|logout|oturum kapat/))
    return { actions: [{ action: 'logout', params: {} }], speak: say('loggingOut') };

  return {
    actions: [],
    speak: say('notUnderstood'),
  };
}

// ─── Main function ───────────────────────────────────────────────────────
/**
 * Process the voice command with AI; returns the actions to run and the speech text.
 *
 * context: { page: string, lang: 'tr'|'en', user: string|null }
 * Returns: { actions: [{action, params}], speak: string }
 */
export async function processVoiceCommand(transcript, context) {
  const actions = getActionsForAI();

  try {
    // Dedicated /api/voice/intent endpoint — gives Claude a "pure assistant" role
    const result = await api.voiceIntent(transcript, context, actions);
    if (Array.isArray(result?.actions) && typeof result?.speak === 'string') {
      return result;
    }
  } catch {
    // 401 (not logged in) or network error — fall back to local matching
  }

  return localFallback(transcript, context);
}
