import { ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth';

export default function RequireAuth({
  role,
  children,
}: {
  role?: 'DEV' | 'CONSUMER';
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const { t } = useTranslation();

  if (loading) return <p className="text-center text-slate-400">{t('common.loading')}</p>;
  if (!user) return <Navigate to="/login" replace />;

  if (role && user.role !== role) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-slate-300">
          {role === 'DEV' ? t('auth.requireDev') : t('auth.requireConsumer')}
        </p>
        <Link to="/" className="text-indigo-400 hover:underline">
          {t('common.backHome')}
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}