import type { Difficulty } from '@arena/ui/types/task.types';

export { BASE_TRANSITION, FADE_UP } from '@arena/ui/constants/motion';

export const DIFFICULTY_LABELS: Record<Difficulty, { label: string; sublabel: string }> = {
  1: { label: '★', sublabel: 'Легко' },
  2: { label: '★★', sublabel: 'Просто' },
  3: { label: '★★★', sublabel: 'Средне' },
  4: { label: '★★★★', sublabel: 'Сложно' },
  5: { label: '★★★★★', sublabel: 'Эксперт' },
};

export const DIFFICULTIES: Difficulty[] = [1, 2, 3, 4, 5];
