import type { Dictionary } from '../en';
import { shared } from './shared';
import { homeTexts } from './home';
import { authTexts } from './auth';
import { projectTexts } from './project';

export const ja: Dictionary = { ...shared, ...homeTexts, ...authTexts, ...projectTexts };