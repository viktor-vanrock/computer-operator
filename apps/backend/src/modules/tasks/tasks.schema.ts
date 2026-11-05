import { z } from 'zod';

import { DIFFICULTY_MAX, DIFFICULTY_MIN, TASK_PROMPT_MIN, TASK_TITLE_MIN } from './tasks.constants.js';

export const DifficultySchema = z.number().int().min(DIFFICULTY_MIN).max(DIFFICULTY_MAX);
const TaskImageIdSchema = z.string().trim().min(1).max(255).nullable();

const TaskPublicFieldsSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(TASK_TITLE_MIN),
  prompt: z.string().min(TASK_PROMPT_MIN),
  imageId: TaskImageIdSchema,
  difficulty: DifficultySchema,
  isPreset: z.boolean(),
  isVisible: z.boolean(),
  createdAt: z.string(),
});

export const TaskSchema = TaskPublicFieldsSchema;

export const AdminTaskSchema = TaskPublicFieldsSchema;

export const CreateTaskSchema = z.object({
  title: z.string().min(TASK_TITLE_MIN),
  prompt: z.string().min(TASK_PROMPT_MIN),
  imageId: TaskImageIdSchema.default(null),
  difficulty: DifficultySchema,
  validationToken: z.string().min(1).optional(),
});

export const CreatePresetTaskSchema = CreateTaskSchema.omit({ validationToken: true }).extend({
  isVisible: z.boolean().default(true),
});

export const UpdatePresetTaskSchema = z.object({
  title: z.string().min(TASK_TITLE_MIN),
  prompt: z.string().min(TASK_PROMPT_MIN),
  imageId: TaskImageIdSchema,
  difficulty: DifficultySchema,
  isVisible: z.boolean(),
});

export const ImportPresetTasksSchema = z.object({
  tasks: z.array(CreatePresetTaskSchema).min(1),
});
