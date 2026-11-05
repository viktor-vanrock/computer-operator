export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface Task {
  id: string
  title: string
  prompt: string
  imageId: string | null
  difficulty: Difficulty
  isPreset: boolean
  isVisible: boolean
  createdAt: string
}

export type AdminTask = Task;
