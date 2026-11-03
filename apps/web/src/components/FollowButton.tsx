import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, FollowEntry } from '../api';
import { useAuth } from '../auth';

export default function FollowButton({
  projectId,
  slug,
  ownerId,
  onChange,
}: {
  projectId: string;
  slug: string;
  ownerId: string;
  onChange: (delta: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const userId = user?.id;
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!userId) {
      setFollowing(null);
      return;
    }
    let cancelled = false;
    api<FollowEntry[]>('/me/follows')
      .then((list) => {
        if (!cancelled) setFollowing(list.some((f) => f.projectId === projectId));
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, projectId]);

  async function toggle() {
    if (following === null || busy) return;
    setBusy(true);
    setError('');
    try {
      const path = `/projects/${encodeURIComponent(slug)}/follow`;
      if (following) {
        await api(path, { method: 'DELETE' });
        setFollowing(false);
        onChange(-1);
      } else {
        await api(path, { method: 'PUT' });
        setFollowing(true);
        onChange(1);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return null;
  if (!user) {
    return (
      <Link to="/login" className="text-sm text-indigo-400 hover:underline">
        {t('follow.signInToFollow')}
      </Link>
    );
  }
  if (user.id === ownerId) return null; // owners are not notified of their own project

  return (
    <div className="space-y-1">
      <button
        onClick={() => void toggle()}
        disabled={following === null || busy}
        className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
          following
            ? 'border border-slate-600 hover:bg-slate-800'
            : 'bg-indigo-600 hover:bg-indigo-500'
        }`}
      >
        {following === null ? '...' : following ? t('follow.following') : t('follow.follow')}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}