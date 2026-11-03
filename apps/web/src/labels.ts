import { FeedbackStatus, PostType } from './api';
import i18n from './i18n';

// A Record whose values are looked up in the CURRENT language every time they are read, so every
// existing STATUS_LABEL[...] / POST_TYPE_LABEL[...] call keeps working and follows the toggle.
function translatedMap<K extends string>(prefix: string, keys: readonly K[]): Record<K, string> {
  const map = {} as Record<K, string>;
  for (const key of keys) {
    Object.defineProperty(map, key, { enumerable: true, get: () => i18n.t(`${prefix}.${key}`) });
  }
  return map;
}

export const STATUS_ORDER: FeedbackStatus[] = [
  'OPEN',
  'UNDER_REVIEW',
  'PLANNED',
  'IN_PROGRESS',
  'SHIPPED',
  'DECLINED',
];

export const STATUS_LABEL = translatedMap('status', STATUS_ORDER);

export const STATUS_STYLE: Record<FeedbackStatus, string> = {
  OPEN: 'bg-slate-800 text-slate-300',
  UNDER_REVIEW: 'bg-amber-900 text-amber-200',
  PLANNED: 'bg-sky-900 text-sky-200',
  IN_PROGRESS: 'bg-indigo-900 text-indigo-200',
  SHIPPED: 'bg-emerald-900 text-emerald-200',
  DECLINED: 'bg-red-900 text-red-200',
};

export const POST_TYPE_ORDER: PostType[] = ['ANNOUNCEMENT', 'CHANGELOG', 'VISION'];

export const POST_TYPE_LABEL = translatedMap('postType', POST_TYPE_ORDER);