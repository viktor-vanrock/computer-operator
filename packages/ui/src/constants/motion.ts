import type { Transition } from 'framer-motion';

export const BASE_TRANSITION: Transition = { duration: 0.4, ease: 'easeOut' };

export const FADE_UP = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: BASE_TRANSITION,
};
