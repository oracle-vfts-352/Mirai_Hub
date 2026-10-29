import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage, Project, ProjectDetail } from '../api';
import { useAuth } from '../auth';
import FeedbackSection from '../components/FeedbackSection';
import FollowButton from '../components/FollowButton';
import PostList from '../components/PostList';
import Avatar from '../components/Avatar';

const input =
  'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-500';

function EditProjectForm({
  project,
  onSaved,
  onCancel,
}: {
  project: ProjectDetail;
  onSaved: (updated: Project) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(project.name);
  const [tagline, setTagline] = useState(project.tagline ?? '');
  const [vision, setVision] = useState(project.vision ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // Empty strings clear the tagline / vision; the slug is not editable
      const updated = await api<Project>(`/projects/${project.id}`, {
        method: 'PATCH',
        body: { name: name.trim(), tagline: tagline.trim(), vision: vision.trim() },
      });
      onSaved(updated);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-slate-700 p-3">
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">Name</span>
        <input
          className={input}
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">Tagline</span>
        <input
          className={input}
          maxLength={160}
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">Vision</span>
        <textarea
          className={`${input} h-32`}
          maxLength={5000}
          value={vision}
          onChange={(e) => setVision(e.target.value)}
        />
      </label>
      <p className="text-xs text-slate-500">
        The page address stays <span className="text-slate-300">/p/{project.slug}</span>.
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-slate-400 hover:underline">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function ProjectPage() {
  const [aboutPost, setAboutPost] = useState<{ id: string; title: string } | null>(null);
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProject(null);
    setError('');
    setEditing(false);
    setAboutPost(null);
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

  // Keep the header counts in step with what the person just did
  function adjust(field: 'followers' | 'feedback', delta: number) {
    setProject((p) =>
      p ? { ...p, _count: { ...p._count, [field]: Math.max(0, p._count[field] + delta) } } : p,
    );
  }

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
    <article className="space-y-8">
      {isOwner && editing ? (
        <EditProjectForm
          project={project}
          onSaved={(updated) => {
            // the PATCH response has no counts or owner, so keep the ones we already have
            setProject((p) => (p ? { ...p, ...updated } : p));
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold">{project.name}</h2>
              {project.tagline && <p className="text-slate-400">{project.tagline}</p>}
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <span>by</span>
                <Avatar url={project.owner.avatarUrl} name={project.owner.name} size="sm" />
                <Link to={`/u/${project.owner.id}`} className="text-indigo-400 hover:underline">
                  {project.owner.name}
                </Link>
              </p>
            </div>
            <FollowButton
              projectId={project.id}
              slug={project.slug}
              ownerId={project.ownerId}
              onChange={(d) => adjust('followers', d)}
            />
          </div>
          <p className="text-xs text-slate-500">
            {project._count.followers} followers · {project._count.feedback} feedback
            {isOwner && (
              <span className="ml-2 rounded bg-indigo-900 px-2 py-0.5 text-indigo-200">Your project</span>
            )}
          </p>
          {isOwner && (
            <button
              onClick={() => setEditing(true)}
              className="text-sm text-indigo-400 hover:underline"
            >
              Edit project
            </button>
          )}
          {project.vision && (
            <p className="whitespace-pre-wrap pt-2 text-slate-200">{project.vision}</p>
          )}
        </header>
      )}

      <PostList
        key={`posts-${project.slug}`}
        slug={project.slug}
        isOwner={isOwner}
        onGiveFeedback={(post) => {
          setAboutPost(post);
          document.getElementById('feedback')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        onDeleted={(id) => setAboutPost((a) => (a?.id === id ? null : a))}
      />

      <FeedbackSection
        key={`feedback-${project.slug}`}
        slug={project.slug}
        isOwner={isOwner}
        ownerName={project.owner.name}
        aboutPost={aboutPost}
        onAboutChange={setAboutPost}
        onCreated={() => adjust('feedback', 1)}
      />

      <Link to="/" className="text-sm text-indigo-400 hover:underline">
        Back to home
      </Link>
    </article>
  );
}