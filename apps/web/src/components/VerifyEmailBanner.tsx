import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

export default function VerifyEmailBanner() {
  const { t } = useTranslation();
  const { user, refresh } = useAuth();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  if (!user || user.emailVerified || pathname.startsWith('/verify-email')) return null;

  async function resend() {
    setBusy(true);
    setSent(false);
    setError('');
    try {
      const res = await api<{ success: boolean; alreadyVerified: boolean }>(
        '/auth/verify-email/send',
        { method: 'POST' },
      );
      if (res.alreadyVerified) await refresh(); // verified elsewhere: the banner disappears
      else setSent(true);
    } catch (err) {
      setError(errorMessage(err)); // includes "too many requests" and "could not send"
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-amber-700/60 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
      <p>{t('banner.text', { email: user.email })}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void resend()}
          disabled={busy}
          className="rounded bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {busy ? t('banner.sending') : t('banner.resend')}
        </button>
        {sent && <span className="text-amber-100">{t('banner.sent')}</span>}
        {error && <span className="text-red-400">{error}</span>}
      </div>
    </div>
  );
}