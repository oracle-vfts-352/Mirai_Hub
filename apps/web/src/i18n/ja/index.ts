import type { Dictionary } from '../en';
import { shared } from './shared';
import { homeTexts } from './home';
import { authTexts } from './auth';
import { projectTexts } from './project';
import { profileTexts } from './profile';
import { notificationTexts } from './notifications';
import { newProjectTexts } from './newProject';

export const ja: Dictionary = {
  ...shared,
  ...homeTexts,
  ...authTexts,
  ...projectTexts,
  ...profileTexts,
  ...notificationTexts,
  ...newProjectTexts,
};