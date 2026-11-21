import { Languages } from 'lucide-react';
import { useI18n } from '../store/i18n.tsx';

export function LangToggle({ className = '' }: { className?: string }) {
  const { lang, setLang } = useI18n();
  const next = lang === 'th' ? 'en' : 'th';
  const label = next === 'en' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย';
  return (
    <button
      type="button"
      className={className ? `lang-toggle ${className}` : 'lang-toggle'}
      onClick={() => setLang(next)}
      aria-label={label}
      title={label}
      lang={next}
      data-testid="lang-toggle"
    >
      <Languages size={24} aria-hidden="true" />
    </button>
  );
}
