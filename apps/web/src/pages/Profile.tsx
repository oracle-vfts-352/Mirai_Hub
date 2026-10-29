import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, errorMessage, PublicProfile, uploadFile } from '../api';
import { useAuth } from '../auth';
import Avatar from '../components/Avatar';
import ProjectLogo from '../components/ProjectLogo';

const input =
  'w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 outline-none focus:border-indigo-500';

const BIO_MAX = 500;
const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

// Upload / remove controls under your own avatar. The server checks everything again.
function AvatarControls({
  hasAvatar,
  onChanged,
}: {
  hasAvatar: boolean;
  onChanged: (url: string | null) => void;
}) {
  const { refresh } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same file be picked again
    if (!file) return;
    if (!AVATAR_TYPES.includes(file.type)) {
      setError('Use a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError('Image is too large (max 2 MB).');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const res = await uploadFile<{ avatarUrl: string | null }>('/me/avatar', 'avatar', file);
      await refresh(); // the header shows your avatar too
      onChanged(res.avatarUrl);
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
      await api('/me/avatar', { method: 'DELETE' });
      await refresh();
      onChanged(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1 text-center text-xs">
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => void pick(e)}
        className="hidden"
      />
      <div className="flex justify-center gap-2">
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="text-indigo-400 hover:underline disabled:opacity-50"
        >
          {busy ? 'Working...' : hasAvatar ? 'Change photo' : 'Add photo'}
        </button>
        {hasAvatar && !busy && (
          <button onClick={() => void remove()} className="text-red-400 hover:underline">
            Remove
          </button>
        )}
      </div>
      {error && <p className="max-w-[10rem] text-red-400">{error}</p>}
    </div>
  );
}

function EditProfileForm({
  profile,
  onSaved,
  onCancel,
}: {
  profile: PublicProfile;
  onSaved: (name: string, bio: string | null) => void;
  onCancel: () => void;
}) {
  const { refresh } = useAuth();
  const [name, setName] = useState(profile.name);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // an empty bio clears it on the server
      const saved = await api<{ id: string; name: string; bio: string | null }>('/me', {
        method: 'PATCH',
        body: { name: name.trim(), bio: bio.trim() },
      });
      await refresh(); // the header shows the signed-in user's name
      onSaved(saved.name, saved.bio);
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
        <span className="text-sm text-slate-300">Bio</span>
        <textarea
          className={`${input} h-28`}
          maxLength={BIO_MAX}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
        <span className="block text-right text-xs text-slate-500">
          {bio.length}/{BIO_MAX}
        </span>
      </label>
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

export default function Profile() {
  const { id = '' } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setError('');
    setEditing(false);
    api<PublicProfile>(`/users/${encodeURIComponent(id)}`)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch((err) => {
        if (cancelled) return;
        // 400 = not a valid id, 404 = no such user: both mean "no such profile"
        const missing = err instanceof ApiError && (err.status === 404 || err.status === 400);
        setError(missing ? 'User not found.' : errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

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
  if (!profile) return <p className="text-center text-slate-400">Loading...</p>;

  const isMe = user?.id === profile.id;

  return (
    <article className="space-y-6">
      <div className="flex items-start gap-4">
        <div className="space-y-2">
          <Avatar url={profile.avatarUrl} name={profile.name} size="lg" />
          {isMe && (
            <AvatarControls
              hasAvatar={profile.avatarUrl !== null}
              onChanged={(url) => setProfile((p) => (p ? { ...p, avatarUrl: url } : p))}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          {isMe && editing ? (
            <EditProfileForm
              profile={profile}
              onSaved={(name, bio) => {
                setProfile((p) => (p ? { ...p, name, bio } : p));
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <header className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h2 className="break-words text-2xl font-bold">{profile.name}</h2>
                  <p className="text-xs text-slate-500">
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">
                      {profile.role === 'DEV' ? 'Developer' : 'Consumer'}
                    </span>
                    <span className="ml-2">Joined {new Date(profile.createdAt).toLocaleDateString()}</span>
                    {isMe && (
                      <span className="ml-2 rounded bg-indigo-900 px-2 py-0.5 text-indigo-200">You</span>
                    )}
                  </p>
                </div>
                {isMe && (
                  <button
                    onClick={() => setEditing(true)}
                    className="shrink-0 text-sm text-indigo-400 hover:underline"
                  >
                    Edit profile
                  </button>
                )}
              </div>
              {profile.bio ? (
                <p className="whitespace-pre-wrap break-words text-slate-200">{profile.bio}</p>
              ) : (
                <p className="text-sm text-slate-500">
                  {isMe ? 'You have not written a bio yet.' : 'No bio yet.'}
                </p>
              )}
            </header>
          )}
        </div>
      </div>

      {profile.role === 'DEV' && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Projects</h3>
          {profile.projects.length === 0 && <p className="text-sm text-slate-400">No projects yet.</p>}
          <ul className="space-y-2">
            {profile.projects.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/p/${p.slug}`}
                  className="flex items-start gap-3 rounded border border-slate-800 p-3 hover:bg-slate-900"
                >
                  <ProjectLogo url={p.logoUrl} name={p.name} size="md" />
                  <div className="min-w-0">
                    <span className="font-medium">{p.name}</span>
                    {p.tagline && <p className="text-sm text-slate-400">{p.tagline}</p>}
                    <p className="text-xs text-slate-500">
                      {p._count.followers} followers · {p._count.feedback} feedback
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link to="/" className="text-sm text-indigo-400 hover:underline">
        Back to home
      </Link>
    </article>
  );
}