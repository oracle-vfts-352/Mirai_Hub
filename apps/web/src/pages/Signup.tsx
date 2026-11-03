import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { startRegistration } from '@simplewebauthn/browser';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

type CreationOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

const input =
  'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-500';

export default function Signup() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'DEV' | 'CONSUMER'>('DEV');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsPasskey, setNeedsPasskey] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  async function registerPasskey() {
    const options = await api<CreationOptions>('/auth/passkey/register-options', { method: 'POST' });
    const credentialResponse = await startRegistration({ optionsJSON: options });
    await api('/auth/passkey/register-verify', { method: 'POST', body: { credentialResponse } });
    await refresh();
    navigate('/');
  }

  async function run(fn: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api('/auth/signup', { method: 'POST', body: { email, name, role } });
      setNeedsPasskey(true); // the account exists now; the passkey step can be retried for 10 minutes
      await registerPasskey();
    });
  }

  if (needsPasskey) {
    return (
      <div className="space-y-4 text-center">
        <p>{t('signup.accountCreated')}</p>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          disabled={busy}
          onClick={() => void run(registerPasskey)}
          className="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? t('signup.waiting') : t('signup.createPasskey')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold">{t('signup.title')}</h2>
      <input className={input} type="email" placeholder={t('signup.emailPlaceholder')} required value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className={input} placeholder={t('signup.namePlaceholder')} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <select className={input} value={role} onChange={(e) => setRole(e.target.value as 'DEV' | 'CONSUMER')}>
        <option value="DEV">{t('signup.roleDev')}</option>
        <option value="CONSUMER">{t('signup.roleConsumer')}</option>
      </select>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? t('signup.working') : t('signup.continue')}
      </button>
      <p className="text-center text-sm text-slate-400">
        {t('signup.haveAccount')}{' '}
        <Link to="/login" className="text-indigo-400 hover:underline">
          {t('signup.signIn')}
        </Link>
      </p>
    </form>
  );
}