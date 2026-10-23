import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FeedPost } from '../api';
import { POST_TYPE_LABEL } from '../labels';
import { useApi } from '../useApi';

export default function FeedList({
  scope,
  empty,
}: {
  scope: 'all' | 'following';
  empty: ReactNode;
}) {
  const { data, error, loading } = useApi<FeedPost[]>(`/feed?scope=${scope}`);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (loading) return <p className="text-sm text-slate-400">Loading...</p>;
  if (!data || data.length === 0) return <div className="text-sm text-slate-400">{empty}</div>;

  return (
    <ul className="space-y-3">
      {data.map((p) => (
        <li key={p.id}>
          <Link
            to={`/p/${p.project.slug}`}
            className="block space-y-1 rounded border border-slate-800 p-3 hover:bg-slate-900"
          >
            <p className="text-xs text-slate-500">
              <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
                {POST_TYPE_LABEL[p.type]}
              </span>
              <span className="ml-2">{p.project.name}</span>
              <span className="ml-2">· {new Date(p.createdAt).toLocaleDateString()}</span>
            </p>
            <h3 className="font-medium">{p.title}</h3>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{p.excerpt}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}