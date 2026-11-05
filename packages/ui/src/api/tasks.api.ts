/**
 * Хуки для работы с задачами.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../lib/api-client';
import type { AdminTask, Difficulty, Task } from '../types/task.types';

export const taskKeys = {
  all: ['tasks'] as const,
  preset: () => [...taskKeys.all, 'preset'] as const,
  detail: (id: string) => [...taskKeys.all, id] as const,
};

export function useTasks() {
  return useQuery({
    queryKey: taskKeys.preset(),
    queryFn: () => apiClient.get<Task[]>('/tasks'),
  });
}

export function useTask(id: string) {
  return useQuery({
    queryKey: taskKeys.detail(id),
    queryFn: () => apiClient.get<Task>(`/tasks/${id}`),
    enabled: !!id,
  });
}

export function useGenerateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.get<Task>('/tasks/random'),
    onSuccess: () => {
      // После генерации инвалидируем кеш — список задач обновится
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export interface CreateTaskInput {
  title: string;
  prompt: string;
  imageId?: string | null;
  difficulty: Difficulty;
  validationToken?: string;
}

export function useCreateTask() {
  return useMutation({
    mutationFn: (input: CreateTaskInput) => apiClient.post<Task>('/tasks', input),
  });
}

export interface PresetTaskInput {
  title: string;
  prompt: string;
  imageId: string | null;
  difficulty: Difficulty;
  isVisible: boolean;
}

export function useAdminPresetTasks() {
  return useQuery({
    queryKey: [...taskKeys.all, 'admin', 'preset'],
    queryFn: () => apiClient.get<AdminTask[]>('/tasks/admin/presets'),
  });
}

export function useCreatePresetTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PresetTaskInput) => apiClient.post<AdminTask>('/tasks/admin/presets', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useUpdatePresetTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PresetTaskInput }) =>
      apiClient.patch<AdminTask>(`/tasks/admin/presets/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useDeletePresetTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/tasks/admin/presets/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  });
}

export function useImportPresetTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tasks: PresetTaskInput[]) =>
      apiClient.post<AdminTask[]>('/tasks/admin/presets/import', { tasks }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  });
}
