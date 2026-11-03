import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BrowseProject } from '../api';
import ProjectLogo from './ProjectLogo';

export default function ProjectCard({ project }: { project: BrowseProject }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/p/${project.slug}`}
      className="flex h-full items-start gap-3 rounded border border-slate-800 p-3 hover:bg-slate-900"
    >
      <ProjectLogo url={project.logoUrl} name={project.name} size="md" />
      <div className="min-w-0 space-y-1">
        <h3 className="font-semibold">{project.name}</h3>
        {project.tagline && <p className="line-clamp-2 text-sm text-slate-400">{project.tagline}</p>}
        <p className="text-xs text-slate-500">{t('project.byName', { name: project.owner.name })}</p>
        <p className="text-xs text-slate-500">
          {t('project.followers', { count: project._count.followers })} ·{' '}
          {t('project.feedbackCount', { count: project._count.feedback })}
        </p>
      </div>
    </Link>
  );
}