import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BrowseProject, Project } from '../api';
import { useAuth } from '../auth';
import FeedList from '../components/FeedList';
import ProjectCard from '../components/ProjectCard';
import { useApi } from '../useApi';
import ProjectLogo from '../components/ProjectLogo';

type Tab = 'discover' | 'following' | 'mine';
type Sort = 'new' | 'followers';

const SORTS: { id: Sort; label: string }[] = [
  { id: 'new', label: 'Newest' },
  { id: 'followers', label: 'Most followed' },
];

function Discover() {
  const [sort, setSort] = useState<Sort>('new');
  const { data: projects, error, loading } = useApi<BrowseProject[]>(`/projects?sort=${sort}`);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects</h2>
          <div className="flex gap-1 text-sm">
            {SORTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSort(s.id)}
                className={`rounded px-2 py-1 ${
                  sort === s.id ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {loading && <p className="text-sm text-slate-400">Loading...</p>}
        {projects?.length === 0 && <p className="text-sm text-slate-400">No projects yet.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {projects?.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Recent updates</h2>
        <FeedList scope="all" empty="No updates yet." />
      </section>
    </div>
  );
}

function Following({ goDiscover }: { goDiscover: () => void }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Updates from projects you follow</h2>
      <FeedList
        scope="following"
        empty={
          <p>
            Nothing here yet.{' '}
            <button onClick={goDiscover} className="text-indigo-400 hover:underline">
              Find a project to follow
            </button>
            .
          </p>
        }
      />
    </section>
  );
}

function MyProjects() {
  const { data: projects, error, loading } = useApi<Project[]>('/projects/mine');

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My projects</h2>
        <Link
          to="/projects/new"
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500"
        >
          Create project
        </Link>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">Loading...</p>}
      {projects?.length === 0 && (
        <p className="text-sm text-slate-400">No projects yet. Create your first one.</p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {projects?.map((p) => (
          <li key={p.id}>
              <Link
                to={`/p/${p.slug}`}
                className="flex h-full items-start gap-3 rounded border border-slate-700 px-3 py-2 hover:bg-slate-900"
            >
              <ProjectLogo url={p.logoUrl} name={p.name} size="md" />
              <div className="min-w-0">
                <span className="font-medium">{p.name}</span>
                <span className="ml-2 text-sm text-slate-400">/{p.slug}</span>
                {p.tagline && <p className="text-sm text-slate-400">{p.tagline}</p>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Home() {
  const { user, loading, logout } = useAuth();
  const [params, setParams] = useSearchParams();

  if (loading) return <p className="text-center text-slate-400">Loading...</p>;

  const tabs: { id: Tab; label: string }[] = [{ id: 'discover', label: 'Discover' }];
  if (user) tabs.push({ id: 'following', label: 'Following' });
  if (user?.role === 'DEV') tabs.push({ id: 'mine', label: 'My projects' });

  const requested = params.get('tab');
  const tab: Tab = tabs.find((t) => t.id === requested)?.id ?? 'discover';

  function selectTab(id: Tab) {
    if (id === 'discover') setParams({});
    else setParams({ tab: id });
  }

  return (
    <div className="space-y-6">
      {user ? (
        <p className="text-center text-sm text-slate-400">
          Signed in as <span className="font-semibold text-slate-200">{user.name}</span> · {user.email} (
          {user.role}) ·{' '}
          <button onClick={() => void logout()} className="text-indigo-400 hover:underline">
            Sign out
          </button>
        </p>
      ) : (
        <div className="space-y-3 text-center">
          <p className="text-slate-400">Share your vision. Hear what matters.</p>
          <div className="flex justify-center gap-3">
            <Link to="/signup" className="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500">
              Sign up
            </Link>
            <Link
              to="/login"
              className="rounded border border-slate-600 px-4 py-2 font-medium hover:bg-slate-800"
            >
              Sign in
            </Link>
          </div>
        </div>
      )}

      <nav className="flex gap-1 border-b border-slate-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id
                ? 'border-indigo-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'discover' && <Discover />}
      {tab === 'following' && <Following goDiscover={() => selectTab('discover')} />}
      {tab === 'mine' && <MyProjects />}
    </div>
  );
}