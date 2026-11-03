import i18n from './i18n';

export type User = {
  id: string;
  email: string;
  name: string;
  role: 'CONSUMER' | 'DEV';
  avatarUrl: string | null;
  emailVerified: boolean;
};

export type Project = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  vision: string | null;
  logoUrl: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetail = Project & {
  owner: { id: string; name: string; avatarUrl: string | null };
  _count: { followers: number; feedback: number };
};

// Public browse list item (GET /projects): owner name only, no vision
export type BrowseProject = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  createdAt: string;
  owner: { id: string; name: string };
  _count: { followers: number; feedback: number };
};

// Public profile (GET /users/:id): never contains an email
export type ProfileProject = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  createdAt: string;
  _count: { followers: number; feedback: number };
};

export type PublicProfile = {
  id: string;
  name: string;
  bio: string | null;
  avatarUrl: string | null;
  role: 'CONSUMER' | 'DEV';
  createdAt: string;
  projects: ProfileProject[];
};

export type PostType = 'VISION' | 'ANNOUNCEMENT' | 'CHANGELOG';

export type Post = {
  id: string;
  projectId: string;
  type: PostType;
  title: string;
  body: string;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

// Feed item (GET /feed): a short excerpt instead of the full body
export type FeedPost = {
  id: string;
  type: PostType;
  title: string;
  excerpt: string;
  coverUrl: string | null;
  createdAt: string;
  project: { slug: string; name: string; logoUrl: string | null };
};

export type FeedbackStatus =
  | 'OPEN'
  | 'UNDER_REVIEW'
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'SHIPPED'
  | 'DECLINED';

export type FeedbackItem = {
  id: string;
  projectId: string;
  authorId: string;
  title: string;
  body: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
  author: { id: string; name: string; avatarUrl: string | null };
  voteCount: number;
  hasVoted: boolean;
  ownerReply: string | null;
  ownerReplyAt: string | null;
  postId: string | null;
  post: { id: string; title: string } | null;
};

export type FollowEntry = {
  userId: string;
  projectId: string;
  createdAt: string;
  project: { id: string; slug: string; name: string; tagline: string | null };
};

export type NotificationType = 'FEEDBACK_STATUS' | 'NEW_POST' | 'FEEDBACK_REPLY' | 'NEW_FEEDBACK';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  project: { slug: string; name: string };
  refId: string;
  title: string | null; // null when the feedback item or post was deleted
  status: FeedbackStatus | null; // the item's CURRENT status (not the status at event time)
  read: boolean;
  createdAt: string;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Same-origin calls through the Vite proxy: the HttpOnly cookies are sent automatically.
export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const hasBody = options.body !== undefined;
  const res = await fetch(`/api${path}`, {
    method: options.method ?? (hasBody ? 'POST' : 'GET'),
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? i18n.t('errors.requestFailed'));
  return data as T;
}

// Multipart upload (one file). No Content-Type header: the browser adds the boundary itself.
export async function uploadFile<T = unknown>(path: string, field: string, file: File): Promise<T> {
  const form = new FormData();
  form.append(field, file);
  const res = await fetch(`/api${path}`, { method: 'POST', body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // nginx answers 413 with an HTML page, not our JSON
    if (res.status === 413) throw new ApiError(413, i18n.t('errors.fileTooLarge'));
    throw new ApiError(res.status, data?.error ?? i18n.t('errors.uploadFailed'));
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.name === 'NotAllowedError') {
    return i18n.t('errors.passkeyCancelled');
  }
  if (err instanceof Error) return err.message;
  return i18n.t('errors.generic');
}