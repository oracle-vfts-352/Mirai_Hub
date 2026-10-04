import React from 'react';

export const SkeletonCard: React.FC = () => {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 bg-white dark:bg-zinc-900/50 shadow-sm animate-pulse-fast">
      {/* Header Line Skeleton */}
      <div className="flex justify-between items-center mb-4">
        <div className="h-5 bg-zinc-200 dark:bg-zinc-800 rounded w-1/3"></div>
        <div className="h-6 bg-zinc-200 dark:bg-zinc-800 rounded-full w-16"></div>
      </div>
      
      {/* Body Line Skeletons */}
      <div className="space-y-3">
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-3/4"></div>
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-1/2"></div>
      </div>

      {/* Footer Metrics Skeletons */}
      <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800/60 flex justify-between">
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-1/4"></div>
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded w-1/4"></div>
      </div>
    </div>
  );
};
