import { shared } from './shared';

// Each batch adds its area here, for example: { ...shared, home }
export const en = { ...shared };

// The Japanese dictionary must have exactly this shape.
export type Dictionary = typeof en;