import type { Difficulty } from '@arena/ui/types/task.types';

export type TaskSource = 'preset' | 'custom';

export interface SelectedTask {
  id: string | null;
  title: string;
  prompt: string;
  imageId: string | null;
  difficulty: Difficulty;
  source: TaskSource;
}
