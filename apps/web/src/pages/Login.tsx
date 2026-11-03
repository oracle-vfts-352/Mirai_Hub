import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

type RequestOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

const input =
  'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-500';

export default function Login() {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  // Email-link sign-in (lost passkey, new device)
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [mailBusy, setMailBusy] = useState(false);
  const [mailSentTo, setMailSentTo] = useState('');
  const [mailError, setMailError] = useState('');

  async function signIn() {
    setError('');
    setBusy(true);
    try {
      const options = await api<RequestOptions>('/auth/passkey/login-options', { method: 'POST' });
      const credentialResponse = await startAuthentication({ optionsJSON: options });
      await api('/auth/passkey/login-verify', { method: 'POST', body: { credentialResponse } });
      await refresh();
      navigate('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function requestLink(e: FormEvent) {
    e.preventDefault();
    setMailError('');
    setMailBusy(true);
    try {
      await api('/auth/email-login/request', { method: 'POST', body: { email } });
      setMailSentTo(email.trim());
    } catch (err) {
      setMailError(errorMessage(err)); // includes "too many requests"
    } finally {
      setMailBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-center">
      <h2 className="text-xl font-semibold">{t('login.title')}</h2>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        disabled={busy}
        onClick={() => void signIn()}
        className="w-full rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? t('login.waiting') : t('login.passkeyButton')}
      </button>

      {mailSentTo ? (
        <p className="rounded border border-slate-800 p-3 text-sm text-slate-300">
          {t('login.sentTo', { email: mailSentTo })}
        </p>
      ) : showEmail ? (
        <form onSubmit={requestLink} className="space-y-2 rounded border border-slate-800 p-3 text-left">
          <p className="text-sm text-slate-400">{t('login.emailHelp')}</p>
          <input
            className={input}
            type="email"
            placeholder={t('login.emailPlaceholder')}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {mailError && <p className="text-sm text-red-400">{mailError}</p>}
          <button
            type="submit"
            disabled={mailBusy}
            className="w-full rounded border border-slate-600 px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {mailBusy ? t('login.sending') : t('login.sendLink')}
          </button>
        </form>
      ) : (
        <button
          onClick={() => setShowEmail(true)}
          className="text-sm text-indigo-400 hover:underline"
        >
          {t('login.lostLink')}
        </button>
      )}

      <p className="text-sm text-slate-400">
        {t('login.newHere')}{' '}
        <Link to="/signup" className="text-indigo-400 hover:underline">
          {t('login.signUp')}
        </Link>
      </p>
    </div>
  );
}