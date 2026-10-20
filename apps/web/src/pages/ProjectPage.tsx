import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage, ProjectDetail } from '../api';
import { useAuth } from '../auth';

export default function ProjectPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setProject(null);
    setError('');
    api<ProjectDetail>(`/projects/${encodeURIComponent(slug)}`)
      .then((p) => {
        if (!cancelled) setProject(p);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError && err.status === 404 ? 'Project not found.' : errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (error) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-slate-300">{error}</p>
        <Link to="/" className="text-indigo-400 hover:underline">
          Back to home
        </Link>
      </div>
    );
  }
  if (!project) return <p className="text-center text-slate-400">Loading...</p>;

  const isOwner = user?.id === project.ownerId;

  return (
    <article className="space-y-4">
      <header className="space-y-1">
        <h2 className="text-2xl font-bold">{project.name}</h2>
        {project.tagline && <p className="text-slate-400">{project.tagline}</p>}
        <p className="text-xs text-slate-500">
          {project._count.followers} followers · {project._count.feedback} feedback
          {isOwner && <span className="ml-2 rounded bg-indigo-900 px-2 py-0.5 text-indigo-200">Your project</span>}
        </p>
      </header>

      {project.vision && <p className="whitespace-pre-wrap text-slate-200">{project.vision}</p>}

      <p className="text-sm text-slate-500">Posts and feedback will appear here next.</p>

      <Link to="/" className="text-sm text-indigo-400 hover:underline">
        Back to home
      </Link>
    </article>
  );
}