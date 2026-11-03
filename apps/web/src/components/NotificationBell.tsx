import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, NotificationItem } from '../api';
import { useAuth } from '../auth';
import { formatDateTime } from '../i18n/format';
import { STATUS_LABEL } from '../labels';

const POLL_MS = 30_000;

export default function NotificationBell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id;

  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState('');
  const box = useRef<HTMLDivElement>(null);

  // Built while rendering, so the sentences follow the language toggle
  function describe(n: NotificationItem): string {
    if (n.title === null) return t('notifications.updateIn', { project: n.project.name });
    if (n.type === 'FEEDBACK_STATUS') {
      return n.status
        ? t('notifications.statusNow', { title: n.title, status: STATUS_LABEL[n.status] })
        : t('notifications.updated', { title: n.title });
    }
    if (n.type === 'FEEDBACK_REPLY') {
      return t('notifications.replied', { project: n.project.name, title: n.title });
    }
    if (n.type === 'NEW_FEEDBACK') {
      return t('notifications.newFeedback', { project: n.project.name, title: n.title });
    }
    return t('notifications.newPost', { title: n.title });
  }

  const refreshCount = useCallback(async () => {
    try {
      const res = await api<{ unread: number }>('/me/notifications/unread-count');
      setUnread(res.unread);
    } catch {
      // polling is best-effort: ignore network hiccups and expired sessions
    }
  }, []);

  // Poll while signed in, and refresh when the person comes back to this window
  useEffect(() => {
    if (!userId) {
      setUnread(0);
      setItems(null);
      setOpen(false);
      return;
    }
    void refreshCount();
    const timer = window.setInterval(() => void refreshCount(), POLL_MS);
    const onFocus = () => void refreshCount();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [userId, refreshCount]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function loadList() {
    setError('');
    try {
      setItems(await api<NotificationItem[]>('/me/notifications'));
      void refreshCount();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void loadList();
  }

  function openItem(n: NotificationItem) {
    if (!n.read) {
      setItems((prev) => (prev ? prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)) : prev));
      setUnread((u) => Math.max(0, u - 1));
      api(`/notifications/${n.id}/read`, { method: 'PATCH' }).catch(() => void refreshCount());
    }
    setOpen(false);
    navigate(`/p/${n.project.slug}`);
  }

  async function markAll() {
    setError('');
    try {
      await api('/me/notifications/read-all', { method: 'POST' });
      setItems((prev) => (prev ? prev.map((n) => ({ ...n, read: true })) : prev));
      setUnread(0);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!user) return null;

  return (
    <div ref={box} className="relative">
      <button
        onClick={toggle}
        aria-label={unread > 0 ? t('notifications.ariaUnread', { count: unread }) : t('notifications.aria')}
        className="relative rounded p-2 text-slate-300 hover:bg-slate-800"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 max-h-96 w-80 overflow-y-auto rounded border border-slate-700 bg-slate-900 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <span className="text-sm font-semibold">{t('notifications.title')}</span>
            <button
              onClick={() => void markAll()}
              disabled={unread === 0}
              className="text-xs text-indigo-400 hover:underline disabled:opacity-40 disabled:no-underline"
            >
              {t('notifications.markAll')}
            </button>
          </div>

          {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}
          {!error && items === null && (
            <p className="px-3 py-3 text-sm text-slate-400">{t('common.loading')}</p>
          )}
          {items?.length === 0 && (
            <p className="px-3 py-3 text-sm text-slate-400">{t('notifications.empty')}</p>
          )}

          <ul>
            {items?.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => openItem(n)}
                  className="flex w-full gap-2 border-b border-slate-800 px-3 py-2 text-left hover:bg-slate-800"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-indigo-500'}`}
                  />
                  <span className="min-w-0">
                    <span className={`block text-sm ${n.read ? 'text-slate-400' : 'text-slate-100'}`}>
                      {describe(n)}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {n.project.name} · {formatDateTime(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}