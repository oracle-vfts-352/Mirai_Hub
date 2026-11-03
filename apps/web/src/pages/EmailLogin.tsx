import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

export default function EmailLogin() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token');
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const started = useRef(false); // React runs effects twice in dev: the token works only once

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api('/auth/email-login/verify', { method: 'POST', body: { token } })
      .then(async () => {
        await refresh();
        navigate('/', { replace: true });
      })
      .catch((err) => setError(errorMessage(err)));
  }, [token, refresh, navigate]);

  const message = !token ? t('emailLogin.incomplete') : error;
  if (!message) return <p className="text-center text-slate-400">{t('emailLogin.signingIn')}</p>;

  return (
    <div className="space-y-3 text-center">
      <p className="text-red-400">{message}</p>
      <p className="text-sm text-slate-400">{t('emailLogin.requestNew')}</p>
      <Link to="/login" className="text-indigo-400 hover:underline">{t('emailLogin.goLogin')}</Link>
    </div>
  );
}