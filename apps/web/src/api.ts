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