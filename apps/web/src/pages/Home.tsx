import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage, Project } from '../api';
import { useAuth } from '../auth';

function MyProjects() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api<Project[]>('/projects/mine')
      .then((p) => {
        if (!cancelled) setProjects(p);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-3 text-left">
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
      {!error && projects === null && <p className="text-sm text-slate-400">Loading...</p>}
      {projects?.length === 0 && (
        <p className="text-sm text-slate-400">No projects yet. Create your first one.</p>
      )}

      <ul className="space-y-2">
        {projects?.map((p) => (
          <li key={p.id}>
            <Link
              to={`/p/${p.slug}`}
              className="block rounded border border-slate-700 px-3 py-2 hover:bg-slate-900"
            >
              <span className="font-medium">{p.name}</span>
              <span className="ml-2 text-sm text-slate-400">/{p.slug}</span>
              {p.tagline && <p className="text-sm text-slate-400">{p.tagline}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function Home() {
  const { user, loading, logout } = useAuth();

  if (loading) return <p className="text-center text-slate-400">Loading...</p>;

  if (!user) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-slate-400">Share your vision. Hear what matters.</p>
        <div className="flex gap-3 justify-center">
          <Link to="/signup" className="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500">
            Sign up
          </Link>
          <Link to="/login" className="rounded border border-slate-600 px-4 py-2 font-medium hover:bg-slate-800">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <p>
          Signed in as <span className="font-semibold">{user.name}</span>
        </p>
        <p className="text-sm text-slate-400">
          {user.email} ({user.role})
        </p>
        <button
          onClick={() => void logout()}
          className="mt-2 rounded border border-slate-600 px-4 py-2 text-sm font-medium hover:bg-slate-800"
        >
          Sign out
        </button>
      </div>

      {user.role === 'DEV' ? (
        <MyProjects />
      ) : (
        <p className="text-center text-sm text-slate-400">
          You are signed in as a consumer. Following projects and giving feedback comes next.
        </p>
      )}
    </div>
  );
}