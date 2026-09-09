import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import ru from '@/i18n/locales/ru';
import en from '@/i18n/locales/en';

/**
 * i18next bootstrap - runs once at app startup before React mounts.
 *
 * Detection order:
 *   1. localStorage `iceslab:lang` (admin's explicit choice)
 *   2. browser `navigator.language` (first match against ['ru','en'])
 *   3. fallback: ru (most users today are Russian-speaking)
 *
 * Why no backend fetch: the panel is small enough that bundling all locales
 * inline is cheaper than two HTTP requests on first paint. We can swap to
 * lazy-loaded JSON later if locale count grows past ~5.
 */
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ru: { translation: ru },
      en: { translation: en },
    },
    fallbackLng: 'ru',
    supportedLngs: ['ru', 'en'],
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'iceslab:lang',
      caches: ['localStorage'],
    },
  });

export default i18n;
