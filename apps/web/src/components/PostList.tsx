import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage, Post, PostType, uploadFile } from '../api';
import { useAuth } from '../auth';
import { formatDate } from '../i18n/format';
import { POST_TYPE_LABEL, POST_TYPE_ORDER } from '../labels';

type Draft = { type: PostType; title: string; body: string };
type CoverChange = { file: File | null; remove: boolean };

const input =
  'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-500';

const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const COVER_MAX_BYTES = 5 * 1024 * 1024;

function PostForm({
  initial,
  existingCoverUrl,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  existingCoverUrl?: string | null;
  submitLabel: string;
  onSubmit: (d: Draft, cover: CoverChange) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft>(initial);
  const [file, setFile] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const valid = draft.title.trim().length >= 3 && draft.body.trim().length > 0 && !busy;

  // Local preview of the picked file
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const shown = preview ?? (removeCover ? null : existingCoverUrl ?? null);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // lets the same file be picked again
    if (!f) return;
    if (!COVER_TYPES.includes(f.type)) {
      setError(t('posts.badType'));
      return;
    }
    if (f.size > COVER_MAX_BYTES) {
      setError(t('posts.tooLarge'));
      return;
    }
    setError('');
    setFile(f);
    setRemoveCover(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit(
        { type: draft.type, title: draft.title.trim(), body: draft.body.trim() },
        { file, remove: removeCover && !file },
      );
      // on success the parent closes this form
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded border border-slate-700 p-3">
      <select
        className={input}
        value={draft.type}
        onChange={(e) => setDraft({ ...draft, type: e.target.value as PostType })}
      >
        {POST_TYPE_ORDER.map((ty) => (
          <option key={ty} value={ty}>
            {POST_TYPE_LABEL[ty]}
          </option>
        ))}
      </select>
      <input
        className={input}
        placeholder={t('posts.titlePlaceholder')}
        minLength={3}
        maxLength={120}
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      <textarea
        className={`${input} h-32`}
        placeholder={t('posts.bodyPlaceholder')}
        maxLength={10000}
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
      />

      <div className="space-y-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={pick}
          className="hidden"
        />
        {shown && <img src={shown} alt="" className="max-h-48 w-full rounded object-cover" />}
        <div className="flex gap-3 text-xs">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="text-indigo-400 hover:underline disabled:opacity-50"
          >
            {shown ? t('posts.changeCover') : t('posts.addCover')}
          </button>
          {shown && (
            <button
              type="button"
              onClick={() => {
                setFile(null);
                setRemoveCover(Boolean(existingCoverUrl));
              }}
              disabled={busy}
              className="text-red-400 hover:underline disabled:opacity-50"
            >
              {t('posts.remove')}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!valid}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? t('posts.saving') : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-slate-400 hover:underline">
          {t('posts.cancel')}
        </button>
      </div>
    </form>
  );
}

export default function PostList({
  slug,
  isOwner,
  onGiveFeedback,
  onDeleted,
}: {
  slug: string;
  isOwner: boolean;
  onGiveFeedback?: (post: { id: string; title: string }) => void;
  onDeleted?: (postId: string) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError('');
    api<Post[]>(`/projects/${encodeURIComponent(slug)}/posts`)
      .then((list) => {
        if (!cancelled) setPosts(list);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  function setCoverUrl(id: string, coverUrl: string | null) {
    setPosts((prev) => (prev ? prev.map((p) => (p.id === id ? { ...p, coverUrl } : p)) : prev));
  }

  // The post is created first; the cover is a second request. If only the cover fails,
  // the post stays published and the owner can retry through Edit.
  async function create(data: Draft, cover: CoverChange) {
    const post = await api<Post>(`/projects/${encodeURIComponent(slug)}/posts`, {
      method: 'POST',
      body: data,
    });
    setPosts((prev) => (prev ? [post, ...prev] : [post]));
    setShowForm(false);
    if (cover.file) {
      try {
        const res = await uploadFile<{ coverUrl: string | null }>(`/posts/${post.id}/cover`, 'cover', cover.file);
        setCoverUrl(post.id, res.coverUrl);
      } catch (err) {
        setError(t('posts.coverFailedCreate', { error: errorMessage(err) }));
      }
    }
  }

  async function update(id: string, data: Draft, cover: CoverChange) {
    const post = await api<Post>(`/posts/${id}`, { method: 'PATCH', body: data });
    setPosts((prev) => (prev ? prev.map((p) => (p.id === id ? post : p)) : prev));
    setEditingId(null);
    try {
      if (cover.file) {
        const res = await uploadFile<{ coverUrl: string | null }>(`/posts/${id}/cover`, 'cover', cover.file);
        setCoverUrl(id, res.coverUrl);
      } else if (cover.remove) {
        await api(`/posts/${id}/cover`, { method: 'DELETE' });
        setCoverUrl(id, null);
      }
    } catch (err) {
      setError(t('posts.coverFailedUpdate', { error: errorMessage(err) }));
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('posts.confirmDelete'))) return;
    setError('');
    try {
      await api(`/posts/${id}`, { method: 'DELETE' });
      setPosts((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
      onDeleted?.(id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t('posts.updates')}</h3>
        {isOwner && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500"
          >
            {t('posts.newPost')}
          </button>
        )}
      </div>

      {isOwner && showForm && (
        <PostForm
          initial={{ type: 'ANNOUNCEMENT', title: '', body: '' }}
          submitLabel={t('posts.publish')}
          onSubmit={create}
          onCancel={() => setShowForm(false)}
        />
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!error && posts === null && <p className="text-sm text-slate-400">{t('common.loading')}</p>}
      {posts?.length === 0 && <p className="text-sm text-slate-400">{t('posts.empty')}</p>}

      {posts?.map((p) =>
        isOwner && editingId === p.id ? (
          <PostForm
            key={p.id}
            initial={{ type: p.type, title: p.title, body: p.body }}
            existingCoverUrl={p.coverUrl}
            submitLabel={t('posts.saveChanges')}
            onSubmit={(d, c) => update(p.id, d, c)}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <article key={p.id} id={`post-${p.id}`} className="space-y-1 rounded border border-slate-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
                  {POST_TYPE_LABEL[p.type]}
                </span>
                <span className="ml-2">{formatDate(p.createdAt)}</span>
              </p>
              {isOwner && (
                <div className="flex gap-3 text-xs">
                  <button onClick={() => setEditingId(p.id)} className="text-indigo-400 hover:underline">
                    {t('posts.edit')}
                  </button>
                  <button onClick={() => void remove(p.id)} className="text-red-400 hover:underline">
                    {t('posts.delete')}
                  </button>
                </div>
              )}
            </div>
            {p.coverUrl && (
              <img
                src={p.coverUrl}
                alt=""
                loading="lazy"
                className="mb-1 max-h-64 w-full rounded object-cover"
              />
            )}
            <h4 className="font-medium">{p.title}</h4>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{p.body}</p>
            {user && !isOwner && onGiveFeedback && (
              <button
                onClick={() => onGiveFeedback({ id: p.id, title: p.title })}
                className="pt-1 text-xs text-indigo-400 hover:underline"
              >
                {t('posts.giveFeedback')}
              </button>
            )}
          </article>
        ),
      )}
    </section>
  );
}