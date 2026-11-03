import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { ja } from './ja';

// Keeps <html lang> in step with the chosen language (accessibility, search engines).
// Registered BEFORE init, so the first language detection is caught too.
i18n.on('languageChanged', (lng: string) => {
  document.documentElement.lang = lng.startsWith('ja') ? 'ja' : 'en';
});

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, ja: { translation: ja } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'ja'],
    nonExplicitSupportedLngs: true, // "ja-JP" counts as "ja"
    interpolation: { escapeValue: false }, // React already escapes
    react: { useSuspense: false },
    detection: {
      order: ['localStorage', 'navigator'], // the saved choice first, then the browser language
      caches: ['localStorage'],
      lookupLocalStorage: 'mirai-lang',
    },
  });

export default i18n;