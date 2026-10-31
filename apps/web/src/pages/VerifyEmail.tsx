import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

type State = { kind: 'working' } | { kind: 'done' } | { kind: 'error'; message: string };

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { refresh } = useAuth();
  const [state, setState] = useState<State>(
    token ? { kind: 'working' } : { kind: 'error', message: 'This link is incomplete.' },
  );
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

  if (state.kind === 'working') {
    return <p className="text-center text-slate-400">Verifying your email...</p>;
  }

  if (state.kind === 'done') {
    return (
      <div className="space-y-3 text-center">
        <p className="text-green-400">Your email is verified. Thank you!</p>
        <Link to="/" className="text-indigo-400 hover:underline">Go to Mirai Hub</Link>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-center">
      <p className="text-red-400">{state.message}</p>
      <p className="text-sm text-slate-400">
        Sign in and use "Resend email" on the home page to get a new link.
      </p>
      <Link to="/" className="text-indigo-400 hover:underline">Go to Mirai Hub</Link>
    </div>
  );
}