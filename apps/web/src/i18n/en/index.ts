import { shared } from './shared';
import { homeTexts } from './home';
import { authTexts } from './auth';
import { projectTexts } from './project';
import { profileTexts } from './profile';
import { notificationTexts } from './notifications';
import { newProjectTexts } from './newProject';

// Each batch adds its area file here.
export const en = {
  ...shared,
  ...homeTexts,
  ...authTexts,
  ...projectTexts,
  ...profileTexts,
  ...notificationTexts,
  ...newProjectTexts,
};

// The Japanese dictionary must have exactly this shape.
export type Dictionary = typeof en;