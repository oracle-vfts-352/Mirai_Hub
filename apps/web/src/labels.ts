import { FeedbackStatus, PostType } from './api';

export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  OPEN: 'Open',
  UNDER_REVIEW: 'Under review',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  SHIPPED: 'Shipped',
  DECLINED: 'Declined',
};

export const STATUS_STYLE: Record<FeedbackStatus, string> = {
  OPEN: 'bg-slate-800 text-slate-300',
  UNDER_REVIEW: 'bg-amber-900 text-amber-200',
  PLANNED: 'bg-sky-900 text-sky-200',
  IN_PROGRESS: 'bg-indigo-900 text-indigo-200',
  SHIPPED: 'bg-emerald-900 text-emerald-200',
  DECLINED: 'bg-red-900 text-red-200',
};

export const STATUS_ORDER: FeedbackStatus[] = [
  'OPEN',
  'UNDER_REVIEW',
  'PLANNED',
  'IN_PROGRESS',
  'SHIPPED',
  'DECLINED',
];

export const POST_TYPE_LABEL: Record<PostType, string> = {
  VISION: 'Vision',
  ANNOUNCEMENT: 'Announcement',
  CHANGELOG: 'Changelog',
};

export const POST_TYPE_ORDER: PostType[] = ['ANNOUNCEMENT', 'CHANGELOG', 'VISION'];