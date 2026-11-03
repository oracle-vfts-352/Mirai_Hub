import { shared } from './shared';
import { homeTexts } from './home';
import { authTexts } from './auth';
import { projectTexts } from './project';

// Each batch adds its area file here.
export const en = { ...shared, ...homeTexts, ...authTexts, ...projectTexts };

// The Japanese dictionary must have exactly this shape.
export type Dictionary = typeof en;