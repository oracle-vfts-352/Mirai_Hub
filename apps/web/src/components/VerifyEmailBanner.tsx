import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';

export default function VerifyEmailBanner() {
  const { user, refresh } = useAuth();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  if (!user || user.emailVerified || pathname.startsWith('/verify-email')) return null;

  async function resend() {
    setBusy(true);
    setNote('');
    setError('');
    try {
      const res = await api<{ success: boolean; alreadyVerified: boolean }>(
        '/auth/verify-email/send',
        { method: 'POST' },
      );
      if (res.alreadyVerified) await refresh(); // verified elsewhere: the banner disappears
      else setNote('Email sent. Check your inbox (and your spam folder).');
    } catch (err) {
      setError(errorMessage(err)); // includes "too many requests" and "could not send"
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-amber-700/60 bg-amber-900/30 px-4 py-3 text-sm text-amber-200">
      <p>
        Please verify your email address. We sent a link to <strong>{user.email}</strong>.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void resend()}
          disabled={busy}
          className="rounded bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-500 disabled:opacity-50"
        >
          {busy ? 'Sending...' : 'Resend email'}
        </button>
        {note && <span className="text-amber-100">{note}</span>}
        {error && <span className="text-red-400">{error}</span>}
      </div>
    </div>
  );
}