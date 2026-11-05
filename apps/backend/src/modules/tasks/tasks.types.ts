import type {
  AdminTaskSchema,
  CreatePresetTaskSchema,
  CreateTaskSchema,
  DifficultySchema,
  ImportPresetTasksSchema,
  TaskSchema,
  UpdatePresetTaskSchema,
} from './tasks.schema.js';
import type { z } from 'zod';


export type Difficulty = z.infer<typeof DifficultySchema>;
export type Task = z.infer<typeof TaskSchema>;
export type AdminTask = z.infer<typeof AdminTaskSchema>;
export type CreateTaskInput = Omit<z.infer<typeof CreateTaskSchema>, 'validationToken'>;
export type CreatePresetTaskInput = z.infer<typeof CreatePresetTaskSchema>;
export type UpdatePresetTaskInput = z.infer<typeof UpdatePresetTaskSchema>;
export type ImportPresetTasksInput = z.infer<typeof ImportPresetTasksSchema>;
