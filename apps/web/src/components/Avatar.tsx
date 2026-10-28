import { useEffect, useState } from 'react';

const SIZES = {
  sm: 'h-5 w-5 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-20 w-20 text-2xl',
} as const;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = Array.from(parts[0])[0];
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] : '';
  return (first + last).toUpperCase();
}

export default function Avatar({
  url,
  name,
  size = 'md',
}: {
  url: string | null | undefined;
  name: string;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]); // a new upload gets a fresh chance

  const base = `${SIZES[size]} shrink-0 rounded-full`;
  if (url && !failed) {
    return <img src={url} alt="" onError={() => setFailed(true)} className={`${base} object-cover`} />;
  }
  return (
    <span aria-hidden className={`${base} flex items-center justify-center bg-slate-700 font-medium text-slate-200`}>
      {initials(name)}
    </span>
  );
}