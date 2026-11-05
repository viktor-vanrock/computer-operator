import type { Difficulty } from '@arena/ui/types/task.types';

export interface TaskFormValue {
  title: string;
  prompt: string;
  imageId: string | null;
  difficulty: Difficulty;
  isVisible: boolean;
}

export const EMPTY_TASK_FORM: TaskFormValue = {
  title: '',
  prompt: '',
  imageId: null,
  difficulty: 1,
  isVisible: true,
};
