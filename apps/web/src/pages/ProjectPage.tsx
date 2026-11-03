import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError, errorMessage, Project, ProjectDetail, uploadFile } from '../api';
import { useAuth } from '../auth';
import Avatar from '../components/Avatar';
import FeedbackSection from '../components/FeedbackSection';
import FollowButton from '../components/FollowButton';
import PostList from '../components/PostList';
import ProjectLogo from '../components/ProjectLogo';

const input =
  'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-500';

const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

// Stored in state instead of a text, so the message is translated while rendering
const NOT_FOUND = '__not_found__';

// Logo upload / remove. It happens right away and is not tied to the Save button of the form.
function LogoControls({
  project,
  onChanged,
}: {
  project: ProjectDetail;
  onChanged: (url: string | null) => void;
}) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be picked again
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setError(t('project.logo.badType'));
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setError(t('project.logo.tooLarge'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      const res = await uploadFile<{ logoUrl: string | null }>(`/projects/${project.id}/logo`, 'logo', file);
      onChanged(res.logoUrl);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setError('');
    setBusy(true);
    try {
      await api(`/projects/${project.id}/logo`, { method: 'DELETE' });
      onChanged(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <ProjectLogo url={project.logoUrl} name={project.name} size="lg" />
      <div className="space-y-1 text-xs">
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => void pick(e)}
          className="hidden"
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="text-indigo-400 hover:underline disabled:opacity-50"
          >
            {busy ? t('project.logo.working') : project.logoUrl ? t('project.logo.change') : t('project.logo.add')}
          </button>
          {project.logoUrl && !busy && (
            <button type="button" onClick={() => void remove()} className="text-red-400 hover:underline">
              {t('project.logo.remove')}
            </button>
          )}
        </div>
        <p className="text-slate-500">{t('project.logo.hint')}</p>
        {error && <p className="text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function EditProjectForm({
  project,
  onSaved,
  onLogoChanged,
  onCancel,
}: {
  project: ProjectDetail;
  onSaved: (updated: Project) => void;
  onLogoChanged: (url: string | null) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
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
      <LogoControls project={project} onChanged={onLogoChanged} />
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">{t('project.form.name')}</span>
        <input
          className={input}
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">{t('project.form.tagline')}</span>
        <input
          className={input}
          maxLength={160}
          value={tagline}
          onChange={(e) => setTagline(e.target.value)}
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">{t('project.form.vision')}</span>
        <textarea
          className={`${input} h-32`}
          maxLength={5000}
          value={vision}
          onChange={(e) => setVision(e.target.value)}
        />
      </label>
      <p className="text-xs text-slate-500">
        {t('project.form.addressStays')} <span className="text-slate-300">/p/{project.slug}</span>
      </p>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || name.trim().length === 0}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? t('project.form.saving') : t('project.form.save')}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-slate-400 hover:underline">
          {t('project.form.cancel')}
        </button>
      </div>
    </form>
  );
}

export default function ProjectPage() {
  const { t } = useTranslation();
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
        setError(err instanceof ApiError && err.status === 404 ? NOT_FOUND : errorMessage(err));
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
        <p className="text-slate-300">{error === NOT_FOUND ? t('project.notFound') : error}</p>
        <Link to="/" className="text-indigo-400 hover:underline">
          {t('common.backHome')}
        </Link>
      </div>
    );
  }
  if (!project) return <p className="text-center text-slate-400">{t('common.loading')}</p>;

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
          onLogoChanged={(url) => setProject((p) => (p ? { ...p, logoUrl: url } : p))}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <header className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <ProjectLogo url={project.logoUrl} name={project.name} size="lg" />
              <div className="min-w-0 space-y-1">
                <h2 className="break-words text-2xl font-bold">{project.name}</h2>
                {project.tagline && <p className="text-slate-400">{project.tagline}</p>}
                <p className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span>{t('project.by')}</span>
                  <Avatar url={project.owner.avatarUrl} name={project.owner.name} size="sm" />
                  <Link to={`/u/${project.owner.id}`} className="text-indigo-400 hover:underline">
                    {project.owner.name}
                  </Link>
                </p>
              </div>
            </div>
            <FollowButton
              projectId={project.id}
              slug={project.slug}
              ownerId={project.ownerId}
              onChange={(d) => adjust('followers', d)}
            />
          </div>
          <p className="text-xs text-slate-500">
            {t('project.followers', { count: project._count.followers })} ·{' '}
            {t('project.feedbackCount', { count: project._count.feedback })}
            {isOwner && (
              <span className="ml-2 rounded bg-indigo-900 px-2 py-0.5 text-indigo-200">
                {t('project.yourProject')}
              </span>
            )}
          </p>
          {isOwner && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setEditing(true)}
                className="text-sm text-indigo-400 hover:underline"
              >
                {t('project.editProject')}
              </button>
              {!project.logoUrl && (
                <span className="text-xs text-slate-500">{t('project.noLogoHint')}</span>
              )}
            </div>
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
        {t('common.backHome')}
      </Link>
    </article>
  );
}