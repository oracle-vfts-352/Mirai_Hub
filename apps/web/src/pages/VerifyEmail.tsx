import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

type State = { kind: 'working' } | { kind: 'done' } | { kind: 'error'; message: string };

export default function VerifyEmail() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token');
  const { refresh } = useAuth();
  const [state, setState] = useState<State>({ kind: 'working' });
  const started = useRef(false); // React runs effects twice in dev: the token works only once

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(async () => {
        await refresh(); // if you are signed in here, the "verify" banner disappears
        setState({ kind: 'done' });
      })
      .catch((err) => setState({ kind: 'error', message: errorMessage(err) }));
  }, [token, refresh]);

  // No token in the link: translated while rendering, so it follows the language toggle
  const message = !token ? t('verifyEmail.incomplete') : state.kind === 'error' ? state.message : null;

  if (!message && state.kind === 'working') {
    return <p className="text-center text-slate-400">{t('verifyEmail.working')}</p>;
  }

  if (!message && state.kind === 'done') {
    return (
      <div className="space-y-3 text-center">
        <p className="text-green-400">{t('verifyEmail.done')}</p>
        <Link to="/" className="text-indigo-400 hover:underline">{t('verifyEmail.goHome')}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-center">
      <p className="text-red-400">{message}</p>
      <p className="text-sm text-slate-400">{t('verifyEmail.resendHint')}</p>
      <Link to="/" className="text-indigo-400 hover:underline">{t('verifyEmail.goHome')}</Link>
    </div>
  );
}