import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorMessage, Project } from '../api';

// Same rules as routes/projects.ts (the server stays the authority)
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = ['mine', 'new', 'admin', 'api'];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function slugProblem(slug: string): string | null {
  if (!slug) return null; // don't nag before the person starts typing
  if (!SLUG_RE.test(slug)) return 'Use 3-40 letters, numbers or dashes (no dash at the start or end).';
  if (RESERVED.includes(slug)) return 'That slug is reserved.';
  return null;
}

const input =
  'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-500';

export default function NewProject() {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [tagline, setTagline] = useState('');
  const [vision, setVision] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const problem = slugProblem(slug);
  const canSubmit = name.trim().length > 0 && slug.length > 0 && !problem && !busy;

  function onName(value: string) {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // Empty optional fields are left out instead of sent as ""
      const body: Record<string, string> = { name: name.trim(), slug };
      if (tagline.trim()) body.tagline = tagline.trim();
      if (vision.trim()) body.vision = vision.trim();
      const project = await api<Project>('/projects', { method: 'POST', body });
      navigate(`/p/${project.slug}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold">Create a project</h2>

      <label className="block space-y-1">
        <span className="text-sm text-slate-300">Name</span>
        <input className={input} required maxLength={80} value={name} onChange={(e) => onName(e.target.value)} />
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-slate-300">Page address</span>
        <input
          className={input}
          required
          maxLength={40}
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase().trim());
          }}
        />
        {problem ? (
          <span className="text-xs text-red-400">{problem}</span>
        ) : (
          <span className="text-xs text-slate-500">
            {window.location.host}/p/{slug || '...'}
          </span>
        )}
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-slate-300">Tagline (optional)</span>
        <input className={input} maxLength={160} value={tagline} onChange={(e) => setTagline(e.target.value)} />
      </label>

      <label className="block space-y-1">
        <span className="text-sm text-slate-300">Vision (optional)</span>
        <textarea
          className={`${input} h-32`}
          maxLength={5000}
          value={vision}
          onChange={(e) => setVision(e.target.value)}
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded bg-indigo-600 px-4 py-2 font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? 'Creating...' : 'Create project'}
        </button>
        <Link to="/" className="text-sm text-slate-400 hover:underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}