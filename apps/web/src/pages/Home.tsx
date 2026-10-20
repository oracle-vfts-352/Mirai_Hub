import { Link } from 'react-router-dom';
import { useAuth } from '../auth';

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
    <div className="space-y-3 text-center">
      <p>
        Signed in as <span className="font-semibold">{user.name}</span>
      </p>
      <p className="text-sm text-slate-400">
        {user.email} ({user.role})
      </p>
      <button
        onClick={() => void logout()}
        className="rounded border border-slate-600 px-4 py-2 font-medium hover:bg-slate-800"
      >
        Sign out
      </button>
    </div>
  );
}