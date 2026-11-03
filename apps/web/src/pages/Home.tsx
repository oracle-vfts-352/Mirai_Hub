import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BrowseProject, Project } from '../api';
import { useAuth } from '../auth';
import FeedList from '../components/FeedList';
import ProjectCard from '../components/ProjectCard';
import { useApi } from '../useApi';
import ProjectLogo from '../components/ProjectLogo';

type Tab = 'discover' | 'following' | 'mine';
type Sort = 'new' | 'followers';

const SORT_IDS: Sort[] = ['new', 'followers'];
const SEARCH_MAX = 80;

// Returns `value` only after it has stopped changing for `ms` milliseconds.
function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function Discover() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? ''); // what is typed in the box
  const [sort, setSort] = useState<Sort>('new');
  const q = useDebounced(text.trim(), 300); // what is actually searched

  // Keep the address bar in sync (replace: typing must not fill the back-button history)
  useEffect(() => {
    if ((params.get('q') ?? '') === q) return;
    setParams(q ? { q } : {}, { replace: true });
  }, [q, params, setParams]);

  const path = `/projects?sort=${sort}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const { data: projects, error, loading } = useApi<BrowseProject[]>(path);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('home.projects')}</h2>
          <div className="flex gap-1 text-sm">
            {SORT_IDS.map((id) => (
              <button
                key={id}
                onClick={() => setSort(id)}
                className={`rounded px-2 py-1 ${
                  sort === id ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {t(`home.sort.${id}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <input
            type="search"
            aria-label={t('home.searchLabel')}
            placeholder={t('home.searchPlaceholder')}
            maxLength={SEARCH_MAX}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          />
          {text && (
            <button
              onClick={() => setText('')}
              className="shrink-0 rounded px-3 text-sm text-slate-400 hover:bg-slate-800"
            >
              {t('home.clear')}
            </button>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
        {loading && <p className="text-sm text-slate-400">{t('common.loading')}</p>}
        {projects?.length === 0 && (
          <p className="text-sm text-slate-400">
            {q ? t('home.noMatch', { q }) : t('home.noProjects')}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {projects?.map((p) => <ProjectCard key={p.id} project={p} />)}
        </div>
        {q && projects?.length === 50 && (
          <p className="text-xs text-slate-500">{t('home.first50')}</p>
        )}
      </section>

      {!q && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('home.recentUpdates')}</h2>
          <FeedList scope="all" empty={t('home.noUpdates')} />
        </section>
      )}
    </div>
  );
}

function Following({ goDiscover }: { goDiscover: () => void }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t('home.followingTitle')}</h2>
      <FeedList
        scope="following"
        empty={
          <p>
            {t('home.followingEmpty')}{' '}
            <button onClick={goDiscover} className="text-indigo-400 hover:underline">
              {t('home.findProject')}
            </button>
          </p>
        }
      />
    </section>
  );
}

function MyProjects() {
  const { t } = useTranslation();
  const { data: projects, error, loading } = useApi<Project[]>('/projects/mine');

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t('home.myProjects')}</h2>
        <Link
          to="/projects/new"
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium hover:bg-indigo-500"
        >
          {t('home.createProject')}
        </Link>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {loading && <p className="text-sm text-slate-400">{t('common.loading')}</p>}
      {projects?.length === 0 && <p className="text-sm text-slate-400">{t('home.noMine')}</p>}

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
  const { t } = useTranslation();
  const { user, loading, logout } = useAuth();
  const [params, setParams] = useSearchParams();

  if (loading) return <p className="text-center text-slate-400">{t('common.loading')}</p>;

  const tabs: { id: Tab; label: string }[] = [{ id: 'discover', label: t('home.tabs.discover') }];
  if (user) tabs.push({ id: 'following', label: t('home.tabs.following') });
  if (user?.role === 'DEV') tabs.push({ id: 'mine', label: t('home.tabs.mine') });

  const requested = params.get('tab');
  const tab: Tab = tabs.find((x) => x.id === requested)?.id ?? 'discover';

  function selectTab(id: Tab) {
    if (id === 'discover') setParams({});
    else setParams({ tab: id });
  }

  return (
    <div className="space-y-6">
      {user ? (
        <p className="text-center text-sm text-slate-400">
          {t('home.signedInAs')} <span className="font-semibold text-slate-200">{user.name}</span> ·{' '}
          {user.email} ({user.role}) ·{' '}
          <button onClick={() => void logout()} className="text-indigo-400 hover:underline">
            {t('home.signOut')}
          </button>
        </p>
      ) : (
        <div className="space-y-3 text-center">
          <p className="text-slate-400">{t('home.tagline')}</p>
          <div className="flex justify-center gap-3">
            <Link to="/signup" className="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500">
              {t('home.signUp')}
            </Link>
            <Link
              to="/login"
              className="rounded border border-slate-600 px-4 py-2 font-medium hover:bg-slate-800"
            >
              {t('home.signIn')}
            </Link>
          </div>
        </div>
      )}

      <nav className="flex gap-1 border-b border-slate-800">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => selectTab(x.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === x.id
                ? 'border-indigo-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {x.label}
          </button>
        ))}
      </nav>

      {tab === 'discover' && <Discover />}
      {tab === 'following' && <Following goDiscover={() => selectTab('discover')} />}
      {tab === 'mine' && <MyProjects />}
    </div>
  );
}