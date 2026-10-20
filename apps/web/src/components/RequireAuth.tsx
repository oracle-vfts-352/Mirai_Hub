import { ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function RequireAuth({
  role,
  children,
}: {
  role?: 'DEV' | 'CONSUMER';
  children: ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) return <p className="text-center text-slate-400">Loading...</p>;
  if (!user) return <Navigate to="/login" replace />;

  if (role && user.role !== role) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-slate-300">
          {role === 'DEV'
            ? 'Only developer accounts can create projects.'
            : 'This page is for consumer accounts.'}
        </p>
        <Link to="/" className="text-indigo-400 hover:underline">
          Back to home
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}