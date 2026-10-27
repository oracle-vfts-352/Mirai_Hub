import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, FeedbackItem, FeedbackStatus, Post } from '../api';
import { useAuth } from '../auth';
import { STATUS_LABEL, STATUS_ORDER, STATUS_STYLE } from '../labels';

type Sort = 'votes' | 'new';

const REPLY_MAX = 2000;

const input =
  'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-500';

// Textarea + counter for writing or editing the owner reply.
function ReplyEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSave(text.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const canSave = text.trim().length > 0 && text.length <= REPLY_MAX && !busy;

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        className={`${input} h-24 text-sm`}
        placeholder="Write your official response..."
        maxLength={REPLY_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {text.length}/{REPLY_MAX}
        </span>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!canSave}
          className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Saving...' : 'Save reply'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded px-3 py-1 text-sm text-slate-400 hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function FeedbackSection({
  slug,
  isOwner,
  ownerName,
  aboutPost,
  onClearAbout,
  onCreated,
}: {
  slug: string;
  isOwner: boolean;
  ownerName?: string;
  aboutPost: { id: string; title: string } | null;
  onClearAbout: () => void;
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [sort, setSort] = useState<Sort>('votes');
  const [postFilter, setPostFilter] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');
  const [votingId, setVotingId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [deletingReplyId, setDeletingReplyId] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Posts are only needed for the "about this update" filter
  useEffect(() => {
    let cancelled = false;
    api<Post[]>(`/projects/${encodeURIComponent(slug)}/posts`)
      .then((list) => {
        if (!cancelled) setPosts(list);
      })
      .catch(() => {
        // the filter is optional: ignore errors
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setError('');
    const filter = postFilter ? `&postId=${encodeURIComponent(postFilter)}` : '';
    api<FeedbackItem[]>(`/projects/${encodeURIComponent(slug)}/feedback?sort=${sort}${filter}`)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, sort, postFilter, reloadKey]);

  async function toggleVote(item: FeedbackItem) {
    if (!user || isOwner || votingId) return;
    setVotingId(item.id);
    setError('');
    try {
      const res = await api<{ voteCount: number }>(`/feedback/${item.id}/vote`, {
        method: item.hasVoted ? 'DELETE' : 'PUT',
      });
      setItems((prev) =>
        prev
          ? prev.map((f) =>
              f.id === item.id ? { ...f, hasVoted: !item.hasVoted, voteCount: res.voteCount } : f,
            )
          : prev,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setVotingId(null);
    }
  }

  async function changeStatus(item: FeedbackItem, status: FeedbackStatus) {
    if (status === item.status || statusBusyId) return;
    setStatusBusyId(item.id);
    setError('');
    try {
      await api(`/feedback/${item.id}/status`, { method: 'PATCH', body: { status } });
      setItems((prev) => (prev ? prev.map((f) => (f.id === item.id ? { ...f, status } : f)) : prev));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStatusBusyId(null);
    }
  }

  // Throws on failure so ReplyEditor can show the error next to its form.
  async function saveReply(item: FeedbackItem, text: string) {
    const res = await api<{ ownerReply: string | null; ownerReplyAt: string | null }>(
      `/feedback/${item.id}/reply`,
      { method: 'PUT', body: { text } },
    );
    setItems((prev) =>
      prev
        ? prev.map((f) =>
            f.id === item.id ? { ...f, ownerReply: res.ownerReply, ownerReplyAt: res.ownerReplyAt } : f,
          )
        : prev,
    );
    setReplyingId(null);
  }

  async function deleteReply(item: FeedbackItem) {
    if (deletingReplyId) return;
    if (!window.confirm('Delete your response to this feedback?')) return;
    setDeletingReplyId(item.id);
    setError('');
    try {
      await api(`/feedback/${item.id}/reply`, { method: 'DELETE' });
      setItems((prev) =>
        prev ? prev.map((f) => (f.id === item.id ? { ...f, ownerReply: null, ownerReplyAt: null } : f)) : prev,
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDeletingReplyId(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await api(`/projects/${encodeURIComponent(slug)}/feedback`, {
        method: 'POST',
        body: {
          title: title.trim(),
          body: body.trim(),
          ...(aboutPost ? { postId: aboutPost.id } : {}),
        },
      });
      setTitle('');
      setBody('');
      onClearAbout();
      onCreated();
      setReloadKey((k) => k + 1);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit = title.trim().length >= 3 && body.trim().length > 0 && !submitting;

  return (
    <section id="feedback" className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Feedback</h3>
        <div className="flex gap-1 text-sm">
          {(['votes', 'new'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`rounded px-2 py-1 ${
                sort === s ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              {s === 'votes' ? 'Most votes' : 'Newest'}
            </button>
          ))}
        </div>
      </div>

      {posts.length > 0 && (
        <select
          value={postFilter}
          onChange={(e) => setPostFilter(e.target.value)}
          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-300"
        >
          <option value="">All feedback</option>
          {posts.map((p) => (
            <option key={p.id} value={p.id}>
              About: {p.title}
            </option>
          ))}
        </select>
      )}

      {isOwner && (
        <p className="text-xs text-slate-500">
          Change a status and your followers get a notification (only when the status really changes).
          You can also write one official response per feedback item.
        </p>
      )}

      {isOwner ? (
        <p className="rounded border border-slate-800 p-3 text-sm text-slate-400">
          You respond to feedback with replies, statuses and posts, so there is no feedback form on
          your own project.
        </p>
      ) : user ? (
        <form onSubmit={submit} className="space-y-2 rounded border border-slate-800 p-3">
          {aboutPost && (
            <div className="flex items-center justify-between gap-2 rounded bg-slate-800 px-3 py-2 text-sm">
              <span className="min-w-0 truncate text-slate-300">
                Feedback about: <span className="text-slate-100">{aboutPost.title}</span>
              </span>
              <button
                type="button"
                onClick={onClearAbout}
                className="shrink-0 text-xs text-slate-400 hover:underline"
              >
                Clear
              </button>
            </div>
          )}
          <input
            className={input}
            placeholder="What would you like to see? (short title)"
            minLength={3}
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className={`${input} h-24`}
            placeholder="Tell the team more..."
            maxLength={5000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          >
            {submitting ? 'Sending...' : 'Send feedback'}
          </button>
        </form>
      ) : (
        <p className="text-sm text-slate-400">
          <Link to="/login" className="text-indigo-400 hover:underline">
            Sign in
          </Link>{' '}
          to give feedback and vote.
        </p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!error && items === null && <p className="text-sm text-slate-400">Loading...</p>}
      {items?.length === 0 && (
        <p className="text-sm text-slate-400">
          {postFilter ? 'No feedback about this update yet.' : 'No feedback yet. Be the first.'}
        </p>
      )}

      <ul className="space-y-3">
        {items?.map((f) => (
          <li key={f.id} className="flex gap-3 rounded border border-slate-800 p-3">
            <button
              onClick={() => void toggleVote(f)}
              disabled={!user || isOwner || votingId === f.id}
              title={
                isOwner
                  ? 'Owners respond with replies and statuses'
                  : user
                    ? f.hasVoted
                      ? 'Remove your vote'
                      : 'Vote'
                    : 'Sign in to vote'
              }
              className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded border text-sm ${
                f.hasVoted
                  ? 'border-indigo-500 bg-indigo-950 text-indigo-200'
                  : 'border-slate-700 text-slate-300'
              } ${user && !isOwner ? 'hover:bg-slate-800' : 'opacity-60'}`}
            >
              <span aria-hidden>▲</span>
              <span>{f.voteCount}</span>
            </button>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-medium">{f.title}</h4>
                {isOwner ? (
                  <select
                    value={f.status}
                    disabled={statusBusyId === f.id}
                    onChange={(e) => void changeStatus(f, e.target.value as FeedbackStatus)}
                    className={`rounded px-2 py-0.5 text-xs outline-none ${STATUS_STYLE[f.status]}`}
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[f.status]}`}>
                    {STATUS_LABEL[f.status]}
                  </span>
                )}
              </div>
              {f.post && (
                <button
                  onClick={() => setPostFilter(f.post!.id)}
                  title="Show only feedback about this update"
                  className="max-w-full truncate rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
                >
                  About: {f.post.title}
                </button>
              )}
              <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{f.body}</p>
              <p className="text-xs text-slate-500">
                <Link to={`/u/${f.author.id}`} className="text-slate-400 hover:text-indigo-300 hover:underline">
                  {f.author.name}
                </Link>{' '}
                · {new Date(f.createdAt).toLocaleDateString()}
              </p>

              {/* Official owner response: visible to everyone */}
              {f.ownerReply && replyingId !== f.id && (
                <div className="mt-2 rounded border-l-2 border-indigo-500 bg-slate-900 p-3">
                  <p className="text-xs font-medium text-indigo-300">
                    Response from {ownerName ?? 'the project owner'}
                    {f.ownerReplyAt && (
                      <span className="font-normal text-slate-500">
                        {' '}
                        · {new Date(f.ownerReplyAt).toLocaleDateString()}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-200">
                    {f.ownerReply}
                  </p>
                </div>
              )}

              {/* Owner controls */}
              {isOwner && replyingId === f.id && (
                <div className="mt-2">
                  <ReplyEditor
                    initial={f.ownerReply ?? ''}
                    onSave={(text) => saveReply(f, text)}
                    onCancel={() => setReplyingId(null)}
                  />
                </div>
              )}
              {isOwner && replyingId !== f.id && (
                <div className="flex gap-3 pt-1 text-xs">
                  <button
                    onClick={() => setReplyingId(f.id)}
                    className="text-indigo-400 hover:underline"
                  >
                    {f.ownerReply ? 'Edit reply' : 'Reply'}
                  </button>
                  {f.ownerReply && (
                    <button
                      onClick={() => void deleteReply(f)}
                      disabled={deletingReplyId === f.id}
                      className="text-red-400 hover:underline disabled:opacity-50"
                    >
                      Delete reply
                    </button>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}