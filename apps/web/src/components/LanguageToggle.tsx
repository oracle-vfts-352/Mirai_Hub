import { useTranslation } from 'react-i18next';

const OPTIONS = [
  { id: 'en', label: 'EN' },
  { id: 'ja', label: '日本語' },
] as const;

export default function LanguageToggle() {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage === 'ja' ? 'ja' : 'en';

  return (
    <div
      role="group"
      aria-label={t('language.label')}
      className="flex overflow-hidden rounded border border-slate-700 text-xs"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          lang={o.id}
          aria-pressed={current === o.id}
          onClick={() => void i18n.changeLanguage(o.id)}
          className={`px-2 py-1 ${
            current === o.id ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}