import { useEffect, useState } from 'react';
import { api, errorMessage, Post } from '../api';
import { POST_TYPE_LABEL } from '../labels';

export default function PostList({ slug }: { slug: string }) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState('');

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

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Updates</h3>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!error && posts === null && <p className="text-sm text-slate-400">Loading...</p>}
      {posts?.length === 0 && <p className="text-sm text-slate-400">No posts yet.</p>}

      {posts?.map((p) => (
        <article key={p.id} className="space-y-1 rounded border border-slate-800 p-3">
          <p className="text-xs text-slate-500">
            <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
              {POST_TYPE_LABEL[p.type]}
            </span>
            <span className="ml-2">{new Date(p.createdAt).toLocaleDateString()}</span>
          </p>
          <h4 className="font-medium">{p.title}</h4>
          <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{p.body}</p>
        </article>
      ))}
    </section>
  );
}