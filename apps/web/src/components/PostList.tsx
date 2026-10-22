import { FormEvent, useEffect, useState } from 'react';
import { api, errorMessage, Post, PostType } from '../api';
import { POST_TYPE_LABEL, POST_TYPE_ORDER } from '../labels';

type Draft = { type: PostType; title: string; body: string };

const input =
  'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-500';

function PostForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  submitLabel: string;
  onSubmit: (d: Draft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = draft.title.trim().length >= 3 && draft.body.trim().length > 0 && !busy;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit({ type: draft.type, title: draft.title.trim(), body: draft.body.trim() });
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
        {POST_TYPE_ORDER.map((t) => (
          <option key={t} value={t}>
            {POST_TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      <input
        className={input}
        placeholder="Title"
        minLength={3}
        maxLength={120}
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
      />
      <textarea
        className={`${input} h-32`}
        placeholder="What do you want to tell your followers?"
        maxLength={10000}
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
      />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!valid}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Saving...' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-slate-400 hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function PostList({ slug, isOwner }: { slug: string; isOwner: boolean }) {
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

  async function create(data: Draft) {
    const post = await api<Post>(`/projects/${encodeURIComponent(slug)}/posts`, {
      method: 'POST',
      body: data,
    });
    setPosts((prev) => (prev ? [post, ...prev] : [post]));
    setShowForm(false);
  }

  async function update(id: string, data: Draft) {
    const post = await api<Post>(`/posts/${id}`, { method: 'PATCH', body: data });
    setPosts((prev) => (prev ? prev.map((p) => (p.id === id ? post : p)) : prev));
    setEditingId(null);
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this post? Its notifications are removed too.')) return;
    setError('');
    try {
      await api(`/posts/${id}`, { method: 'DELETE' });
      setPosts((prev) => (prev ? prev.filter((p) => p.id !== id) : prev));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Updates</h3>
        {isOwner && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500"
          >
            New post
          </button>
        )}
      </div>

      {isOwner && showForm && (
        <PostForm
          initial={{ type: 'ANNOUNCEMENT', title: '', body: '' }}
          submitLabel="Publish"
          onSubmit={create}
          onCancel={() => setShowForm(false)}
        />
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!error && posts === null && <p className="text-sm text-slate-400">Loading...</p>}
      {posts?.length === 0 && <p className="text-sm text-slate-400">No posts yet.</p>}

      {posts?.map((p) =>
        isOwner && editingId === p.id ? (
          <PostForm
            key={p.id}
            initial={{ type: p.type, title: p.title, body: p.body }}
            submitLabel="Save changes"
            onSubmit={(d) => update(p.id, d)}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <article key={p.id} className="space-y-1 rounded border border-slate-800 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">
                <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
                  {POST_TYPE_LABEL[p.type]}
                </span>
                <span className="ml-2">{new Date(p.createdAt).toLocaleDateString()}</span>
              </p>
              {isOwner && (
                <div className="flex gap-3 text-xs">
                  <button onClick={() => setEditingId(p.id)} className="text-indigo-400 hover:underline">
                    Edit
                  </button>
                  <button onClick={() => void remove(p.id)} className="text-red-400 hover:underline">
                    Delete
                  </button>
                </div>
              )}
            </div>
            <h4 className="font-medium">{p.title}</h4>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{p.body}</p>
          </article>
        ),
      )}
    </section>
  );
}