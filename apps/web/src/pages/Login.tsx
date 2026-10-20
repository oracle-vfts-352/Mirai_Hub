import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

type RequestOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

export default function Login() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

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

  return (
    <div className="space-y-4 text-center">
      <h2 className="text-xl font-semibold">Sign in</h2>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        disabled={busy}
        onClick={() => void signIn()}
        className="w-full rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? 'Waiting for your passkey prompt...' : 'Sign in with passkey'}
      </button>
      <p className="text-sm text-slate-400">
        New here? <Link to="/signup" className="text-indigo-400 hover:underline">Sign up</Link>
      </p>
    </div>
  );
}