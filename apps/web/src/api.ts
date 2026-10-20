export type User = {
  id: string;
  email: string;
  name: string;
  role: 'CONSUMER' | 'DEV';
};

export type Project = {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  vision: string | null;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetail = Project & {
  _count: { followers: number; feedback: number };
};

export type PostType = 'VISION' | 'ANNOUNCEMENT' | 'CHANGELOG';

export type Post = {
  id: string;
  projectId: string;
  type: PostType;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
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
  author: { id: string; name: string };
  voteCount: number;
  hasVoted: boolean;
};

export type FollowEntry = {
  userId: string;
  projectId: string;
  createdAt: string;
  project: { id: string; slug: string; name: string; tagline: string | null };
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
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Request failed');
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.name === 'NotAllowedError') {
    return 'The passkey prompt was cancelled or timed out.';
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}