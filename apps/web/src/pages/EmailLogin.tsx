import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

export default function EmailLogin() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState(token ? '' : 'This link is incomplete.');
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

  if (!error) return <p className="text-center text-slate-400">Signing you in...</p>;

  return (
    <div className="space-y-3 text-center">
      <p className="text-red-400">{error}</p>
      <p className="text-sm text-slate-400">Request a new link on the sign-in page.</p>
      <Link to="/login" className="text-indigo-400 hover:underline">Go to sign in</Link>
    </div>
  );
}