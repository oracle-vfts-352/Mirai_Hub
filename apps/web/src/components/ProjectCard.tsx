import { Link } from 'react-router-dom';
import { BrowseProject } from '../api';

export default function ProjectCard({ project }: { project: BrowseProject }) {
  return (
    <Link
      to={`/p/${project.slug}`}
      className="block h-full space-y-1 rounded border border-slate-800 p-3 hover:bg-slate-900"
    >
      <h3 className="font-semibold">{project.name}</h3>
      {project.tagline && <p className="line-clamp-2 text-sm text-slate-400">{project.tagline}</p>}
      <p className="text-xs text-slate-500">by {project.owner.name}</p>
      <p className="text-xs text-slate-500">
        {project._count.followers} followers · {project._count.feedback} feedback
      </p>
    </Link>
  );
}