import { useEffect, useState } from 'react';

const SIZES = {
  sm: 'h-5 w-5 text-[9px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-xl',
} as const;

// One word: its first two letters. Several words: the first letters of the first two.
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}

export default function ProjectLogo({
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

  const base = `${SIZES[size]} shrink-0 rounded-lg`;
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        onError={() => setFailed(true)}
        className={`${base} bg-slate-800 object-contain`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`${base} flex items-center justify-center bg-indigo-900 font-semibold text-indigo-100`}
    >
      {initials(name)}
    </span>
  );
}